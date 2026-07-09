import { describe, it, expect } from 'vitest';
import type { StorageLike } from './session';
import {
  loadDefaultTimer, saveDefaultTimer, loadGuestKey, saveGuestKey,
  loadNickname, saveNickname, loadAvatar, saveAvatar,
  loadCardStyle, saveCardStyle, loadCardFaceTheme, saveCardFaceTheme,
} from './prefs';
import { AVATARS } from '../core/avatars';

function mem(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

describe('prefs — default turn timer (Stage 4)', () => {
  it('defaults to 0 and round-trips whitelisted values only', () => {
    const s = mem();
    expect(loadDefaultTimer(s)).toBe(0);
    saveDefaultTimer(60, s);
    expect(loadDefaultTimer(s)).toBe(60);
    saveDefaultTimer(45, s);            // off the 0/30/60/90 whitelist → ignored
    expect(loadDefaultTimer(s)).toBe(60);
  });
});

describe('prefs — guest device handle (Stage 4)', () => {
  it('round-trips a non-empty handle and ignores blanks', () => {
    const s = mem();
    expect(loadGuestKey(s)).toBeNull();
    saveGuestKey('device-abc', s);
    expect(loadGuestKey(s)).toBe('device-abc');
    saveGuestKey('   ', s);
    expect(loadGuestKey(s)).toBe('device-abc'); // unchanged
  });
});

describe('prefs — card back style (Stage 13.0)', () => {
  it('defaults to green and round-trips every back style (Stage 13.5)', () => {
    const s = mem();
    expect(loadCardStyle(s)).toBe('green');
    for (const style of ['red', 'blue', 'dark', 'green'] as const) {
      saveCardStyle(style, s);
      expect(loadCardStyle(s)).toBe(style);
    }
  });

  it('maps the legacy "classic" value and rejects junk → green', () => {
    const s = mem();
    saveCardStyle('classic', s);        // legacy DB value → normalised to green
    expect(loadCardStyle(s)).toBe('green');
    saveCardStyle('holographic', s);    // off the whitelist → green
    expect(loadCardStyle(s)).toBe('green');
  });
});

describe('prefs — card face theme (Stage 13.5)', () => {
  it('defaults to classic and round-trips classic/clean', () => {
    const s = mem();
    expect(loadCardFaceTheme(s)).toBe('classic');
    saveCardFaceTheme('clean', s);
    expect(loadCardFaceTheme(s)).toBe('clean');
    saveCardFaceTheme('classic', s);
    expect(loadCardFaceTheme(s)).toBe('classic');
  });

  it('rejects junk → classic', () => {
    const s = mem();
    saveCardFaceTheme('holographic', s); // off the whitelist → classic
    expect(loadCardFaceTheme(s)).toBe('classic');
  });
});

describe('prefs — existing localStorage fallback still intact', () => {
  it('nickname and avatar prefs are unaffected by the new keys', () => {
    const s = mem();
    saveNickname('Alice', s);
    saveAvatar(AVATARS[3], s);
    expect(loadNickname(s)).toBe('Alice');
    expect(loadAvatar(s)).toBe(AVATARS[3]);
  });
});
