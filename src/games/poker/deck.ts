// ---------------------------------------------------------------------------
// Poker — deck construction, shuffle and deal. Pure + deterministic (all
// randomness via the injected rng). See POKER_RULES.md §1/§3. A single standard
// 52-card deck, no jokers. Card ids are unique (`<suit>-<rank>`).
// ---------------------------------------------------------------------------

import type { Rank, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';
import type { PokerCard } from './types';

/** Standard 52-card ranks, low→high. */
export const POKER_RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const POKER_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

/** Total cards in play — always a single 52-card deck. */
export const POKER_DECK_SIZE = 52;

/** Build the unshuffled 52-card deck. */
export function createPokerDeck(): PokerCard[] {
  const cards: PokerCard[] = [];
  for (const suit of POKER_SUITS) {
    for (const rank of POKER_RANKS) {
      cards.push({ id: `${suit}-${rank}`, suit, rank });
    }
  }
  return cards;
}

/** Fisher–Yates shuffle using the injected rng (pure — returns a new array). */
export function shufflePoker(deck: PokerCard[], rng: Rng): PokerCard[] {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface PokerDeal {
  /** 2 hole cards per active seat (eliminated seats get an empty hand). */
  holeCardsBySeat: PokerCard[][];
  /** The remaining face-down deck (board + burns come off the TOP = index 0). */
  deck: PokerCard[];
}

/**
 * Shuffle a fresh 52-card deck and deal 2 hole cards to each active seat. Deals
 * one card at a time around the table (starter first) exactly like a real deal,
 * so the leftover deck order is well defined. `activeSeats` are the seats still in
 * the match; the deal starts at `firstSeat` (small blind / left of button) and
 * goes clockwise. Eliminated seats get [].
 */
export function dealPoker(
  playerCount: number,
  activeSeats: number[],
  firstSeat: number,
  rng: Rng,
): PokerDeal {
  const deck = shufflePoker(createPokerDeck(), rng);
  const holeCardsBySeat: PokerCard[][] = Array.from({ length: playerCount }, () => []);
  // Order the active seats clockwise starting from firstSeat.
  const order = orderFrom(activeSeats, firstSeat, playerCount);
  let idx = 0;
  for (let round = 0; round < 2; round++) {
    for (const seat of order) {
      holeCardsBySeat[seat].push(deck[idx++]);
    }
  }
  return { holeCardsBySeat, deck: deck.slice(idx) };
}

/** Active seats ordered clockwise beginning at `firstSeat`. */
export function orderFrom(activeSeats: number[], firstSeat: number, playerCount: number): number[] {
  const active = new Set(activeSeats);
  const order: number[] = [];
  for (let step = 0; step < playerCount; step++) {
    const seat = (firstSeat + step) % playerCount;
    if (active.has(seat)) order.push(seat);
  }
  return order;
}
