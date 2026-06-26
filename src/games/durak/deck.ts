// ---------------------------------------------------------------------------
// Durak — deck, deal, trump, first attacker (Stage 9.1). Pure + deterministic
// (all randomness comes from the injected rng). See DURAK_RULES.md §1.
// ---------------------------------------------------------------------------

import type { Card, Rank, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';

/** 36-card Durak ranks: 6 (low) … A (high). */
export const DURAK_RANKS: Rank[] = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const DURAK_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

const RANK_VALUE: Record<string, number> = {
  '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
};

/** Comparison value for a rank (6 → 6 … A → 14). */
export function cardValue(rank: Rank): number {
  return RANK_VALUE[rank];
}

/** The full 36-card deck (unshuffled). */
export function createDurakDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of DURAK_SUITS) {
    for (const rank of DURAK_RANKS) deck.push({ suit, rank, value: RANK_VALUE[rank] });
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

export interface DealResult {
  hands: Card[][];
  drawPile: Card[];
  trumpCard: Card;
  trumpSuit: Suit;
}

/**
 * Shuffle, deal 6 to each player (round-robin), then reveal the next card as the
 * trump and slide it to the bottom of the draw pile (last to be drawn).
 */
export function dealDurak(numPlayers: number, rng: Rng): DealResult {
  const deck = shuffle(createDurakDeck(), rng);
  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  let idx = 0;
  for (let c = 0; c < 6; c++) {
    for (let p = 0; p < numPlayers; p++) hands[p].push(deck[idx++]);
  }
  const remaining = deck.slice(idx);
  const trumpCard = remaining[0];                       // revealed trump
  const drawPile = remaining.slice(1).concat(trumpCard); // trump at the bottom
  return { hands, drawPile, trumpCard, trumpSuit: trumpCard.suit };
}

/** The trump suit defined by the revealed card. */
export function determineTrump(trumpCard: Card): Suit {
  return trumpCard.suit;
}

/**
 * Index of the player holding the lowest trump card, or null if nobody holds a
 * trump (the caller falls back to seat 0 — DURAK_RULES.md §1 "First attacker").
 */
export function findLowestTrumpHolder(hands: Card[][], trumpSuit: Suit): number | null {
  let best = -1;
  let bestVal = Infinity;
  hands.forEach((hand, i) => {
    for (const c of hand) {
      if (c.suit === trumpSuit && c.value < bestVal) { bestVal = c.value; best = i; }
    }
  });
  return best === -1 ? null : best;
}
