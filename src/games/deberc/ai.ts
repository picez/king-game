// ---------------------------------------------------------------------------
// Deberc — heuristic bot (Stage 3). Produces ONE legal DebercAction for the
// acting seat in every phase, enough to drive a full bot-vs-bot match to a
// finish. Greedy but not random: it bids only on a playable trump holding, and
// in the play it wins opponents' tricks economically while feeding a winning
// partner and dumping cheap cards otherwise. Pure — reads the (server-visible)
// state and mutates nothing. Mirrors durak/ai.ts's contract.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import type { DebercAction, DebercState } from './types';
import { DEBERC_SUITS, cardPoints, trickStrength } from './deck';
import { legalPlays, resolveTrick } from './rules';
import { detectAllSequences } from './melds';

/**
 * Minimum hand score (see suitScore) at which a bot commits to a trump. Bidding
 * is now on the 6-card hand (v1.1 — the прикуп is taken only after trump), so the
 * threshold is lower than the old 9-card value: a bot takes trump on a decent
 * six, otherwise passes into round 2 / the forced table trump.
 */
const BID_THRESHOLD = 6;

/**
 * How playable a hand is with `suit` as trump: trumps count for their length and
 * the top trumps (J/9) carry the hand; side aces/tens add a little. Tuned so an
 * average hand scores below BID_THRESHOLD — a weak об'яз then passes rather than
 * committing into an ХВ.
 */
function suitScore(hand: Card[], suit: Suit): number {
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
    // Round 1 only accepts/refuses the face-up table trump (any non-null suit
    // accepts it — the reducer forces tableTrumpCard.suit either way).
    const suit = state.tableTrumpCard.suit;
    return suitScore(hand, suit) >= BID_THRESHOLD
      ? { type: 'BID', suit }
      : { type: 'BID', suit: null };
  }
  // Round 2 may name any free suit — the refused table trump is off the table.
  const candidates = DEBERC_SUITS.filter((s) => s !== state.tableTrumpCard.suit);
  const { suit, score } = bestSuit(hand, candidates);
  return score >= BID_THRESHOLD ? { type: 'BID', suit } : { type: 'BID', suit: null };
}

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

/** The acting seat's card play: lead strong, take economically, feed a partner. */
function playAction(state: DebercState): DebercAction {
  const seat = state.turnSeat;
  const trump = state.trumpSuit;
  const hand = state.players[seat].hand;
  const trick = state.currentTrick;
  const ledSuit = trick ? trick.ledSuit : null;
  const legal = legalPlays(hand, ledSuit, trump);

  // Leading: grab a trick with the strongest side card; keep trumps in reserve.
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

  // Cards that, played now, would take the trick.
  const winners = legal.filter((c) => {
    const plays = [...trick.plays, { seatIndex: seat, card: c, playOrder: trick.plays.length + 1 }];
    return resolveTrick(plays, trick.ledSuit, trump) === seat;
  });

  if (partnerWinning) {
    // Partner holds the trick. If we play last it is safe to feed them our points;
    // otherwise dump cheaply (an opponent still plays after us).
    if (isLast) {
      const card = legal.slice().sort((a, b) => cardPoints(b, trump) - cardPoints(a, trump))[0];
      return { type: 'PLAY_CARD', card };
    }
    return { type: 'PLAY_CARD', card: pickBy(legal, trump, dumpValue) };
  }

  // Opponent holds the trick: take it as cheaply as possible, else dump cheaply.
  if (winners.length > 0) {
    return { type: 'PLAY_CARD', card: pickBy(winners, trump, winCost) };
  }
  return { type: 'PLAY_CARD', card: pickBy(legal, trump, dumpValue) };
}

/** The lowest-cost card by `cost` (stable, deterministic). */
function pickBy(cards: Card[], trump: Suit | null, cost: (c: Card, t: Suit | null) => number): Card {
  return cards.slice().sort((a, b) => cost(a, trump) - cost(b, trump))[0];
}

/**
 * Declaring phase: the bot declares ALL the sequences it actually holds (fair —
 * bots never "miss" a meld). A declared деберц wins the match outright.
 */
function declareAction(state: DebercState): DebercAction {
  const seat = state.meldTurnSeat;
  const seqs = detectAllSequences(state.dealtHands[seat], seat, state.trumpSuit);
  return { type: 'DECLARE_MELD', melds: seqs.map((m) => ({ kind: m.kind, cards: m.cards })) };
}

/**
 * The bot's chosen action for the current state, or null on a finished match.
 * Bidding → BID; declaring → DECLARE_MELD (all held sequences); playing →
 * PLAY_CARD; the two acknowledgement phases advance automatically (NEXT_TRICK /
 * NEXT_HAND). The reducer enforces legality.
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
