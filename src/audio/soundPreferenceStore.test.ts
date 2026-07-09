// Stage 15.2 — the sound preference store is the single client source of truth
// read by the engine at play time. Exercised without a DOM (node env): default,
// setter, normalisation, idempotence. No Audio is ever created here.
import { describe, it, expect, afterEach } from 'vitest';
import { getSoundPreference, setSoundPreference } from './soundPreferenceStore';

afterEach(() => setSoundPreference('off')); // reset the singleton between cases

describe('soundPreferenceStore', () => {
  it('defaults to off (no localStorage in node)', () => {
    expect(getSoundPreference()).toBe('off');
  });

  it('switches through subtle/full and back to off', () => {
    setSoundPreference('subtle');
    expect(getSoundPreference()).toBe('subtle');
    setSoundPreference('full');
    expect(getSoundPreference()).toBe('full');
    setSoundPreference('off');
    expect(getSoundPreference()).toBe('off');
  });

  it('normalises unknown / tampered values to off', () => {
    setSoundPreference('full');
    setSoundPreference('deafening'); // off the whitelist → off
    expect(getSoundPreference()).toBe('off');
    setSoundPreference('subtle');
    setSoundPreference(null);
    expect(getSoundPreference()).toBe('off');
  });
});
