import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../models/types';
import { canDiscardToKitty, getValidKittyDiscards } from './kitty';

function card(suit: Suit, rank: Rank): Card {
  return { suit, rank, value: 1 };
}

const HAND: Card[] = [
  card('hearts', '7'),
  card('hearts', 'K'),
  card('spades', 'Q'),
  card('clubs', 'J'),
  card('diamonds', '9'),
  card('spades', 'A'),
];

describe('canDiscardToKitty — forbidden penalty cards by mode', () => {
  it('No Hearts: cannot discard a heart, can discard others', () => {
    expect(canDiscardToKitty(card('hearts', '7'), 'no_hearts')).toBe(false);
    expect(canDiscardToKitty(card('hearts', 'K'), 'no_hearts')).toBe(false);
    expect(canDiscardToKitty(card('spades', 'A'), 'no_hearts')).toBe(true);
  });

  it('No Queens: cannot discard a Q (any suit)', () => {
    expect(canDiscardToKitty(card('spades', 'Q'), 'no_queens')).toBe(false);
    expect(canDiscardToKitty(card('hearts', 'Q'), 'no_queens')).toBe(false);
    expect(canDiscardToKitty(card('spades', 'K'), 'no_queens')).toBe(true);
  });

  it('No Jacks: cannot discard a J (any suit)', () => {
    expect(canDiscardToKitty(card('clubs', 'J'), 'no_jacks')).toBe(false);
    expect(canDiscardToKitty(card('clubs', '10'), 'no_jacks')).toBe(true);
  });

  it('King of Hearts: cannot discard ANY heart; non-hearts are fine', () => {
    expect(canDiscardToKitty(card('hearts', 'K'), 'king_of_hearts')).toBe(false);
    expect(canDiscardToKitty(card('hearts', '7'), 'king_of_hearts')).toBe(false); // all hearts forbidden
    expect(canDiscardToKitty(card('spades', 'K'), 'king_of_hearts')).toBe(true);
    expect(canDiscardToKitty(card('clubs', '9'), 'king_of_hearts')).toBe(true);
  });

  it('No Tricks / Last Two Tricks / Trump: anything may be discarded', () => {
    for (const mode of ['no_tricks', 'last_two_tricks', 'trump'] as const) {
      for (const c of HAND) {
        expect(canDiscardToKitty(c, mode)).toBe(true);
      }
    }
  });
});

describe('getValidKittyDiscards', () => {
  it('filters out the current mode penalty cards', () => {
    const legal = getValidKittyDiscards(HAND, 'no_hearts');
    expect(legal.some((c) => c.suit === 'hearts')).toBe(false);
    expect(legal).toHaveLength(HAND.length - 2); // two hearts removed
  });

  it('returns the whole hand for non-restricted modes', () => {
    expect(getValidKittyDiscards(HAND, 'no_tricks')).toHaveLength(HAND.length);
    expect(getValidKittyDiscards(HAND, 'trump')).toHaveLength(HAND.length);
  });
});
