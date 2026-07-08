// ---------------------------------------------------------------------------
// Tarneeb — deck, rank values, and the deal. Pure + deterministic (all
// randomness comes from the injected rng). See TARNEEB_RULES.md §3, §4.
// ---------------------------------------------------------------------------

import type { Card, Rank, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';

/** Standard 52-card ranks, low→high index. Rank order high→low: A K Q J 10 … 2 (§3). */
export const TARNEEB_RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];
export const TARNEEB_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

/** Comparison value within a suit: 2→2 … 10→10, J→11, Q→12, K→13, A→14 (§3). */
const RANK_VALUE: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14,
};

/** Numeric rank order of a card (higher wins within the same suit). */
export function rankValue(card: Card): number {
  return RANK_VALUE[card.rank];
}

/** The rank value of a bare rank (used by the AI for hand strength). */
export function rankValueOf(rank: Rank): number {
  return RANK_VALUE[rank];
}

/** The unshuffled 52-card deck (13 ranks × 4 suits). */
export function createTarneebDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of TARNEEB_SUITS) {
    for (const rank of TARNEEB_RANKS) {
      deck.push({ suit, rank, value: RANK_VALUE[rank] });
    }
  }
  return deck;
}

/** Fisher–Yates shuffle using the injected rng (pure — returns a new array). */
export function shuffleTarneebDeck(deck: Card[], rng: Rng): Card[] {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Counter-clockwise successor (the player to `seat`'s right): 0→3→2→1→0 (§2). */
function rightOf(seat: number): number {
  return (seat + 3) % 4;
}

/**
 * Shuffle and deal all 52 cards, 13 to each seat. Per §4 [MVP], cards go out one
 * at a time counter-clockwise starting at the dealer's right — the final hands
 * are the same regardless of packet order, but this honours the documented deal.
 */
export function dealTarneeb(dealerSeat: number, rng: Rng): Card[][] {
  const deck = shuffleTarneebDeck(createTarneebDeck(), rng);
  const hands: Card[][] = [[], [], [], []];
  let seat = rightOf(dealerSeat); // the dealer's right receives the first card
  for (let i = 0; i < deck.length; i++) {
    hands[seat].push(deck[i]);
    seat = rightOf(seat);
  }
  return hands;
}
