import { describe, it, expect } from 'vitest';
import { calcSelection, calcHandTotal } from './calculator';
import type { FiftyOneCard } from './types';

const c = (id: string, suit: FiftyOneCard['suit'], rank: FiftyOneCard['rank']): FiftyOneCard =>
  ({ id, joker: false, suit, rank });
const joker = (id: string): FiftyOneCard => ({ id, joker: true, suit: null, rank: null });

describe('51 calculator — calcSelection (pure preview, reuses resolveMeld)', () => {
  it('a valid run reports run + its meld value', () => {
    const r = calcSelection([c('a', 'spades', '7'), c('b', 'spades', '8'), c('d', 'spades', '9')]);
    expect(r).toMatchObject({ count: 3, valid: true, type: 'run', value: 24 }); // 7+8+9
  });

  it('a valid set reports set + its meld value', () => {
    const r = calcSelection([c('a', 'spades', '7'), c('b', 'hearts', '7'), c('d', 'clubs', '7')]);
    expect(r).toMatchObject({ valid: true, type: 'set', value: 21 }); // 7×3
  });

  it('a joker in a run is valued by the card it represents, not 25', () => {
    const r = calcSelection([c('a', 'spades', '7'), c('b', 'spades', '8'), joker('j')]);
    expect(r.valid).toBe(true);
    expect(r.type).toBe('run');
    expect(r.value).toBe(24); // 7+8+9 (joker=9), NOT 7+8+25
  });

  it('fewer than 3 cards is never a meld — shows the raw carried value', () => {
    const r = calcSelection([c('a', 'spades', '7'), c('b', 'hearts', 'K')]);
    expect(r).toMatchObject({ valid: false, type: null, value: 17 }); // 7 + 10
  });

  it('an invalid combination shows the raw penalty sum (jokers 25)', () => {
    const r = calcSelection([c('a', 'spades', '7'), c('b', 'spades', '8'), c('d', 'spades', '10')]);
    expect(r.valid).toBe(false);
    expect(r.value).toBe(25); // 7 + 8 + 10 — a gap, not a run
  });
});

describe('51 calculator — calcHandTotal (opened basis: normals by value, joker 25)', () => {
  it('sums the hand penalty value', () => {
    expect(calcHandTotal([c('a', 'spades', '7'), c('b', 'hearts', 'K'), joker('j')])).toBe(42); // 7 + 10 + 25
    expect(calcHandTotal([])).toBe(0);
  });
});
