// ---------------------------------------------------------------------------
// Tutorial progress (Stage 42.5) — which games' tutorials the player has finished.
//
// A per-device "✓ done" tick, kept in localStorage only: no account, no server, no
// stats. A tutorial counts as done when the player reaches its last step and leaves
// with Done or Practice. Same tiny external-store pattern as the other client prefs.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from 'react';
import { isGameType, type GameType } from '../games/catalog';

export const TUTORIALS_DONE_KEY = 'king.tutorialsDone.v1';

/** The slice of Storage this module touches (tests pass an in-memory one). */
export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ProgressStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The finished games, validated and de-duplicated (junk or a corrupt value → none). */
export function loadTutorialsDone(storage: ProgressStorage | null = defaultStorage()): GameType[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(TUTORIALS_DONE_KEY) ?? '[]');
    return Array.isArray(raw) ? [...new Set(raw.filter(isGameType))] : [];
  } catch {
    return [];
  }
}

function saveTutorialsDone(games: readonly GameType[], storage: ProgressStorage | null): void {
  try { storage?.setItem(TUTORIALS_DONE_KEY, JSON.stringify(games)); } catch { /* non-fatal */ }
}

let done: readonly GameType[] = loadTutorialsDone();
const listeners = new Set<() => void>();

/** Mark a game's tutorial finished (idempotent) and persist it. */
export function markTutorialDone(game: GameType, storage: ProgressStorage | null = defaultStorage()): void {
  if (done.includes(game)) return;
  done = [...done, game];
  saveTutorialsDone(done, storage);
  listeners.forEach((l) => l());
}

export function getTutorialsDone(): readonly GameType[] {
  return done;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** React hook: the finished games; re-renders when one is added. */
export function useTutorialsDone(): readonly GameType[] {
  return useSyncExternalStore(subscribe, getTutorialsDone, getTutorialsDone);
}
