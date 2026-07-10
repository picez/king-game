import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { rankValueOf } from './deck';
import {
  bidRank, isValidBidShape, suitIndex, CONTRACT_SUIT_ORDER, trumpSuitOf,
  determineTrickWinner,
} from './rules';
import type { PreferansPlay } from './types';

const C = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: rankValueOf(rank) });

describe('bidding ladder', () => {
  it('suit order is ♠ < ♣ < ♦ < ♥ < NT', () => {
    expect(CONTRACT_SUIT_ORDER).toEqual(['spades', 'clubs', 'diamonds', 'hearts', 'NT']);
    expect(suitIndex('spades')).toBe(0);
    expect(suitIndex('NT')).toBe(4);
  });

  it('ascends strictly: 6♠ < 6♣ < … < 6NT < 7♠ < … < 10NT', () => {
    const ladder = [
      bidRank({ level: 6, suit: 'spades' }),
      bidRank({ level: 6, suit: 'clubs' }),
      bidRank({ level: 6, suit: 'diamonds' }),
      bidRank({ level: 6, suit: 'hearts' }),
      bidRank({ level: 6, suit: 'NT' }),
      bidRank({ level: 7, suit: 'spades' }),
      bidRank({ level: 10, suit: 'NT' }),
    ];
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).toBeGreaterThan(ladder[i - 1]);
    expect(bidRank({ level: 6, suit: 'spades' })).toBe(0);
    expect(bidRank({ level: 6, suit: 'NT' })).toBe(4);
    expect(bidRank({ level: 7, suit: 'spades' })).toBe(5);
    expect(bidRank({ level: 10, suit: 'NT' })).toBe(24);
  });

  it('valid bid shape rejects out-of-range levels / unknown suits', () => {
    expect(isValidBidShape(6, 'spades')).toBe(true);
    expect(isValidBidShape(10, 'NT')).toBe(true);
    expect(isValidBidShape(5, 'spades')).toBe(false);
    expect(isValidBidShape(11, 'hearts')).toBe(false);
    expect(isValidBidShape(6, 'x' as Suit)).toBe(false);
    expect(isValidBidShape(6.5, 'spades')).toBe(false);
  });
});

describe('trumpSuitOf', () => {
  it('is the suit for a suit contract, null for NT', () => {
    expect(trumpSuitOf({ level: 7, suit: 'hearts' })).toBe('hearts');
    expect(trumpSuitOf({ level: 8, suit: 'NT' })).toBeNull();
  });
});

describe('determineTrickWinner', () => {
  const plays = (arr: [number, Card][]): PreferansPlay[] =>
    arr.map(([seat, card], i) => ({ seat, card, playOrder: i + 1 }));

  it('highest of the led suit wins with no trump (NT)', () => {
    const t = plays([[0, C('hearts', '9')], [1, C('hearts', 'K')], [2, C('spades', 'A')]]);
    // led = hearts; spades A is off-suit and cannot win in NT.
    expect(determineTrickWinner(t, 'hearts', null)).toBe(1);
  });

  it('a trump beats the led suit', () => {
    const t = plays([[0, C('hearts', 'A')], [1, C('spades', '7')], [2, C('hearts', 'K')]]);
    // led = hearts, trump = spades; seat 1's low trump beats the ace of hearts.
    expect(determineTrickWinner(t, 'hearts', 'spades')).toBe(1);
  });

  it('highest trump wins when several are played', () => {
    const t = plays([[0, C('spades', '9')], [1, C('spades', 'Q')], [2, C('hearts', 'A')]]);
    expect(determineTrickWinner(t, 'spades', 'spades')).toBe(1);
  });

  it('off-suit non-trump discards never win', () => {
    const t = plays([[0, C('clubs', '7')], [1, C('diamonds', 'A')], [2, C('hearts', 'A')]]);
    // led = clubs, no trump: only the 7♣ is on-suit → seat 0 wins despite the aces.
    expect(determineTrickWinner(t, 'clubs', null)).toBe(0);
  });
});
