// ---------------------------------------------------------------------------
// Client adaptor for the Stage 25.1 Friends API. SOFT like profileApi: every call
// degrades gracefully (unreachable / no-DB / not-signed-in → a typed result, never a
// throw). NO email is ever received (the server never sends one). Friend requests are
// BY CODE only. No UI here — this is the types + fetch + normalize layer.
// ---------------------------------------------------------------------------

import { normalizeFriendCode } from './friendCode';

/** A friend / pending-request item — public fields only (never an email). */
export interface Friend {
  userId: string;
  displayName: string | null;
  avatar: string | null;
  avatarImageUrl: string | null;
  online: boolean;
  since: string;
}

export interface FriendsData {
  friendCode: string | null;
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
}

/** Outcome of POST /api/friends/request, mapped from the HTTP status + body code. */
export type FriendRequestOutcome =
  | 'created' | 'accepted' | 'already_friends' | 'pending_exists'
  | 'self' | 'invalid_code' | 'forbidden' | 'rate_limited' | 'unavailable' | 'error';

async function call<T>(base: string, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(`${base}${path}`, {
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
    let data: T | null = null;
    try { data = (await res.json()) as T; } catch { /* empty/non-JSON */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** Coerce one server item to a safe `Friend` (defaults over anything malformed). */
export function parseFriend(raw: unknown): Friend | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== 'string' || !r.userId) return null;
  return {
    userId: r.userId,
    displayName: typeof r.displayName === 'string' ? r.displayName : null,
    avatar: typeof r.avatar === 'string' ? r.avatar : null,
    avatarImageUrl: typeof r.avatarImageUrl === 'string' ? r.avatarImageUrl : null,
    online: r.online === true,
    since: typeof r.since === 'string' ? r.since : '',
  };
}

const list = (v: unknown): Friend[] => (Array.isArray(v) ? v.map(parseFriend).filter((f): f is Friend => f !== null) : []);

/** Normalise the /api/friends payload; online friends first within `friends`. */
export function parseFriendsData(raw: unknown): FriendsData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const friends = list(r.friends).sort((a, b) => Number(b.online) - Number(a.online));
  return {
    friendCode: typeof r.friendCode === 'string' ? r.friendCode : null,
    friends,
    incoming: list(r.incoming),
    outgoing: list(r.outgoing),
  };
}

/** GET /api/friends — the friend code + friends + pending requests, or null when unavailable. */
export async function fetchFriends(base: string): Promise<FriendsData | null> {
  const { ok, data } = await call<unknown>(base, '/api/friends');
  return ok && data ? parseFriendsData(data) : null;
}

/** POST /api/friends/request — send a request by code. Returns a typed outcome. */
export async function requestFriend(base: string, friendCode: string): Promise<FriendRequestOutcome> {
  // Send the normalised code when possible; the server re-validates regardless.
  const code = normalizeFriendCode(friendCode) ?? friendCode;
  const { ok, status, data } = await call<{ status?: string; error?: string }>(
    base, '/api/friends/request', { method: 'POST', body: JSON.stringify({ friendCode: code }) },
  );
  if (ok) return (data?.status === 'accepted' ? 'accepted' : 'created');
  const err = data?.error;
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  if (err === 'already_friends' || err === 'pending_exists' || err === 'self'
    || err === 'invalid_code' || err === 'forbidden') return err;
  return 'error';
}

/** POST /api/friends/accept — accept a request from `userId`. */
export async function acceptFriend(base: string, userId: string): Promise<boolean> {
  const { ok } = await call<{ ok?: boolean }>(base, '/api/friends/accept', { method: 'POST', body: JSON.stringify({ userId }) });
  return ok;
}

/** POST /api/friends/decline — decline a request from `userId`. */
export async function declineFriend(base: string, userId: string): Promise<boolean> {
  const { ok } = await call<{ ok?: boolean }>(base, '/api/friends/decline', { method: 'POST', body: JSON.stringify({ userId }) });
  return ok;
}

/** DELETE /api/friends/:userId — remove an accepted friend. */
export async function removeFriend(base: string, userId: string): Promise<boolean> {
  const { ok } = await call<{ ok?: boolean }>(base, `/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  return ok;
}
