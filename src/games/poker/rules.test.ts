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
    expect(isPokerAction(undefined)).toBe(false);
    expect(isPokerAction('FOLD')).toBe(false);
    expect(isPokerAction(42)).toBe(false);
    expect(isPokerAction([])).toBe(false);            // arrays are not actions
    expect(isPokerAction({})).toBe(false);            // empty object → no type
  });

  it('validates START_GAME structurally so the reducer never dereferences a missing field', () => {
    expect(isPokerAction({ type: 'START_GAME', playerNames: ['A', 'B'] })).toBe(true);
    expect(isPokerAction({ type: 'START_GAME', playerNames: ['A', 'B'], playerTypes: ['human', 'ai'], playerCount: 2, buttonSeat: 0 })).toBe(true);
    expect(isPokerAction({ type: 'START_GAME', playerNames: ['A', 'B'], options: { startingStack: 1000, smallBlind: 10, bigBlind: 20 } })).toBe(true);
    // Malformed START_GAME shapes.
    expect(isPokerAction({ type: 'START_GAME' })).toBe(false);                                  // no playerNames
    expect(isPokerAction({ type: 'START_GAME', playerNames: 'AB' })).toBe(false);               // not an array
    expect(isPokerAction({ type: 'START_GAME', playerNames: ['A'], playerTypes: 'human' })).toBe(false); // playerTypes not array
    expect(isPokerAction({ type: 'START_GAME', playerNames: ['A'], playerCount: 1.5 })).toBe(false);     // fractional
    expect(isPokerAction({ type: 'START_GAME', playerNames: ['A'], playerCount: NaN })).toBe(false);
    expect(isPokerAction({ type: 'START_GAME', playerNames: ['A'], buttonSeat: Infinity })).toBe(false);
    expect(isPokerAction({ type: 'START_GAME', playerNames: ['A'], options: 'nope' })).toBe(false);      // options not object
    expect(isPokerAction({ type: 'START_GAME', playerNames: ['A'], options: { smallBlind: 'x' } })).toBe(false);
  });
});
