import { describe, it, expect } from 'vitest';
import {
  ANIMATION_PREFERENCES, DEFAULT_ANIMATION_PREFERENCE,
  normalizeMotionPreference, resolveEffectiveMotion,
} from './motionPref';

describe('normalizeMotionPreference', () => {
  it('accepts every supported value verbatim', () => {
    for (const p of ANIMATION_PREFERENCES) {
      expect(normalizeMotionPreference(p)).toBe(p);
    }
  });

  it('falls back to system for unknown/legacy/empty input', () => {
    expect(normalizeMotionPreference('holographic')).toBe(DEFAULT_ANIMATION_PREFERENCE);
    expect(normalizeMotionPreference('')).toBe('system');
    expect(normalizeMotionPreference(null)).toBe('system');
    expect(normalizeMotionPreference(undefined)).toBe('system');
    expect(DEFAULT_ANIMATION_PREFERENCE).toBe('system');
  });
});

describe('resolveEffectiveMotion — accessibility override truth table', () => {
  it('honours explicit off/reduced regardless of the OS', () => {
    expect(resolveEffectiveMotion('off', false)).toBe('off');
    expect(resolveEffectiveMotion('off', true)).toBe('off');       // OS never re-enables motion
    expect(resolveEffectiveMotion('reduced', false)).toBe('reduced');
    expect(resolveEffectiveMotion('reduced', true)).toBe('reduced');
  });

  it('plays full motion for full/system only when the OS does NOT ask to reduce', () => {
    expect(resolveEffectiveMotion('full', false)).toBe('full');
    expect(resolveEffectiveMotion('system', false)).toBe('full');
  });

  it('NEVER forces full motion onto a reduced-motion device (OS wins over full/system)', () => {
    expect(resolveEffectiveMotion('full', true)).toBe('reduced');   // not 'full'
    expect(resolveEffectiveMotion('system', true)).toBe('reduced');
  });
});
