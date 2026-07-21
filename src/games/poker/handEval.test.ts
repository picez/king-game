import { describe, expect, it } from 'vitest';
import { bestHand, compareHands, evaluateSeat, scoreFive } from './handEval';
import type { Rank, Suit } from '../../models/types';
import type { PokerCard } from './types';

const c = (rank: Rank, suit: Suit): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });
const cat = (cards: PokerCard[]) => scoreFive(cards).category;

describe('poker hand evaluator — every category (§9)', () => {
  it('classifies each of the ten categories', () => {
    expect(cat([c('A', 'spades'), c('K', 'spades'), c('Q', 'spades'), c('J', 'spades'), c('10', 'spades')])).toBe('royal_flush');
    expect(cat([c('9', 'hearts'), c('8', 'hearts'), c('7', 'hearts'), c('6', 'hearts'), c('5', 'hearts')])).toBe('straight_flush');
    expect(cat([c('7', 'spades'), c('7', 'hearts'), c('7', 'clubs'), c('7', 'diamonds'), c('2', 'spades')])).toBe('four_of_a_kind');
    expect(cat([c('K', 'spades'), c('K', 'hearts'), c('K', 'clubs'), c('4', 'diamonds'), c('4', 'spades')])).toBe('full_house');
    expect(cat([c('A', 'clubs'), c('J', 'clubs'), c('8', 'clubs'), c('5', 'clubs'), c('2', 'clubs')])).toBe('flush');
    expect(cat([c('9', 'spades'), c('8', 'hearts'), c('7', 'clubs'), c('6', 'diamonds'), c('5', 'spades')])).toBe('straight');
    expect(cat([c('Q', 'spades'), c('Q', 'hearts'), c('Q', 'clubs'), c('9', 'diamonds'), c('2', 'spades')])).toBe('three_of_a_kind');
    expect(cat([c('J', 'spades'), c('J', 'hearts'), c('4', 'clubs'), c('4', 'diamonds'), c('A', 'spades')])).toBe('two_pair');
    expect(cat([c('10', 'spades'), c('10', 'hearts'), c('K', 'clubs'), c('7', 'diamonds'), c('2', 'spades')])).toBe('one_pair');
    expect(cat([c('A', 'spades'), c('J', 'hearts'), c('9', 'clubs'), c('5', 'diamonds'), c('2', 'spades')])).toBe('high_card');
  });

  it('treats A-2-3-4-5 as the lowest straight (the wheel), 5 high', () => {
    const wheel = [c('A', 'spades'), c('2', 'hearts'), c('3', 'clubs'), c('4', 'diamonds'), c('5', 'spades')];
    expect(cat(wheel)).toBe('straight');
    const sixHigh = [c('6', 'spades'), c('5', 'hearts'), c('4', 'clubs'), c('3', 'diamonds'), c('2', 'spades')];
    // A 6-high straight beats the 5-high wheel.
    expect(compareHands(scoreFive(sixHigh), scoreFive(wheel))).toBeGreaterThan(0);
  });

  it('does NOT wrap around (Q-K-A-2-3 is not a straight)', () => {
    expect(cat([c('Q', 'spades'), c('K', 'hearts'), c('A', 'clubs'), c('2', 'diamonds'), c('3', 'spades')])).toBe('high_card');
  });

  it('royal flush is the strongest straight flush', () => {
    const royal = scoreFive([c('A', 'diamonds'), c('K', 'diamonds'), c('Q', 'diamonds'), c('J', 'diamonds'), c('10', 'diamonds')]);
    const kHigh = scoreFive([c('K', 'clubs'), c('Q', 'clubs'), c('J', 'clubs'), c('10', 'clubs'), c('9', 'clubs')]);
    expect(royal.category).toBe('royal_flush');
    expect(compareHands(royal, kHigh)).toBeGreaterThan(0);
  });
});

describe('poker evaluator — kicker + tie comparisons (§9)', () => {
  it('breaks a one-pair tie by the highest kicker', () => {
    const a = scoreFive([c('9', 'spades'), c('9', 'hearts'), c('A', 'clubs'), c('5', 'diamonds'), c('2', 'spades')]);
    const b = scoreFive([c('9', 'clubs'), c('9', 'diamonds'), c('K', 'clubs'), c('5', 'hearts'), c('2', 'hearts')]);
    expect(compareHands(a, b)).toBeGreaterThan(0); // ace kicker beats king kicker
  });

  it('breaks a two-pair tie by the kicker when both pairs match', () => {
    const a = scoreFive([c('J', 'spades'), c('J', 'hearts'), c('4', 'clubs'), c('4', 'diamonds'), c('A', 'spades')]);
    const b = scoreFive([c('J', 'clubs'), c('J', 'diamonds'), c('4', 'hearts'), c('4', 'spades'), c('K', 'spades')]);
    expect(compareHands(a, b)).toBeGreaterThan(0);
  });

  it('two identical-rank hands (suits differ) compare exactly equal', () => {
    const a = scoreFive([c('A', 'spades'), c('K', 'spades'), c('Q', 'hearts'), c('J', 'clubs'), c('9', 'diamonds')]);
    const b = scoreFive([c('A', 'hearts'), c('K', 'clubs'), c('Q', 'spades'), c('J', 'diamonds'), c('9', 'spades')]);
    expect(compareHands(a, b)).toBe(0); // suits never break ties
  });
});

describe('poker evaluator — best 5 of 7', () => {
  it('picks the best 5-card hand out of 7', () => {
    const hole = [c('A', 'spades'), c('A', 'hearts')];
    const board = [c('A', 'clubs'), c('K', 'diamonds'), c('K', 'spades'), c('2', 'hearts'), c('7', 'clubs')];
    // Best is aces full of kings.
    expect(evaluateSeat(hole, board).category).toBe('full_house');
  });

  it('finds a straight flush hidden inside 7 cards', () => {
    const cards = [
      c('6', 'clubs'), c('2', 'diamonds'), // hole
      c('3', 'clubs'), c('4', 'clubs'), c('5', 'clubs'), c('7', 'clubs'), c('K', 'hearts'), // board
    ];
    expect(bestHand(cards).category).toBe('straight_flush'); // 7-6-5-4-3 clubs
  });

  it('a shared board that both players play ties (board-only)', () => {
    const board = [c('A', 'spades'), c('A', 'hearts'), c('A', 'clubs'), c('K', 'diamonds'), c('K', 'spades')];
    const p1 = evaluateSeat([c('2', 'hearts'), c('3', 'clubs')], board);
    const p2 = evaluateSeat([c('2', 'diamonds'), c('4', 'spades')], board);
    // Both play the board (aces full of kings) — the 2/3/4 never improve it.
    expect(p1.category).toBe('full_house');
    expect(compareHands(p1, p2)).toBe(0);
  });
});
