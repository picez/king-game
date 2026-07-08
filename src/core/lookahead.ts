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
//
// Two classic exact-solver optimisations make the deeper gates affordable:
//
//  * TRANSPOSITION TABLE — the search returns score DELTAS (future points from a
//    position on), which are path-independent, so positions reached in different
//    move orders share one solved value. Every card still in play gets a bit in
//    one 32-bit mask (the gates keep the total ≤ 32); since each card belongs to
//    a fixed root hand, the UNION mask + the trick leader is a complete numeric
//    key for any trick-boundary position, shared across all root candidates.
//
//  * EQUIVALENT-CARD PRUNING — two same-suit cards with no live card between
//    them (in another hand or on the table) and the same per-card penalty are
//    strategically identical, so interior nodes search only one per such block.
//    This collapses the free-discard explosion the boundary TT cannot reach.
// ---------------------------------------------------------------------------

import type { Card, GameModeId, GameState, ScoringConfig, Suit } from '../models/types';
import { getValidCards } from './rules';
import { getCurrentPlayerIdx } from './gameEngine';
import { aiChooseCard } from './ai';

// Only attempt the exact search when the largest remaining hand is at most this
// many cards. Beyond it the tree is too wide to solve in time and we defer to the
// heuristic. Kept per-player-count: the 52-card 4-player game branches wider (four
// seats), so it earns a slightly tighter gate than the 32-card 3-player game.
// (Raised from 4/5 once the transposition table landed — see the header.)
// NOTE: the bit-mask encoding requires n*gate + (n-1) ≤ 32 cards in play.
const HAND_GATE_4P = 6;
const HAND_GATE_3P = 7;

// MIDGAME depth-limited search: above the exact gate but at/below this larger
// gate, search DEPTH_TRICKS full tricks exactly (max-n) and estimate each leaf
// position with a cheap greedy rollout to the end of the round. This turns the
// hard exact/greedy cliff into a graded fall-off — the bot still reasons a few
// tricks ahead through the widest part of the hand instead of dropping straight
// to the one-ply heuristic. Gate + depth are sized to keep worst-case latency
// bounded (measured; see .shots/king-lookahead-bench.mjs); a node-budget abort
// still falls back to greedy for that one move.
const MIDGAME_GATE_4P = 8;
const MIDGAME_GATE_3P = 10;
const DEPTH_TRICKS = 2;

// Hard ceiling on explored nodes. A follow-suit-light position (everyone void of
// the led suit → free discards) can still explode past the gate, so this backstop
// aborts the search and the caller falls back to the greedy heuristic for that one
// decision. With the transposition table a node is only counted when actually
// searched (cache hits are free), so the budget bounds real work per move.
//
// The MIDGAME budget is much tighter than the EXACT one: a midgame position that
// won't fit must abort FAST (its greedy fallback is cheap and nearly as good),
// because the server is single-threaded — a long blocking search would stall every
// other room's event loop. The exact endgame is worth a larger budget: there is no
// better answer than solving it, and it is rarer. (Measured: this caps midgame
// worst-case latency to a few tens of ms; see .shots/king-lookahead-bench.mjs.)
const EXACT_NODE_BUDGET = 600_000;
const MIDGAME_NODE_BUDGET = 40_000;

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
  /**
   * Union bit mask of ALL cards still in hands (bit index via Ctx.bitOf). Every
   * card belongs to exactly one seat's root hand, so the union alone identifies
   * every seat's remaining hand — a single number keys the whole position.
   */
  union: number;
  /** Cards played into the current, in-progress trick, in play order. */
  plays: Card[];
  /** Seat that led the current trick (plays[0] is theirs). */
  leaderIdx: number;
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
  budget: number; // node ceiling for this search (exact vs midgame)
  /** Bit index per card (`suit:rank`) over every card still in play at the root. */
  bitOf: Map<string, number>;
  /** Transposition table: trick-boundary position (union·4+leader) → delta vector. */
  tt: Map<number, number[]>;
  /**
   * At a trick boundary where `tricksResolved >= rolloutAtTricks`, estimate the
   * position with a greedy rollout instead of expanding further (midgame mode).
   * `Infinity` = never roll out → the search is exact to the end of the round.
   */
  rolloutAtTricks: number;
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

/** A child position plus the trick resolution (if the play completed a trick). */
interface Applied {
  sim: Sim;
  /** Winner seat + points when this play resolved a trick, else null. */
  credit: { seat: number; score: number } | null;
}

/**
 * Returns the FUTURE per-seat score-delta vector under max-n play from `sim`
 * (points still to be scored from here to the end of the round). Every seat plays
 * the card that maximises ITS OWN final component. In exact mode this is optimal
 * to the round end; in midgame mode the deepest DEPTH_TRICKS tricks are exact and
 * positions past them are estimated by rollout(). Deltas are path-independent,
 * which is what makes them safe to memoize in the TT. Cached/returned vectors are
 * shared — callers must copy before mutating.
 */
function search(sim: Sim, ctx: Ctx): number[] {
  // Terminal: no cards left anywhere and no trick in progress → round done.
  if (sim.plays.length === 0 && sim.hands.every((h) => h.length === 0)) {
    return ZERO_VECS[ctx.n] ?? new Array(ctx.n).fill(0);
  }

  // Transposition lookup at trick boundaries: identical remaining hands + leader
  // always yield the same future, no matter the move order that got here.
  // (tricksResolved is derivable from the union, so it needn't be in the key.
  // union is ≤ 32 bits and leader < 4, so union·4+leader is an exact number key.)
  const key = sim.plays.length === 0 ? sim.union * 4 + sim.leaderIdx : -1;
  if (key >= 0) {
    const hit = ctx.tt.get(key);
    if (hit !== undefined) return hit;
    // Midgame cut-off: at a trick boundary past the exact depth, estimate the
    // rest with a greedy rollout. The rollout is a pure function of the position
    // (union determines every hand + tricksResolved), so it is TT-safe to cache.
    if (sim.tricksResolved >= ctx.rolloutAtTricks) {
      const est = rollout(sim, ctx);
      ctx.tt.set(key, est);
      return est;
    }
  }

  if (++ctx.nodes > ctx.budget) throw ABORT;

  const seat = (sim.leaderIdx + sim.plays.length) % ctx.n;
  const ledSuit: Suit | null = sim.plays.length > 0 ? sim.plays[0].suit : null;
  const valid = getValidCards(sim.hands[seat], ledSuit, ctx.modeId, ctx.trumpSuit);

  let best: number[] | null = null;
  for (const card of pruneEquivalent(valid, sim, ctx, seat)) {
    const vec = valueOfPlay(sim, seat, card, ctx);
    if (best === null || vec[seat] > best[seat]) best = vec;
  }
  if (key >= 0) ctx.tt.set(key, best!);
  return best!; // valid is never empty while any hand has cards
}

/**
 * Drops strategically identical alternatives: within one suit, cards with no
 * LIVE card strictly between them (in another hand or in the current trick) and
 * an equal per-card penalty always produce the same future — searching one per
 * block is exact. Only interior nodes prune; the root evaluates every card so
 * the analysis still reports a value for each legal play.
 */
function pruneEquivalent(valid: Card[], sim: Sim, ctx: Ctx, seat: number): Card[] {
  if (valid.length <= 1) return valid;
  const bySuit = new Map<Suit, Card[]>();
  for (const c of valid) {
    const g = bySuit.get(c.suit);
    if (g) g.push(c); else bySuit.set(c.suit, [c]);
  }
  const out: Card[] = [];
  for (const [suit, group] of bySuit) {
    if (group.length === 1) { out.push(group[0]); continue; }
    group.sort((a, b) => a.value - b.value);
    // Values of this suit still live OUTSIDE the acting hand — only these can
    // ever distinguish two of our cards (we never compete with our own holding).
    const foreign: number[] = [];
    for (let s = 0; s < ctx.n; s++) {
      if (s === seat) continue;
      for (const c of sim.hands[s]) if (c.suit === suit) foreign.push(c.value);
    }
    for (const c of sim.plays) if (c.suit === suit) foreign.push(c.value);
    out.push(group[0]); // the block representative is its lowest card
    for (let i = 1; i < group.length; i++) {
      const lo = group[i - 1];
      const hi = group[i];
      const gap = foreign.some((v) => v > lo.value && v < hi.value);
      if (gap || cardPenalty(lo, ctx.modeId, ctx.scoring) !== cardPenalty(hi, ctx.modeId, ctx.scoring)) {
        out.push(hi); // not equivalent to the previous → starts a new block
      }
    }
  }
  return out;
}

/** Delta vector of `seat` playing `card` from `sim` (search + trick credit). */
function valueOfPlay(sim: Sim, seat: number, card: Card, ctx: Ctx): number[] {
  const { sim: child, credit } = applyPlay(sim, seat, card, ctx);
  let vec = search(child, ctx);
  if (credit !== null && credit.score !== 0) {
    vec = vec.slice(); // never mutate a shared/cached vector
    vec[credit.seat] += credit.score;
  }
  return vec;
}

/**
 * Applies `seat` playing `card` and returns the resulting Sim. When the play
 * completes a trick it is resolved: the winner leads the next trick and the
 * trick's points are reported via `credit` (added by the caller on unwind).
 */
function applyPlay(sim: Sim, seat: number, card: Card, ctx: Ctx): Applied {
  // Clone only the acting seat's hand; other seats' arrays are never mutated.
  const hands = sim.hands.slice();
  hands[seat] = removeFirst(hands[seat], card);
  // (2**bit, not 1<<bit: bit 31 via << would flip the sign and corrupt the key.)
  const union = sim.union - 2 ** ctx.bitOf.get(cardKey(card))!;

  const plays = sim.plays.slice();
  plays.push(card);

  if (plays.length < ctx.n) {
    return {
      sim: { hands, union, plays, leaderIdx: sim.leaderIdx, tricksResolved: sim.tricksResolved },
      credit: null,
    };
  }

  // Trick complete — resolve, credit the winner, and lead from the winner.
  const winnerSeat = trickWinnerSeat(plays, sim.leaderIdx, ctx.trumpSuit, ctx.n);
  return {
    sim: { hands, union, plays: [], leaderIdx: winnerSeat, tricksResolved: sim.tricksResolved + 1 },
    credit: { seat: winnerSeat, score: trickScore(plays, ctx, sim.tricksResolved) },
  };
}

/** Stable identity of a card for the bit-index map. */
function cardKey(card: Card): string {
  return `${card.suit}:${card.rank}`;
}

/** Shared all-zero terminal vectors (per player count) — never mutated. */
const ZERO_VECS: Record<number, number[]> = { 3: [0, 0, 0], 4: [0, 0, 0, 0] };

/** New array with the first card equal to `card` removed. */
function removeFirst(hand: Card[], card: Card): Card[] {
  const idx = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
  if (idx === -1) return hand;
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

// ---------------------------------------------------------------------------
// Midgame leaf estimate: a cheap greedy rollout to the end of the round
// ---------------------------------------------------------------------------

/**
 * Play `sim` out to the end of the round with a fast greedy policy (perfect
 * info, deterministic — no rng), returning the per-seat score DELTA it produces.
 * This is the leaf evaluator for the midgame depth-limited search: the top
 * DEPTH_TRICKS tricks are solved by exact max-n, and each resulting position is
 * scored by this rollout rather than expanded further. It is a coarse estimate,
 * NOT exact play — but a consistent one, so the exact layer above ranks moves by
 * a stable signal. Mutates only local copies.
 */
function rollout(sim: Sim, ctx: Ctx): number[] {
  // Charge the rollout's cost (≈ one step per remaining card) against the node
  // budget BEFORE running it. Otherwise a rollout-heavy midgame position — many
  // boundary leaves, each a full playout — could block for far longer than the
  // budget implies, since expanded-node counting alone never sees this work. With
  // it charged, such a position aborts promptly and falls back to greedy.
  let plies = sim.plays.length;
  for (const h of sim.hands) plies += h.length;
  ctx.nodes += plies;
  if (ctx.nodes > ctx.budget) throw ABORT;

  const delta = new Array(ctx.n).fill(0) as number[];
  const hands = sim.hands.map((h) => h.slice());
  let plays = sim.plays.slice();
  let leader = sim.leaderIdx;
  let tricks = sim.tricksResolved;

  while (plays.length > 0 || hands.some((h) => h.length > 0)) {
    const seat = (leader + plays.length) % ctx.n;
    const ledSuit: Suit | null = plays.length > 0 ? plays[0].suit : null;
    const valid = getValidCards(hands[seat], ledSuit, ctx.modeId, ctx.trumpSuit);
    const card = rolloutPick(valid, ledSuit, plays, ctx, tricks);
    const idx = hands[seat].findIndex((c) => c.suit === card.suit && c.rank === card.rank);
    hands[seat].splice(idx, 1);
    plays.push(card);
    if (plays.length === ctx.n) {
      const winner = trickWinnerSeat(plays, leader, ctx.trumpSuit, ctx.n);
      delta[winner] += trickScore(plays, ctx, tricks);
      tricks += 1;
      plays = [];
      leader = winner;
    }
  }
  return delta;
}

/** The card currently winning the in-progress trick (plays is non-empty). */
function rolloutWinner(plays: Card[], trump: Suit | null): Card {
  let best = plays[0];
  for (let i = 1; i < plays.length; i++) {
    if (beatsCard(plays[i], best, trump, plays[0].suit)) best = plays[i];
  }
  return best;
}

/**
 * Fast one-ply policy used inside the rollout. A deliberately lightweight proxy
 * for aiChooseCard (it need not match it exactly — it only has to be sensible and
 * deterministic): win cheaply / lead high in point-winning situations; dump the
 * costliest card and dodge tricks in avoidance situations.
 */
function rolloutPick(
  valid: Card[],
  ledSuit: Suit | null,
  plays: Card[],
  ctx: Ctx,
  tricksResolved: number,
): Card {
  if (valid.length === 1) return valid[0];
  const trump = ctx.trumpSuit;
  const pen = (c: Card) => cardPenalty(c, ctx.modeId, ctx.scoring);
  // Winning tricks is good in Trump, and in Last Two Tricks until the final two.
  const winMode = ctx.modeId === 'trump'
    || (ctx.modeId === 'last_two_tricks' && ctx.tricksPerRound - tricksResolved > 2);
  const lowest = (cs: Card[]) => cs.reduce((a, b) => (b.value < a.value ? b : a));
  const highest = (cs: Card[]) => cs.reduce((a, b) => (b.value > a.value ? b : a));

  if (ledSuit === null) {
    if (winMode) return highest(valid);           // contest with strength
    const safe = valid.filter((c) => pen(c) === 0);
    return lowest(safe.length ? safe : valid);     // lead low, avoid own penalties
  }

  const winner = rolloutWinner(plays, trump);
  const beating = valid.filter((c) => beatsCard(c, winner, trump, plays[0].suit));
  const losing = valid.filter((c) => !beatsCard(c, winner, trump, plays[0].suit));

  if (winMode) {
    if (beating.length > 0) {
      const nonTrump = trump ? beating.filter((c) => c.suit !== trump) : beating;
      return lowest(nonTrump.length ? nonTrump : beating); // win as cheaply as possible
    }
    const nonTrump = trump ? valid.filter((c) => c.suit !== trump) : valid;
    return lowest(nonTrump.length ? nonTrump : valid);     // can't win → shed low, keep trumps
  }

  // Avoidance: prefer to lose the trick.
  if (losing.length > 0) {
    const losingPenalty = losing.filter((c) => pen(c) > 0);
    return highest(losingPenalty.length ? losingPenalty : losing); // dump the costliest
  }
  // Forced to win: take it with the cheapest non-penalty card.
  const nonPenalty = valid.filter((c) => pen(c) === 0);
  return lowest(nonPenalty.length ? nonPenalty : valid);
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
  const exactGate = n >= 4 ? HAND_GATE_4P : HAND_GATE_3P;
  const midgameGate = n >= 4 ? MIDGAME_GATE_4P : MIDGAME_GATE_3P;

  // Gate on the largest remaining hand — the search width is driven by the seat
  // with the most choices left. Small hands are solved EXACTLY to the round end;
  // larger ones (up to the midgame gate) get a DEPTH_TRICKS-deep exact search
  // with greedy-rollout leaves; anything bigger defers to the greedy heuristic.
  let maxHand = 0;
  for (const p of state.players) if (p.hand.length > maxHand) maxHand = p.hand.length;
  if (maxHand === 0 || maxHand > midgameGate) return null;
  const rootTricks = state.currentRound.tricks.length;
  const isExact = maxHand <= exactGate;
  const rolloutAtTricks = isExact ? Infinity : rootTricks + DEPTH_TRICKS;

  const ledSuit = state.currentTrick?.ledSuit ?? null;
  const valid = getValidCards(state.players[seat].hand, ledSuit, state.currentRound.mode.id, state.trumpSuit);
  if (valid.length === 0) return null;

  // Assign every card still in play a bit index (hands + the in-progress trick).
  // The gates keep the total ≤ 32, so one 32-bit mask per seat suffices; if a
  // custom config ever exceeds that, skip the search rather than mis-key the TT.
  const plays = (state.currentTrick?.plays ?? []).map((pl) => pl.card);
  const bitOf = new Map<string, number>();
  for (const p of state.players) for (const c of p.hand) bitOf.set(cardKey(c), bitOf.size);
  for (const c of plays) bitOf.set(cardKey(c), bitOf.size);
  if (bitOf.size > 32) return null;

  const ctx: Ctx = {
    modeId: state.currentRound.mode.id,
    trumpSuit: state.trumpSuit,
    scoring: state.config.scoring,
    tricksPerRound: state.config.tricksPerRound,
    n,
    nodes: 0,
    budget: isExact ? EXACT_NODE_BUDGET : MIDGAME_NODE_BUDGET,
    bitOf,
    tt: new Map(),
    rolloutAtTricks,
  };
  const sim: Sim = {
    hands: state.players.map((p) => p.hand),
    union: state.players.reduce(
      (m, p) => p.hand.reduce((mm, c) => mm + 2 ** bitOf.get(cardKey(c))!, m), 0),
    plays,
    leaderIdx: state.currentLeaderIdx,
    tricksResolved: state.currentRound.tricks.length,
  };

  const greedy = aiChooseCard(state);
  try {
    // One shared TT across all root candidates — siblings transpose heavily.
    const candidates = valid.map((card) => ({
      card,
      value: valueOfPlay(sim, seat, card, ctx)[seat],
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
