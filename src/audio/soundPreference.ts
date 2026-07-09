// ---------------------------------------------------------------------------
// Sound preference — pure helpers + local persistence (Stage 15.2).
//
// A LOCAL, device-contextual UI preference controlling whether (and how loudly)
// the client-side sound engine plays. Sound is DEFAULT OFF for everyone and
// nothing plays until the user opts in. Deliberately DECOUPLED from the
// animation preference (a quiet room and a still table are separate choices).
//
// Privacy/fairness: this value is purely client-side. It is NEVER game state,
// never in the WS room protocol, never synced to the server or the DB. Two
// players in the same online room can each have their own setting. No React /
// DOM / Audio here, so it can be unit-tested and reused by both the store and
// the engine without importing UI or browser-audio code.
//
// Storage: local-only under `cardMajlis.sound.v1` (the newer brand-prefixed
// namespace, like the custom avatar / custom server device settings). We chose
// local-only over profile sync on purpose — sound belongs to the device, not
// the account — so there is no user_settings column and no messages.ts field.
//
// Values:
//   'off'    — no sound at all (the default). The engine is a hard no-op.
//   'subtle' — quieter: the engine scales every asset's volume down.
//   'full'   — the asset's intended volume (still a modest ceiling per asset).
// ---------------------------------------------------------------------------

import type { StorageLike } from '../net/session';

export const SOUND_PREFERENCES = ['off', 'subtle', 'full'] as const;
export type SoundPreference = (typeof SOUND_PREFERENCES)[number];

/** Everyone starts silent; sound is strictly opt-in. */
export const DEFAULT_SOUND_PREFERENCE: SoundPreference = 'off';

/** localStorage key — brand-prefixed, device-local, never synced. */
export const SOUND_PREF_KEY = 'cardMajlis.sound.v1';

/** Any input (unknown / tampered / legacy) → a valid preference; fallback 'off'. */
export function normalizeSoundPreference(v: string | null | undefined): SoundPreference {
  return (SOUND_PREFERENCES as readonly string[]).includes(v as string)
    ? (v as SoundPreference)
    : DEFAULT_SOUND_PREFERENCE;
}

/**
 * Volume multiplier applied on top of each asset's `volumeHint` for the tier.
 *   off    → 0   (never plays; the engine short-circuits before this anyway)
 *   subtle → 0.5 (noticeably quieter background feedback)
 *   full   → 1.0 (the asset's intended level)
 */
export function soundTierVolume(pref: SoundPreference): number {
  switch (pref) {
    case 'full': return 1;
    case 'subtle': return 0.5;
    default: return 0;
  }
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Load the saved preference, or 'off' if none / invalid / unavailable. */
export function loadSoundPreference(storage: StorageLike | null = defaultStorage()): SoundPreference {
  try {
    return normalizeSoundPreference(storage?.getItem(SOUND_PREF_KEY));
  } catch {
    return DEFAULT_SOUND_PREFERENCE;
  }
}

/** Persist the preference locally (only ever writes a valid, normalised value). */
export function saveSoundPreference(pref: string, storage: StorageLike | null = defaultStorage()): void {
  const p = normalizeSoundPreference(pref);
  try { storage?.setItem(SOUND_PREF_KEY, p); } catch { /* non-fatal */ }
}
