import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import {
  createFiftyOneDeck,
  dealFiftyOne,
  deckCountFor,
  shuffleFiftyOne,
  totalDeckSize,
} from './deck';

describe('51 deck', () => {
  it('builds 54 cards (1 deck + 2 jokers) for 2 players', () => {
    const deck = createFiftyOneDeck(2);
    expect(deck).toHaveLength(54);
    expect(deck.filter((c) => c.joker)).toHaveLength(2);
    expect(deck.filter((c) => !c.joker)).toHaveLength(52);
    expect(deckCountFor(2)).toBe(1);
    expect(totalDeckSize(2)).toBe(54);
  });

  it.each([3, 4])('builds 106 cards (2 decks + 2 jokers) for %i players', (n) => {
    const deck = createFiftyOneDeck(n);
    expect(deck).toHaveLength(106);
    expect(deck.filter((c) => c.joker)).toHaveLength(2);
    expect(deck.filter((c) => !c.joker)).toHaveLength(104);
    expect(totalDeckSize(n)).toBe(106);
  });

  it('gives every card a unique id (even the two decks) but allows duplicate rank/suit', () => {
    const deck = createFiftyOneDeck(4);
    const ids = new Set(deck.map((c) => c.id));
    expect(ids.size).toBe(deck.length); // ids unique
    // Two physical 9♥ exist (one per deck), same rank+suit, different id.
    const nineHearts = deck.filter((c) => c.rank === '9' && c.suit === 'hearts');
    expect(nineHearts).toHaveLength(2);
    expect(nineHearts[0].id).not.toBe(nineHearts[1].id);
  });

  it('shuffle is deterministic for a seed and preserves the multiset', () => {
    const a = shuffleFiftyOne(createFiftyOneDeck(4), makeRng(42));
    const b = shuffleFiftyOne(createFiftyOneDeck(4), makeRng(42));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(new Set(a.map((c) => c.id)).size).toBe(106);
  });

  it.each([2, 3, 4])('deals 14 to the starter, 13 to the rest; discard empty (%i players)', (n) => {
    const seats = Array.from({ length: n }, (_, i) => i);
    const starter = 1;
    const { handsBySeat, drawPile, discardPile } = dealFiftyOne(n, seats, starter, makeRng(5));
    expect(handsBySeat[starter]).toHaveLength(14);
    for (const seat of seats) {
      if (seat !== starter) expect(handsBySeat[seat]).toHaveLength(13);
    }
    const dealt = 14 + 13 * (n - 1);
    expect(drawPile).toHaveLength(totalDeckSize(n) - dealt);
    expect(discardPile).toHaveLength(0);
    // Conservation: every card is somewhere, no duplicates.
    const all = [...handsBySeat.flat(), ...drawPile];
    expect(all).toHaveLength(totalDeckSize(n));
    expect(new Set(all.map((c) => c.id)).size).toBe(totalDeckSize(n));
  });

  it('skips eliminated seats (empty hands) when dealing', () => {
    // 4 seats but seat 2 eliminated → deal to seats [0,1,3].
    const { handsBySeat } = dealFiftyOne(4, [0, 1, 3], 0, makeRng(9));
    expect(handsBySeat[0]).toHaveLength(14);
    expect(handsBySeat[1]).toHaveLength(13);
    expect(handsBySeat[2]).toHaveLength(0);
    expect(handsBySeat[3]).toHaveLength(13);
  });
});
