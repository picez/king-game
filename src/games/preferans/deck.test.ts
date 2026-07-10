import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import {
  createPreferansDeck, shufflePreferansDeck, dealPreferans, nextSeat,
  NUM_SEATS, HAND_SIZE, TALON_SIZE,
} from './deck';

describe('Preferans deck', () => {
  it('is 32 unique cards (7–A × 4 suits)', () => {
    const deck = createPreferansDeck();
    expect(deck).toHaveLength(32);
    const keys = new Set(deck.map((c) => `${c.suit}:${c.rank}`));
    expect(keys.size).toBe(32);
    // Only 7..A ranks; no 2–6.
    expect(deck.some((c) => ['2', '3', '4', '5', '6'].includes(c.rank))).toBe(false);
  });

  it('shuffle is a permutation (same 32 cards) and deterministic per seed', () => {
    const a = shufflePreferansDeck(createPreferansDeck(), makeRng(42));
    const b = shufflePreferansDeck(createPreferansDeck(), makeRng(42));
    expect(a.map((c) => `${c.suit}${c.rank}`)).toEqual(b.map((c) => `${c.suit}${c.rank}`));
    expect(new Set(a.map((c) => `${c.suit}:${c.rank}`)).size).toBe(32);
  });
});

describe('Preferans deal', () => {
  it('gives 10 cards to each of 3 seats + a 2-card talon, all 32 distinct', () => {
    const { hands, talon } = dealPreferans(0, makeRng(7));
    expect(hands).toHaveLength(NUM_SEATS);
    hands.forEach((h) => expect(h).toHaveLength(HAND_SIZE));
    expect(talon).toHaveLength(TALON_SIZE);
    const all = [...hands.flat(), ...talon];
    expect(all).toHaveLength(32);
    expect(new Set(all.map((c) => `${c.suit}:${c.rank}`)).size).toBe(32);
  });
});

describe('seat rotation', () => {
  it('nextSeat is left / clockwise: 0→1→2→0', () => {
    expect(nextSeat(0)).toBe(1);
    expect(nextSeat(1)).toBe(2);
    expect(nextSeat(2)).toBe(0);
  });
});
