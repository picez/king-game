// ---------------------------------------------------------------------------
// User profile / settings repository (Stage 3; opt-in foundation).
//
// DB-backed reads/writes for profiles and settings. NOT wired to any HTTP route
// or the game server yet — the API is deferred to Stage 4 (when sessions exist
// to attach it to). For now this is the foundation the future /api/profile,
// /api/settings, /api/games/<type>/settings endpoints will call, and it is
// exercised by the optional integration test (src/net/users.integration.test.ts).
//
// All functions require Postgres (DATABASE_URL); they throw a clear error if it
// is not configured, since this layer is only meaningful with a database. None
// of the running server's existing paths call into here, so guest play, local
// pass-and-play, and file/memory storage are completely unaffected.
// ---------------------------------------------------------------------------

import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users, userSettings, userGameSettings } from './schema';
import { getDb } from './client';
import {
  sanitizeGlobalSettings, sanitizeDisplayName, sanitizeGameSettings,
  DEFAULT_LANG, DEFAULT_CARD_STYLE, DEFAULT_ANIMATION_PREF, DEFAULT_FAVORITE_GAME,
  DEFAULT_CARD_FACE_THEME,
  type GlobalSettings,
} from '../../src/net/userSettings';

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) {
    throw new Error(
      'users repository requires DATABASE_URL (Postgres). It is opt-in — only ' +
      'call it when a database is configured.',
    );
  }
  return conn.db as PostgresJsDatabase;
}

export interface UserRecord {
  id: string;
  guestKey: string | null;
  displayName: string | null;
  isGuest: boolean;
}

export interface UserProfile extends UserRecord {
  settings: GlobalSettings;
}

function toUserRecord(row: typeof users.$inferSelect): UserRecord {
  return { id: row.id, guestKey: row.guestKey, displayName: row.displayName, isGuest: row.isGuest };
}

/**
 * Finds the guest by its device handle, or lazily creates one (is_guest=true)
 * plus a default settings row. Race-safe via ON CONFLICT on the unique guest_key.
 * `guestKey` is a lookup key from the client's localStorage, NOT a credential —
 * there is no auth in Stage 3.
 */
export async function getOrCreateGuest(guestKey: string): Promise<UserRecord> {
  const db = await database();
  const inserted = await db.insert(users)
    .values({ guestKey, isGuest: true })
    .onConflictDoNothing({ target: users.guestKey })
    .returning();
  if (inserted.length) {
    await db.insert(userSettings).values({ userId: inserted[0].id }).onConflictDoNothing();
    return toUserRecord(inserted[0]);
  }
  // Lost the insert race (or already existed) — read the existing row.
  const existing = await db.select().from(users).where(eq(users.guestKey, guestKey)).limit(1);
  return toUserRecord(existing[0]);
}

/** Full profile (identity + global settings), or null if the user is gone. */
export async function getProfile(userId: string): Promise<UserProfile | null> {
  const db = await database();
  const u = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!u) return null;
  const s = (await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1))[0];
  return {
    ...toUserRecord(u),
    settings: {
      lang: (s?.lang as GlobalSettings['lang']) ?? DEFAULT_LANG,
      avatar: s?.avatar ?? null,
      cardStyle: (s?.cardStyle as GlobalSettings['cardStyle']) ?? DEFAULT_CARD_STYLE,
      animationPreference:
        (s?.animationPreference as GlobalSettings['animationPreference']) ?? DEFAULT_ANIMATION_PREF,
      favoriteGame: (s?.favoriteGame as GlobalSettings['favoriteGame']) ?? DEFAULT_FAVORITE_GAME,
      cardFaceTheme: (s?.cardFaceTheme as GlobalSettings['cardFaceTheme']) ?? DEFAULT_CARD_FACE_THEME,
    },
  };
}

/** Sets the display name (trimmed/capped/sanitised). Returns the stored value. */
export async function updateDisplayName(userId: string, name: unknown): Promise<string | null> {
  const db = await database();
  const clean = sanitizeDisplayName(name);
  await db.update(users).set({ displayName: clean, updatedAt: new Date() }).where(eq(users.id, userId));
  return clean;
}

/**
 * Merges a partial patch into the user's global settings, validates, and upserts.
 * Returns the resulting fully-valid settings.
 */
export async function upsertGlobalSettings(
  userId: string,
  patch: Partial<GlobalSettings>,
): Promise<GlobalSettings> {
  const db = await database();
  const cur = (await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1))[0];
  const merged = {
    lang: patch.lang ?? cur?.lang,
    avatar: 'avatar' in patch ? patch.avatar : cur?.avatar,
    cardStyle: patch.cardStyle ?? cur?.cardStyle,
    animationPreference: patch.animationPreference ?? cur?.animationPreference,
    favoriteGame: patch.favoriteGame ?? cur?.favoriteGame,
    cardFaceTheme: patch.cardFaceTheme ?? cur?.cardFaceTheme,
  };
  const clean = sanitizeGlobalSettings(merged);
  const cols = {
    lang: clean.lang, avatar: clean.avatar, cardStyle: clean.cardStyle,
    animationPreference: clean.animationPreference, favoriteGame: clean.favoriteGame,
    cardFaceTheme: clean.cardFaceTheme, updatedAt: new Date(),
  };
  await db.insert(userSettings).values({ userId, ...cols }).onConflictDoUpdate({
    target: userSettings.userId,
    set: cols,
  });
  return clean;
}

/** Reads validated per-game settings for (user, gameType). */
export async function getGameSettings(userId: string, gameType: string): Promise<Record<string, unknown>> {
  const db = await database();
  const row = (await db.select().from(userGameSettings)
    .where(and(eq(userGameSettings.userId, userId), eq(userGameSettings.gameType, gameType)))
    .limit(1))[0];
  return sanitizeGameSettings(gameType, row?.settings ?? {});
}

/** Merges + validates + upserts per-game settings; returns the stored object. */
export async function upsertGameSettings(
  userId: string,
  gameType: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = await database();
  const row = (await db.select().from(userGameSettings)
    .where(and(eq(userGameSettings.userId, userId), eq(userGameSettings.gameType, gameType)))
    .limit(1))[0];
  const merged = { ...(row?.settings ?? {}), ...patch };
  const clean = sanitizeGameSettings(gameType, merged);
  await db.insert(userGameSettings).values({ userId, gameType, settings: clean, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [userGameSettings.userId, userGameSettings.gameType],
      set: { settings: clean, updatedAt: new Date() },
    });
  return clean;
}

// ── Stage 6: account promotion / creation (Google sign-in) ──────────────────

export interface ProviderProfile {
  email: string | null;
  name: string | null;
  emailVerified: boolean;
}

/**
 * Promotes a guest user IN PLACE into a real account on first Google sign-in
 * (the safest path: zero data movement — same user row keeps its settings/stats).
 * Sets `is_guest=false` + email; fills the display name from Google ONLY when the
 * guest had none (never clobbers a custom name). The `guest_key` is left intact
 * so the same device keeps resolving to this (now real) user.
 */
export async function promoteGuestToAccount(userId: string, p: ProviderProfile): Promise<void> {
  const db = await database();
  const cur = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  const displayName = cur?.displayName && cur.displayName.trim()
    ? cur.displayName
    : sanitizeDisplayName(p.name);
  await db.update(users).set({
    isGuest: false,
    email: p.email,
    emailVerified: p.emailVerified,
    displayName,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
}

/** Creates a fresh (non-guest) account user + default settings row; returns its id. */
export async function createAccountUser(p: ProviderProfile): Promise<string> {
  const db = await database();
  const inserted = await db.insert(users).values({
    isGuest: false,
    email: p.email,
    emailVerified: p.emailVerified,
    displayName: sanitizeDisplayName(p.name),
  }).returning({ id: users.id });
  const id = inserted[0].id;
  await db.insert(userSettings).values({ userId: id }).onConflictDoNothing();
  return id;
}
