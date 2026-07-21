import { describe, expect, it } from 'vitest';
import { isPokerAction, isPokerLifecycleAction, isValidWagerAmount } from './rules';

describe('isValidWagerAmount — runtime guard for untrusted amounts (§5)', () => {
  it('accepts only positive, finite, safe integers', () => {
    expect(isValidWagerAmount(1)).toBe(true);
    expect(isValidWagerAmount(20)).toBe(true);
    expect(isValidWagerAmount(1000)).toBe(true);
  });

  it('rejects strings / objects / null / undefined / booleans', () => {
    for (const v of ['20', '', 'not-a-number', {}, [], null, undefined, true, false]) {
      expect(isValidWagerAmount(v as unknown), String(v)).toBe(false);
    }
  });

  it('rejects NaN / Infinity / fractions / zero / negatives / unsafe integers', () => {
    for (const v of [NaN, Infinity, -Infinity, 20.5, 0.1, 0, -20, -1, Number.MAX_SAFE_INTEGER + 1]) {
      expect(isValidWagerAmount(v), String(v)).toBe(false);
    }
  });
});

describe('lifecycle + action guards', () => {
  it('flags START_GAME / START_NEXT_HAND as lifecycle actions', () => {
    expect(isPokerLifecycleAction({ type: 'START_GAME' })).toBe(true);
    expect(isPokerLifecycleAction({ type: 'START_NEXT_HAND' })).toBe(true);
    expect(isPokerLifecycleAction({ type: 'FOLD' })).toBe(false);
    expect(isPokerLifecycleAction({ type: 'RAISE' })).toBe(false);
  });

  it('isPokerAction validates BET/RAISE amounts and accepts the simple actions', () => {
    expect(isPokerAction({ type: 'FOLD' })).toBe(true);
    expect(isPokerAction({ type: 'CHECK' })).toBe(true);
    expect(isPokerAction({ type: 'CALL' })).toBe(true);
    expect(isPokerAction({ type: 'ALL_IN' })).toBe(true);
    expect(isPokerAction({ type: 'BET', amount: 40 })).toBe(true);
    expect(isPokerAction({ type: 'RAISE', amount: 80 })).toBe(true);
    // Malformed / unknown payloads.
    expect(isPokerAction({ type: 'BET', amount: 'x' })).toBe(false);
    expect(isPokerAction({ type: 'RAISE', amount: NaN })).toBe(false);
    expect(isPokerAction({ type: 'RAISE' })).toBe(false);
    expect(isPokerAction({ type: 'NUKE' })).toBe(false);
    expect(isPokerAction(null)).toBe(false);
    expect(isPokerAction('FOLD')).toBe(false);
  });
});
