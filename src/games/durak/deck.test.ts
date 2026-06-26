import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import {
  createDurakDeck, dealDurak, shuffle, findLowestTrumpHolder, cardValue, determineTrump,
} from './deck';
import type { Card } from '../../models/types';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit, value: cardValue(rank) });
const key = (c: Card) => `${c.rank}${c.suit[0]}`;

describe('Durak deck', () => {
  it('builds 36 unique cards (6–A × 4 suits)', () => {
    const deck = createDurakDeck();
    expect(deck).toHaveLength(36);
    expect(new Set(deck.map(key)).size).toBe(36);
    expect(deck.every((c) => c.value >= 6 && c.value <= 14)).toBe(true);
    expect(deck.some((c) => c.rank === '6')).toBe(true);
    expect(deck.some((c) => c.rank === '5')).toBe(false); // no low cards below 6
  });

  it('shuffle is deterministic for a given rng seed and preserves the multiset', () => {
    const a = shuffle(createDurakDeck(), makeRng(123));
    const b = shuffle(createDurakDeck(), makeRng(123));
    expect(a.map(key)).toEqual(b.map(key));
    expect(new Set(a.map(key)).size).toBe(36);
  });

  it.each([2, 3, 4])('deals 6 to each of %i players; trump is the bottom card', (n) => {
    const { hands, drawPile, trumpCard, trumpSuit } = dealDurak(n, makeRng(7));
    expect(hands).toHaveLength(n);
    expect(hands.every((h) => h.length === 6)).toBe(true);
    expect(drawPile).toHaveLength(36 - 6 * n);
    expect(drawPile[drawPile.length - 1]).toEqual(trumpCard);     // trump drawn last
    expect(trumpSuit).toBe(trumpCard.suit);
    expect(determineTrump(trumpCard)).toBe(trumpSuit);
    // All 36 cards accounted for, no duplicates.
    const all = [...hands.flat(), ...drawPile.slice(0, -1), trumpCard];
    expect(new Set(all.map(key)).size).toBe(36);
  });

  it('finds the lowest trump holder', () => {
    const hands: Card[][] = [
      [C('K', 'spades'), C('9', 'hearts')],   // trump (spades) K
      [C('7', 'spades'), C('A', 'clubs')],    // trump 7 ← lowest
      [C('Q', 'spades')],                      // trump Q
    ];
    expect(findLowestTrumpHolder(hands, 'spades')).toBe(1);
  });

  it('returns null when nobody holds a trump (caller falls back to seat 0)', () => {
    const hands: Card[][] = [[C('7', 'hearts')], [C('8', 'clubs')]];
    expect(findLowestTrumpHolder(hands, 'spades')).toBeNull();
  });
});
