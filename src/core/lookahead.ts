// ---------------------------------------------------------------------------
// King endgame lookahead — a perfect-information max-n game-tree search over the
// remaining tricks of the current round.
//
// The server bot legally sees every hand (botAction reads the unredacted state),
// so trick play is a fully deterministic, perfect-information multi-player game.
// King's scoring is arranged so that HIGHER is always better for every seat
// (penalty modes score negatively, Trump positively — see gameConfigs.ts), which
// makes the value at each node a plain per-seat score vector and every seat a
// maximiser of its own component. That is textbook max-n (Luckhardt & Irani).
//
// A full-round search from the opening lead is astronomically large, so this is
// gated to the ENDGAME: only when the largest remaining hand is small enough does
// the search run to the true end of the round (optimal play); otherwise, and on
// any node-budget blow-out, it falls back to the shipped greedy heuristic
// (aiChooseCard). The endgame is exactly where the greedy bot misplays — dumping
// the last penalty, dodging the King of Hearts on the final tricks, and the
// Last-Two-Tricks switch — so solving it exactly is where the points are.
// ---------------------------------------------------------------------------

import type { Card, GameModeId, GameState, ScoringConfig, Suit } from '../models/types';
import { getValidCards } from './rules';
import { getCurrentPlayerIdx } from './gameEngine';
import { aiChooseCard } from './ai';

// Only attempt the exact search when the largest remaining hand is at most this
// many cards. Beyond it the tree is too wide to solve in time and we defer to the
// heuristic. Kept per-player-count: the 52-card 4-player game branches wider (four
// seats), so it earns a slightly tighter gate than the 32-card 3-player game.
const HAND_GATE_4P = 4;
const HAND_GATE_3P = 5;

// Hard ceiling on explored nodes. A follow-suit-light position (everyone void of
// the led suit → free discards) can still explode past the gate, so this backstop
// aborts the search and the caller falls back to the greedy heuristic for that one
// decision. Sized to stay well under a few milliseconds per move.
const NODE_BUDGET = 600_000;

/** Thrown to unwind the recursion when the node budget is exhausted. */
const ABORT = Symbol('lookahead-abort');

/**
 * A compact, fast-to-clone snapshot of an in-progress round. Deliberately NOT the
 * full GameState — the reducer's immutable spreads are far too heavy to run at
 * every node of a search tree, and we only need what affects trick outcomes and
 * scoring.
 */
interface Sim {
  /** Remaining hand per seat (seat index === players[] index). */
  hands: Card[][];
  /** Cards played into the current, in-progress trick, in play order. */
  plays: Card[];
  /** Seat that led the current trick (plays[0] is theirs). */
  leaderIdx: number;
  /** Per-seat score accrued by tricks RESOLVED during the search (offset-free). */
  scores: number[];
  /** Count of tricks resolved so far in the whole round (incl. before search). */
  tricksResolved: number;
}

/** Immutable context shared by every node of one search. */
interface Ctx {
  modeId: GameModeId;
  trumpSuit: Suit | null;
  scoring: ScoringConfig;
  tricksPerRound: number;
  n: number;
  nodes: number; // mutable node counter (budget guard)
}

// ---------------------------------------------------------------------------
// Scoring helpers (mirror scoring.ts / gameConfigs.ts exactly)
// ---------------------------------------------------------------------------

/** Points a single card contributes to whoever wins its trick (per-card modes). */
function cardPenalty(card: Card, modeId: GameModeId, scoring: ScoringConfig): number {
  switch (modeId) {
    case 'no_hearts':      return card.suit === 'hearts' ? scoring.perHeart : 0;
    case 'no_queens':      return card.rank === 'Q' ? scoring.perQueen : 0;
    case 'no_jacks':       return card.rank === 'J' ? scoring.perJack : 0;
    case 'king_of_hearts': return card.suit === 'hearts' && card.rank === 'K' ? scoring.kingOfHearts : 0;
    default:               return 0;
  }
}

/**
 * Score awarded to the winner of a just-resolved trick. `globalTrickIdx` is the
 * 0-based index of this trick within the whole round (needed for Last Two Tricks,
 * which scores only when the trick is one of the final two).
 */
function trickScore(
  cards: Card[],
  ctx: Ctx,
  globalTrickIdx: number,
): number {
  switch (ctx.modeId) {
    case 'no_tricks':       return ctx.scoring.perTrick;
    case 'trump':           return ctx.scoring.trumpRewardPerTrick;
    case 'last_two_tricks': return globalTrickIdx >= ctx.tricksPerRound - 2 ? ctx.scoring.perLastTrick : 0;
    default: {
      let s = 0;
      for (const c of cards) s += cardPenalty(c, ctx.modeId, ctx.scoring);
      return s;
    }
  }
}

/** Winner (seat index) of a completed trick — mirrors rules.ts resolveTrick. */
function trickWinnerSeat(
  plays: Card[],
  leaderIdx: number,
  trumpSuit: Suit | null,
  n: number,
): number {
  const ledSuit = plays[0].suit;
  let bestSeat = leaderIdx;
  let bestCard = plays[0];
  for (let i = 1; i < plays.length; i++) {
    const seat = (leaderIdx + i) % n;
    const card = plays[i];
    if (beatsCard(card, bestCard, trumpSuit, ledSuit)) {
      bestCard = card;
      bestSeat = seat;
    }
  }
  return bestSeat;
}

/** Does `card` beat the current winner `best`, given trump and the led suit? */
function beatsCard(card: Card, best: Card, trumpSuit: Suit | null, ledSuit: Suit): boolean {
  const cardTrump = trumpSuit != null && card.suit === trumpSuit;
  const bestTrump = trumpSuit != null && best.suit === trumpSuit;
  if (cardTrump && !bestTrump) return true;
  if (!cardTrump && bestTrump) return false;
  if (cardTrump && bestTrump) return card.value > best.value;
  // Neither is trump: only a card of the led suit can be in contention, and the
  // running winner is always a led-suit (or trump) card, so compare within suit.
  if (card.suit === ledSuit && best.suit === ledSuit) return card.value > best.value;
  return false; // card is an off-suit discard — cannot win
}

// ---------------------------------------------------------------------------
// Max-n search
// ---------------------------------------------------------------------------

/**
 * Returns the final per-seat score vector under max-n optimal play from `sim`.
 * Every seat plays the card that maximises ITS OWN final component.
 */
function search(sim: Sim, ctx: Ctx): number[] {
  // Terminal: no cards left anywhere and no trick in progress → round done.
  if (sim.plays.length === 0 && sim.hands.every((h) => h.length === 0)) {
    return sim.scores;
  }

  if (++ctx.nodes > NODE_BUDGET) throw ABORT;

  const seat = (sim.leaderIdx + sim.plays.length) % ctx.n;
  const ledSuit: Suit | null = sim.plays.length > 0 ? sim.plays[0].suit : null;
  const valid = getValidCards(sim.hands[seat], ledSuit, ctx.modeId, ctx.trumpSuit);

  let best: number[] | null = null;
  for (const card of valid) {
    const child = applyPlay(sim, seat, card, ctx);
    const vec = search(child, ctx);
    if (best === null || vec[seat] > best[seat]) best = vec;
  }
  return best!; // valid is never empty while any hand has cards
}

/**
 * Applies `seat` playing `card` and returns the resulting Sim. When the play
 * completes a trick it is resolved: the winner is credited and leads the next.
 */
function applyPlay(sim: Sim, seat: number, card: Card, ctx: Ctx): Sim {
  // Clone only the acting seat's hand; other seats' arrays are never mutated.
  const hands = sim.hands.slice();
  hands[seat] = removeFirst(hands[seat], card);

  const plays = sim.plays.slice();
  plays.push(card);

  if (plays.length < ctx.n) {
    return { hands, plays, leaderIdx: sim.leaderIdx, scores: sim.scores, tricksResolved: sim.tricksResolved };
  }

  // Trick complete — resolve, credit the winner, and lead from the winner.
  const winnerSeat = trickWinnerSeat(plays, sim.leaderIdx, ctx.trumpSuit, ctx.n);
  const scores = sim.scores.slice();
  scores[winnerSeat] += trickScore(plays, ctx, sim.tricksResolved);
  return {
    hands,
    plays: [],
    leaderIdx: winnerSeat,
    scores,
    tricksResolved: sim.tricksResolved + 1,
  };
}

/** New array with the first card equal to `card` removed. */
function removeFirst(hand: Card[], card: Card): Card[] {
  const idx = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
  if (idx === -1) return hand;
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/** Per-candidate max-n value of our seat's final round score at the root. */
export interface LookaheadAnalysis {
  /** The card the lookahead picks (best for our seat; greedy tie-break). */
  best: Card;
  /** Every legal root card with its max-n value for our seat. */
  candidates: { card: Card; value: number }[];
  /** The greedy heuristic's pick, for comparison/tie-breaking. */
  greedy: Card;
}

/**
 * Runs the endgame search at the root and returns the max-n value of every legal
 * card for our seat, or null when the position is outside the gate / the search
 * aborted (caller should fall back to the greedy heuristic). Exposed for tests and
 * potential UI hinting; production play goes through aiChooseCardLookahead.
 */
export function analyzeLookahead(state: GameState): LookaheadAnalysis | null {
  const seat = getCurrentPlayerIdx(state);
  const n = state.players.length;
  const gate = n >= 4 ? HAND_GATE_4P : HAND_GATE_3P;

  // Gate on the largest remaining hand — the search width is driven by the seat
  // with the most choices left.
  let maxHand = 0;
  for (const p of state.players) if (p.hand.length > maxHand) maxHand = p.hand.length;
  if (maxHand === 0 || maxHand > gate) return null;

  const ledSuit = state.currentTrick?.ledSuit ?? null;
  const valid = getValidCards(state.players[seat].hand, ledSuit, state.currentRound.mode.id, state.trumpSuit);
  if (valid.length === 0) return null;

  const ctx: Ctx = {
    modeId: state.currentRound.mode.id,
    trumpSuit: state.trumpSuit,
    scoring: state.config.scoring,
    tricksPerRound: state.config.tricksPerRound,
    n,
    nodes: 0,
  };
  const sim: Sim = {
    hands: state.players.map((p) => p.hand),
    plays: (state.currentTrick?.plays ?? []).map((pl) => pl.card),
    leaderIdx: state.currentLeaderIdx,
    scores: new Array(n).fill(0),
    tricksResolved: state.currentRound.tricks.length,
  };

  const greedy = aiChooseCard(state);
  try {
    const candidates = valid.map((card) => ({
      card,
      value: search(applyPlay(sim, seat, card, ctx), ctx)[seat],
    }));
    // Best for our seat; on ties prefer the greedy pick so behaviour stays stable
    // and sensible when the search is indifferent (several equally-safe cards).
    let best = candidates[0];
    for (const c of candidates) {
      const isGreedy = c.card.suit === greedy.suit && c.card.rank === greedy.rank;
      const bestIsGreedy = best.card.suit === greedy.suit && best.card.rank === greedy.rank;
      if (c.value > best.value || (c.value === best.value && isGreedy && !bestIsGreedy)) best = c;
    }
    return { best: best.card, candidates, greedy };
  } catch (e) {
    if (e === ABORT) return null;
    throw e;
  }
}

/**
 * Choose a card to play using endgame lookahead when the position is small enough
 * to solve exactly; otherwise defer to the shipped greedy heuristic (aiChooseCard).
 * Drop-in replacement for aiChooseCard at the PLAY_CARD decision.
 */
export function aiChooseCardLookahead(state: GameState): Card {
  const analysis = analyzeLookahead(state);
  return analysis ? analysis.best : aiChooseCard(state);
}
