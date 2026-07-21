import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { createPokerDeck, dealPoker, orderFrom, POKER_DECK_SIZE, shufflePoker } from './deck';

describe('poker deck (§1/§3)', () => {
  it('is a standard 52-card deck of unique cards, no jokers', () => {
    const deck = createPokerDeck();
    expect(deck).toHaveLength(POKER_DECK_SIZE);
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
    expect(deck.every((c) => c.suit !== null && c.rank !== null)).toBe(true);
  });

  it('shuffles deterministically for a given seed and preserves the 52 cards', () => {
    const a = shufflePoker(createPokerDeck(), makeRng(42));
    const b = shufflePoker(createPokerDeck(), makeRng(42));
    const c = shufflePoker(createPokerDeck(), makeRng(43));
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id)); // same seed → same order
    expect(a.map((x) => x.id)).not.toEqual(c.map((x) => x.id)); // different seed → different
    expect(new Set(a.map((x) => x.id)).size).toBe(52);
  });

  it('deals 2 hole cards to every active seat and leaves the rest as the deck', () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const seats = Array.from({ length: count }, (_, i) => i);
      const deal = dealPoker(count, seats, 0, makeRng(count));
      for (const s of seats) expect(deal.holeCardsBySeat[s]).toHaveLength(2);
      expect(deal.deck).toHaveLength(52 - count * 2);
      // No card appears twice across hands + remaining deck.
      const all = [...deal.holeCardsBySeat.flat(), ...deal.deck];
      expect(new Set(all.map((c) => c.id)).size).toBe(52);
    }
  });

  it('orders active seats clockwise from a start seat, skipping the inactive', () => {
    expect(orderFrom([0, 2, 3], 2, 4)).toEqual([2, 3, 0]);
    expect(orderFrom([0, 1, 2, 3], 0, 4)).toEqual([0, 1, 2, 3]);
  });
});
