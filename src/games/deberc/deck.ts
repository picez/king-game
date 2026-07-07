// ---------------------------------------------------------------------------
// Deberc — deck, card points, trick strength, and the deal. Pure + deterministic
// (all randomness comes from the injected rng). See DEBERC_RULES.md §2, §3.
// ---------------------------------------------------------------------------

import type { Card, Rank, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';

/** 36-card Deberc ranks: 6 (low) … A (high). Value is the natural sequence order. */
export const DEBERC_RANKS: Rank[] = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const DEBERC_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

/** Natural sequence value (6→6 … A→14). Consecutive ranks differ by exactly 1. */
const SEQ_VALUE: Record<string, number> = {
  '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

/** Sequence-order value for a rank (used for meld runs). */
export function seqValue(rank: Rank): number {
  return SEQ_VALUE[rank];
}

/** The full 36-card deck (unshuffled). `value` is the sequence order. */
export function createDebercDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of DEBERC_SUITS) {
    for (const rank of DEBERC_RANKS) deck.push({ suit, rank, value: SEQ_VALUE[rank] });
  }
  return deck;
}

/** Fisher–Yates shuffle using the injected rng (pure — returns a new array). */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Card point values (DEBERC_RULES.md §2) --------------------------------

const TRUMP_POINTS: Record<string, number> = {
  J: 20, '9': 14, A: 11, '10': 10, K: 4, Q: 3, '8': 0, '7': 0, '6': 0,
};
const PLAIN_POINTS: Record<string, number> = {
  A: 11, '10': 10, K: 4, Q: 3, J: 2, '9': 0, '8': 0, '7': 0, '6': 0,
};

/** Card points, depending on whether the card is in the trump suit. */
export function cardPoints(card: Card, trumpSuit: Suit | null): number {
  const isTrump = trumpSuit != null && card.suit === trumpSuit;
  return (isTrump ? TRUMP_POINTS : PLAIN_POINTS)[card.rank];
}

// --- Trick strength (DEBERC_RULES.md §2) -----------------------------------
// Trump:     J > 9 > A > 10 > K > Q > 8 > 7 > 6
// Non-trump: A > 10 > K > Q > J > 9 > 8 > 7 > 6

const TRUMP_STRENGTH: Record<string, number> = {
  J: 8, '9': 7, A: 6, '10': 5, K: 4, Q: 3, '8': 2, '7': 1, '6': 0,
};
const PLAIN_STRENGTH: Record<string, number> = {
  A: 8, '10': 7, K: 6, Q: 5, J: 4, '9': 3, '8': 2, '7': 1, '6': 0,
};

/**
 * Relative strength of a card within its own suit for winning a trick. Only
 * comparable between cards of the same suit (or both trump); the trick resolver
 * layers trump-beats-plain on top of this.
 */
export function trickStrength(card: Card, trumpSuit: Suit | null): number {
  const isTrump = trumpSuit != null && card.suit === trumpSuit;
  return (isTrump ? TRUMP_STRENGTH : PLAIN_STRENGTH)[card.rank];
}

// --- Deal (DEBERC_RULES.md §3) ---------------------------------------------

export interface DebercDealResult {
  /** Each seat's 9 cards (6 dealt + 3 talon, all taken into hand). */
  hands: Card[][];
  /** The face-up trump card — the top of the об'яз's talon (also in their hand). */
  tableTrumpCard: Card;
  /** Undealt cards left on the table (9 for 3 players, 0 for 4). */
  stock: Card[];
}

/**
 * Shuffle and deal 9 cards to each seat (6 + a 3-card talon, all kept in hand).
 * The об'яз's talon top is revealed as the table trump card. Any undealt cards
 * become the stock (3 players leave 9 undealt; 4 players use the whole deck).
 */
export function dealDeberc(numPlayers: number, objazSeat: number, rng: Rng): DebercDealResult {
  const deck = shuffle(createDebercDeck(), rng);
  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  let idx = 0;
  // 6 to each hand, then 3 talon to each — dealt as one 9-card block per seat
  // (the deck is already shuffled, so the packet order does not affect fairness).
  for (let c = 0; c < 9; c++) {
    for (let p = 0; p < numPlayers; p++) hands[p].push(deck[idx++]);
  }
  const stock = deck.slice(idx);
  // The об'яз's talon top = the last (9th) card dealt to that seat, revealed.
  const tableTrumpCard = hands[objazSeat][hands[objazSeat].length - 1];
  return { hands, tableTrumpCard, stock };
}
