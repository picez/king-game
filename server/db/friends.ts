// ---------------------------------------------------------------------------
// Friends repository (Stage 25.1) — the signed-in social graph. DB-gated (opt-in):
// throws a clear error when DATABASE_URL is unset, like the other db/* repos.
//
// One directed row per request in `friendships`; an accepted row IS the friendship and
// is queried in BOTH directions (there is never a reciprocal A→B + B→A duplicate — the
// code checks both directions before inserting, and a reverse pending request is
// AUTO-ACCEPTED rather than duplicated). Emits ONLY public fields (displayName, emoji
// avatar, same-origin avatar URL, presence layered on later) — NEVER an email.
// ---------------------------------------------------------------------------

import { randomInt } from 'node:crypto';
import { getDb } from './client';
import {
  FRIEND_CODE_ALPHABET, FRIEND_CODE_BODY_LEN, formatFriendCode, normalizeFriendCode,
} from '../../src/net/friendCode';
import { avatarImageUrlPath } from '../../src/net/avatarImage';

type Row = Record<string, unknown>;
type Sql = { (strings: TemplateStringsArray, ...args: unknown[]): Promise<Row[]> };

async function sqlConn(): Promise<Sql> {
  const conn = await getDb();
  if (!conn) throw new Error('friends repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.sql as unknown as Sql;
}

export type FriendKind = 'accepted' | 'incoming' | 'outgoing';

/** A public-safe friend/relationship summary — NO email, ever. */
export interface FriendSummary {
  userId: string;
  displayName: string | null;
  avatar: string | null;          // whitelisted emoji avatar (user_settings.avatar)
  avatarImageUrl: string | null;  // same-origin /api/avatar/<id>.webp?v=n, or null
  kind: FriendKind;
  since: string;                  // ISO updated_at
}

export interface FriendLists {
  friends: FriendSummary[];   // accepted
  incoming: FriendSummary[];  // pending, addressed TO me (I accept/decline)
  outgoing: FriendSummary[];  // pending, sent BY me
}

// ── friend code ─────────────────────────────────────────────────────────────

function genFriendCodeBody(): string {
  let s = '';
  for (let i = 0; i < FRIEND_CODE_BODY_LEN; i++) s += FRIEND_CODE_ALPHABET[randomInt(FRIEND_CODE_ALPHABET.length)];
  return s;
}

/** Returns the user's stable friend code, generating + persisting a unique one on first
 *  use. Retries on the (astronomically rare) unique collision. */
export async function getOrCreateFriendCode(userId: string): Promise<string> {
  const sql = await sqlConn();
  const cur = (await sql`SELECT friend_code FROM users WHERE id = ${userId} LIMIT 1`)[0]?.friend_code;
  if (cur) return String(cur);
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = formatFriendCode(genFriendCodeBody());
    try {
      const rows = await sql`
        UPDATE users SET friend_code = ${code}, updated_at = now()
        WHERE id = ${userId} AND friend_code IS NULL
        RETURNING friend_code`;
      if (rows[0]?.friend_code) return String(rows[0].friend_code);
      // Set concurrently by another request → read it back.
      const again = (await sql`SELECT friend_code FROM users WHERE id = ${userId} LIMIT 1`)[0]?.friend_code;
      if (again) return String(again);
    } catch { /* unique violation on the code → try a fresh one */ }
  }
  throw new Error('friend_code_generation_failed');
}

/** Resolve a (any-form) friend code to a user, or null. Guests are not addressable. */
export async function findUserByFriendCode(code: string): Promise<{ id: string; isGuest: boolean } | null> {
  const canonical = normalizeFriendCode(code);
  if (!canonical) return null;
  const sql = await sqlConn();
  const r = (await sql`SELECT id, is_guest FROM users WHERE friend_code = ${canonical} LIMIT 1`)[0];
  return r ? { id: String(r.id), isGuest: Boolean(r.is_guest) } : null;
}

// ── relationship queries ─────────────────────────────────────────────────────

interface Existing { requesterId: string; addresseeId: string; status: string; }

/** The existing row between two users in EITHER direction, or null. */
async function existingBetween(sql: Sql, a: string, b: string): Promise<Existing | null> {
  const r = (await sql`
    SELECT requester_id, addressee_id, status FROM friendships
    WHERE (requester_id = ${a} AND addressee_id = ${b})
       OR (requester_id = ${b} AND addressee_id = ${a})
    LIMIT 1`)[0];
  return r ? { requesterId: String(r.requester_id), addresseeId: String(r.addressee_id), status: String(r.status) } : null;
}

export type RequestResult =
  | 'created' | 'auto_accepted' | 'already_friends' | 'pending_exists' | 'self' | 'invalid_code' | 'blocked';

/**
 * Send a friend request BY CODE (never by email). Self / already-friends / duplicate are
 * graceful, and a reverse pending request is AUTO-ACCEPTED (no reciprocal duplicate row).
 */
export async function sendFriendRequest(userId: string, friendCode: string): Promise<{ result: RequestResult; otherId: string | null }> {
  const target = await findUserByFriendCode(friendCode);
  if (!target || target.isGuest) return { result: 'invalid_code', otherId: null };
  if (target.id === userId) return { result: 'self', otherId: null };
  const sql = await sqlConn();
  const existing = await existingBetween(sql, userId, target.id);
  if (existing) {
    if (existing.status === 'blocked') return { result: 'blocked', otherId: null };
    if (existing.status === 'accepted') return { result: 'already_friends', otherId: target.id };
    // pending
    if (existing.requesterId === userId) return { result: 'pending_exists', otherId: target.id };
    // reverse pending (they already asked me) → accept it
    await sql`
      UPDATE friendships SET status = 'accepted', updated_at = now()
      WHERE requester_id = ${target.id} AND addressee_id = ${userId} AND status = 'pending'`;
    return { result: 'auto_accepted', otherId: target.id };
  }
  await sql`
    INSERT INTO friendships (requester_id, addressee_id, status)
    VALUES (${userId}, ${target.id}, 'pending')
    ON CONFLICT (requester_id, addressee_id) DO NOTHING`;
  return { result: 'created', otherId: target.id };
}

/** Accept a pending request addressed TO me. Only the addressee may accept. */
export async function acceptFriendRequest(userId: string, requesterId: string): Promise<boolean> {
  const sql = await sqlConn();
  const rows = await sql`
    UPDATE friendships SET status = 'accepted', updated_at = now()
    WHERE requester_id = ${requesterId} AND addressee_id = ${userId} AND status = 'pending'
    RETURNING requester_id`;
  return rows.length > 0;
}

/** Decline (delete) a pending request addressed TO me. Only the addressee may decline. */
export async function declineFriendRequest(userId: string, requesterId: string): Promise<boolean> {
  const sql = await sqlConn();
  const rows = await sql`
    DELETE FROM friendships
    WHERE requester_id = ${requesterId} AND addressee_id = ${userId} AND status = 'pending'
    RETURNING requester_id`;
  return rows.length > 0;
}

/** Remove an ACCEPTED friend (either direction). Only a party to the pair can. */
export async function removeFriend(userId: string, otherUserId: string): Promise<boolean> {
  const sql = await sqlConn();
  const rows = await sql`
    DELETE FROM friendships
    WHERE status = 'accepted'
      AND ((requester_id = ${userId} AND addressee_id = ${otherUserId})
        OR (requester_id = ${otherUserId} AND addressee_id = ${userId}))
    RETURNING requester_id`;
  return rows.length > 0;
}

/** True when the two users are accepted friends (used to authorise a room invite). */
export async function areFriends(a: string, b: string): Promise<boolean> {
  const sql = await sqlConn();
  const rows = await sql`
    SELECT 1 FROM friendships
    WHERE status = 'accepted'
      AND ((requester_id = ${a} AND addressee_id = ${b})
        OR (requester_id = ${b} AND addressee_id = ${a}))
    LIMIT 1`;
  return rows.length > 0;
}

/** Accepted userIds for a user — used by presence fan-out (who to notify). */
export async function friendUserIds(userId: string): Promise<string[]> {
  const sql = await sqlConn();
  const rows = await sql`
    SELECT CASE WHEN requester_id = ${userId} THEN addressee_id ELSE requester_id END AS other_id
    FROM friendships
    WHERE status = 'accepted' AND (requester_id = ${userId} OR addressee_id = ${userId})`;
  return rows.map((r) => String(r.other_id));
}

/** The user's accepted friends + incoming + outgoing pending requests — public fields only. */
export async function listFriends(userId: string): Promise<FriendLists> {
  const sql = await sqlConn();
  const rows = await sql`
    SELECT f.requester_id, f.addressee_id, f.status, f.updated_at,
           u.id AS other_id, u.display_name,
           s.avatar AS avatar, av.id AS avatar_id, av.version AS avatar_version
    FROM friendships f
    JOIN users u
      ON u.id = (CASE WHEN f.requester_id = ${userId} THEN f.addressee_id ELSE f.requester_id END)
    LEFT JOIN user_settings s ON s.user_id = u.id
    LEFT JOIN user_avatars av ON av.user_id = u.id
    WHERE (f.requester_id = ${userId} OR f.addressee_id = ${userId})
      AND f.status IN ('accepted', 'pending')
    ORDER BY f.updated_at DESC`;

  const out: FriendLists = { friends: [], incoming: [], outgoing: [] };
  for (const r of rows) {
    const kind: FriendKind = r.status === 'accepted'
      ? 'accepted'
      : String(r.addressee_id) === userId ? 'incoming' : 'outgoing';
    const summary: FriendSummary = {
      userId: String(r.other_id),
      displayName: r.display_name == null ? null : String(r.display_name),
      avatar: r.avatar == null ? null : String(r.avatar),
      avatarImageUrl: r.avatar_id ? avatarImageUrlPath(String(r.avatar_id), Number(r.avatar_version)) : null,
      kind,
      since: new Date(r.updated_at as string | number | Date).toISOString(),
    };
    (kind === 'accepted' ? out.friends : kind === 'incoming' ? out.incoming : out.outgoing).push(summary);
  }
  return out;
}
