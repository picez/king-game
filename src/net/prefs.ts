/**
 * Lightweight user preferences in localStorage (persists across sessions,
 * unlike the per-tab online session). Stores ONLY non-sensitive UI prefs —
 * never game state, hands, or passwords.
 */

import type { StorageLike } from './session';
import { isValidAvatar } from '../core/avatars';
import { normalizeCardBack, type CardBackStyle } from '../ui/components/cardArt';
import { normalizeMotionPreference, type AnimationPreference } from '../ui/components/motionPref';
import { normalizeCardFaceTheme, type CardFaceTheme } from '../ui/components/cardFaceTheme';
import { normalizeFavoriteGame } from '../games/catalog';
import type { GameType } from '../games/catalog';

const NICK_KEY = 'king.nickname.v1';
const LANG_KEY = 'king.lang.v1';
const AVATAR_KEY = 'king.avatar.v1';
const TIMER_KEY = 'king.defaultTimer.v1';
const GUEST_KEY = 'king.guest.v1';
const CARDBACK_KEY = 'king.cardStyle.v1';
const MOTION_KEY = 'king.motion.v1';
const FAVGAME_KEY = 'king.favoriteGame.v1';
const CARDFACE_KEY = 'king.cardFaceTheme.v1';

/** Allowed default turn-timer values (seconds); 0 = off. Mirrors KING_RULES.md. */
const TIMER_VALUES = [0, 30, 60, 90];

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadNickname(storage: StorageLike | null = defaultStorage()): string | null {
  const v = storage?.getItem(NICK_KEY) ?? null;
  return v && v.trim() ? v : null;
}

export function saveNickname(name: string, storage: StorageLike | null = defaultStorage()): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  try { storage?.setItem(NICK_KEY, trimmed.slice(0, 20)); } catch { /* non-fatal */ }
}

export function loadLang(storage: StorageLike | null = defaultStorage()): string | null {
  return storage?.getItem(LANG_KEY) ?? null;
}

export function saveLang(lang: string, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(LANG_KEY, lang); } catch { /* non-fatal */ }
}

/** Loads the saved avatar id, or null if none/invalid (whitelist-checked). */
export function loadAvatar(storage: StorageLike | null = defaultStorage()): string | null {
  const v = storage?.getItem(AVATAR_KEY) ?? null;
  return isValidAvatar(v) ? v : null;
}

export function saveAvatar(avatar: string, storage: StorageLike | null = defaultStorage()): void {
  if (!isValidAvatar(avatar)) return; // never persist anything off the whitelist
  try { storage?.setItem(AVATAR_KEY, avatar); } catch { /* non-fatal */ }
}

/** Preferred default turn timer (seconds) for hosting; 0/30/60/90 only. */
export function loadDefaultTimer(storage: StorageLike | null = defaultStorage()): number {
  const n = Number(storage?.getItem(TIMER_KEY));
  return TIMER_VALUES.includes(n) ? n : 0;
}

export function saveDefaultTimer(seconds: number, storage: StorageLike | null = defaultStorage()): void {
  if (!TIMER_VALUES.includes(seconds)) return; // ignore anything off the whitelist
  try { storage?.setItem(TIMER_KEY, String(seconds)); } catch { /* non-fatal */ }
}

/**
 * Preferred card-back style (Stage 13.0): 'green' (classic default) or 'red'.
 * A purely visual, local UI preference — never game state. Any legacy/unknown
 * value (e.g. the DB's 'classic') normalises to 'green'.
 */
export function loadCardStyle(storage: StorageLike | null = defaultStorage()): CardBackStyle {
  return normalizeCardBack(storage?.getItem(CARDBACK_KEY));
}

export function saveCardStyle(style: string, storage: StorageLike | null = defaultStorage()): void {
  const s = normalizeCardBack(style); // only ever persist a valid style
  try { storage?.setItem(CARDBACK_KEY, s); } catch { /* non-fatal */ }
}

/**
 * Card face theme (Stage 13.5): 'classic' or 'clean'. A purely visual, local UI
 * preference — never game state, never card identity. Unknown → 'classic'.
 */
export function loadCardFaceTheme(storage: StorageLike | null = defaultStorage()): CardFaceTheme {
  return normalizeCardFaceTheme(storage?.getItem(CARDFACE_KEY));
}

export function saveCardFaceTheme(theme: string, storage: StorageLike | null = defaultStorage()): void {
  const t = normalizeCardFaceTheme(theme); // only ever persist a valid theme
  try { storage?.setItem(CARDFACE_KEY, t); } catch { /* non-fatal */ }
}

/**
 * Preferred animation intensity (Stage 13.2): 'system' | 'full' | 'reduced' | 'off'.
 * A purely visual, local UI preference — never game state. Unknown/legacy values
 * normalise to 'system' (follow the device). The OS `prefers-reduced-motion` still
 * takes priority over 'full'/'system' at apply time (see motionPref.ts).
 */
export function loadMotionPreference(storage: StorageLike | null = defaultStorage()): AnimationPreference {
  return normalizeMotionPreference(storage?.getItem(MOTION_KEY));
}

export function saveMotionPreference(pref: string, storage: StorageLike | null = defaultStorage()): void {
  const p = normalizeMotionPreference(pref); // only ever persist a valid value
  try { storage?.setItem(MOTION_KEY, p); } catch { /* non-fatal */ }
}

/**
 * Preferred "favorite" game (Stage 13.3): pre-selects the Local/Host game picker.
 * A local UI preference — never game state. Unknown/unavailable values normalise
 * to King (the default) so a stale value never breaks the picker.
 */
export function loadFavoriteGame(storage: StorageLike | null = defaultStorage()): GameType {
  return normalizeFavoriteGame(storage?.getItem(FAVGAME_KEY));
}

export function saveFavoriteGame(game: string, storage: StorageLike | null = defaultStorage()): void {
  const g = normalizeFavoriteGame(game); // only ever persist a valid game id
  try { storage?.setItem(FAVGAME_KEY, g); } catch { /* non-fatal */ }
}

/**
 * A stable per-device guest handle. PUBLIC, non-sensitive — a lookup key the
 * server maps to a guest user row (NOT a credential, NOT a password). Persisted
 * so the same device reuses its guest profile across sessions.
 */
export function loadGuestKey(storage: StorageLike | null = defaultStorage()): string | null {
  const v = storage?.getItem(GUEST_KEY) ?? null;
  return v && v.trim() ? v : null;
}

export function saveGuestKey(key: string, storage: StorageLike | null = defaultStorage()): void {
  if (!key.trim()) return;
  try { storage?.setItem(GUEST_KEY, key.trim().slice(0, 64)); } catch { /* non-fatal */ }
}
