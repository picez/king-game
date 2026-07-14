// ---------------------------------------------------------------------------
// 51 — deck construction and the deal. Pure + deterministic (all randomness via
// the injected rng). See 51_RULES.md §3 (deck) and §4 (deal).
//   • 2 players  → 1 standard 52-card deck + 2 jokers  = 54 cards;
//   • 3–4 players → 2 standard 52-card decks + 2 jokers = 106 cards.
//   • Each active seat is dealt 13, the STARTER gets 14; the rest form the
//     face-down draw pile; the discard pile starts EMPTY.
// ---------------------------------------------------------------------------

import type { Rank, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';
import type { FiftyOneCard } from './types';

/** Standard 52-card ranks, low→high. */
export const FIFTY_ONE_RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];
export const FIFTY_ONE_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

/** How many standard 52-card decks are used for a given player count (§3). */
export function deckCountFor(playerCount: number): number {
  return playerCount <= 2 ? 1 : 2;
}

/** Total cards in play for a given player count (decks × 52 + 2 jokers). */
export function totalDeckSize(playerCount: number): number {
  return deckCountFor(playerCount) * 52 + 2;
}

/** Build the unshuffled deck for `playerCount` (1 or 2 decks + 2 jokers). */
export function createFiftyOneDeck(playerCount: number): FiftyOneCard[] {
  const decks = deckCountFor(playerCount);
  const cards: FiftyOneCard[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of FIFTY_ONE_SUITS) {
      for (const rank of FIFTY_ONE_RANKS) {
        cards.push({ id: `${d}-${suit}-${rank}`, joker: false, suit, rank });
      }
    }
  }
  // Two jokers are always in play (§3).
  cards.push({ id: 'joker-0', joker: true, suit: null, rank: null });
  cards.push({ id: 'joker-1', joker: true, suit: null, rank: null });
  return cards;
}

/** Fisher–Yates shuffle using the injected rng (pure — returns a new array). */
export function shuffleFiftyOne(deck: FiftyOneCard[], rng: Rng): FiftyOneCard[] {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface FiftyOneDeal {
  handsBySeat: FiftyOneCard[][];
  drawPile: FiftyOneCard[];
  discardPile: FiftyOneCard[];
}

/**
 * Shuffle and deal a fresh round. `activeSeats` are the seats still in the
 * match (eliminated seats are skipped and get an empty hand). The `starterSeat`
 * is dealt 14 cards, every other active seat 13; the remainder is the draw
 * pile; the discard pile is empty (§4). Draw/discard tops are the LAST element.
 */
export function dealFiftyOne(
  playerCount: number,
  activeSeats: number[],
  starterSeat: number,
  rng: Rng,
): FiftyOneDeal {
  const deck = shuffleFiftyOne(createFiftyOneDeck(playerCount), rng);
  const handsBySeat: FiftyOneCard[][] = Array.from({ length: playerCount }, () => []);
  let idx = 0;
  for (const seat of activeSeats) {
    const count = seat === starterSeat ? 14 : 13;
    handsBySeat[seat] = deck.slice(idx, idx + count);
    idx += count;
  }
  return { handsBySeat, drawPile: deck.slice(idx), discardPile: [] };
}
