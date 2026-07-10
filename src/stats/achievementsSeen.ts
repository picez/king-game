// ---------------------------------------------------------------------------
// Achievement "seen" state (Stage 16.1) — a PURE, DEVICE-LOCAL unlock ledger.
//
// The unlock toast needs to know which earned badges the user has already been
// shown. We keep that as a plain list of achievement ids in localStorage — NO DB
// column, NO server route, NO WS message, and nothing on the wire. A badge that
// is earned (per the read-only stats) but whose id is not yet in this list is a
// "new" unlock → the toast surfaces it once, then its id is marked seen.
//
// All helpers here are pure over an injectable StorageLike (no React/DOM), so the
// diff + round-trip + tamper-safety are unit-testable without a browser.
// ---------------------------------------------------------------------------

import type { StorageLike } from '../net/session';
import type { AchievementProgress } from './achievements';

/** Device-local key for the seen-achievements ledger (product namespace). */
export const ACHIEVEMENTS_SEEN_KEY = 'cardMajlis.achievementsSeen.v1';

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The ids of the earned rows, in catalog order (locked rows dropped). */
export function earnedIds(rows: readonly AchievementProgress[]): string[] {
  return rows.filter((r) => r.earned).map((r) => r.achievement.id);
}

/**
 * Reads the seen-id ledger. Always returns a clean array of unique non-blank
 * strings; any tampering (non-JSON, non-array, non-string members) degrades to
 * an empty list rather than throwing — the worst case is re-showing a toast.
 */
export function loadSeen(storage: StorageLike | null = defaultStorage()): string[] {
  let raw: string | null = null;
  try { raw = storage?.getItem(ACHIEVEMENTS_SEEN_KEY) ?? null; } catch { return []; }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const clean = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
    return Array.from(new Set(clean));
  } catch {
    return [];
  }
}

/** Persists the seen-id ledger (deduped). Storage errors are non-fatal. */
export function saveSeen(ids: readonly string[], storage: StorageLike | null = defaultStorage()): void {
  const unique = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0)));
  try { storage?.setItem(ACHIEVEMENTS_SEEN_KEY, JSON.stringify(unique)); } catch { /* non-fatal */ }
}

/**
 * The ids that are earned NOW but were not earned in the previous snapshot — the
 * pure "what just unlocked" diff, independent of any storage.
 */
export function newlyEarned(previous: readonly string[], next: readonly string[]): string[] {
  const before = new Set(previous);
  return next.filter((id) => !before.has(id));
}

/** The earned ids the user has not been shown yet (earned − seen). */
export function unseenEarned(earned: readonly string[], seen: readonly string[]): string[] {
  const known = new Set(seen);
  return earned.filter((id) => !known.has(id));
}

/**
 * Adds `ids` to the persisted ledger and returns the merged list. Used after the
 * toast is dismissed so those unlocks never re-announce.
 */
export function markSeen(ids: readonly string[], storage: StorageLike | null = defaultStorage()): string[] {
  const merged = Array.from(new Set([...loadSeen(storage), ...ids]));
  saveSeen(merged, storage);
  return merged;
}
