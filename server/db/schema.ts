// ---------------------------------------------------------------------------
// Drizzle schema — Stage 1 (Postgres is OPTIONAL).
//
// Only the `rooms` table exists yet: it mirrors the file store, holding the full
// PersistedRoom as JSONB plus a few denormalised columns for indexing/TTL. The
// normalised tables from ARCHITECTURE_DB_AUTH.md (users/auth/members/games/
// rounds/snapshots) land in later stages.
//
// This module imports drizzle's pg-core, so it is only ever loaded on a DB code
// path (PgRoomStorage / migrate). When DATABASE_URL is unset, nothing here is
// imported and the server runs on file/memory storage exactly as before.
// ---------------------------------------------------------------------------

import { pgTable, text, integer, boolean, jsonb, timestamp, uuid, primaryKey, unique } from 'drizzle-orm/pg-core';
import type { PersistedRoom } from '../../src/net/serverCore';

export const rooms = pgTable('rooms', {
  /** 4-char room code (matches the in-memory/file key). */
  code: text('code').primaryKey(),
  /**
   * Which card game this room belongs to (multi-game foundation). King is the
   * only game today, so this defaults to 'king'. Added early — while the
   * migration is fresh — so a future second game needs no backfill. See
   * ARCHITECTURE_DB_AUTH.md §2.0.
   */
  gameType: text('game_type').notNull().default('king'),
  /** Denormalised for cheap filtering; source of truth is `data`. */
  playerCount: integer('player_count').notNull(),
  started: boolean('started').notNull().default(false),
  /** Authoritative room payload — same JSON the file store writes. */
  data: jsonb('data').$type<PersistedRoom>().notNull(),
  /** Mirrors PersistedRoom.updatedAt; used for TTL sweeps. */
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type RoomsTable = typeof rooms;

// ---------------------------------------------------------------------------
// Stage 3 — user profiles & settings (DB-backed foundation; opt-in).
//
// Identity is game-agnostic: `users` + global `user_settings`. Per-game prefs
// (e.g. King's default timer) live in `user_game_settings`, keyed by game_type,
// so adding a game never migrates the shared settings. No auth/OAuth yet — a
// guest is a `users` row with is_guest=true, found via `guest_key` (a device
// handle from the client's localStorage; a lookup key, NOT a credential).
// These tables are unused by the running server until a later stage wires the
// API; for now they back the repository in server/db/users.ts.
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stable per-device guest handle (null for future real accounts). Unique. */
  guestKey: text('guest_key').unique(),
  displayName: text('display_name'),
  isGuest: boolean('is_guest').notNull().default(false),
  /** Reserved for Stage 4 auth; unused in Stage 3. */
  email: text('email'),
  emailVerified: boolean('email_verified').notNull().default(false),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete tombstone (GDPR flow, later stages). */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  lang: text('lang').notNull().default('en'),
  /** Whitelisted emoji id or null (client derives a default when null). */
  avatar: text('avatar'),
  cardStyle: text('card_style').notNull().default('classic'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const userGameSettings = pgTable('user_game_settings', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  gameType: text('game_type').notNull(),
  /** Game-specific settings, validated per game_type (e.g. King: defaultTimer). */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.gameType] }),
}));

export type UsersTable = typeof users;
export type UserSettingsTable = typeof userSettings;
export type UserGameSettingsTable = typeof userGameSettings;

// ---------------------------------------------------------------------------
// Stage 4 — sessions & external auth accounts (DB-backed; opt-in).
//
// Both are game-agnostic identity tables (no game_type). A session is the source
// of truth for a login/device: we store only the HASH of the cookie token, so a
// DB dump can't be replayed (ARCHITECTURE_DB_AUTH.md §2.3/§5). `auth_accounts`
// is the seam for Google/Apple login — it exists now (forward-compat) but is
// unused until OAuth lands; a guest needs no auth_accounts row.
// ---------------------------------------------------------------------------

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** SHA-256(token + SESSION_SECRET) — never the plaintext token. Unique. */
  tokenHash: text('token_hash').notNull().unique(),
  /** 'web_cookie' today; 'mobile_refresh' reserved for later (Stage 6). */
  kind: text('kind').notNull().default('web_cookie'),
  /** Coarse fingerprints for security review (optional, minimised). */
  userAgent: text('user_agent'),
  ipHash: text('ip_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  /** Set on logout/revoke; a revoked session is rejected even before expiry. */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const authAccounts = pgTable('auth_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'google' | 'apple' | … */
  provider: text('provider').notNull(),
  /** The provider's stable subject id (`sub`). Unique per provider. */
  providerAccountId: text('provider_account_id').notNull(),
  emailAtProvider: text('email_at_provider'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerAccount: unique('auth_accounts_provider_account_uq').on(t.provider, t.providerAccountId),
}));

export type SessionsTable = typeof sessions;
export type AuthAccountsTable = typeof authAccounts;
