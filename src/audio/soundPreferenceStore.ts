// ---------------------------------------------------------------------------
// Client-only source of truth for the sound preference (Stage 15.2).
//
// A tiny external store (no context/provider, like cardBackStore /
// motionPreferenceStore) so any component reads the choice via
// useSyncExternalStore, AND the engine reads the CURRENT value at play time
// through getSoundPreference(). A `data-sound` attribute is stamped on <html>
// for inspection/debugging only — no CSS keys off it (sound is not visual).
//
// LOCAL + device-contextual: never put into room/WS state, never synced to the
// server. Initialised from localStorage on module load. Default OFF.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';
import {
  loadSoundPreference, saveSoundPreference, normalizeSoundPreference,
  type SoundPreference,
} from './soundPreference';

let current: SoundPreference = loadSoundPreference();
const listeners = new Set<() => void>();

/** Reflect the choice on <html> (for debugging/inspection; no CSS depends on it). */
function applyDom(pref: SoundPreference): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.sound = pref;
  }
}
applyDom(current); // stamp once, at first import — does NOT create any Audio.

export function getSoundPreference(): SoundPreference {
  return current;
}

/**
 * Set the active preference (accepts unknown/tampered inputs → 'off'), persist
 * it locally, stamp the DOM, and notify subscribers. Never plays a sound.
 */
export function setSoundPreference(v: string | null | undefined): void {
  const next = normalizeSoundPreference(v);
  if (next === current) return;
  current = next;
  saveSoundPreference(next);
  applyDom(next);
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** React hook: re-renders the caller whenever the sound preference changes. */
export function useSoundPreference(): SoundPreference {
  return useSyncExternalStore(subscribe, getSoundPreference, getSoundPreference);
}
