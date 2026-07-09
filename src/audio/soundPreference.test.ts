// Stage 15.2 — sound preference pure helpers + local persistence.
import { describe, it, expect } from 'vitest';
import {
  SOUND_PREFERENCES, DEFAULT_SOUND_PREFERENCE, SOUND_PREF_KEY,
  normalizeSoundPreference, soundTierVolume,
  loadSoundPreference, saveSoundPreference,
} from './soundPreference';
import type { StorageLike } from '../net/session';

/** A minimal in-memory StorageLike for round-trip tests (no real localStorage). */
function fakeStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('sound preference model', () => {
  it('defaults to off for everyone', () => {
    expect(DEFAULT_SOUND_PREFERENCE).toBe('off');
    expect(SOUND_PREFERENCES).toEqual(['off', 'subtle', 'full']);
  });

  it('normalizes valid values to themselves', () => {
    for (const p of SOUND_PREFERENCES) expect(normalizeSoundPreference(p)).toBe(p);
  });

  it('normalizes unknown / tampered / empty / null input to off', () => {
    for (const bad of ['loud', 'ON', 'Full', '', ' ', 'system', '__proto__', null, undefined]) {
      expect(normalizeSoundPreference(bad as string)).toBe('off');
    }
  });

  it('tier volume: off silences, subtle quieter than full, full = 1', () => {
    expect(soundTierVolume('off')).toBe(0);
    expect(soundTierVolume('full')).toBe(1);
    expect(soundTierVolume('subtle')).toBeGreaterThan(0);
    expect(soundTierVolume('subtle')).toBeLessThan(soundTierVolume('full'));
  });
});

describe('sound preference local persistence', () => {
  it('loads off when storage is empty or unavailable', () => {
    expect(loadSoundPreference(fakeStorage())).toBe('off');
    expect(loadSoundPreference(null)).toBe('off');
  });

  it('round-trips a saved value under the brand-prefixed key', () => {
    const s = fakeStorage();
    saveSoundPreference('subtle', s);
    expect(s.map.get(SOUND_PREF_KEY)).toBe('subtle');
    expect(loadSoundPreference(s)).toBe('subtle');
  });

  it('only ever persists a normalized value (tampered input → off)', () => {
    const s = fakeStorage();
    saveSoundPreference('loud', s);
    expect(s.map.get(SOUND_PREF_KEY)).toBe('off');
  });

  it('reads a tampered stored value back as off', () => {
    const s = fakeStorage({ [SOUND_PREF_KEY]: 'boom' });
    expect(loadSoundPreference(s)).toBe('off');
  });
});
