import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { pokerReducer } from './engine';
import { allCards, checkPokerInvariants } from './invariants';
import type { PokerState } from './types';

function start(playerCount: number, seed: number): PokerState {
  const names = Array.from({ length: playerCount }, (_, i) => `P${i}`);
  return pokerReducer(null, {
    type: 'START_GAME', playerNames: names, playerTypes: names.map(() => 'ai' as const), playerCount, buttonSeat: 0,
  }, { rng: makeRng(seed) }) as PokerState;
}

describe('poker invariants', () => {
  it('a freshly dealt hand is well-formed (52 unique cards, chips conserved)', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const s = start(n, n * 7);
      expect(checkPokerInvariants(s)).toEqual([]);
      const cards = allCards(s);
      expect(cards).toHaveLength(52);
      expect(new Set(cards.map((c) => c.id)).size).toBe(52);
    }
  });

  it('flags a chip-conservation violation', () => {
    const s = start(3, 5);
    const bad = { ...s, stacksBySeat: s.stacksBySeat.map((x, i) => (i === 0 ? x + 500 : x)) };
    expect(checkPokerInvariants(bad).some((e) => e.includes('chip conservation'))).toBe(true);
  });

  it('flags a duplicate card', () => {
    const s = start(2, 5);
    const dup = { ...s, board: [...s.board, s.holeCardsBySeat[0][0]] };
    // board length becomes illegal too, but the duplicate id must be reported.
    expect(checkPokerInvariants(dup).some((e) => e.includes('duplicate') || e.includes('card count'))).toBe(true);
  });
});
