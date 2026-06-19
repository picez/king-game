import type { Card, Rank, Suit } from '../models/types';
import type { Rng } from './rng';

const SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANKS_52: Rank[] = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANKS_32: Rank[] = ['7','8','9','10','J','Q','K','A'];

export function createDeck(deckSize: 32 | 52): Card[] {
  const ranks = deckSize === 52 ? RANKS_52 : RANKS_32;
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of ranks) {
      cards.push({ suit, rank, value: ranks.indexOf(rank) + 1 });
    }
  }
  return cards;
}

/**
 * Fisher-Yates shuffle — returns a new shuffled array.
 *
 * `rng` defaults to `Math.random` (local play is unchanged). Pass a seeded RNG
 * (see core/rng.ts) for a reproducible, server-controlled deal.
 */
export function shuffleDeck(cards: Card[], rng: Rng = Math.random): Card[] {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Validates a deck: checks expected card count and detects duplicates.
 * Must be called before every deal per PRD §10.3 / §10.4 / §11.3.
 */
export function validateDeck(cards: Card[], expectedSize: number): boolean {
  if (cards.length !== expectedSize) return false;
  const seen = new Set<string>();
  for (const card of cards) {
    const key = `${card.suit}:${card.rank}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/**
 * Deals cards round-robin starting from the player to the dealer's left,
 * per PRD §4.1 / §4.2. Returns one hand array per player and kitty cards.
 */
export function dealCards(
  deck: Card[],
  playerCount: number,
  cardsPerPlayer: number,
  kittySize: number,
  dealerIdx: number,
): { hands: Card[][]; kitty: Card[] } {
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  for (let i = 0; i < cardsPerPlayer * playerCount; i++) {
    // Start from the player to the dealer's left (dealerIdx + 1)
    const playerIdx = (dealerIdx + 1 + i) % playerCount;
    hands[playerIdx].push(deck[i]);
  }
  const kittyStart = cardsPerPlayer * playerCount;
  const kitty = deck.slice(kittyStart, kittyStart + kittySize);
  return { hands, kitty };
}
