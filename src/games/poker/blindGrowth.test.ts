import { describe, it, expect } from 'vitest';
import { currentBlinds, normalizeOptions, DEFAULT_OPTIONS } from './rules';
import { pokerReducer } from './engine';
import type { PokerOptions } from './types';

// Blind-growth schedule (§16 D). The exact off-by-one: with N, hands 1..N post base,
// hand N+1 → ×2, hand 2N+1 → ×4. Level = floor((hand-1)/N), multiplier = 2^level.

const base: PokerOptions = { startingStack: 100000, smallBlind: 25, bigBlind: 50, blindGrowthEveryHands: 3 };

describe('currentBlinds — N=3 exact off-by-one (hands 1..7)', () => {
  const expected: Array<[number, number, number]> = [
    [1, 25, 50], [2, 25, 50], [3, 25, 50],   // level 0
    [4, 50, 100], [5, 50, 100], [6, 50, 100], // level 1 (×2)
    [7, 100, 200],                             // level 2 (×4)
  ];
  for (const [hand, sb, bb] of expected) {
    it(`hand ${hand} → ${sb}/${bb}`, () => {
      expect(currentBlinds(base, hand)).toEqual({ smallBlind: sb, bigBlind: bb });
    });
  }
});

describe('currentBlinds — Off never grows', () => {
  it('blindGrowthEveryHands=0 stays base for any hand', () => {
    const off = { ...base, blindGrowthEveryHands: 0 };
    for (const h of [1, 3, 10, 100, 1000]) expect(currentBlinds(off, h)).toEqual({ smallBlind: 25, bigBlind: 50 });
  });
});

describe('currentBlinds — N=1 doubles every hand', () => {
  it('hand h → base × 2^(h-1)', () => {
    const o = { ...base, blindGrowthEveryHands: 1 };
    expect(currentBlinds(o, 1)).toEqual({ smallBlind: 25, bigBlind: 50 });
    expect(currentBlinds(o, 2)).toEqual({ smallBlind: 50, bigBlind: 100 });
    expect(currentBlinds(o, 4)).toEqual({ smallBlind: 200, bigBlind: 400 });
  });
});

describe('currentBlinds — overflow safe', () => {
  it('never returns a non-safe-integer big blind, even at absurd hand counts', () => {
    const o = { ...base, blindGrowthEveryHands: 1 };
    const r = currentBlinds(o, 100000);
    expect(Number.isSafeInteger(r.bigBlind)).toBe(true);
    expect(Number.isSafeInteger(r.smallBlind)).toBe(true);
    expect(r.bigBlind).toBeGreaterThan(0);
  });
});

describe('normalizeOptions — growth validation', () => {
  it('defaults growth to 0 (off)', () => {
    expect(normalizeOptions(undefined).blindGrowthEveryHands).toBe(0);
    expect(DEFAULT_OPTIONS.blindGrowthEveryHands).toBe(0);
  });
  it('accepts a safe integer 1..100', () => {
    expect(normalizeOptions({ blindGrowthEveryHands: 5 }).blindGrowthEveryHands).toBe(5);
    expect(normalizeOptions({ blindGrowthEveryHands: 100 }).blindGrowthEveryHands).toBe(100);
  });
  it('rejects malformed / out-of-range growth → 0', () => {
    for (const bad of [-1, 0.5, 101, NaN, Infinity, '3' as unknown as number, {} as unknown as number]) {
      expect(normalizeOptions({ blindGrowthEveryHands: bad as number }).blindGrowthEveryHands).toBe(0);
    }
  });
  it('carries a valid mode, drops an invalid one', () => {
    expect(normalizeOptions({ mode: 'online_bankroll' }).mode).toBe('online_bankroll');
    expect(normalizeOptions({ mode: 'nope' as never }).mode).toBeUndefined();
  });
});

describe('reducer wires current blinds into the deal (hand 1 posts base)', () => {
  it('START_GAME with growth stores + posts the CURRENT blinds for hand 1', () => {
    const s = pokerReducer(null, {
      type: 'START_GAME', playerNames: ['A', 'B', 'C'], playerCount: 3,
      options: { startingStack: 100000, smallBlind: 25, bigBlind: 50, blindGrowthEveryHands: 3 },
    });
    expect(s).not.toBeNull();
    expect(s!.smallBlindCurrent).toBe(25);
    expect(s!.bigBlindCurrent).toBe(50);
    expect(s!.currentBet).toBe(50);      // pre-flop bring-in = current big blind
    expect(s!.minRaise).toBe(50);
    const blinds = s!.actionLog.filter((a) => a.kind === 'blind').map((a) => a.amount).sort((a, b) => a - b);
    expect(blinds).toEqual([25, 50]);    // exactly SB + BB at current level
  });

  it('a full-stack conservation holds at start (stacks + committed = players × stack)', () => {
    const s = pokerReducer(null, {
      type: 'START_GAME', playerNames: ['A', 'B', 'C'], playerCount: 3,
      options: { startingStack: 100000, smallBlind: 25, bigBlind: 50, blindGrowthEveryHands: 3 },
    })!;
    const total = s.stacksBySeat.reduce((a, b) => a + b, 0) + s.contributedBySeat.reduce((a, b) => a + b, 0);
    expect(total).toBe(3 * 100000);
  });
});
