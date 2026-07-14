import { describe, expect, it } from 'vitest';
import type { Rank, Suit } from '../../models/types';
import type { FiftyOneCard } from './types';
import {
  isValidMeld,
  meldValue,
  rankValue,
  resolveMeld,
  resolveRun,
  resolveSet,
} from './melds';

/** Build a concrete card. `d` distinguishes the two decks (unique id). */
const c = (rank: Rank, suit: Suit, d = 0): FiftyOneCard => ({
  id: `${d}-${suit}-${rank}`,
  joker: false,
  suit,
  rank,
});
let jokerN = 0;
const J = (): FiftyOneCard => ({ id: `joker-${jokerN++}`, joker: true, suit: null, rank: null });

describe('51 card values (§10)', () => {
  it('scores 2–9 at face, 10/J/Q/K/A at 10', () => {
    expect(rankValue('2')).toBe(2);
    expect(rankValue('9')).toBe(9);
    expect(rankValue('10')).toBe(10);
    expect(rankValue('J')).toBe(10);
    expect(rankValue('Q')).toBe(10);
    expect(rankValue('K')).toBe(10);
    expect(rankValue('A')).toBe(10);
  });
});

describe('51 runs (§6)', () => {
  it('accepts a plain same-suit run and values it', () => {
    const r = resolveRun([c('7', 'hearts'), c('8', 'hearts'), c('9', 'hearts')]);
    expect(r?.type).toBe('run');
    expect(r?.value).toBe(24); // 7+8+9
  });

  it('accepts a longer run', () => {
    const r = resolveRun([c('10', 'clubs'), c('J', 'clubs'), c('Q', 'clubs'), c('K', 'clubs')]);
    expect(r?.value).toBe(40); // 10+10+10+10
  });

  it('rejects a mixed-suit "run"', () => {
    expect(resolveRun([c('7', 'hearts'), c('8', 'spades'), c('9', 'hearts')])).toBeNull();
  });

  it('rejects a non-consecutive run', () => {
    expect(resolveRun([c('7', 'hearts'), c('9', 'hearts'), c('10', 'hearts')])).toBeNull();
  });

  it('accepts A-2-3 (Ace low) worth 6', () => {
    const r = resolveRun([c('A', 'spades'), c('2', 'spades'), c('3', 'spades')]);
    expect(r?.type).toBe('run');
    expect(r?.value).toBe(6); // 1 + 2 + 3
  });

  it('accepts Q-K-A (Ace high) worth 30', () => {
    const r = resolveRun([c('Q', 'diamonds'), c('K', 'diamonds'), c('A', 'diamonds')]);
    expect(r?.value).toBe(30);
  });

  it('rejects K-A-2 (no wrap around the Ace)', () => {
    expect(resolveRun([c('K', 'hearts'), c('A', 'hearts'), c('2', 'hearts')])).toBeNull();
  });

  it('accepts a run with an internal joker and values the represented card', () => {
    const r = resolveRun([c('7', 'spades'), J(), c('9', 'spades')]);
    expect(r?.type).toBe('run');
    // joker = 8♠ → 7 + 8 + 9
    expect(r?.value).toBe(24);
    // The joker occupies the middle slot and represents 8♠.
    expect(r?.jokerRepresents[1]).toEqual({ suit: 'spades', rank: '8' });
  });

  it('accepts A-2-3 with an internal joker as the 2', () => {
    const r = resolveRun([c('A', 'clubs'), J(), c('3', 'clubs')]);
    expect(r?.value).toBe(6); // 1 + (joker=2) + 3
    expect(r?.jokerRepresents[1]).toEqual({ suit: 'clubs', rank: '2' });
  });

  it('rejects a joker at the END of a run (ambiguous)', () => {
    // 7♠ 8♠ [joker] could be 9♠ or 6♠ → not a clear card, rejected in MVP.
    expect(resolveRun([c('7', 'spades'), c('8', 'spades'), J()])).toBeNull();
  });

  it('rejects a meld with two jokers (MVP cap of 1)', () => {
    expect(resolveRun([c('7', 'spades'), J(), J()])).toBeNull();
  });
});

describe('51 sets (§6)', () => {
  it('accepts a 3-of-a-kind and values it', () => {
    const r = resolveSet([c('7', 'spades'), c('7', 'hearts'), c('7', 'clubs')]);
    expect(r?.type).toBe('set');
    expect(r?.value).toBe(21); // 7 × 3
  });

  it('accepts a 4-of-a-kind (all four distinct suits)', () => {
    const r = resolveSet([c('9', 'spades'), c('9', 'hearts'), c('9', 'clubs'), c('9', 'diamonds')]);
    expect(r?.value).toBe(36);
  });

  it('values a set of Aces at 30', () => {
    const r = resolveSet([c('A', 'spades'), c('A', 'hearts'), c('A', 'clubs')]);
    expect(r?.value).toBe(30);
  });

  it('rejects a set with a duplicate identical card (two 9♥)', () => {
    // Two physical 9♥ from two decks may not sit in the same set (§6).
    expect(resolveSet([c('9', 'hearts', 0), c('9', 'hearts', 1), c('9', 'clubs')])).toBeNull();
  });

  it('rejects a mixed-rank "set"', () => {
    expect(resolveSet([c('9', 'spades'), c('8', 'hearts'), c('9', 'clubs')])).toBeNull();
  });

  it('accepts a set completed by a joker (clear missing suit)', () => {
    const r = resolveSet([c('K', 'spades'), c('K', 'hearts'), J()]);
    expect(r?.type).toBe('set');
    expect(r?.value).toBe(30); // K × 3
    // The joker represents the third king in a missing suit.
    expect(r?.jokerRepresents[2].rank).toBe('K');
  });
});

describe('51 resolveMeld + opening totals (§7)', () => {
  it('resolves a run before a set and reports value', () => {
    expect(meldValue([c('7', 'hearts'), c('8', 'hearts'), c('9', 'hearts')])).toBe(24);
    expect(isValidMeld([c('K', 'spades'), c('K', 'hearts'), c('K', 'clubs')])).toBe(true);
  });

  it('a 51-exact opening is valid; 50 is not', () => {
    // 10♥ J♥ Q♥ = 30 ; 7♣ 7♦ 7♠ = 21 → total 51.
    const run = [c('10', 'hearts'), c('J', 'hearts'), c('Q', 'hearts')];
    const set = [c('7', 'clubs'), c('7', 'diamonds'), c('7', 'spades')];
    const total = meldValue(run) + meldValue(set);
    expect(total).toBe(51);

    // 5♥ 6♥ 7♥ = 18 ; 8♣ 8♦ 8♠ = 24 → 42 (< 51).
    const under = meldValue([c('5', 'hearts'), c('6', 'hearts'), c('7', 'hearts')])
      + meldValue([c('8', 'clubs'), c('8', 'diamonds'), c('8', 'spades')]);
    expect(under).toBe(42);
  });

  it('a joker in an opening meld contributes its represented value, not 25', () => {
    // Q♠ [joker=K♠] A♠ → 10 + 10 + 10 = 30 (not 25 for the joker).
    const r = resolveMeld([c('Q', 'spades'), J(), c('A', 'spades')]);
    expect(r?.value).toBe(30);
    expect(r?.jokerRepresents[1]).toEqual({ suit: 'spades', rank: 'K' });
  });
});
