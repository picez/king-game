/**
 * Online session persistence (localStorage).
 *
 * Stores ONLY the small reconnect handle needed to rejoin a room after a tab
 * reload, a short drop, OR a full tab/browser close — never the GameState and
 * never any hand. localStorage (not sessionStorage) is used so the "Resume"
 * option survives closing the tab, within the TTL; older sessions are treated as
 * stale. The pure serialize/parse/validate functions are unit-tested; the thin
 * save/load/clear wrappers do the storage I/O and accept an injectable storage.
 */

export const SESSION_VERSION = 1;
export const SESSION_KEY = 'king.online.session.v1';
/** Resumable for 2 hours; older sessions are treated as stale. */
export const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export interface OnlineSession {
  version: number;
  serverUrl: string;
  roomCode: string;
  reconnectToken: string;
  playerName: string;
  role: 'host' | 'join';
  seatIndex: number | null;
  savedAt: number;
}

/** The fields a caller supplies; version/savedAt are stamped on save. */
export type SessionInput = Omit<OnlineSession, 'version' | 'savedAt'>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// ---------------------------------------------------------------------------
// Pure helpers (no I/O)
// ---------------------------------------------------------------------------

export function serializeSession(session: OnlineSession): string {
  return JSON.stringify(session);
}

export function isExpired(session: OnlineSession, now: number): boolean {
  return now - session.savedAt > SESSION_TTL_MS;
}

/**
 * Parses + validates a stored session. Returns null for missing, malformed,
 * wrong-version, or expired data. Rebuilds a clean object from known fields
 * only, so any extra/injected data (e.g. a stray hand) is dropped, never used.
 */
export function parseSession(raw: string | null, now: number): OnlineSession | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;

  if (o.version !== SESSION_VERSION) return null;
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (!str(o.serverUrl) || !str(o.roomCode) || !str(o.reconnectToken) || !str(o.playerName)) return null;
  if (o.role !== 'host' && o.role !== 'join') return null;
  if (typeof o.savedAt !== 'number') return null;

  const session: OnlineSession = {
    version: SESSION_VERSION,
    serverUrl: o.serverUrl,
    roomCode: o.roomCode,
    reconnectToken: o.reconnectToken,
    playerName: o.playerName,
    role: o.role,
    seatIndex: typeof o.seatIndex === 'number' ? o.seatIndex : null,
    savedAt: o.savedAt,
  };
  return isExpired(session, now) ? null : session;
}

// ---------------------------------------------------------------------------
// Storage I/O wrappers
// ---------------------------------------------------------------------------

function defaultStorage(): StorageLike | null {
  try {
    // localStorage so Resume survives a full tab/browser close (within the TTL).
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // storage can throw in some sandboxed contexts
  }
}

export function saveSession(
  input: SessionInput,
  opts: { storage?: StorageLike | null; now?: number } = {},
): OnlineSession {
  const storage = opts.storage ?? defaultStorage();
  const session: OnlineSession = {
    ...input,
    version: SESSION_VERSION,
    savedAt: opts.now ?? Date.now(),
  };
  try {
    storage?.setItem(SESSION_KEY, serializeSession(session));
  } catch {
    /* storage full / unavailable — non-fatal */
  }
  return session;
}

export function loadSession(
  opts: { storage?: StorageLike | null; now?: number } = {},
): OnlineSession | null {
  const storage = opts.storage ?? defaultStorage();
  return parseSession(storage?.getItem(SESSION_KEY) ?? null, opts.now ?? Date.now());
}

export function clearSession(opts: { storage?: StorageLike | null } = {}): void {
  const storage = opts.storage ?? defaultStorage();
  try {
    storage?.removeItem(SESSION_KEY);
  } catch {
    /* non-fatal */
  }
}
