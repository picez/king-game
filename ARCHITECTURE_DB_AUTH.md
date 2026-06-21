# Architecture Proposal — Database, Profiles & Auth

> **Status:** Proposal only. No code is implemented by this document (except the
> Stage 1 `game_type` column noted in §2.0/§3 — already applied).
> **Scope:** Move from file-based persistence (`.data/rooms.json`) to a real
> database, add user profiles + settings + stats, add Google login first
> (Apple later), keep guest play and local pass-and-play intact, **and lay a
> multi-game foundation** so the same site/app can host other card games beyond
> King without re-architecting identity, rooms, or storage.
>
> **Multi-game in one line:** identity/profile/auth/settings are **game-agnostic
> and shared**; everything *gameplay* (rooms, games, rounds, events, stats) is
> tagged with a **`game_type`** (e.g. `'king'`) and a **`ruleset_id`/
> `rules_version`** (e.g. `'king-v1'`). King is just the first registered game.
>
> **Guiding constraints** (from `KING_RULES.md` and the existing design):
> - `KING_RULES.md` stays the **source of truth** for gameplay. The DB stores
>   authoritative state; it never re-derives rules.
> - The server stays **server-authoritative**. The DB is persistence, not a
>   second brain. The reducer (`gameReducer`) remains the only thing that
>   mutates game state.
> - **Privacy/redaction** is preserved end-to-end. Hands, the dealer's discard,
>   the kitty, and other players' collected cards stay hidden exactly as today.
>   We never persist a "flat" game that leaks private state to readers.
> - **Local & online compatibility.** Local pass-and-play and guest online play
>   must keep working with **no account and no DB dependency** on the client.

---

## 0. TL;DR Recommendation

| Decision | Choice | One-line reason |
|---|---|---|
| Server runtime | **Keep Node + `ws`, add a tiny HTTP layer** | We already have an `http.createServer`; only auth needs real routes. |
| HTTP framework | **Add minimal Express (or Hono)** *only for `/auth/*` + `/api/*`** | Raw `http` is painful for OAuth callbacks/cookies; keep WS untouched. |
| Database | **PostgreSQL** | Already the target; relational fits rooms/members/rounds/stats. |
| ORM | **Drizzle** | Lightweight, SQL-first, no engine binary — fits `tsx`/ESM/Render free. |
| Auth | **Google OAuth (Authorization Code + PKCE) → own session** | Apple Sign-In added later through the same `auth_accounts` seam. |
| Sessions | **DB-backed sessions; httpOnly cookie (web) + refresh JWT (mobile)** | One identity model serving both PWA and future native apps. |
| Guest mode | **First-class anonymous identity, optionally upgradable** | Guests never blocked by login; can "claim" their guest later. |
| Migration seam | **The existing `RoomStorage` interface** | Stage 2 is a drop-in `PgRoomStorage` — zero gameplay change. |
| Multi-game | **`game_type` + `ruleset_id` on all gameplay tables; shared identity** | Add new games without touching users/auth/sessions/profile. |
| API shape | **Namespaced: `/api/profile` (shared), `/api/games/<type>/…` (per-game)** | Mobile/web target one identity, many games. |

**Start here:** Stage 1 (DB provisioning + schema + `/health` DB check) and a
`PgRoomStorage` behind the existing interface. Stage 1 also adds the
`game_type` column to `rooms` now (default `'king'`) — see §2.0/§3 — because the
migration is early and the column is free. Nothing user-facing changes until
profiles land in Stage 3.

---

## 1. Backend Architecture

### 1.1 Does the Node server stay? Do we need a framework?

**Keep the Node + `ws` server.** It is already server-authoritative and already
runs an `http.createServer` that serves `/health`, the static `dist/`, and the
`/ws` upgrade (`server/index.ts`). The game loop, timers, redaction, and
reconnect logic are healthy and rule-correct — there is no reason to rewrite
them.

**Add a *minimal* HTTP framework, but only for new REST surface.** OAuth
callbacks, cookie signing, CSRF, and JSON `/api/*` endpoints are tedious and
error-prone on raw `http`. Two good options:

- **Express** — most familiar, huge ecosystem, trivial cookie/session
  middleware. Slightly heavier.
- **Hono** — tiny, fast, first-class TypeScript, great on edge/serverless and
  plain Node. Cleaner for a small API.

**Recommendation: Express** for lowest-friction integration on the *same* HTTP
server that already hosts the WS upgrade. We mount Express as the request
handler and keep `WebSocketServer({ server })` attached to the same
`http.Server`, so there is still **one port, one service** (important for the
Render free plan). Hono is a fine alternative if we want a smaller dependency.

> **Implementation note (Stage 4):** the API surface turned out small enough
> (six JSON routes + a guest/logout/OAuth scaffold) that we implemented it on the
> **raw `http.Server`** (`server/api.ts`) — a tiny router, cookie/CSRF helpers,
> and a JSON body reader — rather than adding Express. Same single port, zero new
> dependencies, fully reversible. If the surface grows (many routes, complex
> middleware), swapping in Express/Hono behind the same `handleApiRequest` seam is
> straightforward.

```
            ┌──────────────────────────────────────────┐
            │            http.Server (one port)         │
            │  ┌───────────────┐   ┌──────────────────┐ │
  HTTPS ───▶│  │ Express app   │   │ WebSocketServer  │ │◀── WSS upgrade (/ws)
            │  │ /auth/*       │   │ server-authoritative│
            │  │ /api/*        │   │ gameReducer + redact│
            │  │ /health       │   └─────────┬────────┘ │
            │  │ static dist/  │             │          │
            │  └───────┬───────┘             │          │
            └──────────┼───────────────────────┼─────────┘
                       │                       │
                       ▼                       ▼
                ┌──────────────────────────────────┐
                │            PostgreSQL             │
                │  users / auth / settings / stats  │
                │  rooms / members / rounds         │
                │  game_snapshots (authoritative)   │
                └──────────────────────────────────┘
```

### 1.2 Database: PostgreSQL

Confirmed. Relational model maps cleanly to rooms → members → games → rounds →
stats, and Postgres `JSONB` is ideal for the one genuinely document-shaped piece
(the authoritative `GameState` snapshot). Foreign keys + transactions give us
referential integrity for accounts, and `ON DELETE CASCADE` makes GDPR-style
account deletion a single statement.

### 1.3 ORM: Drizzle vs Prisma — decision

| Criterion | Prisma | Drizzle | Winner here |
|---|---|---|---|
| Runtime weight | Query engine binary (Rust) downloaded per platform; heavier cold start | Pure TS, thin wrapper over `pg`/`postgres.js` | **Drizzle** |
| `tsx` / ESM fit | Needs `prisma generate` codegen step; works but adds a build phase | No codegen; schema *is* TypeScript | **Drizzle** |
| Render free plan | Engine download + generate inflate build/deploy | `npm install` only; trivial | **Drizzle** |
| Type-safety | Excellent (generated client) | Excellent (inferred from schema) | Tie |
| Migrations | `prisma migrate` (very mature, great DX) | `drizzle-kit generate`/`migrate` (good, SQL-visible) | Prisma slightly ahead |
| Raw SQL / control | Possible but you fight the abstraction | SQL-first; raw SQL is natural | **Drizzle** |
| Studio/GUI | `prisma studio` (excellent) | `drizzle-studio` (good) | Prisma slightly ahead |
| Learning curve | Own schema language (`.prisma`) | Just TypeScript | **Drizzle** |

**Decision: Drizzle.**

Reasoning specific to *this* project:
- The repo already runs TypeScript directly via **`tsx`** with **ESM**, no build
  step for the server. Prisma's generate phase and engine binary cut against
  that grain; Drizzle adds nothing to the runtime.
- We are persistence-light: most "state" is a single authoritative JSONB blob
  plus a handful of normalized tables. We don't need Prisma's heavy relational
  query builder; we *do* want easy, explicit SQL for stats aggregation.
- Render free plan builds are time/space constrained — avoiding the Prisma
  engine download keeps deploys fast and predictable.

Prisma's only real edge is migration/Studio DX. `drizzle-kit` covers migrations
well and keeps the generated SQL reviewable in git, which suits a server-
authoritative game where we want to *see* exactly what changes.

> If the team strongly prefers Prisma's DX and accepts the heavier deploy, the
> data model below is ORM-agnostic and ports 1:1. The recommendation stands at
> Drizzle.

### 1.4 Auth: Google first, Apple later

**Flow: OAuth 2.0 Authorization Code with PKCE.**

1. Client hits `GET /auth/google` → server redirects to Google with PKCE
   challenge + `state` (CSRF) stored in a short-lived signed cookie.
2. Google redirects back to `GET /auth/google/callback?code&state`.
3. Server verifies `state`, exchanges `code` for tokens **server-side** using
   `GOOGLE_CLIENT_SECRET`, validates the Google **ID token** (issuer, audience,
   expiry, signature), and reads `sub` (stable Google user id), email,
   email_verified, name, picture.
4. Server upserts into `auth_accounts (provider='google', provider_account_id=sub)`,
   creating/linking a `users` row. **We never store Google access/refresh
   tokens** unless we later need Google APIs — for login we only need identity.
5. Server creates a **session** and sets an httpOnly, Secure, SameSite=Lax
   cookie (web). Done.

**Apple Sign-In (future)** plugs into the same `auth_accounts` table with
`provider='apple'`. Apple specifics handled then: client-secret is a signed JWT
(ES256, rotated), name/email only delivered on first consent, "Hide My Email"
relay addresses. No schema change required — the seam already exists.

### 1.5 Sessions / JWT strategy

We serve two clients with different ergonomics: a **web PWA** (cookies work
great) and a **future native app** (cookies are awkward; bearer tokens are
natural). Use a **hybrid, DB-backed** model:

- **Source of truth:** a `sessions` table (one row per active login/device),
  storing a hashed token, device label, created/last-seen, expiry, revoked flag.
  This gives us real **logout-everywhere** and per-device revocation — a plain
  stateless JWT can't be revoked.
- **Web (PWA):** session id delivered as an **httpOnly Secure cookie**
  (`SameSite=Lax`). Simple, XSS-resistant, CSRF-protected via `state`/double-
  submit on state-changing POSTs.
- **Mobile (future):** issue a **short-lived access JWT** (~15 min, signed with
  `SESSION_SECRET`) + a **refresh token** that maps to a `sessions` row. The app
  stores the refresh token in secure storage and rotates it. Revocation =
  delete/flag the session row.

**WebSocket auth:** the WS connection authenticates by reading the same session.
On `connect`/first message the client presents its identity:
- Web: the httpOnly cookie rides the WS upgrade automatically; server resolves
  the session → `userId` (or guest).
- Mobile: the client sends the access JWT in the connect payload.

The server attaches `{ userId | guestId }` to the socket session alongside the
existing `clientId`. **Crucially, room/seat authority still flows through the
existing `clientId` + `reconnectToken` mechanism** — auth only *names* the
player; it does not replace the seat/reconnect model. That keeps gameplay
untouched.

### 1.6 Guest mode compatibility (non-negotiable)

Guest play must keep working with **zero login**:

- Local pass-and-play: unchanged. No network, no DB, no identity. Period.
- Online guest: a player without a session gets an **ephemeral guest identity**.
  Two options, we pick **(b)**:
  - (a) pure in-memory clientId only (today's behavior) — fine, but stats can't
    follow them.
  - (b) **lightweight `users` row with `is_guest=true`**, created on first
    online action, keyed to the device via the existing localStorage handle.
    This lets a guest accumulate stats and *optionally* "claim" the guest
    account later by logging in with Google (we merge the guest `users` row into
    the authenticated one).

Guests never see a login wall. Login is an *upgrade*, surfaced as "Save your
progress", never a gate to play.

### 1.7 API surface & namespacing (mobile-ready, multi-game)

The REST/WS surface is split into **shared (identity)** vs **per-game**, so a
future native app authenticates once and plays many games:

- **Shared, game-agnostic:**
  - `/auth/*` — OAuth login/callback/logout (Stage 4+).
  - `/api/profile` — the user (display name, email state, account actions).
  - `/api/settings` — global settings (lang, avatar, card_style).
  - `/api/games` — the **catalog** of available games (from `game_catalog`):
    `[{ game_type, display_name, current_ruleset_id, player_counts }]`.
- **Per-game, namespaced under the type:**
  - `/api/games/king/...` — King-specific reads (e.g. `/rooms`, `/stats`,
    `/leaderboard`, `/settings`). A second game later lives at
    `/api/games/<type>/...` with the **same shape**.
  - WebSocket messages stay as today for King; when a second game arrives, the
    `CREATE_ROOM`/lobby messages carry a `gameType` field (defaulting to `king`
    for back-compat) and the server routes to the right reducer.

Rule of thumb: **if it's about *who you are*, it's shared (`/api/profile`,
`/api/settings`); if it's about *what you're playing*, it's under
`/api/games/<type>`.** This keeps auth/session/profile reusable verbatim for
every future game and every client (PWA, Android, iOS).

---

## 2. Data Model

### 2.0 Multi-game foundation (read first)

Two columns make the model multi-game without coupling identity to King:

- **`game_type` (text)** — which game a row belongs to, e.g. `'king'`. Present on
  **every gameplay table**: `rooms`, `games`, `rounds`, `game_events`/
  `game_snapshots`, `user_stats`, and `user_game_settings`. **Absent** from
  identity tables: `users`, `auth_accounts`, `sessions`, `user_settings`
  (global) — those are shared across all games.
- **`ruleset_id` / `rules_version` (text)** — the *version of the rules* a room/
  game was created under, e.g. `'king-v1'`. This lets rules evolve
  (`KING_RULES.md` changes) without misreading older games/stats: a finished
  game is forever interpreted under the ruleset it was played with. `KING_RULES.md`
  is the source of truth for `king-v*`; bumping it mints a new `ruleset_id`.

Why now (even pre-multi-game): adding `game_type` while only King exists is free
(default `'king'`) and avoids a painful backfill once a second game ships. The
`rooms.game_type` column is applied in **Stage 1** for exactly this reason.

An **optional `game_catalog`** table (and a `rulesets` companion) registers each
game and its current ruleset; see §2.14. It is the source for `/api/games`.

> **Naming:** the column is `game_type` everywhere for consistency. `ruleset_id`
> and `rules_version` are used interchangeably in this doc; pick one name at
> implementation time (recommend `ruleset_id`, a string like `king-v1`).

Conventions: all tables have `id uuid primary key default gen_random_uuid()`
(via `pgcrypto`), `created_at timestamptz not null default now()`, and
`updated_at timestamptz` where mutable. "Private" = never leaves the server in
any client payload. "Public" = may appear in lobby lists, profiles, or
leaderboards.

### 2.1 `users`

Core identity. A guest is just a user with `is_guest=true`.

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `id` | uuid PK | | private id; **public** as opaque player ref |
| `display_name` | text | sanitized, ≤ 20 chars (matches current nickname cap) | **public** |
| `is_guest` | boolean | default `false` | private |
| `email` | citext null | from primary auth account; nullable for guests | **private** |
| `email_verified` | boolean | from provider | private |
| `status` | text | `active` / `disabled` / `deleted` (soft) | private |
| `created_at` / `updated_at` | timestamptz | | private |
| `deleted_at` | timestamptz null | soft-delete tombstone for GDPR flow | private |

**Retention:** active indefinitely. Guest users with no activity for **N days**
(e.g. 30) and no linked auth account are pruned by a cleanup job.

### 2.2 `auth_accounts`

One row per external identity linked to a user. Enables Google now, Apple later,
and multiple providers per user.

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `id` | uuid PK | | private |
| `user_id` | uuid FK → users(id) `ON DELETE CASCADE` | | private |
| `provider` | text | `google` \| `apple` \| (future) | private |
| `provider_account_id` | text | provider `sub` (stable) | private |
| `email_at_provider` | text null | provider-reported email | private |
| `created_at` / `updated_at` | timestamptz | | private |

**Constraints:** `unique(provider, provider_account_id)`.
**Tokens:** we do **not** store provider access/refresh tokens for login-only
use. If a future feature needs Google APIs, add an encrypted `provider_tokens`
table then — not now.
**Retention:** lifecycle tied to the user (cascade on delete).

### 2.3 `sessions`

Active logins / devices. Backs both cookie sessions and mobile refresh tokens.

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `id` | uuid PK | session id (never sent raw to client for mobile; web uses signed cookie) | private |
| `user_id` | uuid FK → users `ON DELETE CASCADE` | | private |
| `token_hash` | text | **hash** of the session/refresh token (never plaintext) | private |
| `kind` | text | `web_cookie` \| `mobile_refresh` | private |
| `device_label` | text null | "Chrome on Windows", "iPhone" | private (shown to owner only) |
| `ip_hash` / `user_agent` | text null | coarse, for security review | private |
| `last_seen_at` | timestamptz | sliding session | private |
| `expires_at` | timestamptz | hard expiry | private |
| `revoked_at` | timestamptz null | logout / revoke | private |

**Retention:** delete rows past `expires_at` + grace; revoked rows purged by
cleanup. Provides logout-everywhere.

### 2.4 `user_settings`

The profile/preferences currently in `localStorage` (`src/net/prefs.ts`,
`src/i18n`, `src/core/avatars.ts`). DB becomes the **server copy** for logged-in
users; guests keep using localStorage (with optional sync on claim).

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `user_id` | uuid PK/FK → users `ON DELETE CASCADE` | one row per user | |
| `lang` | text | `en`\|`uk`\|`de`\|`ar` (validated against `LANGS`) | **public-ish** (shown in UI) |
| `avatar` | text | **whitelisted emoji only** (validate via `isValidAvatar`) | **public** |
| `card_style` | text | e.g. `classic` (default); future styles | **public** |
| `prefers_reduced_motion` | boolean null | a11y | private |
| `updated_at` | timestamptz | | |

> **Note on card style:** today there is a single shipped art style
> (`src/ui/components/cardArt.ts`); `card_style` is added now as a forward-
> compatible column so unlocking styles later needs no migration. Validation
> mirrors avatar safety: only known enum values are accepted (never free text),
> preserving the existing XSS-safe posture.

`user_settings` holds **only game-agnostic** preferences (identity-level). It is
**not** King-specific. Anything game-specific (e.g. King table animations, a
preferred default mode-selection type, per-game UI toggles) goes in
`user_game_settings` below — so adding a second game never bloats or migrates the
shared settings row.

**Retention:** lives with the user.

### 2.4b `user_game_settings` (per-game preferences)

One row per `(user, game_type)`. Keeps King-specific (and future game-specific)
preferences out of the shared `user_settings`.

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `user_id` | uuid FK → users `ON DELETE CASCADE` | | |
| `game_type` | text | e.g. `king` | private |
| `settings` | jsonb | free-form, game-validated (e.g. `{ defaultModeSelection: 'dealer_choice', preferredTimer: 60 }`) | private |
| `updated_at` | timestamptz | | |

**PK** `(user_id, game_type)`. The JSONB is validated by that game's settings
schema (server-side), never trusted raw. Serves `/api/games/<type>/settings`.

**Retention:** lives with the user.

### 2.5 `rooms`

Replaces the `PersistedRoom` JSON file rows. Mirrors `ServerRoom` /
`PersistedRoom` (`src/net/serverCore.ts`) so `PgRoomStorage` is a 1:1 swap. The
**multi-game** columns (`game_type`, `ruleset_id`, `status`) sit alongside the
JSONB payload; King-specific fields (`mode_selection_type`, `turn_timer_sec`,
the full `gameState`, etc.) stay **inside the payload**, so a different game
stores its own shape in the same table without new columns.

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `code` | text PK | 4-char room code (today's scheme) | **public** (discovery) |
| `game_type` | text | e.g. `king` (**Stage 1**, default `'king'`) | **public** |
| `ruleset_id` | text | rules version, e.g. `king-v1` | public |
| `status` | text | `lobby` \| `in_game` \| `finished` (generic across games) | public |
| `player_count` | smallint | 3 or 4 (King); generic per game | public |
| `payload` | jsonb | full `PersistedRoom` (mode, timer, members, `gameState`, dealLog, secrets) — **game-specific shape** | mixed (see below) |
| `password_salt` | text null | room secret salt | **private** |
| `password_hash` | text null | salted hash (see §5 — upgrade to argon2) | **private** |
| `created_at` / `updated_at` | timestamptz | | mixed |

> **Stage 1 status:** the real table today is exactly this, minimally: `code`,
> `game_type` (default `'king'`), `player_count`, `started`, `payload` (`data`
> JSONB = the full `PersistedRoom`), `updated_at`. `ruleset_id`/`status` and the
> split-out member/secret columns are later-stage normalisation; for now they
> live inside `payload`. See §3 Stage 1.

> The discovery list (`LIST_ROOMS`) already exposes only public summaries; the
> column visibility above matches that. **Password salt/hash inside the payload
> never appear in any client payload.** Discovery can filter by `game_type` so a
> game-specific lobby only lists its own rooms.

**Retention:** same TTL policy as today, enforced in SQL instead of in-memory:
- idle (no connected members) → expire after `ROOM_TTL_HOURS` (default 24);
- hard cap `ROOM_HARD_TTL_HOURS` (default 48) regardless.
A periodic job (the current `cleanupRooms`, repointed at SQL) deletes expired
rooms; cascades remove members/games/rounds/snapshots.

### 2.6 `room_members`

Replaces the embedded `members[]` array. One row per seat/participant. Models
humans, **guests**, and **bots** uniformly (as today's `ServerMember`).

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `id` | uuid PK | | private |
| `room_code` | text FK → rooms(code) `ON DELETE CASCADE` | | |
| `client_id` | uuid | per-connection id (today's clientId) | private |
| `reconnect_token_hash` | text null | **hash** of the reconnect token (was plaintext in JSON) | **private** |
| `user_id` | uuid null FK → users | set for logged-in or guest users; **null for bots** | private |
| `name` | text | display name | **public** (in room) |
| `role` | text | `player` \| `spectator` | public |
| `seat_index` | smallint null | 0..3 once seated | public |
| `is_host` | boolean | | public |
| `connected` | boolean | reset false on load (matches deserialize) | public |
| `type` | text | `human` \| `ai` | public |
| `avatar` | text | whitelisted emoji / `BOT_AVATAR` | public |

> **Security upgrade vs today:** the JSON file stores `reconnectToken` in
> plaintext. In Postgres we store **`reconnect_token_hash`** and compare hashes,
> so a DB dump can't hijack live sessions. The client still holds the raw token
> in localStorage exactly as now.

**Bots & guests:** a bot is `type='ai', user_id=null, reconnect_token_hash=null`
(bots never reconnect, per current logic). A guest is a normal member with a
`user_id` pointing at an `is_guest=true` user.

> **`game_type` here?** Not stored — it is derivable via the room FK (`room` →
> `game_type`). Add a denormalised `game_type` column **only** if member queries
> need to filter by game without joining `rooms` (e.g. "all rooms a user is in,
> grouped by game"); otherwise keep it off to avoid a second source of truth.
> (`user_id` is nullable: null for bots; set for humans/guests.)

**Retention:** cascade with the room.

### 2.7 `games`

A started game inside a room. Today the game lives inside the room blob; we lift
it to its own row so completed games (for stats/history) survive room cleanup.

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `id` | uuid PK | | public (as match id) |
| `room_id` | text null FK → rooms(code) (set null on room delete) | room may be gone after cleanup | private |
| `game_type` | text | e.g. `king` (copied from room; durable after room delete) | **public** |
| `ruleset_id` | text | rules version the game was played under, e.g. `king-v1` | public |
| `player_count` | smallint | 3/4 (King); generic per game | public |
| `status` | text | `in_progress` \| `finished` \| `abandoned` | public |
| `result` | jsonb null | game-specific outcome summary (e.g. King totals/winner rationale) | public |
| `started_at` | timestamptz | | public |
| `finished_at` | timestamptz null | | public |
| `winner_user_id` | uuid null FK → users | per-game win rule (King: lowest score) | public |

> `game_type` + `ruleset_id` are **copied onto the game** at creation so stats and
> history remain correct even after the room is cleaned up and even if the
> ruleset later changes. Game-specific config that was once `mode_selection_type`
> now lives in the room payload / `result` JSONB, not as King-only columns.

**Seat ↔ identity mapping** for a game is captured in `game_players` (below) so
stats can attribute rounds to real users even after the room is gone.

#### 2.7b `game_players` (seat → identity for a finished game)

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `game_id` | uuid FK → games `ON DELETE CASCADE` | | |
| `seat_index` | smallint | 0..3 | public |
| `player_id` | text | engine id (`player-0`…) used in `roundHistory` | private |
| `user_id` | uuid null FK → users | null for bots | private |
| `name` / `avatar` / `type` | text | snapshot at game time | public |
| `final_total` | integer | from `scores[playerId].total` | public |

PK `(game_id, seat_index)`. This is the join that turns rule-level `playerId`s
into account-level stats.

### 2.8 `rounds`

Direct persistence of the engine's **`roundHistory`** records (`RoundRecord` in
`src/models/types.ts`). **Score-only — no hands, no cards** — which is exactly
what `KING_RULES.md` mandates for the score tracker and is perfect for stats.

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `id` | uuid PK | | private |
| `game_id` | uuid FK → games `ON DELETE CASCADE` | | |
| `game_type` | text | denormalised from game (cheap per-game stat queries) | **public** |
| `round_index` | integer | round number within the game | public |
| `mode_id` | text null | **generic round label** — King: `no_tricks`…`trump`; null/other for games without modes | public |
| `dealer_player_id` | text null | engine id (King-specific; null for games with no dealer) | public |
| `dealer_user_id` | uuid null | resolved via game_players | private |
| `meta` | jsonb null | game-specific per-round extras (King: `{ trumpOccurrence, surrenderedBy }`) | public |
| `scores` | jsonb | `score_by_player`, e.g. `{ "player-0": -5, ... }` | public |

> **Generic vs King-specific:** `mode_id` and `scores` are generic enough to
> cover most trick/round games; King-only fields (`trumpOccurrence`,
> `surrenderedBy`) move into `meta` JSONB rather than dedicated columns, so a
> different game's rounds slot into the same table. `game_type` is denormalised
> so per-game stats aggregate without joining `games`.

**Retention:** kept for finished games as long as the game is kept (stats
source). Early-ended rounds recorded identically (per rules).

### 2.9 `game_snapshots` vs `game_events` — choose snapshots

Two ways to persist the **live authoritative state** for crash recovery /
reconnect:

- **`game_snapshots` (RECOMMENDED):** store the full `GameState` as `JSONB`,
  one current row per game (plus optional short history). This is exactly
  today's model (`PersistedRoom.gameState`) — a single blob the reducer loads
  and continues from. Simple, proven, redaction-safe (the blob is **never sent
  raw**; the server always runs it through `sanitizedStateFor`).
- **`game_events` (event sourcing):** store each `GameAction` + seed and replay.
  Powerful (full audit, deterministic replay via the seeded RNG + `dealLog`) but
  a much bigger change to the write path and recovery logic.

**Decision: `game_snapshots` now**, because it is a *zero-behavior-change* lift
of the current persistence. We already have a separate **append-only audit
trail** in `dealLog` (`DealRecord[]`: seed, deckHash, timestamp) — persist that
too (see below) and we retain replayability without committing to full event
sourcing. We can graduate to `game_events` later if anti-cheat/audit needs grow.

`game_snapshots`:

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `game_id` | uuid PK/FK → games `ON DELETE CASCADE` | one current snapshot | |
| `game_type` | text | which engine produced `state` (routes the right reducer on restore) | private |
| `state` | jsonb | full authoritative game state (King: `GameState`) | **PRIVATE — never sent unredacted** |
| `status` | text | mirrors the engine status for cheap queries | private |
| `version` | integer | optimistic-lock / schema version (today's `v`) | private |
| `updated_at` | timestamptz | | private |

> **`game_type` on the snapshot** tells the server which reducer/redactor to load
> when restoring (King → `gameReducer` + `sanitizedStateFor`). A second game
> ships its own engine; the column is the dispatch key.

If/when we adopt **`game_events`** (event sourcing) instead of/alongside
snapshots, the same multi-game tagging applies — each event row carries
`game_type`, an `event_type` (e.g. `PLAY_CARD`, `CHOOSE_MODE`), a monotonic
`seq`, and a game-specific `payload` JSONB:

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `id` | uuid PK | | private |
| `game_id` | uuid FK → games `ON DELETE CASCADE` | | private |
| `game_type` | text | dispatch key | private |
| `seq` | integer | per-game monotonic order | private |
| `event_type` | text | game-specific action/event name | private |
| `payload` | jsonb | the action/event body (+ seed for deals) | **PRIVATE (anti-cheat)** |
| `created_at` | timestamptz | | private |

`game_deal_log` (append-only audit, from `DealRecord`):

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `game_id` | uuid FK → games `ON DELETE CASCADE` | | |
| `round_index` / `dealer_index` | integer | | private |
| `dealer_id` | text | | private |
| `mode_id` | text null | | private |
| `seed` | bigint | RNG seed (reproduce the deal) | **private (anti-cheat)** |
| `deck_hash` | text | integrity fingerprint | private |
| `created_at` | timestamptz | | private |

**Retention:** snapshot deleted when the game is `finished`/`abandoned` and the
room expires (the *rounds* + *game_players* carry the durable history). Deal log
kept with the game for audit; prune with the game.

### 2.10 `user_stats` — per-game, derived, not authoritative

Stats are **per `(user, game_type)`** and **derived from `rounds` +
`game_players`**, never hand-maintained as the source of truth. We keep a
`user_stats` row **per game type** as a **materialized cache** for fast profile/
leaderboard reads, recomputed on game finish (and rebuildable by replaying
`rounds` for that game type).

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `user_id` | uuid FK → users `ON DELETE CASCADE` | | |
| `game_type` | text | e.g. `king` | **public** |
| `games_played` | integer | finished games of this type | **public** |
| `games_won` | integer | wins of this type | public |
| `games_lost` | integer | losses of this type | public |
| `rounds_played` | integer | | public |
| `stats` | jsonb | **game-specific** aggregates — for King: `{ totalScore, bestGameScore, modeBreakdown, surrenders }` | public |
| `last_played_at` | timestamptz | | public |
| `updated_at` | timestamptz | | private |

**PK** `(user_id, game_type)`.

> **Generic vs game-specific.** The *shape* is shared across games:
> `games_played / games_won / games_lost / rounds_played` are universal counters.
> Everything that depends on a game's scoring (King points, where **lower is
> better**; per-mode breakdowns like `no_hearts`; surrenders) lives **inside the
> `stats` JSONB**, computed by King's own aggregator. **We never mix King scoring
> into another game's totals** — a different game writes its own `stats` shape
> under its own `game_type` row. If a game ever needs heavy relational stat
> queries, it can add a dedicated `<game>_stats` table; the JSONB column is the
> default and is enough for King.

> **Why derived?** Rebuildability and correctness. If a stat formula changes, we
> recompute from `rounds` (filtered by `game_type`). Because rounds are
> score-only, this is cheap and privacy-clean, and honours the rule that
> `roundHistory` is the canonical per-round record.

> **Leaderboards** are therefore always per-game (`/api/games/<type>/leaderboard`)
> — there is no cross-game "global score", because scores are not comparable
> across games.

### 2.11 Bot players / guest players

No separate table — modeled uniformly:
- **Bots:** `room_members.type='ai'`, `user_id=null`, no reconnect token; in a
  finished game they appear in `game_players` with `user_id=null, type='ai'` so
  rounds attribute correctly but no `user_stats` is written for them.
- **Guests:** real `users` row with `is_guest=true`; full member + game_players
  + stats participation, with the option to **claim/merge** into a Google
  account later (merge updates `room_members.user_id`, `game_players.user_id`,
  re-runs `user_stats`).

### 2.12 Room passwords / hashed secrets

Stored on `rooms` as `password_salt` + `password_hash` (matches today). The
hashing **algorithm is upgraded** (see §5): replace the current 1000-iteration
custom hash with **argon2id** (or bcrypt). Plaintext is never stored or logged.
Reconnect tokens move to **hashed** storage in `room_members` (§2.6).

### 2.13 ER overview

Shared identity on the left; everything `game_type`-tagged on the right.

```
SHARED (game-agnostic)                 PER-GAME (tagged with game_type [+ ruleset_id])
─────────────────────                  ──────────────────────────────────────────────
users ──< auth_accounts                game_catalog ──< rulesets
  │  └──< sessions                          ▲ (game_type, current_ruleset_id)
  ├──1 user_settings (global)               │
  ├──< user_game_settings ───(game_type)────┘
  ├──< user_stats ───────────(game_type)──────────────┐
  └──< room_members >── rooms ──< games ──< rounds     │ (stats derived
                       (game_type) (game_type) (game_type)  from rounds)
                                   │  └──< game_players >── users
                                   ├──1 game_snapshots (game_type, JSONB, PRIVATE)
                                   └──< game_events/deal_log (game_type, PRIVATE)
```

### 2.14 `game_catalog` + `rulesets` (optional, recommended)

Registers each playable game and its current ruleset. Source for `/api/games`
and the validation list for every `game_type` written elsewhere.

`game_catalog`:

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `game_type` | text PK | e.g. `king` | **public** |
| `display_name` | text | e.g. `King` | public |
| `current_ruleset_id` | text | e.g. `king-v1` (FK → rulesets) | public |
| `player_counts` | jsonb | supported sizes, e.g. `[3,4]` | public |
| `enabled` | boolean | hide a game without deleting data | public |
| `schema_version` | integer | payload/snapshot schema version for this game | private |

`rulesets`:

| Field | Type | Notes | Visibility |
|---|---|---|---|
| `ruleset_id` | text PK | e.g. `king-v1` | public |
| `game_type` | text FK → game_catalog | | public |
| `rules_doc` | text | pointer to the source of truth (e.g. `KING_RULES.md@<commit>`) | public |
| `created_at` | timestamptz | | public |

> Seed `game_catalog` with `('king', 'King', 'king-v1', [3,4], true, 1)` and
> `rulesets` with `('king-v1', 'king', 'KING_RULES.md', …)`. New games are a
> catalog row + their engine — **no identity/auth/profile changes**. Bumping
> `KING_RULES.md` in a breaking way mints `king-v2`; existing games keep
> `king-v1` so their stats stay interpretable.

---

## 3. Migration Plan (small, reversible stages)

Each stage ships independently, behind config where possible, and **cannot break
gameplay** because the reducer and redaction are never touched until explicitly
noted (they aren't, in any stage).

### Stage 1 — DB setup + schema + health check (no gameplay change) — DONE
- Provision Postgres (Render PG or external). Add `DATABASE_URL`.
- Add Drizzle + `drizzle-kit`; write schema (§2) and the first migration.
- Add a DB ping to `/health` (report `db: disabled|ok|error`) **without** making
  the game depend on it — if `DATABASE_URL` is unset, server runs exactly as
  today on file storage.
- **Multi-game (applied now):** the `rooms` table carries a **`game_type`**
  column (default `'king'`) from the first migration, so the eventual second
  game needs no backfill. The full `PersistedRoom` stays in the `data`/`payload`
  JSONB unchanged. `ruleset_id`/`status` and normalised member/secret columns are
  deferred to later stages (they live in the payload for now). The pure
  `roomToRow`/`rowToRow` mapping (`src/net/pgRoomRow.ts`) sets `game_type`
  (defaulting to `'king'`) and is unit-tested without a DB.
- **Acceptance:** `npm run db:migrate` builds the schema (incl. `game_type`);
  `/health` shows DB status; existing tests + e2e still green; default (no DB)
  path unchanged.

### Stage 2 — Persist rooms to DB via the existing `RoomStorage` interface
- Implement `PgRoomStorage implements RoomStorage`
  (`loadRooms`/`saveRoom`/`deleteRoom`) writing to `rooms` + `room_members` +
  `game_snapshots` + `game_deal_log`.
- Select storage by env: `ROOM_STORAGE=pg` → `PgRoomStorage`; otherwise keep
  `FileRoomStorage`/`MemoryRoomStorage`. **`createStorage()` is the only switch
  point.**
- Hash reconnect tokens on write (§2.6).
- Optional one-shot importer: read `.data/rooms.json` → insert rows.
- **Acceptance:** create/join/play/reconnect/cleanup all work with
  `ROOM_STORAGE=pg`; round history survives a server restart (per rules test
  "round history survives serialize/restore"); no message-shape change; clients
  unaware anything moved.

### Stage 3 — User profile/settings (guest mode still works) — PARTIAL (foundation DONE)
Split into a **foundation** (done now) and the **API wiring** (moved to Stage 4,
where a session exists to attach routes to — so we don't ship an unauthenticated
mutation surface).

**Done in Stage 3 (schema + repository + validation, opt-in, no client change):**
- `users` (with `is_guest`, `guest_key`), **global** `user_settings`,
  `user_game_settings` (per `game_type`) — migration `0001_users.sql`,
  drizzle tables in `server/db/schema.ts`.
- Pure validation/sanitisation in `src/net/userSettings.ts` (lang/avatar/
  cardStyle/displayName/per-game `defaultTimer`), unit-tested without a DB.
- Repository `server/db/users.ts`: `getOrCreateGuest` (lazy guest by device
  handle — a lookup key, **not** a credential), `getProfile`,
  `updateDisplayName`, `upsertGlobalSettings`, `get/upsertGameSettings`. Gated
  by `DATABASE_URL`; **nothing in the running server calls it yet**, so guest/
  local play and file/memory storage are untouched.
- Optional integration test (`src/net/users.integration.test.ts`, `TEST_DATABASE_URL`).

**Deferred to Stage 4 (needs sessions):** the HTTP API (`/api/profile`,
`/api/settings`, `/api/games/king/settings`, `/api/games`), `game_catalog`/
`rulesets` seed, and client settings sync. Until then the client keeps
localStorage as the source of truth.

- **Acceptance (met):** logged-out/local play unchanged; settings round-trip for
  a guest via the repository; no login wall; tests/build/e2e green without a DB.

### Stage 4 — session/profile/settings API + guest bridge — PARTIAL (foundation DONE)
Split into a **session/profile/settings foundation** (done now) and **full
Google OAuth** (documented next substage). The foundation is complete and wired;
OAuth is scaffolded but disabled.

**Done in Stage 4 (HTTP API + sessions + guest bridge + soft client sync):**
- **HTTP routing on the existing `http.Server`** (no Express, no second port):
  `server/api.ts` owns `/api/*` + `/auth/*`; `/health`, static `dist/`, the SPA
  fallback, and the `/ws` upgrade are untouched. When `DATABASE_URL` is unset (or
  the DB is unreachable) every route returns a clean **503** and play is
  unaffected; the drizzle/pg driver is imported **dynamically**, only DB-on.
- **API surface:** `GET /api/me`, `PATCH /api/profile`, `GET/PATCH /api/settings`,
  `GET/PATCH /api/games/king/settings`, plus `POST /api/guest-session` and
  `POST /api/logout`. All wired to the Stage 3 repository; no private game state
  is ever exposed.
- **DB-backed sessions** (`sessions` table, migration `0002_sessions_auth.sql`):
  opaque token in an **httpOnly cookie**, stored only as a **peppered SHA-256
  hash** (`server/sessionTokens.ts`), with `expires_at`/`revoked_at` so
  logout/revoke works (not a stateless JWT). `auth_accounts` table added now
  (forward-compat for Google/Apple; unused until OAuth lands).
- **Guest bridge:** `POST /api/guest-session` lazily creates/reuses a guest user
  via `getOrCreateGuest` keyed by a **public device handle** (localStorage
  `king.guest.v1`; a lookup key, **not** a credential) and issues a session.
- **Pure helpers + tests:** cookie parse/serialize, cookie options (dev vs prod),
  CSRF origin check (`src/net/cookies.ts`); token hash/verify + TTL
  (`server/sessionTokens.ts`); API-disabled-without-DB; client `apiBaseFromWsUrl`;
  prefs round-trip; gated session integration test.
- **Soft client sync:** an optional account/profile area (`AccountPanel`) shows
  Guest/Signed-in status, display name, avatar, language, and the per-game King
  default timer. It hydrates from `/api/me` when available and writes through;
  **localStorage stays the source of truth and fallback** — no login wall.
- **Security:** session token hashes only (never plaintext), httpOnly + `Secure`
  (prod) + `SameSite=Lax` cookie, CSRF via SameSite + an Origin allowlist/same-
  origin check on mutations, credentialed CORS (never `*`), no
  cookie/token/PII logging. `SESSION_SECRET` is the hash pepper.

**Deferred to a Stage 4 next substage (documented, not built):** the full Google
OAuth flow (`/auth/google/start` + `/auth/google/callback` exist but return 503
`oauth_disabled` until `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` + the
Authorization-Code/PKCE exchange + ID-token validation + `auth_accounts` upsert
are implemented), `/api/games` catalog (`game_catalog`/`rulesets` seed), guest →
account **claim/merge**, and WS identity resolution from the cookie. Seat/
reconnect authority stays on the existing `clientId`+`reconnectToken` model
regardless.

- **Acceptance (met):** server starts without `DATABASE_URL` exactly as before;
  `/api/*` 503s gracefully with no DB; with `DATABASE_URL` + migrations, `/api/me`
  and the settings/guest endpoints round-trip; local play and online guest rooms
  work without login; no gameplay/rules/scoring/deck change; no private state in
  the API. Google OAuth staged.

### Stage 5 — Stats from completed games (per game_type)
- On `game_finished`, write `games` + `game_players` + `rounds` (from
  `roundHistory`), each tagged with `game_type`/`ruleset_id`, in one transaction;
  recompute the `(user_id, game_type)` `user_stats` row via King's own
  aggregator (King scoring stays inside `stats` JSONB — never mixed with other
  games).
- Add per-game `/api/games/king/stats` (and `/api/games/king/leaderboard`); the
  shared profile shows a per-game breakdown.
- **Acceptance:** finishing a 3p (27-round) and 4p (36-round) game yields correct
  totals matching `scores[playerId].total`; bots excluded from stats; stats
  rebuildable by replaying `rounds` filtered by `game_type`.

### Stage 6 — Mobile auth considerations / Apple Sign-In
- Add refresh-token (`kind='mobile_refresh'`) issuance + rotation; access JWT
  signed with `SESSION_SECRET`.
- Add Apple provider to `/auth/*` and `auth_accounts` (signed client secret,
  first-consent name/email, relay email). No schema change.
- **Acceptance:** a bearer-token client can auth the WS and REST; Apple login
  links to the same user model.

### Stage 7 — Optional Redis for live room scaling
- Only if we outgrow a single Node process. Introduce Redis for (a) pub/sub fan-
  out of `STATE_UPDATE` across instances and (b) a short-TTL cache/lock for the
  active `game_snapshots`. Postgres remains durable truth.
- **Acceptance:** two server instances behind a load balancer share rooms; single-
  instance behavior is byte-for-byte unchanged when Redis is absent.

---

## 4. Compatibility — what must not break

| Surface | Risk | How we protect it |
|---|---|---|
| **Current online rooms** | Storage swap corrupts/loses rooms | Stage 2 lives **entirely behind `RoomStorage`**; same `PersistedRoom` shape; optional JSON→PG importer; `ROOM_STORAGE` flag lets us roll back instantly. |
| **Guest play** | Accidental login wall | Guests get a lazy ephemeral user; login is always an *upgrade* CTA, never required; local pass-and-play needs **no** network/DB/identity. |
| **PWA / offline** | Settings/identity calls break offline | Service worker + localStorage remain the offline fallback for settings; auth/stats are progressive enhancements that degrade gracefully when offline. |
| **Render deployment** | Engine binaries, multi-service, extra ports | Drizzle (no engine); single HTTP server hosts Express + WS on **one port**; migrations run in build/release step; free plan still viable. |
| **Tests / e2e** | New deps break CI; DB required to run | Keep `MemoryRoomStorage` as the default test backend; gate PG tests behind a `DATABASE_URL`; reducer/rules tests are pure and untouched; the e2e script keeps using the in-memory/file path unless explicitly run against PG. |
| **Reducer & rules** | Hidden coupling to persistence | The reducer stays pure; persistence only serializes/restores its output. No rule from `KING_RULES.md` is reimplemented in SQL. |
| **Redaction/privacy** | DB readers leak hands/discard | `game_snapshots.state` is server-only; all client payloads still pass through `sanitizedStateFor`; private columns marked in §2 and never selected into client responses. |

---

## 5. Security & Privacy

- **Room passwords / secrets:** upgrade room hashing from the current custom
  1000-iteration hash to **argon2id** (or bcrypt) with per-room salt. Plaintext
  never stored or logged. WSS/TLS assumed in prod (already required by origin
  checks).
- **Reconnect tokens:** store **hashed** in `room_members` (today they are
  plaintext in JSON). Client keeps the raw token; server compares hashes — a DB
  leak can't hijack live seats.
- **OAuth tokens:** we **don't persist** Google/Apple access/refresh tokens for
  login. We validate the ID token and keep only `provider_account_id`. If APIs
  are needed later, store provider tokens **encrypted at rest** in a dedicated
  table.
- **Sessions:** httpOnly + Secure + SameSite cookies (web); hashed session/
  refresh tokens in DB; rotation + per-device revocation + logout-everywhere.
  `SESSION_SECRET` signs cookies/JWTs and must be a strong random secret.
- **User data minimization:** store `display_name`, optional `email`, settings,
  and derived stats. No card-level game history per user — `rounds` are
  **score-only**, which is both a privacy win and aligned with `KING_RULES.md`.
- **Game history visibility:** stats/profile fields marked **public** in §2 are
  the only thing leaderboards expose. Snapshots, deal logs, salts, hashes, and
  emails are **private**. Other players still cannot see hands/discard/kitty —
  redaction is unchanged.
- **GDPR-like delete/export:**
  - *Delete:* `DELETE FROM users WHERE id=$1` cascades to auth_accounts,
    sessions, settings, members, game_players, stats. For finished games we
    either anonymize the user's `game_players` row (null the `user_id`, keep
    aggregate integrity) or hard-delete per policy. Soft-delete via `deleted_at`
    first, hard-purge by a job.
  - *Export:* a `/api/me/export` returning the user's profile, settings, stats,
    and their game participation as JSON.
- **Rate limiting:** per-IP limits on `/auth/*` (login/callback), `/api/*`
  mutations, and room create/join (mitigate brute-force on room passwords and
  OAuth abuse). WS message flood protection on connect/action.
- **DB backups:** enable managed Postgres automated daily backups +
  point-in-time recovery if the plan supports it. Test restore. Snapshots are
  ephemeral, but `users/rounds/stats` are the irreplaceable rows to protect.
- **CSRF:** `state` param on OAuth; double-submit/SameSite for cookie-based
  POSTs.

---

## 6. Deployment Implications

- **Postgres:** start with **Render PostgreSQL** (same provider, private
  networking, managed backups) for lowest ops overhead; any external Postgres
  (Neon/Supabase/RDS) works via `DATABASE_URL`. Neon's serverless/branching is
  attractive for preview DBs if we want them.
- **Single service preserved:** Express + WS still share one `http.Server` and
  one port; no new web service needed. Static `dist/` still served by the same
  process.
- **Env vars (new + existing):**

  | Var | Purpose |
  |---|---|
  | `DATABASE_URL` | Postgres connection string (Stage 1+) |
  | `GOOGLE_CLIENT_ID` | OAuth client (Stage 4) |
  | `GOOGLE_CLIENT_SECRET` | OAuth secret (Stage 4) |
  | `SESSION_SECRET` | signs cookies/JWTs (Stage 4) |
  | `APP_ORIGIN` | canonical origin for OAuth redirect URIs + cookie domain |
  | `ROOM_STORAGE` | `pg` to switch to `PgRoomStorage` (Stage 2) |
  | *(existing)* `ALLOWED_ORIGINS`, `ROOM_TTL_HOURS`, `ROOM_HARD_TTL_HOURS`, `HOST`, `PORT`, `VITE_WS_URL` | unchanged |

  `APP_ORIGIN` must match the Google authorized redirect URI
  (`$APP_ORIGIN/auth/google/callback`).
- **Migrations command:** `npm run db:migrate` (drizzle-kit) run in Render's
  build or a pre-deploy/release step, before `server:prod` starts. Add
  `db:generate` (author migration) and `db:studio` (inspect) scripts.
- **Seed / dev DB:** add a `db:seed` script for local dev (a demo user, a couple
  of rooms). For local development, Docker `postgres` or a Neon dev branch;
  `ROOM_STORAGE` unset / `memory` keeps tests DB-free.
- **render.yaml:** add a `databases:` block (or link an external DB), add the new
  env vars (`sync:false` for secrets), and a release-phase migrate command.

---

## 7. Risk List

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Storage swap regresses reconnect/round-history persistence | Med | High | Stage 2 behind `RoomStorage`; reuse `PersistedRoom` shape; run the existing "survives serialize/restore" rule test against PG; `ROOM_STORAGE` rollback flag. |
| R2 | Redaction leak when reading snapshots from DB | Low | High | `game_snapshots.state` server-only; all client payloads keep flowing through `sanitizedStateFor`; add a test asserting no endpoint returns raw state. |
| R3 | Guest mode accidentally gated behind login | Low | High | Guests get lazy users; login is upgrade-only; explicit "no login wall" acceptance check each stage. |
| R4 | OAuth misconfig (redirect URI / token validation) | Med | High | Strict ID-token validation (iss/aud/exp/signature); `APP_ORIGIN`-derived redirect; test against Google's playground; `state`/PKCE. |
| R5 | Render free plan limits (build size, idle sleep, no disk) | Med | Med | Drizzle avoids engine downloads; DB is external/managed so idle sleep doesn't lose data; migrations in release step. |
| R6 | Weak legacy hashing carried over | Low | Med | Upgrade to argon2id for room passwords; hash reconnect tokens; one-time rehash on next set. |
| R7 | Stats drift from authoritative scores | Med | Med | Derive stats from `rounds`; make `user_stats` a rebuildable cache; reconcile job. |
| R8 | Guest→account merge data conflicts | Med | Med | Deterministic merge (repoint `user_id`s, recompute stats in a transaction); keep an audit of merges. |
| R9 | Migrations run against prod without review | Low | High | All migrations are SQL in git (drizzle-kit); run in release phase; backups + PITR before destructive changes. |
| R10 | Test suite needs a DB / CI breakage | Med | Med | Default tests on `MemoryRoomStorage`; PG tests gated by `DATABASE_URL`. |
| R11 | Cost/ops creep from premature Redis | Low | Low | Redis is Stage 7, optional, only on horizontal scaling need. |
| R12 | GDPR delete breaks game referential integrity | Low | Med | Cascade where safe; anonymize `game_players.user_id` for finished games to preserve aggregates. |

---

## 8. Where to start first (recommendation)

1. **Stage 1 + the `PgRoomStorage` skeleton (Stage 2 seam).** These are the
   lowest-risk, highest-leverage moves: they introduce Postgres and Drizzle, add
   a DB health check, and prove the storage swap **without changing one line of
   gameplay or any client message**. Because everything routes through the
   existing `RoomStorage` interface and `createStorage()` switch, we can run PG
   and file storage side by side and roll back via a single env var.
2. Only once rooms persist cleanly in PG (reconnect + round-history tests green)
   do we move "up the stack" to profiles (Stage 3) and Google login (Stage 4).

This sequencing keeps `KING_RULES.md` authoritative, the server authoritative,
privacy intact, and guest/local play untouched — exactly the constraints this
project cares about.
