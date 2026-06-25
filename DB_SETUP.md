# Database Setup — Stage 1 (Postgres optional)

This is **Stage 1** of [`ARCHITECTURE_DB_AUTH.md`](./ARCHITECTURE_DB_AUTH.md):
add a Postgres + Drizzle foundation **without changing gameplay, protocol, UI,
or the default file-based persistence**. Postgres is **opt-in**.

The `rooms` table also carries a **`game_type`** column (default `'king'`) from
the very first migration. This is the **multi-game foundation** (see
ARCHITECTURE_DB_AUTH.md §2.0): the same site/app can host other card games later
without re-architecting identity or re-migrating rooms. Identity/profile/auth
(later stages) stay **game-agnostic**; only gameplay rows are `game_type`-tagged.

## TL;DR

- **No `DATABASE_URL`** → nothing changes. Rooms persist to `.data/rooms.json`
  (or memory), and `/health` reports `db: "disabled"`. This is the default and
  the current Render/MVP behaviour.
- **`DATABASE_URL` set** → the server can talk to Postgres. `/health` probes it
  and reports `db: "ok"` or `db: "error"`. Room persistence still uses the file
  store — switching it to Postgres is **Stage 2**, not Stage 1.

## What Stage 1 added

| Piece | File |
|---|---|
| Drizzle schema (`rooms` table, incl. `game_type`) | `server/db/schema.ts` |
| Lazy connection + health probe | `server/db/client.ts` |
| `PgRoomStorage` (wired via `ROOM_STORAGE=pg` in Stage 2) | `server/db/pgRoomStorage.ts` |
| Pure row ↔ room mapping (unit-tested) | `src/net/pgRoomRow.ts` |
| SQL migration | `server/db/migrations/0000_init.sql` |
| Migration runner | `server/db/migrate.ts` |
| drizzle-kit config | `drizzle.config.ts` |
| Env example | `.env.example` (`DATABASE_URL`) |

The connection driver (`postgres`) and drizzle are imported **dynamically**, so
when `DATABASE_URL` is unset they are never loaded and the server starts exactly
as before.

## Enabling Postgres locally

1. Run a Postgres (Docker example):
   ```bash
   docker run --name king-pg -e POSTGRES_PASSWORD=king -e POSTGRES_DB=king \
     -p 5432:5432 -d postgres:16
   ```
2. Point the server at it and apply the schema:
   ```bash
   export DATABASE_URL=postgres://postgres:king@localhost:5432/king
   npm run db:migrate
   ```
3. Start the server and check health:
   ```bash
   DATABASE_URL=$DATABASE_URL npm run server
   curl localhost:3001/health
   # { "status":"ok", "db":"ok", "rooms":0, "uptime":1 }
   ```
   Without `DATABASE_URL` the same call returns `"db":"disabled"`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run db:migrate` | Apply `server/db/migrations/*.sql` (idempotent). Requires `DATABASE_URL`. |
| `npm run db:generate` | Author a new migration from `schema.ts` (drizzle-kit). |
| `npm run db:studio` | Browse the DB (drizzle-kit studio). |

## Tests

`src/net/pgRoomRow.test.ts` covers the room ↔ row mapping and round-trip with
**no database required** (runs under the normal `npm test`). The driver-backed
`PgRoomStorage` is a skeleton and is only exercised against a real `DATABASE_URL`
in later stages.

## Multi-game direction (foundation only in Stage 1)

Only the `rooms.game_type` column lands now. The rest is documented direction in
ARCHITECTURE_DB_AUTH.md, to be built in later stages:

- **Shared (game-agnostic):** `users`, `auth_accounts`, `sessions`,
  `user_settings`, `/api/profile`, `/api/settings`, `/api/games`.
- **Per-game (`game_type`-tagged):** `rooms`, `games`, `rounds`,
  `game_snapshots`/`game_events`, `user_game_settings`, `user_stats`, served
  under `/api/games/<type>/…` (e.g. `/api/games/king/stats`).
- **`ruleset_id`** (e.g. `king-v1`) versions the rules a game was played under so
  old games/stats stay interpretable when `KING_RULES.md` changes.

### Stats tables & JSONB versioning (Stage 5 / 5.2)

Migration `0003_game_stats.sql` adds `games`, `game_players`, `rounds`, and
`user_stats` (all `game_type`-tagged; `rounds` are **score-only** — no cards).
King-specific aggregates live **inside `user_stats.stats` (JSONB)**, versioned by
an internal `v` field (**`STATS_VERSION`**, `server/db/stats.ts`):

- **v1:** `{ totalScore, bestGameScore, modeBreakdown: { modeId: number } }`.
- **v2 (current):** adds `worstGameScore`, `trumpRoundsPlayed`,
  `negativeRoundsPlayed`, `surrenderedCount`, and a richer
  `modeBreakdown: { modeId: { rounds, totalScore } }`.

**No migration is needed to move v1 → v2** — the column already holds JSONB.
`readStats` upgrades v1 rows on read (missing fields default safely; legacy
per-mode `rounds` read as `0`). To backfill exact v2 numbers onto old rows,
call `rebuildUserStats(userId)` which recomputes from `games`/`game_players`/
`rounds`. The leaderboard reads the player **avatar** by joining the existing
`user_settings` table (no avatar snapshot column).

### Auth accounts & guest merge (Stage 6)

`auth_accounts` (from `0002`, extended by `0004_auth_accounts_profile.sql` with
`name_at_provider`/`picture_at_provider`) links a `(provider, provider_account_id)`
to a shared `users` row. The `users` table stays game-agnostic — a Google login
just adds a row pointing at a user; we store the stable `sub` + email/name/picture
basics and **never** Google access/refresh tokens.

On sign-in: a **first-time** Google login for a guest **promotes that user in
place** (no data movement). A **returning** Google account triggers a
**transactional merge** (`server/db/merge.ts`) that folds the guest's settings,
per-game settings, and `user_stats` (combined **per `game_type`**) into the
account, repoints `game_players`/`winner_user_id`, revokes the guest's sessions,
and retires the guest row (`status='merged'`, `guest_key` freed). The merge is
**idempotent** (only folds a live guest) so a replayed callback never duplicates
stats. No migration is needed for the merge itself.

## Stage 2 — Postgres room storage (opt-in)

Stage 2 lets the server persist rooms to Postgres through the existing
`RoomStorage` seam, selected by env. **Default behaviour is unchanged** — with
`ROOM_STORAGE` unset (or `=file`) rooms still go to `.data/rooms.json`.

### Enable Postgres storage

```bash
# 1) migrate once (idempotent; NOT run automatically on server start)
DATABASE_URL=postgres://user:pass@localhost:5432/king npm run db:migrate

# 2) start the server in pg mode
ROOM_STORAGE=pg DATABASE_URL=postgres://user:pass@localhost:5432/king npm run server
```

On boot you'll see `[King] room storage: postgres` and `/health` reports
`"db":"ok"`. Create/join/play/reconnect and TTL cleanup all work as before; rooms
survive a restart (preloaded from Postgres at startup).

### Roll back to file storage

Unset `ROOM_STORAGE` (or set `ROOM_STORAGE=file`) and restart. The file and
Postgres stores are independent — no data migration is needed to switch back
(rooms created in one store are not visible in the other).

### How the selector behaves

| `ROOM_STORAGE` | `DATABASE_URL` | Result |
|---|---|---|
| unset / `file` | any | File store (`.data/rooms.json`) — default |
| `memory` | any | In-memory (no durability) |
| `pg` | set | Postgres room store |
| `pg` | **unset** | **Fail fast** with a clear error (no silent fallback) |

The selector logic (`src/net/storageConfig.ts`) is pure and unit-tested
(`storageConfig.test.ts`); the mapping is in `src/net/pgRoomRow.ts`
(`pgRoomRow.test.ts`). An optional end-to-end check against a real database runs
only when `TEST_DATABASE_URL` is set:

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
# runs src/net/pgRoomStorage.integration.test.ts (skipped otherwise)
```

### Stage 2 limits (still deferred)

- **Rooms only.** No users/auth/profiles/stats (Stages 3–5).
- Reconnect tokens / password hash live **inside the JSONB payload** as today;
  hashing reconnect tokens and `ruleset_id`/`status`/normalised member columns
  are later-stage work.
- Single-instance. Multi-instance fan-out (Redis) is Stage 7.

## Stage 3 — user profile/settings foundation (no auth yet)

Stage 3 adds the **DB-backed user profile/settings foundation** — schema +
validation + a repository layer. It does **not** add Google OAuth, sessions, an
HTTP API, or any client change. Guest mode, local pass-and-play, and the
existing localStorage prefs are untouched.

What landed (opt-in, only meaningful with Postgres):

| Piece | File |
|---|---|
| Migration (`users`, `user_settings`, `user_game_settings`) | `server/db/migrations/0001_users.sql` |
| Drizzle tables | `server/db/schema.ts` |
| Pure validation/sanitisation | `src/net/userSettings.ts` (+ `userSettings.test.ts`) |
| Repository (lazy guest, settings CRUD) | `server/db/users.ts` |
| Optional integration test | `src/net/users.integration.test.ts` |

**Identity is game-agnostic.** `users` + global `user_settings` (lang, avatar,
card_style) are shared across all games; King-specific prefs (e.g. `defaultTimer`)
live in `user_game_settings` keyed by `game_type`. Display name lives on `users`.

**Guests, no auth.** A guest is a `users` row with `is_guest=true`, found via
`guest_key` — a device handle from the client's localStorage, used purely as a
lookup key (it is **not** a credential; there is no login in Stage 3). The
repository's `getOrCreateGuest(guestKey)` creates one lazily.

**Apply the schema** (adds the new tables alongside `rooms`):

```bash
DATABASE_URL=postgres://… npm run db:migrate   # applies 0000_init + 0001_users
```

**Client is unchanged.** localStorage stays the source of truth for prefs. When
auth/sessions arrive (Stage 4), the API will be wired to the repository and the
client can sync settings for a logged-in/guest user; until then nothing reads or
writes these tables in the running server.

Validate without a DB via `npm test` (pure validators) or, against a real
Postgres, with the gated integration test:

```bash
TEST_DATABASE_URL=postgres://… npm test   # runs users.integration.test.ts too
```

### Stage 3 limits (deferred)

- **No HTTP API / no Express.** The repository exists; routes come in Stage 4
  (attached to a session). See ARCHITECTURE_DB_AUTH.md §1.7/§3.
- **No Google OAuth / sessions** (Stage 4).
- **No stats** (Stage 5). `email`/`email_verified`/`status`/`deleted_at` columns
  exist as forward-compat but are unused in Stage 3.

## Stage 4 — sessions + profile/settings API + guest bridge (no auth wall)

Stage 4 wires the Stage 3 repository to an HTTP API, adds **DB-backed sessions**,
and a **guest identity bridge** — all **opt-in** and behind `DATABASE_URL`. The
server, lobby, local pass-and-play, and online guest rooms keep working with **no
database** (every `/api/*` route returns a clean 503).

What landed:

| Piece | File |
|---|---|
| Migration (`sessions`, `auth_accounts`) | `server/db/migrations/0002_sessions_auth.sql` |
| Drizzle tables | `server/db/schema.ts` (`sessions`, `authAccounts`) |
| Session repository (create/find/revoke) | `server/db/sessions.ts` |
| Session token hash/verify + TTL (node:crypto) | `server/sessionTokens.ts` |
| Pure cookie/CSRF helpers | `src/net/cookies.ts` (+ `cookies.test.ts`) |
| HTTP API (routes + 503-when-disabled) | `server/api.ts` (+ `apiDisabled.test.ts`) |
| Client API adaptor + soft sync | `src/net/profileApi.ts`, `src/ui/AccountPanel.tsx` |

**Apply the schema** (adds `sessions` + `auth_accounts` alongside the earlier
tables; idempotent):

```bash
DATABASE_URL=postgres://… npm run db:migrate   # applies 0000 + 0001 + 0002
```

**API surface** (all JSON; share the WS server's port — no second service):

| Method + path | Auth | Purpose |
|---|---|---|
| `GET /api/me` | optional | current identity + global settings (anonymous if no session) |
| `POST /api/guest-session` | — | create/reuse a guest user (by device handle) + set session cookie |
| `POST /api/logout` | optional | revoke the session + clear the cookie |
| `PATCH /api/profile` | session | update display name |
| `GET/PATCH /api/settings` | session | global settings (lang/avatar/cardStyle) |
| `GET/PATCH /api/games/king/settings` | session | King per-game prefs (e.g. defaultTimer) |
| `GET /auth/google/start` · `/callback` | — | OAuth scaffold — 503 `oauth_disabled` until set up |

**Sessions are DB-backed and revocable.** The browser holds an opaque token in an
**httpOnly** cookie; the DB stores only `SHA-256(token + SESSION_SECRET)` (never
plaintext), with `expires_at`/`revoked_at`. Logout/revoke works (a stateless JWT
can't be revoked). Set `SESSION_SECRET` in production (see `.env.example`).

**Guests, still no auth.** `POST /api/guest-session` calls `getOrCreateGuest`
keyed by the client's **public device handle** (`king.guest.v1` in localStorage —
a lookup key, **not** a credential) and issues a session. Login remains an
upgrade, never a gate.

**Client stays localStorage-first.** `AccountPanel` (an optional area in the start
menu) hydrates from `/api/me` when reachable and writes through on change; if the
API is down or DB-disabled it silently uses localStorage prefs exactly as before.

Validate without a DB via `npm test` (pure helpers + API-disabled path) or,
against a real Postgres, with the gated integration test:

```bash
TEST_DATABASE_URL=postgres://… npm test   # runs sessions.integration.test.ts too
```

### Stage 4 limits (deferred to a next substage)

- **No full Google OAuth yet.** Routes exist but return 503 until
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` + the Authorization-Code/PKCE flow +
  ID-token validation + `auth_accounts` upsert are implemented.
- **No `/api/games` catalog** (`game_catalog`/`rulesets`) yet (Stage 5 area).
- **No guest→account claim/merge** yet; **WS still identifies players by
  `clientId`+`reconnectToken`** (auth only *names* a player).

## Not in Stage 4 (later stages)

- Full Google login + guest→account merge, `/api/games` catalog seed.
- Stats tables + `game_catalog` (Stage 5).
- Normalised `room_members`/`games`/`rounds` tables (the room payload stays a
  single JSONB blob).
