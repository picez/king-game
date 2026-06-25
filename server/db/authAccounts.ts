// ---------------------------------------------------------------------------
// External auth accounts repository (Stage 6 — Google sign-in).
//
// One row per (provider, provider_account_id) linked to a shared `users` row.
// The users table stays game-agnostic and is NEVER provider-specific: a Google
// login just adds an `auth_accounts` row pointing at a user (a promoted guest or
// a fresh account). We store only the stable `sub` + login-only profile basics
// (email/name/picture) — never Google access/refresh tokens.
//
// Requires Postgres (DATABASE_URL); imported dynamically by the API layer.
// ---------------------------------------------------------------------------

import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { authAccounts } from './schema';
import { getDb } from './client';

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('authAccounts repository requires DATABASE_URL (Postgres).');
  return conn.db as PostgresJsDatabase;
}

export interface ProviderIdentity {
  provider: string;            // 'google'
  providerAccountId: string;   // stable `sub`
  email: string | null;
  name: string | null;
  picture: string | null;
}

/** Finds the user linked to a provider account, or null. */
export async function findUserByProviderAccount(provider: string, providerAccountId: string): Promise<string | null> {
  const db = await database();
  const row = (await db.select({ userId: authAccounts.userId }).from(authAccounts)
    .where(and(eq(authAccounts.provider, provider), eq(authAccounts.providerAccountId, providerAccountId)))
    .limit(1))[0];
  return row?.userId ?? null;
}

/**
 * Links (or refreshes) a provider account to a user. Idempotent: re-linking the
 * same (provider, account) updates the profile snapshot rather than duplicating.
 */
export async function linkProviderAccount(userId: string, id: ProviderIdentity): Promise<void> {
  const db = await database();
  const now = new Date();
  await db.insert(authAccounts).values({
    userId,
    provider: id.provider,
    providerAccountId: id.providerAccountId,
    emailAtProvider: id.email,
    nameAtProvider: id.name,
    pictureAtProvider: id.picture,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [authAccounts.provider, authAccounts.providerAccountId],
    set: { emailAtProvider: id.email, nameAtProvider: id.name, pictureAtProvider: id.picture, updatedAt: now },
  });
}

export interface AccountSummary {
  provider: string;
  email: string | null;
  picture: string | null;
}

/** The first linked provider account for a user (for /api/me), or null. */
export async function getAccountForUser(userId: string): Promise<AccountSummary | null> {
  const db = await database();
  const row = (await db.select({
    provider: authAccounts.provider,
    email: authAccounts.emailAtProvider,
    picture: authAccounts.pictureAtProvider,
  }).from(authAccounts).where(eq(authAccounts.userId, userId)).limit(1))[0];
  return row ? { provider: row.provider, email: row.email, picture: row.picture } : null;
}
