import { describe, expect, it } from 'vitest';
import type { PokerCard, Rank, Suit } from '../../games/poker/types';
import { compactChips, myHandCategory } from './handStrength';

const c = (suit: Suit, rank: Rank): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });
const back: PokerCard = { id: 'hidden', suit: null, rank: null } as unknown as PokerCard;

describe('myHandCategory', () => {
  it('preflop: a pocket pair or a high card', () => {
    expect(myHandCategory([c('spades', 'A'), c('hearts', 'A')], [])).toBe('one_pair');
    expect(myHandCategory([c('spades', 'A'), c('hearts', 'K')], [])).toBe('high_card');
  });
  it('from the flop on: the best five of hole + board', () => {
    const board = [c('spades', 'K'), c('spades', '7'), c('spades', '2')];
    expect(myHandCategory([c('spades', 'A'), c('spades', '9')], board)).toBe('flush');
    expect(myHandCategory([c('hearts', 'K'), c('clubs', '7')], board)).toBe('two_pair');
    expect(myHandCategory([c('hearts', 'K'), c('clubs', 'K')], [...board, c('diamonds', '7')])).toBe('full_house');
  });
  it('nothing to name for face-down or missing cards', () => {
    expect(myHandCategory([back, back], [])).toBeNull();
    expect(myHandCategory([], [])).toBeNull();
  });
});

describe('compactChips', () => {
  it('keeps small stacks exact and abbreviates large ones', () => {
    expect(compactChips(8450)).toBe('8450');
    expect(compactChips(9999)).toBe('9999');
    expect(compactChips(12_500)).toBe('12.5K');
    expect(compactChips(250_000)).toBe('250K');
    expect(compactChips(1_200_000)).toBe('1.2M');
    expect(compactChips(0)).toBe('0');
  });
});
