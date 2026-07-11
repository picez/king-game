// ---------------------------------------------------------------------------
// Friends presence (Stage 25.1) — in-memory, per server instance.
//
// A user is ONLINE iff they have >= 1 live authenticated WebSocket connection on THIS
// instance. Presence is intentionally NOT a DB column (always fresh, no write per
// connect/disconnect). Guests (no resolved userId) are never tracked. It touches no
// room/gameplay state — the WS lifecycle just attach()es on an authenticated connection
// and detach()es on close.
//
// SINGLE-INSTANCE LIMITATION (documented, same as rooms/social today): presence is
// per-process. Horizontal scaling would need a shared store (e.g. Redis pub/sub) — a
// post-MVP item. Pure logic + an injectable socket key so it is unit-testable.
// ---------------------------------------------------------------------------

/** Opaque per-connection key (the WebSocket instance works; tests pass a string/object). */
type SocketKey = object;

// userId → set of that user's live authenticated sockets.
const sockets = new Map<string, Set<SocketKey>>();

/**
 * Attach an authenticated socket for `userId`. Returns true when this is the user's FIRST
 * socket (an offline→online transition) — the caller fans out a presence update then.
 */
export function attachPresence(userId: string, socket: SocketKey): boolean {
  let set = sockets.get(userId);
  const wasOffline = !set || set.size === 0;
  if (!set) { set = new Set(); sockets.set(userId, set); }
  set.add(socket);
  return wasOffline;
}

/**
 * Detach a socket for `userId`. Returns true when it was the user's LAST socket (an
 * online→offline transition) — the caller fans out a presence update then. Safe to call
 * for an unknown user/socket (no-op → false).
 */
export function detachPresence(userId: string, socket: SocketKey): boolean {
  const set = sockets.get(userId);
  if (!set) return false;
  set.delete(socket);
  if (set.size === 0) { sockets.delete(userId); return true; }
  return false;
}

/** Whether the user has any live authenticated socket on this instance. */
export function isOnline(userId: string): boolean {
  return (sockets.get(userId)?.size ?? 0) > 0;
}

/** Filter a list of userIds down to those currently online (for a presence snapshot). */
export function onlineAmong(userIds: readonly string[]): string[] {
  return userIds.filter(isOnline);
}

/** All currently-online userIds (mainly for tests/diagnostics; not sent on the wire). */
export function onlineUserIds(): string[] {
  return [...sockets.keys()].filter(isOnline);
}

/** Test hook: forget all presence. */
export function resetPresence(): void {
  sockets.clear();
}
