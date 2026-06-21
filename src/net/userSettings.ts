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
//   • cardStyle → src/ui/components/cardArt.ts (single 'classic' style today)
//   • turn timer values → KING_RULES.md (Off/30/60/90)
// They are duplicated here as plain constants only to avoid pulling React/engine
// modules into server validation; keep them in sync if the UI lists change.
// ---------------------------------------------------------------------------

import { isValidAvatar } from '../core/avatars';

// ── Allowed values ─────────────────────────────────────────────────────────

export const SUPPORTED_LANGS = ['en', 'uk', 'de', 'ar'] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';

export const SUPPORTED_CARD_STYLES = ['classic'] as const;
export type CardStyle = (typeof SUPPORTED_CARD_STYLES)[number];
export const DEFAULT_CARD_STYLE: CardStyle = 'classic';

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
}

/**
 * Produces a fully-valid GlobalSettings from arbitrary input. `lang`/`cardStyle`
 * fall back to defaults; `avatar` is kept only if whitelisted, else null.
 */
export function sanitizeGlobalSettings(input: unknown): GlobalSettings {
  const o = (input && typeof input === 'object') ? input as Record<string, unknown> : {};
  return {
    lang: sanitizeLang(o.lang),
    avatar: sanitizeAvatarOrNull(o.avatar),
    cardStyle: sanitizeCardStyle(o.cardStyle),
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
