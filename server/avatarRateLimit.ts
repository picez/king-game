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
/** Bound the map so a long-lived instance seeing many distinct users can't grow it
 *  without limit — when it gets large, drop entries whose newest hit is stale. */
const MAX_TRACKED_USERS = 10_000;

const hits = new Map<string, number[]>();

/** Drop users whose most recent attempt is older than the window (opportunistic). */
function prune(now: number): void {
  const cutoff = now - WINDOW_MS;
  for (const [key, times] of hits) {
    if (times.length === 0 || times[times.length - 1] <= cutoff) hits.delete(key);
  }
}

/**
 * Records an upload attempt for `userId` and returns whether it is allowed. Prunes
 * timestamps older than the window; the map self-bounds (see MAX_TRACKED_USERS).
 * `now` is injectable for tests. Keyed by the SERVER-resolved userId (never a
 * client-supplied value), so it cannot be spoofed or bypassed by header tricks.
 */
export function allowAvatarUpload(userId: string, now: number = Date.now()): boolean {
  if (hits.size > MAX_TRACKED_USERS) prune(now);
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
