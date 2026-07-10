// ---------------------------------------------------------------------------
// Avatar upload rate limit (Stage 17.1) — lightweight, in-memory, per-user.
//
// A single Node instance today (see MVP_STATUS), so a process-local sliding window
// is enough to blunt abuse: at most N uploads per user per window. This is NOT a
// substitute for edge/IP rate limiting at a public launch — that stays an infra
// concern (documented alongside the existing WS rate limiting). Pure logic with an
// injectable clock so it is unit-testable without real time.
// ---------------------------------------------------------------------------

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PER_WINDOW = 8;

const hits = new Map<string, number[]>();

/**
 * Records an upload attempt for `userId` and returns whether it is allowed. Prunes
 * timestamps older than the window; when the store is empty a caller may let it be
 * GC'd. `now` is injectable for tests.
 */
export function allowAvatarUpload(userId: string, now: number = Date.now()): boolean {
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(userId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

/** Test/maintenance hook: forget all recorded attempts. */
export function resetAvatarRateLimit(): void {
  hits.clear();
}

export const AVATAR_RATE_LIMIT = { WINDOW_MS, MAX_PER_WINDOW } as const;
