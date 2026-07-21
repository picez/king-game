import { describe, it, expect } from 'vitest';
import { AVATARS } from '../core/avatars';
import {
  sanitizeLang, sanitizeCardStyle, sanitizeAvatarOrNull, normalizeTurnTimer,
  sanitizeDisplayName, sanitizeGlobalSettings, sanitizeGameSettings,
  sanitizeAnimationPref, sanitizeFavoriteGame, sanitizeCardFaceTheme,
  DEFAULT_LANG, DEFAULT_CARD_STYLE, DEFAULT_ANIMATION_PREF, DEFAULT_FAVORITE_GAME,
  DEFAULT_CARD_FACE_THEME, MAX_DISPLAY_NAME,
} from './userSettings';

describe('userSettings field validators', () => {
  it('validates language with fallback', () => {
    expect(sanitizeLang('uk')).toBe('uk');
    expect(sanitizeLang('ar')).toBe('ar');
    expect(sanitizeLang('xx')).toBe(DEFAULT_LANG);
    expect(sanitizeLang(undefined)).toBe(DEFAULT_LANG);
  });

  it('validates card style with fallback (whitelist extended, Stage 13.5)', () => {
    expect(sanitizeCardStyle('classic')).toBe('classic');
    expect(sanitizeCardStyle('red')).toBe('red'); // Stage 13.0 alternate
    expect(sanitizeCardStyle('blue')).toBe('blue'); // Stage 13.5
    expect(sanitizeCardStyle('dark')).toBe('dark'); // Stage 13.5
    expect(sanitizeCardStyle('holographic')).toBe(DEFAULT_CARD_STYLE);
    expect(sanitizeCardStyle('green')).toBe(DEFAULT_CARD_STYLE); // client visual value ≠ stored value
  });

  it('validates the card face theme with fallback (Stage 13.5)', () => {
    expect(sanitizeCardFaceTheme('classic')).toBe('classic');
    expect(sanitizeCardFaceTheme('clean')).toBe('clean');
    expect(sanitizeCardFaceTheme('holographic')).toBe(DEFAULT_CARD_FACE_THEME);
    expect(sanitizeCardFaceTheme(undefined)).toBe(DEFAULT_CARD_FACE_THEME);
    expect(sanitizeCardFaceTheme(7)).toBe(DEFAULT_CARD_FACE_THEME);
    expect(DEFAULT_CARD_FACE_THEME).toBe('classic');
  });

  it('validates the animation preference with fallback (Stage 13.2)', () => {
    for (const p of ['system', 'full', 'reduced', 'off']) {
      expect(sanitizeAnimationPref(p)).toBe(p);
    }
    expect(sanitizeAnimationPref('holographic')).toBe(DEFAULT_ANIMATION_PREF);
    expect(sanitizeAnimationPref(undefined)).toBe(DEFAULT_ANIMATION_PREF);
    expect(sanitizeAnimationPref(42)).toBe(DEFAULT_ANIMATION_PREF);
    expect(DEFAULT_ANIMATION_PREF).toBe('system');
  });

  it('validates the favorite game with fallback to King (Stage 13.3)', () => {
    for (const g of ['king', 'durak', 'deberc', 'tarneeb']) {
      expect(sanitizeFavoriteGame(g)).toBe(g);
    }
    expect(sanitizeFavoriteGame('chess')).toBe(DEFAULT_FAVORITE_GAME);
    expect(sanitizeFavoriteGame(undefined)).toBe(DEFAULT_FAVORITE_GAME);
    expect(sanitizeFavoriteGame(7)).toBe(DEFAULT_FAVORITE_GAME);
    expect(DEFAULT_FAVORITE_GAME).toBe('king');
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
  const dflt = {
    lang: DEFAULT_LANG, avatar: null, cardStyle: DEFAULT_CARD_STYLE,
    animationPreference: DEFAULT_ANIMATION_PREF, favoriteGame: DEFAULT_FAVORITE_GAME,
    cardFaceTheme: DEFAULT_CARD_FACE_THEME,
  };
  it('produces a fully valid object from partial/garbage input', () => {
    expect(sanitizeGlobalSettings({ lang: 'de', avatar: AVATARS[1], cardStyle: 'blue', animationPreference: 'reduced', favoriteGame: 'durak', cardFaceTheme: 'clean' }))
      .toEqual({ lang: 'de', avatar: AVATARS[1], cardStyle: 'blue', animationPreference: 'reduced', favoriteGame: 'durak', cardFaceTheme: 'clean' });
    expect(sanitizeGlobalSettings({})).toEqual(dflt);
    expect(sanitizeGlobalSettings({ lang: 'zz', avatar: 'nope', animationPreference: 'nope', favoriteGame: 'chess', cardFaceTheme: 'nope' })).toEqual(dflt);
    expect(sanitizeGlobalSettings(null)).toEqual(dflt);
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
