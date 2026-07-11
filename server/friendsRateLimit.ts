// ---------------------------------------------------------------------------
// Friend-request rate limit (Stage 25.1) — lightweight, in-memory, per-user.
//
// Blunts request spam on a single Node instance (see MVP_STATUS): at most N friend
// requests per user per sliding window. Keyed by the SERVER-resolved userId (never a
// client value), so it cannot be spoofed. Not a substitute for edge/IP limiting at a
// public launch. Pure logic with an injectable clock — unit-testable without real time.
// Mirrors server/avatarRateLimit.ts.
// ---------------------------------------------------------------------------

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 20;        // 20 friend requests / hour / user
const MAX_TRACKED_USERS = 10_000;

const hits = new Map<string, number[]>();

function prune(now: number): void {
  const cutoff = now - WINDOW_MS;
  for (const [key, times] of hits) {
    if (times.length === 0 || times[times.length - 1] <= cutoff) hits.delete(key);
  }
}

/** Records a friend-request attempt for `userId`; returns whether it is allowed. */
export function allowFriendRequest(userId: string, now: number = Date.now()): boolean {
  if (hits.size > MAX_TRACKED_USERS) prune(now);
  const cutoff = now - WINDOW_MS;
  const recent = (hits.get(userId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= MAX_PER_WINDOW) { hits.set(userId, recent); return false; }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

// ── room-invite limiter (Stage 25.2): tighter window, own bucket ──────────────
const INVITE_WINDOW_MS = 60 * 1000; // 1 minute
const INVITE_MAX = 10;              // 10 room invites / minute / user
const inviteHits = new Map<string, number[]>();

/** Records a friend room-invite attempt for `userId`; returns whether it is allowed. */
export function allowFriendInvite(userId: string, now: number = Date.now()): boolean {
  if (inviteHits.size > MAX_TRACKED_USERS) {
    const cutoff = now - INVITE_WINDOW_MS;
    for (const [k, times] of inviteHits) if (times.length === 0 || times[times.length - 1] <= cutoff) inviteHits.delete(k);
  }
  const cutoff = now - INVITE_WINDOW_MS;
  const recent = (inviteHits.get(userId) ?? []).filter((t) => t > cutoff);
  if (recent.length >= INVITE_MAX) { inviteHits.set(userId, recent); return false; }
  recent.push(now);
  inviteHits.set(userId, recent);
  return true;
}

/** Test/maintenance hook: forget all recorded attempts. */
export function resetFriendRateLimit(): void {
  hits.clear();
  inviteHits.clear();
}

export const FRIEND_RATE_LIMIT = { WINDOW_MS, MAX_PER_WINDOW, INVITE_WINDOW_MS, INVITE_MAX } as const;
