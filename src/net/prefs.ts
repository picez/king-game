/**
 * Lightweight user preferences in localStorage (persists across sessions,
 * unlike the per-tab online session). Stores ONLY non-sensitive UI prefs —
 * never game state, hands, or passwords.
 */

import type { StorageLike } from './session';
import { isValidAvatar } from '../core/avatars';

const NICK_KEY = 'king.nickname.v1';
const LANG_KEY = 'king.lang.v1';
const AVATAR_KEY = 'king.avatar.v1';
const TIMER_KEY = 'king.defaultTimer.v1';
const GUEST_KEY = 'king.guest.v1';

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
