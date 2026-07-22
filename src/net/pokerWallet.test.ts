import { describe, it, expect } from 'vitest';
import {
  DAILY_CLAIM_CHIPS, isValidChipAmount, utcDateString, nextUtcMidnightMs, parsePokerWallet,
} from './pokerWallet';

// Pure wallet helpers: the daily grant is exactly 1,000,000; the UTC-date math is
// timezone-independent; chip validation rejects anything non-safe-integer; and the
// parser never throws on malformed server payloads.

describe('DAILY_CLAIM_CHIPS', () => {
  it('is exactly one million', () => {
    expect(DAILY_CLAIM_CHIPS).toBe(1_000_000);
  });
});

describe('isValidChipAmount', () => {
  it('accepts non-negative safe integers', () => {
    for (const v of [0, 1, 1000, 1_000_000, Number.MAX_SAFE_INTEGER]) expect(isValidChipAmount(v)).toBe(true);
  });
  it('rejects fractional / negative / non-finite / non-number', () => {
    for (const v of [-1, 0.5, 10.0001, NaN, Infinity, -Infinity, '1000', null, undefined, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
      expect(isValidChipAmount(v as unknown), String(v)).toBe(false);
    }
  });
});

describe('utcDateString', () => {
  it('returns the UTC calendar date regardless of local offset', () => {
    // 2026-07-21T23:30:00Z is still the 21st in UTC.
    expect(utcDateString(Date.UTC(2026, 6, 21, 23, 30))).toBe('2026-07-21');
    // One minute later past midnight → the 22nd.
    expect(utcDateString(Date.UTC(2026, 6, 22, 0, 1))).toBe('2026-07-22');
  });
  it('accepts a Date instance too', () => {
    expect(utcDateString(new Date(Date.UTC(2026, 0, 1, 12)))).toBe('2026-01-01');
  });
});

describe('nextUtcMidnightMs', () => {
  it('is the next UTC 00:00 strictly after now', () => {
    const now = Date.UTC(2026, 6, 21, 15, 0);
    expect(nextUtcMidnightMs(now)).toBe(Date.UTC(2026, 6, 22, 0, 0, 0, 0));
  });
  it('rolls the month/year over', () => {
    expect(nextUtcMidnightMs(Date.UTC(2026, 11, 31, 10))).toBe(Date.UTC(2027, 0, 1));
  });
});

describe('parsePokerWallet', () => {
  it('reads a nested { wallet } payload', () => {
    expect(parsePokerWallet({ wallet: { balance: 5000, canClaimToday: false, nextClaimAt: 123 } }))
      .toEqual({ balance: 5000, canClaimToday: false, nextClaimAt: 123 });
  });
  it('reads a bare view payload', () => {
    expect(parsePokerWallet({ balance: 42, canClaimToday: true, nextClaimAt: null }))
      .toEqual({ balance: 42, canClaimToday: true, nextClaimAt: null });
  });
  it('defaults every field on garbage (never throws, never negative)', () => {
    for (const bad of [null, undefined, 5, 'x', {}, { balance: -10 }, { balance: 1.5 }, { balance: 'nope' }]) {
      const v = parsePokerWallet(bad as unknown);
      expect(v.balance).toBe(0);
      expect(v.canClaimToday).toBe(false);
      expect(v.nextClaimAt).toBe(null);
    }
  });
});
