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
