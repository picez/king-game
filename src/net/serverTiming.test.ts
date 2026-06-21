import { describe, it, expect } from 'vitest';
import {
  clampMs,
  resolveTrickAdvanceMs,
  DEFAULT_TRICK_ADVANCE_MS,
  MIN_TRICK_ADVANCE_MS,
  MAX_TRICK_ADVANCE_MS,
} from './serverTiming';

describe('clampMs', () => {
  it('returns the value when within range', () => {
    expect(clampMs(2500, 1000, 10000, 3000)).toBe(2500);
  });
  it('clamps below the min and above the max', () => {
    expect(clampMs(10, 1000, 10000, 3000)).toBe(1000);
    expect(clampMs(99999, 1000, 10000, 3000)).toBe(10000);
  });
  it('falls back when not a finite number', () => {
    expect(clampMs(NaN, 1000, 10000, 3000)).toBe(3000);
  });
});

describe('resolveTrickAdvanceMs (post-playtest delay #2)', () => {
  it('defaults to a readable hold (2.5–3.5s window)', () => {
    expect(resolveTrickAdvanceMs(undefined)).toBe(DEFAULT_TRICK_ADVANCE_MS);
    expect(DEFAULT_TRICK_ADVANCE_MS).toBeGreaterThanOrEqual(2500);
    expect(DEFAULT_TRICK_ADVANCE_MS).toBeLessThanOrEqual(3500);
  });
  it('honours a valid env override', () => {
    expect(resolveTrickAdvanceMs('3500')).toBe(3500);
  });
  it('clamps an out-of-range or garbage env value', () => {
    expect(resolveTrickAdvanceMs('50')).toBe(MIN_TRICK_ADVANCE_MS);
    expect(resolveTrickAdvanceMs('600000')).toBe(MAX_TRICK_ADVANCE_MS);
    expect(resolveTrickAdvanceMs('abc')).toBe(DEFAULT_TRICK_ADVANCE_MS);
  });
});
