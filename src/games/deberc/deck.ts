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
  /** Each seat's 6-card hand (bidding happens on these). */
  hands: Card[][];
  /** Each seat's face-down 3-card прикуп (taken into hand once trumps are chosen). */
  prykup: Card[][];
  /**
   * The face-up trump card (shows the round-1 table-trump suit). 4 players: it is
   * the dealer's прикуп top (picked up with that packet). 3 players: it is the top
   * of the undealt stock and is never taken. Never a separate card — always lives
   * in prykup[dealer] (4p) or stock (3p).
   */
  tableTrumpCard: Card;
  /** Undealt cards left on the table (9 for 3 players, 0 for 4). */
  stock: Card[];
}

/**
 * Shuffle and deal each seat a **6-card hand** plus a separate face-down
 * **3-card прикуп** packet (DEBERC_RULES.md §3, v1.1). Bidding is on the 6-card
 * hands; the прикуп is merged into the hand only after a trump is chosen.
 *
 * The face-up trump card:
 *  - **4 players** (24 + 12 = 36, no stock): it is the **dealer's** прикуп top,
 *    so the dealer picks it up with their packet.
 *  - **3 players** (18 + 9 = 27 dealt, 9 stock): the dealer has their own прикуп;
 *    the face-up card is the **top of the stock** and stays there (never taken).
 */
export function dealDeberc(numPlayers: number, dealerSeat: number, rng: Rng): DebercDealResult {
  const deck = shuffle(createDebercDeck(), rng);
  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  const prykup: Card[][] = Array.from({ length: numPlayers }, () => []);
  let idx = 0;
  // 6 to each hand…
  for (let c = 0; c < 6; c++) {
    for (let p = 0; p < numPlayers; p++) hands[p].push(deck[idx++]);
  }
  // …then a 3-card прикуп to each.
  for (let c = 0; c < 3; c++) {
    for (let p = 0; p < numPlayers; p++) prykup[p].push(deck[idx++]);
  }
  const stock = deck.slice(idx); // 3p → 9 undealt; 4p → 0.
  // 4p: the face-up trump is the dealer's прикуп top; 3p: the top of the stock.
  const tableTrumpCard = numPlayers === 4 ? prykup[dealerSeat][0] : stock[0];
  return { hands, prykup, tableTrumpCard, stock };
}
