import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import {
  createTarneebDeck,
  dealTarneeb,
  rankValue,
  shuffleTarneebDeck,
  TARNEEB_RANKS,
  TARNEEB_SUITS,
} from './deck';

const key = (c: { suit: string; rank: string }) => `${c.suit}-${c.rank}`;

describe('Tarneeb deck', () => {
  it('has 52 unique cards', () => {
    const deck = createTarneebDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(key)).size).toBe(52);
  });

  it('contains every suit and rank', () => {
    const deck = createTarneebDeck();
    for (const suit of TARNEEB_SUITS) {
      for (const rank of TARNEEB_RANKS) {
        expect(deck.some((c) => c.suit === suit && c.rank === rank)).toBe(true);
      }
    }
    expect(TARNEEB_RANKS).toHaveLength(13);
    expect(TARNEEB_SUITS).toHaveLength(4);
  });

  it('orders ranks A high down to 2 low', () => {
    const A = { suit: 'spades', rank: 'A', value: 14 } as const;
    const K = { suit: 'spades', rank: 'K', value: 13 } as const;
    const two = { suit: 'spades', rank: '2', value: 2 } as const;
    expect(rankValue(A)).toBe(14);
    expect(rankValue(K)).toBe(13);
    expect(rankValue(two)).toBe(2);
    expect(rankValue(A)).toBeGreaterThan(rankValue(K));
    expect(rankValue(K)).toBeGreaterThan(rankValue(two));
  });

  it('shuffle is a permutation (no card lost or duplicated) and pure', () => {
    const deck = createTarneebDeck();
    const shuffled = shuffleTarneebDeck(deck, makeRng(123));
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map(key))).toEqual(new Set(deck.map(key)));
    // original untouched
    expect(deck.map(key)).toEqual(createTarneebDeck().map(key));
  });

  it('deals 13 cards to each of 4 seats with no duplicate or lost card', () => {
    const hands = dealTarneeb(0, makeRng(42));
    expect(hands).toHaveLength(4);
    for (const hand of hands) expect(hand).toHaveLength(13);
    const all = hands.flat();
    expect(all).toHaveLength(52);
    expect(new Set(all.map(key)).size).toBe(52);
  });

  it('deal is deterministic for a fixed seed', () => {
    const a = dealTarneeb(1, makeRng(7)).map((h) => h.map(key));
    const b = dealTarneeb(1, makeRng(7)).map((h) => h.map(key));
    expect(a).toEqual(b);
  });
});
