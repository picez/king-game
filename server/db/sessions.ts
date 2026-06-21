// ---------------------------------------------------------------------------
// Session repository (Stage 4; opt-in, DB-backed).
//
// DB-backed sessions are the source of truth for a login/device, so we can
// logout/revoke (a stateless JWT can't be revoked). We store only the token
// HASH (server/sessionTokens.ts computes it). All functions require Postgres
// (DATABASE_URL) and are imported DYNAMICALLY by the API layer, so a no-DB
// server never loads the driver. Nothing here touches gameplay.
// ---------------------------------------------------------------------------

import { eq, and, gt, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sessions } from './schema';
import { getDb } from './client';

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) {
    throw new Error('sessions repository requires DATABASE_URL (Postgres). It is opt-in.');
  }
  return conn.db as PostgresJsDatabase;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
}

/**
 * Creates a session row for a user. `tokenHash` is the peppered SHA-256 of the
 * cookie token (never the plaintext). Returns the new session id.
 */
export async function createSession(input: {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipHash?: string | null;
}): Promise<string> {
  const db = await database();
  const rows = await db.insert(sessions).values({
    userId: input.userId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    userAgent: input.userAgent ?? null,
    ipHash: input.ipHash ?? null,
  }).returning({ id: sessions.id });
  return rows[0].id;
}

/**
 * Resolves a presented token hash to a LIVE session: not expired, not revoked.
 * Returns null otherwise. Bumps last_seen_at (sliding activity) on a hit.
 */
export async function findValidSession(tokenHash: string, now: Date): Promise<SessionRecord | null> {
  const db = await database();
  const row = (await db.select({
    id: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt,
  }).from(sessions).where(and(
    eq(sessions.tokenHash, tokenHash),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, now),
  )).limit(1))[0];
  if (!row) return null;
  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.id));
  return { id: row.id, userId: row.userId, expiresAt: row.expiresAt };
}

/** Revokes the session for a token hash (logout). Idempotent. */
export async function revokeSession(tokenHash: string, now: Date): Promise<void> {
  const db = await database();
  await db.update(sessions).set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}
