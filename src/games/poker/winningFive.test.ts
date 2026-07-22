import { describe, it, expect } from 'vitest';
import { evaluateSeat, scoreFive } from './handEval';
import type { PokerCard, Rank, Suit } from './types';

// The evaluator exposes the EXACT five winning cards (§16 I) so the showdown UI can
// highlight them. Suits never affect strength/ties, but the returned five is
// deterministic and always length 5, drawn from the seat's hole+board.

const card = (suit: Suit, rank: Rank): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });

describe('evaluateSeat winning-five', () => {
  it('royal flush → the five royal cards, category royal_flush', () => {
    const hole = [card('spades', 'A'), card('spades', 'K')];
    const board = [card('spades', 'Q'), card('spades', 'J'), card('spades', '10'), card('hearts', '2'), card('clubs', '3')];
    const sc = evaluateSeat(hole, board);
    expect(sc.category).toBe('royal_flush');
    expect(sc.cards).toHaveLength(5);
    expect(sc.cards.map((c) => c.id).sort()).toEqual(['spades-10', 'spades-A', 'spades-J', 'spades-K', 'spades-Q'].sort());
  });

  it('A-2-3-4-5 wheel straight → the five wheel cards, category straight', () => {
    const hole = [card('spades', 'A'), card('hearts', '2')];
    const board = [card('clubs', '3'), card('diamonds', '4'), card('spades', '5'), card('hearts', 'K'), card('clubs', 'Q')];
    const sc = evaluateSeat(hole, board);
    expect(sc.category).toBe('straight');
    expect(sc.cards).toHaveLength(5);
    expect(sc.cards.map((c) => c.rank).sort()).toEqual(['2', '3', '4', '5', 'A'].sort());
  });

  it('board-only best hand still returns exactly five cards', () => {
    // Both players play the board: a flush on the board.
    const hole = [card('clubs', '2'), card('diamonds', '3')];
    const board = [card('spades', 'A'), card('spades', 'K'), card('spades', 'Q'), card('spades', 'J'), card('spades', '9')];
    const sc = evaluateSeat(hole, board);
    expect(sc.category).toBe('flush');
    expect(sc.cards).toHaveLength(5);
    // The five come from the board's spades (best flush), not the off-suit hole cards.
    expect(sc.cards.every((c) => c.suit === 'spades')).toBe(true);
  });

  it('scoreFive returns the exact five it was given', () => {
    const five = [card('spades', 'A'), card('spades', 'K'), card('spades', 'Q'), card('spades', 'J'), card('spades', '10')];
    const sc = scoreFive(five);
    expect(sc.cards.map((c) => c.id)).toEqual(five.map((c) => c.id));
  });

  it('two pair picks the correct five (top two pairs + best kicker)', () => {
    const hole = [card('spades', 'A'), card('hearts', 'A')];
    const board = [card('clubs', 'K'), card('diamonds', 'K'), card('spades', 'Q'), card('hearts', '2'), card('clubs', '3')];
    const sc = evaluateSeat(hole, board);
    expect(sc.category).toBe('two_pair');
    expect(sc.cards).toHaveLength(5);
    const ranks = sc.cards.map((c) => c.rank).sort();
    expect(ranks).toEqual(['A', 'A', 'K', 'K', 'Q'].sort());
  });
});
