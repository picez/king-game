// ---------------------------------------------------------------------------
// User profile / settings validation (pure; Stage 3).
//
// Server-side validation + sanitisation for DB-backed profiles. NO React, NO
// game-engine, NO DB imports — just plain data + functions, so it is unit-
// testable without a database and safe to reuse from the (future) API layer and
// the repository (server/db/users.ts).
//
// The allowed value lists mirror the client's source of truth:
//   • languages → src/i18n (LANGS: en/uk/de/ar)
//   • avatars   → src/core/avatars (the emoji whitelist; reused directly below)
//   • cardStyle → src/ui/components/cardArt.ts ('classic' = green, or 'red')
//   • turn timer values → KING_RULES.md (Off/30/60/90)
// They are duplicated here as plain constants only to avoid pulling React/engine
// modules into server validation; keep them in sync if the UI lists change.
// ---------------------------------------------------------------------------

import { isValidAvatar } from '../core/avatars';

// ── Allowed values ─────────────────────────────────────────────────────────

export const SUPPORTED_LANGS = ['en', 'uk', 'de', 'ar'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';

// 'classic' = the green back (kept as the stored default so existing card_style
// rows are never broken); 'red' = burgundy/gold (Stage 13.0); 'blue' = sapphire,
// 'dark' = charcoal/gold (Stage 13.5). Whitelist EXTENSION only — no DB schema
// change (card_style is a free text column; unknown values sanitise to 'classic').
export const SUPPORTED_CARD_STYLES = ['classic', 'red', 'blue', 'dark'] as const;
export type CardStyle = (typeof SUPPORTED_CARD_STYLES)[number];
export const DEFAULT_CARD_STYLE: CardStyle = 'classic';

// Card face theme (Stage 13.5) — a purely visual CSS theme for face-up cards
// (NOT the artwork files). Same value space on client + server. 'classic' = the
// current look; 'clean' = a higher-contrast, larger-index reading aid.
export const SUPPORTED_CARD_FACE_THEMES = ['classic', 'clean'] as const;
export type CardFaceTheme = (typeof SUPPORTED_CARD_FACE_THEMES)[number];
export const DEFAULT_CARD_FACE_THEME: CardFaceTheme = 'classic';

// Animation-intensity preference (Stage 13.2). Same value space on client and
// server (no mapping, unlike cardStyle), mirrored from src/ui/components/motionPref.ts
// so server validation stays React/engine-free. 'system' = follow the device.
export const SUPPORTED_ANIMATION_PREFS = ['system', 'full', 'reduced', 'off'] as const;
export type AnimationPreference = (typeof SUPPORTED_ANIMATION_PREFS)[number];
export const DEFAULT_ANIMATION_PREF: AnimationPreference = 'system';

// Favorite game (Stage 13.3) — pre-selects the Local/Host picker. Mirrors
// src/games/catalog GAME_TYPES as a plain constant so server validation stays
// engine-free. Unknown/unavailable → King (the default).
export const SUPPORTED_FAVORITE_GAMES = ['king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one'] as const;
export type FavoriteGame = (typeof SUPPORTED_FAVORITE_GAMES)[number];
export const DEFAULT_FAVORITE_GAME: FavoriteGame = 'king';

/** Allowed per-turn timer values (seconds); 0 = off. Mirrors KING_RULES.md. */
export const TURN_TIMER_VALUES = [0, 30, 60, 90] as const;
export const DEFAULT_TURN_TIMER = 0;

/** Display-name cap matches the existing nickname cap (src/net/prefs.ts). */
export const MAX_DISPLAY_NAME = 20;

// ── Field validators ───────────────────────────────────────────────────────

export function isSupportedLang(v: unknown): v is Lang {
  return typeof v === 'string' && (SUPPORTED_LANGS as readonly string[]).includes(v);
}
export function sanitizeLang(v: unknown): Lang {
  return isSupportedLang(v) ? v : DEFAULT_LANG;
}

export function isSupportedCardStyle(v: unknown): v is CardStyle {
  return typeof v === 'string' && (SUPPORTED_CARD_STYLES as readonly string[]).includes(v);
}
export function sanitizeCardStyle(v: unknown): CardStyle {
  return isSupportedCardStyle(v) ? v : DEFAULT_CARD_STYLE;
}

export function isSupportedAnimationPref(v: unknown): v is AnimationPreference {
  return typeof v === 'string' && (SUPPORTED_ANIMATION_PREFS as readonly string[]).includes(v);
}
export function sanitizeAnimationPref(v: unknown): AnimationPreference {
  return isSupportedAnimationPref(v) ? v : DEFAULT_ANIMATION_PREF;
}

export function isSupportedFavoriteGame(v: unknown): v is FavoriteGame {
  return typeof v === 'string' && (SUPPORTED_FAVORITE_GAMES as readonly string[]).includes(v);
}
export function sanitizeFavoriteGame(v: unknown): FavoriteGame {
  return isSupportedFavoriteGame(v) ? v : DEFAULT_FAVORITE_GAME;
}

export function isSupportedCardFaceTheme(v: unknown): v is CardFaceTheme {
  return typeof v === 'string' && (SUPPORTED_CARD_FACE_THEMES as readonly string[]).includes(v);
}
export function sanitizeCardFaceTheme(v: unknown): CardFaceTheme {
  return isSupportedCardFaceTheme(v) ? v : DEFAULT_CARD_FACE_THEME;
}

/** Whitelisted emoji id or null — never free text (XSS-safe, like prefs.ts). */
export function sanitizeAvatarOrNull(v: unknown): string | null {
  return isValidAvatar(v) ? v : null;
}

/** 0/30/60/90 only; anything else → 0 (off). Matches serverCore.normalizeTimer. */
export function normalizeTurnTimer(v: unknown): number {
  return v === 30 || v === 60 || v === 90 ? v : 0;
}

/** Trimmed, capped display name, or null when empty/invalid. */
export function sanitizeDisplayName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, MAX_DISPLAY_NAME);
  return t.length ? t : null;
}

// ── Global (game-agnostic) settings ────────────────────────────────────────

export interface GlobalSettings {
  lang: Lang;
  /** Whitelisted emoji id, or null when unset (client derives a default). */
  avatar: string | null;
  cardStyle: CardStyle;
  /** Animation-intensity preference (Stage 13.2); 'system' follows the device. */
  animationPreference: AnimationPreference;
  /** Favorite game (Stage 13.3) — pre-selects the Local/Host picker. */
  favoriteGame: FavoriteGame;
  /** Card face theme (Stage 13.5) — visual only; 'classic' is the current look. */
  cardFaceTheme: CardFaceTheme;
}

/**
 * Produces a fully-valid GlobalSettings from arbitrary input. `lang`/`cardStyle`/
 * `animationPreference` fall back to defaults; `avatar` is kept only if
 * whitelisted, else null.
 */
export function sanitizeGlobalSettings(input: unknown): GlobalSettings {
  const o = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  return {
    lang: sanitizeLang(o.lang),
    avatar: sanitizeAvatarOrNull(o.avatar),
    cardStyle: sanitizeCardStyle(o.cardStyle),
    animationPreference: sanitizeAnimationPref(o.animationPreference),
    favoriteGame: sanitizeFavoriteGame(o.favoriteGame),
    cardFaceTheme: sanitizeCardFaceTheme(o.cardFaceTheme),
  };
}

// ── Per-game settings (game_type-keyed) ────────────────────────────────────

/** King's per-game preferences (stored in user_game_settings.settings JSONB). */
export interface KingGameSettings {
  /** Preferred default lobby turn timer (seconds): 0/30/60/90. */
  defaultTimer: number;
}

/**
 * Validates a game's settings JSONB by game_type. King is the only game today;
 * unknown games return an empty object (nothing trusted) until they register
 * their own schema. Keeping per-game shapes here avoids leaking King-specific
 * fields into the shared global settings.
 */
export function sanitizeGameSettings(gameType: string, input: unknown): Record<string, unknown> {
  const o = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  if (gameType === 'king') {
    const king: KingGameSettings = { defaultTimer: normalizeTurnTimer(o.defaultTimer) };
    return king as unknown as Record<string, unknown>;
  }
  return {};
}
