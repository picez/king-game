// ---------------------------------------------------------------------------
// Solitaire cards (S1). Pure and JSON-friendly: the same state runs in the
// browser and in the server's replay check.
// ---------------------------------------------------------------------------

import type { Card, Rank, Suit } from '../models/types';
import { makeRng } from '../core/rng';

export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

/** A solitaire card. `rank` 1 = Ace … 13 = King. `id` is unique within a deal. */
export interface SCard {
  id: number;
  suit: Suit;
  rank: number;
  up: boolean;
}

export const isRed = (c: Pick<SCard, 'suit'>): boolean => c.suit === 'hearts' || c.suit === 'diamonds';
export const sameColor = (a: SCard, b: SCard): boolean => isRed(a) === isRed(b);

const RANK_LABEL: Record<number, Rank> = {
  1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

/** The shape CardView renders (the table games' card model). */
export function toViewCard(c: SCard): Card {
  return { suit: c.suit, rank: RANK_LABEL[c.rank], value: c.rank };
}

/**
 * `decks` full 52-card decks; `suits` limits the suits used (Spider 1/2 suits)
 * while keeping 52 cards per deck (so 1 suit = 4 copies of spades per deck).
 */
export function buildDeck(decks: number, suits: readonly Suit[] = SUITS): SCard[] {
  const out: SCard[] = [];
  const per = 4 / suits.length; // copies of each used suit per deck
  let id = 0;
  for (let d = 0; d < decks; d++) {
    for (let copy = 0; copy < per; copy++) {
      for (const suit of suits) {
        for (let rank = 1; rank <= 13; rank++) out.push({ id: id++, suit, rank, up: false });
      }
    }
  }
  return out;
}

/** Seeded Fisher–Yates (mulberry32): the same seed always gives the same deal. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const rng = makeRng(seed);
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const faceUp = (c: SCard): SCard => (c.up ? c : { ...c, up: true });
export const faceDown = (c: SCard): SCard => (c.up ? { ...c, up: false } : c);
