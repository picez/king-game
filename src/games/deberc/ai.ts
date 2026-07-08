// ---------------------------------------------------------------------------
// Deberc — heuristic bot. Produces ONE legal DebercAction for the acting seat in
// every phase, enough to drive a full match to a finish. Pure (reads the
// server-visible state, mutates nothing) and deterministic (no Math.random —
// choices depend only on the state). Mirrors durak/ai.ts's contract.
//
// The strong bot (`debercBotAction`) is materially better than the previous
// greedy one (measured head-to-head — see scripts/deberc-ai-eval.mjs): it is
// SELECTIVE about taking trump (a weak об'яз eats an ХВ, §7), banks side aces on
// the lead, captures tricks cheaply to bank card points (deberc rewards capture),
// fights for the +10 last trick, keeps the trump J/9 (маніла) back to ruff, and
// feeds a winning partner. The previous heuristic is preserved as
// `legacyDebercBotAction` purely as the evaluation baseline.
// ---------------------------------------------------------------------------

import type { Card, Rank, Suit } from '../../models/types';
import type { DebercAction, DebercMeldKind, DebercState } from './types';
import { DEBERC_SUITS, cardPoints, trickStrength } from './deck';
import { legalPlays, resolveTrick } from './rules';
import { detectAllSequences, hasBella } from './melds';

/**
 * Minimum hand score (see suitScore) at which a bot commits to a trump. Bidding
 * is on the 6-card hand (the прикуп is taken only after trump), so the threshold
 * is modest: a bot takes trump on a decent six, otherwise passes into round 2 /
 * the forced table trump.
 */
const BID_THRESHOLD = 6;
/** The strong bot is a touch more selective about taking on the об'яз/ХВ risk. */
const NEW_BID_THRESHOLD = 8;

/**
 * How playable a hand is with `suit` as trump: trumps count for their length and
 * the top trumps (J/9) carry the hand; side aces/tens add a little. Tuned so an
 * average hand scores below the bid threshold — a weak об'яз then passes rather
 * than committing into an ХВ.
 */
function suitScore(hand: Card[], suit: Suit): number {
  let score = 0;
  for (const c of hand) {
    if (c.suit === suit) {
      score += 2;
      if (c.rank === 'J') score += 4;
      else if (c.rank === '9') score += 3;
      else if (c.rank === 'A') score += 2;
      else if (c.rank === '10') score += 1;
      else if (c.rank === 'K' || c.rank === 'Q') score += 1; // бела / trump body
    } else if (c.rank === 'A') score += 2;
    else if (c.rank === '10') score += 1;
  }
  return score;
}

/** The strongest suit for this hand (by suitScore) among `candidates`. */
function bestSuit(hand: Card[], candidates: Suit[]): { suit: Suit; score: number } {
  let best = candidates[0];
  let bestScore = suitScore(hand, candidates[0]);
  for (const suit of candidates) {
    const sc = suitScore(hand, suit);
    if (sc > bestScore) { best = suit; bestScore = sc; }
  }
  return { suit: best, score: bestScore };
}

/** A bid for the acting bidder: accept a trump when the hand supports it, else pass. */
function bidAction(state: DebercState): DebercAction {
  const hand = state.players[state.bidderSeat].hand;
  if (state.bidRound === 1) {
    const suit = state.tableTrumpCard.suit;
    return suitScore(hand, suit) >= NEW_BID_THRESHOLD
      ? { type: 'BID', suit }
      : { type: 'BID', suit: null };
  }
  const candidates = DEBERC_SUITS.filter((s) => s !== state.tableTrumpCard.suit);
  const { suit, score } = bestSuit(hand, candidates);
  return score >= NEW_BID_THRESHOLD ? { type: 'BID', suit } : { type: 'BID', suit: null };
}

// --- Card ranking helpers ---------------------------------------------------

/** Rank a card by how little we mind losing it (dump low points, keep trumps). */
function dumpValue(card: Card, trump: Suit | null): number {
  const trumpPenalty = trump != null && card.suit === trump ? 100 : 0;
  return trumpPenalty + cardPoints(card, trump) * 10 + trickStrength(card, trump);
}

/** Rank a winning card by how cheaply it wins (keep trumps and high cards). */
function winCost(card: Card, trump: Suit | null): number {
  const trumpPenalty = trump != null && card.suit === trump ? 100 : 0;
  return trumpPenalty + trickStrength(card, trump);
}

/** The lowest-cost card by `cost` (stable, deterministic). */
function pickBy(cards: Card[], trump: Suit | null, cost: (c: Card, t: Suit | null) => number): Card {
  return cards.slice().sort((a, b) => cost(a, trump) - cost(b, trump))[0];
}

const suitLen = (hand: Card[], suit: Suit): number => hand.filter((c) => c.suit === suit).length;

/** The card carrying the most points (ties → keep the stronger card, i.e. lower strength wins). */
function highestPoints(cards: Card[], trump: Suit | null): Card {
  return cards.slice().sort((a, b) =>
    cardPoints(b, trump) - cardPoints(a, trump) || trickStrength(a, trump) - trickStrength(b, trump))[0];
}

/** The strongest card (highest trick strength) within `cards`. */
function strongest(cards: Card[], trump: Suit | null): Card {
  return cards.slice().sort((a, b) => trickStrength(b, trump) - trickStrength(a, trump))[0];
}

// --- Strong play ------------------------------------------------------------

/**
 * Choose the lead card. Deberc rewards CAPTURING card points, so leading banks
 * points, not ducks: lead a side ace (it usually wins outright, +11), otherwise
 * the strongest non-trump — but keep the trump J (йось) and 9 (маніла) back to
 * ruff opponents' point tricks rather than spending them on a lead.
 */
function chooseLead(hand: Card[], legal: Card[], trump: Suit | null): Card {
  // Bank a side ace first (longest such suit → least likely to be ruffed early).
  const sideAces = hand.filter((c) => c.rank === 'A' && (trump == null || c.suit !== trump));
  if (sideAces.length > 0) {
    return sideAces.slice().sort((a, b) => suitLen(hand, b.suit) - suitLen(hand, a.suit))[0];
  }
  // Otherwise the strongest non-trump; fall back to the lowest trump (never lead
  // away the J/9 маніла — keep them to capture points on defence).
  const nonTrump = legal.filter((c) => trump == null || c.suit !== trump);
  if (nonTrump.length > 0) return strongest(nonTrump, trump);
  return pickBy(legal, trump, (c, t) => trickStrength(c, t)); // lowest trump
}

/**
 * The acting seat's card play: bank points by taking tricks cheaply (deberc is a
 * point-capture game), feed a winning partner, and fight harder for the +10 last
 * trick — while not spending the trump J/9 on cheap tricks.
 */
function playAction(state: DebercState): DebercAction {
  const seat = state.turnSeat;
  const trump = state.trumpSuit;
  const hand = state.players[seat].hand;
  const trick = state.currentTrick;
  const ledSuit = trick ? trick.ledSuit : null;
  const legal = legalPlays(hand, ledSuit, trump);
  const n = state.players.length;
  const isLastTrick = state.tricksPlayed === 8; // the 9th (final) trick — worth +10

  // Leading.
  if (trick == null || trick.plays.length === 0) {
    // The last trick is worth +10 — lead the strongest card to try to bank it.
    if (isLastTrick) return { type: 'PLAY_CARD', card: strongest(legal, trump) };
    return { type: 'PLAY_CARD', card: chooseLead(hand, legal, trump) };
  }

  const isLastToPlay = trick.plays.length === n - 1;
  const currentWinnerSeat = resolveTrick(trick.plays, trick.ledSuit, trump);
  const partnerWinning = currentWinnerSeat !== seat
    && state.teamOf[currentWinnerSeat] === state.teamOf[seat];

  // Cards that, played now, would take the trick.
  const winners = legal.filter((c) => {
    const plays = [...trick.plays, { seatIndex: seat, card: c, playOrder: trick.plays.length + 1 }];
    return resolveTrick(plays, trick.ledSuit, trump) === seat;
  });

  if (partnerWinning) {
    // Partner holds the trick: if we are last it is safe to feed them our points;
    // otherwise dump low (an opponent still plays after us and could overtake).
    if (isLastToPlay) return { type: 'PLAY_CARD', card: highestPoints(legal, trump) };
    return { type: 'PLAY_CARD', card: pickBy(legal, trump, dumpValue) };
  }

  // Opponent (or nobody) holds the trick — take it as cheaply as possible (every
  // captured trick banks its points and averts a бейт). Prefer a non-trump winner
  // and the cheapest trump when we must ruff; winCost keeps the J/9 маніла back.
  if (winners.length > 0) {
    return { type: 'PLAY_CARD', card: pickBy(winners, trump, winCost) };
  }
  // Cannot win: shed the least useful card, keeping high cards and trumps.
  return { type: 'PLAY_CARD', card: pickBy(legal, trump, dumpValue) };
}

/**
 * Declaring: claim exactly the kinds the seat TRULY holds (best sequence band +
 * bella when holding trump K+Q). Bots never bluff, so they never eat the −50; a
 * truthful деберц claim wins the match outright.
 */
function declareAction(state: DebercState): DebercAction {
  const seat = state.meldTurnSeat;
  const hand = state.dealtHands[seat];
  const melds: { kind: DebercMeldKind; topRank?: Rank; suit?: Suit }[] = [];
  // Announce EVERY held sequence (one per suit, with its real nominal + suit) — a
  // hand's own melds all score (owner rule 2026-07-08), so declare them all. A
  // деберц (run ≥ 8) is among these and wins the match outright when announced.
  for (const seq of detectAllSequences(hand, seat, state.trumpSuit)) {
    melds.push({ kind: seq.kind, topRank: seq.cards[seq.cards.length - 1].rank, suit: seq.cards[0].suit });
  }
  if (hasBella(hand, state.trumpSuit)) melds.push({ kind: 'bella' });
  return { type: 'DECLARE_MELD', melds };
}

/**
 * The bot's chosen action for the current state, or null on a finished match.
 * Bidding → BID; declaring → DECLARE_MELD; playing → PLAY_CARD; the two
 * acknowledgement phases advance automatically. The reducer enforces legality.
 */
export function debercBotAction(state: DebercState): DebercAction | null {
  switch (state.phase) {
    case 'bidding': return bidAction(state);
    case 'declaring': return declareAction(state);
    case 'playing': return playAction(state);
    case 'trick_complete': return { type: 'NEXT_TRICK' };
    case 'hand_scoring': return { type: 'NEXT_HAND' };
    default: return null; // 'finished'
  }
}

// ---------------------------------------------------------------------------
// Legacy baseline (the previous greedy heuristic) — kept for head-to-head
// evaluation only (scripts/deberc-ai-eval.mjs). Not used by the app.
// ---------------------------------------------------------------------------

/** The original suit evaluation (before the bidding tweak) — baseline only. */
function legacySuitScore(hand: Card[], suit: Suit): number {
  let score = 0;
  for (const c of hand) {
    if (c.suit === suit) {
      score += 2;
      if (c.rank === 'J') score += 4;
      else if (c.rank === '9') score += 3;
      else if (c.rank === 'A') score += 1;
      else if (c.rank === '10') score += 1;
    } else if (c.rank === 'A') score += 2;
    else if (c.rank === '10') score += 1;
  }
  return score;
}

/** The original bid heuristic — baseline only. */
function legacyBidAction(state: DebercState): DebercAction {
  const hand = state.players[state.bidderSeat].hand;
  if (state.bidRound === 1) {
    const suit = state.tableTrumpCard.suit;
    return legacySuitScore(hand, suit) >= BID_THRESHOLD
      ? { type: 'BID', suit }
      : { type: 'BID', suit: null };
  }
  const candidates = DEBERC_SUITS.filter((s) => s !== state.tableTrumpCard.suit);
  let best = candidates[0];
  let bestScore = legacySuitScore(hand, candidates[0]);
  for (const suit of candidates) {
    const sc = legacySuitScore(hand, suit);
    if (sc > bestScore) { best = suit; bestScore = sc; }
  }
  return bestScore >= BID_THRESHOLD ? { type: 'BID', suit: best } : { type: 'BID', suit: null };
}

function legacyPlayAction(state: DebercState): DebercAction {
  const seat = state.turnSeat;
  const trump = state.trumpSuit;
  const hand = state.players[seat].hand;
  const trick = state.currentTrick;
  const ledSuit = trick ? trick.ledSuit : null;
  const legal = legalPlays(hand, ledSuit, trump);

  if (trick == null || trick.plays.length === 0) {
    const nonTrump = legal.filter((c) => trump == null || c.suit !== trump);
    const pool = nonTrump.length > 0 ? nonTrump : legal;
    const card = pool.slice().sort((a, b) => trickStrength(b, trump) - trickStrength(a, trump))[0];
    return { type: 'PLAY_CARD', card };
  }

  const n = state.players.length;
  const isLast = trick.plays.length === n - 1;
  const currentWinnerSeat = resolveTrick(trick.plays, trick.ledSuit, trump);
  const partnerWinning = state.teamOf[currentWinnerSeat] === state.teamOf[seat];

  const winners = legal.filter((c) => {
    const plays = [...trick.plays, { seatIndex: seat, card: c, playOrder: trick.plays.length + 1 }];
    return resolveTrick(plays, trick.ledSuit, trump) === seat;
  });

  if (partnerWinning) {
    if (isLast) {
      const card = legal.slice().sort((a, b) => cardPoints(b, trump) - cardPoints(a, trump))[0];
      return { type: 'PLAY_CARD', card };
    }
    return { type: 'PLAY_CARD', card: pickBy(legal, trump, dumpValue) };
  }
  if (winners.length > 0) {
    return { type: 'PLAY_CARD', card: pickBy(winners, trump, winCost) };
  }
  return { type: 'PLAY_CARD', card: pickBy(legal, trump, dumpValue) };
}

/** The previous (greedy) bot, for evaluation baselines only. */
export function legacyDebercBotAction(state: DebercState): DebercAction | null {
  switch (state.phase) {
    case 'bidding': return legacyBidAction(state);
    case 'declaring': return declareAction(state);
    case 'playing': return legacyPlayAction(state);
    case 'trick_complete': return { type: 'NEXT_TRICK' };
    case 'hand_scoring': return { type: 'NEXT_HAND' };
    default: return null;
  }
}
