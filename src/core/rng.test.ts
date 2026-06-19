import { describe, it, expect } from 'vitest';
import { makeRng, hashString } from './rng';
import { createDeck, shuffleDeck } from './deck';
import { gameReducer } from './gameEngine';
import type { GameAction } from './gameEngine';

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(12345);
    const b = makeRng(12345);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a()).not.toBe(b());
  });

  it('stays within [0, 1)', () => {
    const r = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('shuffleDeck with a seeded RNG', () => {
  it('same seed → identical shuffle', () => {
    const deck = createDeck(32);
    const s1 = shuffleDeck(deck, makeRng(777));
    const s2 = shuffleDeck(deck, makeRng(777));
    expect(s1).toEqual(s2);
  });

  it('different seed → different shuffle (overwhelmingly likely)', () => {
    const deck = createDeck(52);
    const s1 = shuffleDeck(deck, makeRng(1));
    const s2 = shuffleDeck(deck, makeRng(2));
    expect(s1).not.toEqual(s2);
  });

  it('without an rng still works (local play, Math.random)', () => {
    const deck = createDeck(32);
    const shuffled = shuffleDeck(deck);
    expect(shuffled).toHaveLength(32);
  });
});

describe('seeded deal via the reducer is reproducible', () => {
  const action: GameAction = {
    type: 'START_GAME',
    playerNames: ['A', 'B', 'C', 'D'],
    playerTypes: ['human', 'human', 'human', 'human'],
    modeSelectionType: 'fixed',
  };

  it('same seed → identical hands and first dealer', () => {
    const s1 = gameReducer(null, action, { rng: makeRng(42) })!;
    const s2 = gameReducer(null, action, { rng: makeRng(42) })!;
    expect(s1.dealerIndex).toBe(s2.dealerIndex);
    expect(s1.players.map((p) => p.hand)).toEqual(s2.players.map((p) => p.hand));
  });

  it('different seed → different deal', () => {
    const s1 = gameReducer(null, action, { rng: makeRng(1) })!;
    const s2 = gameReducer(null, action, { rng: makeRng(2) })!;
    expect(s1.players.map((p) => p.hand)).not.toEqual(s2.players.map((p) => p.hand));
  });

  it('without a seed (local) still deals a valid game', () => {
    const s = gameReducer(null, action)!;
    expect(s.players).toHaveLength(4);
    expect(s.players.every((p) => p.hand.length === 13)).toBe(true);
  });
});

describe('hashString', () => {
  it('is stable and differs for different input', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
});
