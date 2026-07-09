// ---------------------------------------------------------------------------
// Client-only source of truth for the LOCAL custom avatar (Stage 14.1). A tiny
// external store (like cardBackStore) so the "me" surfaces that show my avatar
// (AccountBar, Profile preview) re-render when I upload or remove a custom image.
// Purely local + visual: NEVER goes into room/WS state or the server profile.
// Initialised from localStorage on module load.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';
import { loadCustomAvatar } from '../../net/customAvatar';

let current: string | null = loadCustomAvatar();
const listeners = new Set<() => void>();

export function getCustomAvatar(): string | null {
  return current;
}

/** Set the active custom avatar data URL (or null to clear) + notify subscribers.
 *  Persistence is done by the caller via save/clearCustomAvatar (net/customAvatar). */
export function setCustomAvatar(dataUrl: string | null): void {
  if (dataUrl === current) return;
  current = dataUrl;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** React hook: the local custom avatar data URL, or null when none is set. */
export function useCustomAvatar(): string | null {
  return useSyncExternalStore(subscribe, getCustomAvatar, getCustomAvatar);
}
