// ---------------------------------------------------------------------------
// Preferans — deck, rank values, seat rotation, and the deal. Pure +
// deterministic (all randomness comes from the injected rng). See
// PREFERANS_RULES.md §3 (deck), §4 (deal), §2 (seating).
// ---------------------------------------------------------------------------

import type { Card, Rank, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';

/** 32-card ranks, low→high index. Rank order high→low: A K Q J 10 9 8 7 (§3). */
export const PREFERANS_RANKS: Rank[] = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
/** Suits in AUCTION order (low→high): ♠ < ♣ < ♦ < ♥ (< NT, handled in rules). */
export const PREFERANS_SUITS: Suit[] = ['spades', 'clubs', 'diamonds', 'hearts'];

/** Comparison value within a suit: 7→7 … 10→10, J→11, Q→12, K→13, A→14 (§3). */
const RANK_VALUE: Record<string, number> = {
  '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

/** Numeric rank order of a card (higher wins within the same suit). */
export function rankValue(card: Card): number {
  return RANK_VALUE[card.rank];
}
/** The rank value of a bare rank (used by the AI for hand strength). */
export function rankValueOf(rank: Rank): number {
  return RANK_VALUE[rank];
}

export const NUM_SEATS = 3;
export const HAND_SIZE = 10;
export const TALON_SIZE = 2;
export const HAND_TRICKS = 10;

/** The seat to `seat`'s LEFT — turn order proceeds left: 0→1→2→0 (§2). */
export function nextSeat(seat: number): number {
  return (seat + 1) % NUM_SEATS;
}

/** The unshuffled 32-card deck (8 ranks × 4 suits). */
export function createPreferansDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of PREFERANS_SUITS) {
    for (const rank of PREFERANS_RANKS) {
      deck.push({ suit, rank, value: RANK_VALUE[rank] });
    }
  }
  return deck;
}

/** Fisher–Yates shuffle using the injected rng (pure — returns a new array). */
export function shufflePreferansDeck(deck: Card[], rng: Rng): Card[] {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Shuffle and deal: 10 cards to each of the 3 seats (starting left of the dealer),
 * then the last 2 cards form the face-down talon (§4). The final hands are the same
 * regardless of packet order; dealing left-of-dealer honours the documented deal.
 */
export function dealPreferans(dealerSeat: number, rng: Rng): { hands: Card[][]; talon: Card[] } {
  const deck = shufflePreferansDeck(createPreferansDeck(), rng);
  const hands: Card[][] = [[], [], []];
  let seat = nextSeat(dealerSeat); // the player left of the dealer receives the first card
  for (let i = 0; i < NUM_SEATS * HAND_SIZE; i++) {
    hands[seat].push(deck[i]);
    seat = nextSeat(seat);
  }
  const talon = deck.slice(NUM_SEATS * HAND_SIZE); // the last 2 cards
  return { hands, talon };
}
