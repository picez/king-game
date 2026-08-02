// ---------------------------------------------------------------------------
// Pure helpers for the public poker action history (§16 I, Stage 38.0.2).
// The log is PUBLIC by construction — a `PokerActionEntry` carries only
// { seat, street, kind, amount }. No hole cards, deck, burn cards, user ids,
// tokens or escrow data ever reach it, so the panel needs no redaction of its own.
// ---------------------------------------------------------------------------

import type { PokerActionEntry } from '../../games/poker/types';

/** How many of the most recent entries the panel ever shows. */
export const LOG_ROW_LIMIT = 30;

/** The most recent entries, oldest→newest, capped at {@link LOG_ROW_LIMIT}. */
export function recentLogRows(log: readonly PokerActionEntry[], limit: number = LOG_ROW_LIMIT): PokerActionEntry[] {
  return log.slice(-Math.max(0, limit));
}

/**
 * The absolute index of the first shown row, so React keys stay stable as the log
 * grows past the cap (row N keeps its key when older rows scroll out).
 */
export function firstShownIndex(total: number, shown: number): number {
  return Math.max(0, total - shown);
}

/**
 * Whether the toggle should show an unread dot: only while CLOSED and only when
 * actions arrived after the last time the panel was open. Opening the panel is
 * what clears it (the caller stores `seen = total` while open).
 */
export function hasUnreadActions(total: number, seen: number, open: boolean): boolean {
  return !open && total > seen;
}
