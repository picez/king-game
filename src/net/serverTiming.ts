// ---------------------------------------------------------------------------
// Pure server-timing config — no I/O, no side effects, so it is unit-testable
// without booting the WebSocket server. Imported by server/index.ts.
// ---------------------------------------------------------------------------

/** Clamp a millisecond value to [min, max], falling back to `fallback` if NaN. */
export function clampMs(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Default time a completed trick stays on the table before auto-advancing. */
export const DEFAULT_TRICK_ADVANCE_MS = 3000;
export const MIN_TRICK_ADVANCE_MS = 1000;
export const MAX_TRICK_ADVANCE_MS = 10000;

/**
 * Resolve TRICK_ADVANCE_MS from an optional env string. Long enough to read the
 * cards after a trick (post-playtest fix #2); clamped so a bad value can never
 * freeze or flash the table.
 */
export function resolveTrickAdvanceMs(raw: string | undefined): number {
  return clampMs(
    Number(raw ?? DEFAULT_TRICK_ADVANCE_MS),
    MIN_TRICK_ADVANCE_MS,
    MAX_TRICK_ADVANCE_MS,
    DEFAULT_TRICK_ADVANCE_MS,
  );
}
