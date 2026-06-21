import { describe, it, expect } from 'vitest';
import { AVATARS } from '../core/avatars';
import {
  sanitizeLang, sanitizeCardStyle, sanitizeAvatarOrNull, normalizeTurnTimer,
  sanitizeDisplayName, sanitizeGlobalSettings, sanitizeGameSettings,
  DEFAULT_LANG, DEFAULT_CARD_STYLE, MAX_DISPLAY_NAME,
} from './userSettings';

describe('userSettings field validators', () => {
  it('validates language with fallback', () => {
    expect(sanitizeLang('uk')).toBe('uk');
    expect(sanitizeLang('ar')).toBe('ar');
    expect(sanitizeLang('xx')).toBe(DEFAULT_LANG);
    expect(sanitizeLang(undefined)).toBe(DEFAULT_LANG);
  });

  it('validates card style with fallback', () => {
    expect(sanitizeCardStyle('classic')).toBe('classic');
    expect(sanitizeCardStyle('holographic')).toBe(DEFAULT_CARD_STYLE);
  });

  it('keeps only whitelisted avatars, else null', () => {
    expect(sanitizeAvatarOrNull(AVATARS[0])).toBe(AVATARS[0]);
    expect(sanitizeAvatarOrNull('<script>')).toBeNull();
    expect(sanitizeAvatarOrNull('🤖')).toBeNull(); // bot avatar is not user-selectable
    expect(sanitizeAvatarOrNull(undefined)).toBeNull();
  });

  it('normalizes the turn timer to 0/30/60/90', () => {
    expect(normalizeTurnTimer(30)).toBe(30);
    expect(normalizeTurnTimer(90)).toBe(90);
    expect(normalizeTurnTimer(45)).toBe(0);
    expect(normalizeTurnTimer('60')).toBe(0);
  });

  it('trims and caps the display name, null when empty', () => {
    expect(sanitizeDisplayName('  Alice  ')).toBe('Alice');
    expect(sanitizeDisplayName('   ')).toBeNull();
    expect(sanitizeDisplayName(42)).toBeNull();
    expect(sanitizeDisplayName('x'.repeat(50))).toHaveLength(MAX_DISPLAY_NAME);
  });
});

describe('sanitizeGlobalSettings', () => {
  it('produces a fully valid object from partial/garbage input', () => {
    expect(sanitizeGlobalSettings({ lang: 'de', avatar: AVATARS[1], cardStyle: 'classic' }))
      .toEqual({ lang: 'de', avatar: AVATARS[1], cardStyle: 'classic' });
    expect(sanitizeGlobalSettings({})).toEqual({ lang: DEFAULT_LANG, avatar: null, cardStyle: DEFAULT_CARD_STYLE });
    expect(sanitizeGlobalSettings({ lang: 'zz', avatar: 'nope' }))
      .toEqual({ lang: DEFAULT_LANG, avatar: null, cardStyle: DEFAULT_CARD_STYLE });
    expect(sanitizeGlobalSettings(null)).toEqual({ lang: DEFAULT_LANG, avatar: null, cardStyle: DEFAULT_CARD_STYLE });
  });
});

describe('sanitizeGameSettings', () => {
  it('validates King per-game settings (defaultTimer)', () => {
    expect(sanitizeGameSettings('king', { defaultTimer: 60 })).toEqual({ defaultTimer: 60 });
    expect(sanitizeGameSettings('king', { defaultTimer: 7 })).toEqual({ defaultTimer: 0 });
    expect(sanitizeGameSettings('king', {})).toEqual({ defaultTimer: 0 });
    // King-only fields never leak into the result for an unknown game.
    expect(sanitizeGameSettings('chess', { defaultTimer: 60, foo: 1 })).toEqual({});
  });
});
