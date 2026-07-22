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

import { pgTable, text, integer, boolean, jsonb, timestamp, uuid, primaryKey, unique, customType, bigint, date } from 'drizzle-orm/pg-core';
import type { PersistedRoom } from '../../src/net/serverCore';

/** Postgres `bytea` column (Node Buffer <-> bytea), for the processed avatar blob. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType() { return 'bytea'; } });

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
  /** Animation intensity (Stage 13.2): system|full|reduced|off. Purely visual. */
  animationPreference: text('animation_preference').notNull().default('system'),
  /** Favorite game (Stage 13.3): king|durak|deberc|tarneeb. Pre-selects the picker. */
  favoriteGame: text('favorite_game').notNull().default('king'),
  /** Card face theme (Stage 13.5): classic|clean. Purely visual. */
  cardFaceTheme: text('card_face_theme').notNull().default('classic'),
  /**
   * Uploaded-avatar fast-flag (Stage 17.1): 0 = none, else the current version.
   * Denormalised mirror of user_avatars.version; the blob lives in user_avatars.
   * Managed only by the avatar repository — NOT part of the settings sanitize path.
   */
  avatarImageVersion: integer('avatar_image_version').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Stage 17.1 — server-synced custom avatar (HIDDEN backend; no UI/WS wiring).
//
// Stores ONLY the server-PROCESSED WebP (192x192, metadata stripped) — never the
// raw upload, never a filename, never a remote URL. `id` is the OPAQUE public id
// used in /api/avatar/<id>.webp (not the userId). One row per user (unique user_id);
// a replace overwrites the row and bumps `version` so the served URL cache-busts.
// Emoji avatar (user_settings.avatar) stays the fallback + the WS-room identity.
// See AVATAR_UPLOAD_PLAN.md.
// ---------------------------------------------------------------------------

export const userAvatars = pgTable('user_avatars', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  mimeType: text('mime_type').notNull(),
  bytes: bytea('bytes').notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserAvatarsTable = typeof userAvatars;

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
  /** Provider-reported display name / picture URL snapshot (Stage 6). */
  nameAtProvider: text('name_at_provider'),
  pictureAtProvider: text('picture_at_provider'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerAccount: unique('auth_accounts_provider_account_uq').on(t.provider, t.providerAccountId),
}));

export type SessionsTable = typeof sessions;
export type AuthAccountsTable = typeof authAccounts;

// ---------------------------------------------------------------------------
// Stage 5 — stats from completed games (DB-backed; opt-in, per game_type).
//
// On `game_finished` the server lifts the score-only history into durable rows:
// `games` (one finished match) → `game_players` (seat → identity) → `rounds`
// (RoundRecord, score-only). `user_stats` is a per-(user, game_type) cache,
// recomputed on finish and rebuildable by replaying `rounds`. All are tagged
// with `game_type` so a second game never mixes scores. NO private state lives
// here (no hands/discard/kitty) — only scores, exactly as KING_RULES.md mandates
// for the score tracker.
//
// Decoupled from room storage on purpose: `games.room_code` is a plain column
// (NO foreign key to `rooms`), so stats record even when ROOM_STORAGE=file while
// DATABASE_URL is set. `game_key` makes recording idempotent (reconnect/restart
// can't double-count). See ARCHITECTURE_DB_AUTH.md §2.7–§2.10.
// ---------------------------------------------------------------------------

export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * Deterministic per-game identity (room code + final score fingerprint). A
   * unique key so a finished game is recorded at most once — reconnect, restart,
   * or a duplicate trigger all no-op via ON CONFLICT.
   */
  gameKey: text('game_key').notNull().unique(),
  /** Plain column (no FK to rooms): stats are storage-backend independent. */
  roomCode: text('room_code'),
  gameType: text('game_type').notNull().default('king'),
  rulesetId: text('ruleset_id').notNull().default('king-v1'),
  playerCount: integer('player_count').notNull(),
  status: text('status').notNull().default('finished'),
  /** Sole winner (highest total) or null on a tie / no human winner. */
  winnerUserId: uuid('winner_user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Game-specific outcome summary (winners, totals) — public, score-only. */
  result: jsonb('result').$type<Record<string, unknown>>(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
});

export const gamePlayers = pgTable('game_players', {
  gameId: uuid('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  seatIndex: integer('seat_index').notNull(),
  /** Engine id (`player-0`…) used in roundHistory. */
  playerId: text('player_id').notNull(),
  /** Null for bots; anonymised (set null) on GDPR user delete. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  avatar: text('avatar'),
  type: text('type').notNull(),
  finalTotal: integer('final_total').notNull(),
  isWinner: boolean('is_winner').notNull().default(false),
}, (t) => ({
  pk: primaryKey({ columns: [t.gameId, t.seatIndex] }),
}));

export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: uuid('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  gameType: text('game_type').notNull().default('king'),
  roundIndex: integer('round_index').notNull(),
  /** Generic round label — King: a GameModeId (e.g. no_hearts/trump). */
  modeId: text('mode_id'),
  dealerPlayerId: text('dealer_player_id'),
  trumpOccurrence: integer('trump_occurrence').notNull().default(0),
  /** Score-only: { "player-0": -5, … }. Never holds cards. */
  scores: jsonb('scores').$type<Record<string, number>>().notNull(),
});

export const userStats = pgTable('user_stats', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  gameType: text('game_type').notNull(),
  gamesPlayed: integer('games_played').notNull().default(0),
  gamesWon: integer('games_won').notNull().default(0),
  gamesLost: integer('games_lost').notNull().default(0),
  roundsPlayed: integer('rounds_played').notNull().default(0),
  /** King-specific aggregates: { totalScore, bestGameScore, modeBreakdown }. */
  stats: jsonb('stats').$type<Record<string, unknown>>().notNull().default({}),
  lastPlayedAt: timestamp('last_played_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.gameType] }),
}));

export type GamesTable = typeof games;
export type GamePlayersTable = typeof gamePlayers;
export type RoundsTable = typeof rounds;
export type UserStatsTable = typeof userStats;

// ---------------------------------------------------------------------------
// Stage 37.7 — Poker chip wallet + append-only ledger (bankroll economy; opt-in).
//
// `poker_wallets` is a per-user chip balance + the last daily-claim UTC date. The
// balance is server-authoritative BIGINT and can never go negative (DB CHECK).
// `poker_ledger` is IMMUTABLE — one row per balance change (daily claim / table
// buy-in / payout / cancel refund), each with a UNIQUE `idempotencyKey` so a
// concurrent double claim, a duplicate START_GAME, or a rebroadcast finish can
// never double-credit/-debit. LOCAL free-play Poker never touches these tables.
// See migration 0010 + POKER_RULES.md (economy).
// ---------------------------------------------------------------------------

export const pokerWallets = pgTable('poker_wallets', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  /** Authoritative chip balance (never negative). `mode: 'number'` — values stay safe integers. */
  balance: bigint('balance', { mode: 'number' }).notNull().default(0),
  /** UTC calendar date of the last successful daily claim (null = never). */
  lastClaimDate: date('last_claim_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const pokerLedger = pgTable('poker_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** daily_claim | table_buy_in | table_payout | table_cancel_refund */
  reason: text('reason').notNull(),
  /** Signed chip change applied by this entry. */
  delta: bigint('delta', { mode: 'number' }).notNull(),
  /** Balance after this entry (audit; never negative). */
  balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
  /** Unique per logical operation → idempotent economy (double-run no-ops). */
  idempotencyKey: text('idempotency_key').notNull().unique(),
  /** Optional economy-match reference + room code (audit). */
  matchId: text('match_id'),
  roomCode: text('room_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Stage 37.7.1 — per-match settlement gate. One row per economy match records the
 * single terminal outcome ('payout' | 'cancel_refund'). Claimed inside the settlement
 * transaction so payout and refund are MUTUALLY EXCLUSIVE across a crash/restart (the
 * per-user ledger keys differ, so only this shared PK can enforce it). See migration 0011.
 */
export const pokerMatchSettlements = pgTable('poker_match_settlements', {
  matchId: text('match_id').primaryKey(),
  /** payout | cancel_refund — the outcome that won the resolution gate. */
  outcome: text('outcome').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PokerWalletsTable = typeof pokerWallets;
export type PokerLedgerTable = typeof pokerLedger;
export type PokerMatchSettlementsTable = typeof pokerMatchSettlements;
