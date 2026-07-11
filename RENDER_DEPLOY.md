# Deploy Card Majlis to Render (single Web Service)

The simplest hosted path: **GitHub repo → Render Web Service → Deploy**. One
service serves both the **frontend** and the **WebSocket** on the same domain,
and Render provides **HTTPS/WSS** automatically.

> **After each deploy**, run the 10–15 min [`PRODUCTION_SMOKE.md`](PRODUCTION_SMOKE.md)
> checklist to confirm health / 5 games / rooms / stats / avatars / social / security.

> Why one service works: the Node server (`server/index.ts`) serves the built
> client from `dist/` AND handles the WebSocket on `/ws`, all on the port Render
> injects via `$PORT`. The client, served from the same origin, defaults to
> `wss://<this-domain>/ws` — so on Render it connects to the right place with
> **no build-time domain needed**.

Based on Render's Web Services docs (<https://render.com/docs/web-services>):
bind `0.0.0.0`, read `process.env.PORT`, Render terminates TLS at the load
balancer, and WebSocket connections are supported on the same service.

---

## Steps

1. **Push the repo to GitHub** (or GitLab/Bitbucket).

2. **Render Dashboard → New → Web Service.**
   (Or **New → Blueprint** to use the committed `render.yaml`, which fills in
   the commands and env vars for you — then skip to step 7.)

3. **Connect the repository** and pick the branch (e.g. `main`).

4. **Build Command:**
   ```
   npm install && npm run build
   ```
   > Use `npm install` (NOT `npm ci --omit=dev`). The server runs the TypeScript
   > via `tsx`, and the build needs `vite`/`tsc` — these are devDependencies and
   > must be installed on Render.

5. **Start Command:**
   ```
   npm run server:prod
   ```
   (`npm start` works too — it runs the same production server.)

6. **Environment variables** (Environment tab):
   | Key | Value | Notes |
   |-----|-------|-------|
   | `NODE_ENV` | `production` | stricter startup warnings |
   | `HOST` | `0.0.0.0` | Render requires binding 0.0.0.0 |
   | `ALLOWED_ORIGINS` | `https://<your-service>.onrender.com` | set after step 9 (see below) |
   | `ROOM_TTL_HOURS` | `24` | idle-room cleanup |
   | `ROOM_HARD_TTL_HOURS` | `48` | hard cap for connected rooms |
   | `ORPHAN_ROOM_TTL_MS` | `900000` | delete orphan rooms (no connected human) after 15 min (Stage 7.2) |
   | `DISCONNECTED_SUBSTITUTE_DELAY_MS` | `120000` | AI substitute delay for a disconnected human's turn, 2 min (Stage 7.2) |
   | `VITE_WS_URL` | `wss://<your-service>.onrender.com/ws` | **optional** — see note |
   | `VOICE_ICE_SERVERS` | _(unset)_ | **optional, preferred** — runtime TURN for voice; served at `/api/voice/ice-config`, no rebuild (see below) |
   | `VITE_VOICE_ICE_SERVERS` | _(unset)_ | **optional** — build-time TURN fallback for voice (see below) |

   - **Do NOT set `PORT`.** Render injects it; the server reads `process.env.PORT`.
   - **`VITE_WS_URL` is optional on Render.** Same-origin hosting means the client
     auto-derives `wss://<this-domain>/ws`. Set it only if you host the client on
     a different domain. If you do set it, it is baked in at build time, so a
     **redeploy** (rebuild) is required for a change to take effect.
   - **Voice TURN (voice chat, Stage 25.5–25.6) — two ways, both optional.** Unset → voice uses
     **STUN-only** (Google public STUN): works for most NATs, but strict/symmetric-NAT users fall
     back to text chat. To add a **TURN** relay, set a JSON array, e.g.
     `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"USER","credential":"SECRET"}]`
     (get the URL/user/credential from your TURN provider — Metered.ca, Twilio, Cloudflare, or a
     self-hosted coturn; see VOICE_CHAT_PLAN.md §7).
     - **`VOICE_ICE_SERVERS` (preferred, runtime).** The server reads it and serves it to the
       browser at **`GET /api/voice/ice-config`**. Change it and **restart the service — no client
       rebuild**. The credential is delivered to the browser (which must authenticate to TURN),
       but is **never logged and never in `/health/diagnostics`**.
     - **`VITE_VOICE_ICE_SERVERS` (fallback, build-time).** Baked into the bundle at `npm run
       build`; used only if the runtime endpoint is unreachable. A change needs a **redeploy**.
     - Either way the credential lives **only** in the Render env var — **never commit it**. A
       malformed value safely falls back to STUN. Verify with
       `curl -s $HOST/health/diagnostics` → `voice.ice` reads `turn_configured`, and
       `curl -s $HOST/api/voice/ice-config` returns your servers.

7. **Health Check Path:**
   ```
   /health
   ```

8. **Create Web Service / Deploy.** Render runs the build, then the start
   command. Watch the logs for:
   ```
   [King] server-authoritative server listening on 0.0.0.0:10000 (production)
   [King] serving static client from /opt/render/project/src/dist (single-service mode; WS on /ws)
   ```

9. **Open** `https://<your-service>.onrender.com`.

---

## After the first deploy (the URL is known only now)

Render assigns the domain only after the service is created. Once you have
`https://<your-service>.onrender.com`:

1. Set **`ALLOWED_ORIGINS`** = `https://<your-service>.onrender.com` (tightens the
   socket to your origin). Saving env vars triggers a redeploy.
2. **`VITE_WS_URL` — usually leave unset.** The client already connects to
   `wss://<your-service>.onrender.com/ws` by default (same origin). Only set it
   (and redeploy) if the client is served from a different host.

That's it — no other domain wiring is needed because TLS, routing, and the
WebSocket upgrade all happen on the one Render service.

---

## Verify `/health`

```bash
curl -s https://<your-service>.onrender.com/health
# {"status":"ok","rooms":0,"uptime":12}
```
Render also polls this path; a non-200 marks the deploy unhealthy.

For a richer, still-public snapshot (build/commit, room + socket load, DB + avatar
readiness) without opening the Render dashboard, use the diagnostics endpoint:

```bash
curl -s https://<your-service>.onrender.com/health/diagnostics
# {"status":"ok","version":"0.1.0","commit":"…","uptime":42,"db":"enabled",
#  "rooms":{"total":3,"open":1,"inGame":2},"connections":5,
#  "games":{"count":5,"ids":["king","durak","deberc","tarneeb","preferans"]},
#  "avatarUploads":{"status":"enabled","reason":null,"ffmpeg":true,"database":true}}
```
It exposes **only** aggregate counts, booleans, the app version + short commit, and the
public game ids — never user/room/session/email/token/chat/card data. It reads in-memory
counters + a cached boot ffmpeg flag (no DB query, no per-request ffmpeg spawn), so it is
safe to poll. `commit` is populated when the build env sets `RENDER_GIT_COMMIT`.

## Play from your phone

1. Open `https://<your-service>.onrender.com` in mobile Chrome/Safari (HTTPS).
2. **Host online room** → share the 4-letter room code (and password if set).
3. Friends open the same URL → **Join** → enter the code.
4. The client connects over `wss://…/ws` automatically (the menu's mixed-content
   warning only appears if you manually type a `ws://` URL on an HTTPS page).
5. **Install as an app (PWA):** browser menu → **Add to Home screen / Install** —
   launches standalone, portrait, with the King icon (needs HTTPS, which Render
   provides).

---

## Persistence on Render

- **Free / no disk = ephemeral.** `.data/rooms.json` lives on a disk that is
  **wiped on every redeploy or restart** (and free instances sleep when idle).
  In-progress rooms are lost on restart. Fine for a quick demo/test.
- **Durable rooms** need a **paid instance + persistent disk**:
  1. Add a disk (Render dashboard → service → Disks, or uncomment the `disk:`
     block in `render.yaml`), e.g. mount at `/var/data`.
  2. Set `ROOM_STORAGE_FILE=/var/data/rooms.json`.
  3. The server writes atomically (temp file + rename) and restores rooms on
     restart, so reconnect-token holders can resume.
- **Disable persistence entirely** (always start clean): set
  `ROOM_STORAGE=memory`.
- **What's stored** (when persisted): game state, members + reconnect tokens,
  and the **salted password hash** — never the plaintext password. Treat the
  disk as sensitive; do not expose it publicly.

### Postgres room storage on Render (optional, Stage 2)

Instead of a disk, you can persist rooms to **Render PostgreSQL** — durable
without a paid disk, and the path forward for accounts/stats later.

1. **Create a Render PostgreSQL** instance; copy its **Internal Database URL**.
2. **Add env vars** to the Web Service:
   | Key | Value |
   |-----|-------|
   | `ROOM_STORAGE` | `pg` |
   | `DATABASE_URL` | _(the Render Postgres connection string)_ |
   (With `render.yaml`, uncomment the `DATABASE_URL` `fromDatabase` block.)
3. **Run the migration once** before the first pg start. Either:
   - set the **Start Command** to `npm run db:migrate && npm run server:prod`
     (simple; safe because the migration is idempotent), **or**
   - run `npm run db:migrate` once via a Render **Job**/one-off shell, keeping
     the Start Command as `npm run server:prod` (preferred if you don't want a
     migrate on every boot).
4. Deploy. The startup log shows `room storage: postgres` and
   `/health` reports `"db":"ok"`.

- **Fail-fast:** `ROOM_STORAGE=pg` without `DATABASE_URL` exits with a clear
  error — it never silently falls back.
- **Rollback:** remove `ROOM_STORAGE` (or set `=file`) and redeploy to return to
  the file/disk behaviour. The **non-DB deploy is unaffected** — leaving these
  unset keeps today's behaviour exactly.
- **Stage 2 stores rooms only** (no accounts/auth/stats yet). See `DB_SETUP.md`.

### Profiles, settings & sessions (optional, Stage 4)

Once `DATABASE_URL` is set and migrated (`0002_sessions_auth.sql` runs as part of
`npm run db:migrate`), the same Web Service also serves the **profile/settings
API** and **guest sessions** on the same port — no extra service. Add:

| Key | Value | Notes |
|-----|-------|-------|
| `DATABASE_URL` | _(Render Postgres URL)_ | enables `/api/*`; without it everything 503s and play is unaffected |
| `SESSION_SECRET` | _(strong random, e.g. `openssl rand -hex 32`)_ | **required in prod** — pepper for hashing session tokens; rotating it logs everyone out |
| `COOKIE_SECURE` | `true` | optional override; defaults to secure when `NODE_ENV=production` |
| `SESSION_TTL_DAYS` | `30` | optional; session lifetime (1..365) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | _(optional)_ | **Stage 6: Google sign-in** (see below). Unset → `/auth/google/start` 503s `oauth_disabled`, server runs normally. |
| `APP_ORIGIN` | `https://<your-domain>` | optional; canonical origin for the post-login redirect (defaults to the request host) |

- The client is served from the **same origin**, so credentialed `/api` fetches
  and the CSRF origin check work with no extra config. (Only a **split-origin**
  client needs its origin added to `ALLOWED_ORIGINS`.)
- **No login wall:** with or without these vars, local play and online guest
  rooms work. Migrations are idempotent — see the room-storage note above for
  running `npm run db:migrate` (a release step or one-off Job).

#### Troubleshooting: Profile shows `/api/me -> 503 (migration_required)`

`migration_required` means the database is **reachable but its schema is behind the code**
— a required `user_settings` column is missing (added by migrations **0005** `animation_preference`,
**0006** `favorite_game`, **0007** `card_face_theme`, **0008** `avatar_image_version`), so the
profile read throws Postgres `42703 undefined_column`. **Fix it by running the migrations** —
they are **idempotent** (`ADD COLUMN IF NOT EXISTS`), so re-running is safe:

```bash
# Render → your Web Service → "Shell" (or a one-off Job), with DATABASE_URL in the env:
npm run db:migrate
```

Docker vs native runtime does **not** matter — `db:migrate` only needs `DATABASE_URL`. Confirm
with `curl -s $HOST/health/diagnostics` → `"db":"enabled"` and `curl -s $HOST/api/me` → `200
{"authenticated":false}`. To avoid this after every schema change, make migrations part of the
**Start Command** (`npm run db:migrate && npm run server:prod`) or a release step. Until fixed,
`/api/me` returns the safe `migration_required` code (it does **not** pretend you're a signed-in
guest, because a Google sign-in would still fail to read the profile).

#### Troubleshooting: Profile shows a connection error / `/api/me -> 503 (db_error)`

`db_error` means the server is **up and same-origin**, but a profile/session query
hit the database and failed — the frontend, CORS, custom server, and PWA are **not**
the cause (the in-app **Copy diagnostics** button confirms `Origin: … (same-origin)`).
It is usually a **transient** Render free-tier Postgres event (cold-start after idle,
a dropped pooled connection, or connection-limit pressure). Distinct from
`migration_required` above (a schema drift), which needs `npm run db:migrate`.

- **`GET /api/me` no longer hard-fails on this** — it degrades to `200 {"authenticated":false}`
  (the visitor is treated as a guest, so the Profile shows **Sign in**, not a dead-end);
  the real identity returns on the next probe once the DB is back. Session-required
  routes (`/api/settings`, stats) still answer a safe `503 db_error` ("temporarily
  unavailable — retry"). No SQL, params, credentials, or emails are ever logged/returned.
- **Distinguish the cause** with `curl -s $HOST/health/diagnostics` → the `db` field is one of
  **`enabled`** (probe ok) / **`disabled`** (no `DATABASE_URL`) / **`error`** (probe `select 1`
  failed → unreachable/unhealthy) / **`migration_required`** (reachable but a required
  `user_settings` column is missing → run `npm run db:migrate`). The probe is cheap
  (`select 1` + an `information_schema` column check) and cached for ~30 s.
- **If `db` stays `error`:** check the Render **Postgres** instance is running and not
  suspended; confirm `DATABASE_URL` is present and correct (Render's *Internal* URL for a
  same-region service); ensure **migrations ran** (`npm run db:migrate`, idempotent) — a
  missing `user_settings` / `sessions` / `auth_accounts` / `user_avatars` table surfaces as
  `db_error` too. `DATABASE_POOL_MAX` (default 5) can be lowered on the free tier.

### Google sign-in (optional, Stage 6)

Lets a player link their guest progress (profile / settings / **per-game stats**) to a
Google account so it follows them across devices. Guest data is merged
server-side on first login — nothing is lost, and a returning Google account
never double-counts stats.

1. **Google Cloud Console** → *APIs & Services → Credentials* → **Create OAuth
   client ID** → *Web application*.
2. **Authorized redirect URI** (exact match, no trailing slash):
   `https://<your-render-domain>/auth/google/callback`
3. Copy the client id/secret into the Web Service env vars:

   | Key | Value |
   |-----|-------|
   | `GOOGLE_CLIENT_ID` | _(from Console)_ |
   | `GOOGLE_CLIENT_SECRET` | _(from Console)_ |
   | `GOOGLE_REDIRECT_URI` | `https://<your-render-domain>/auth/google/callback` |
   | `APP_ORIGIN` | `https://<your-render-domain>` |

4. `SESSION_SECRET` **must** be set (it also signs the OAuth state cookie).
5. Run migrations (`0004_auth_accounts_profile.sql` is idempotent). Done — the
   AccountPanel's **Sign in with Google** button is now live.

- Authorization-Code + **PKCE**; the OAuth `state` is a signed, 10-min cookie
  (CSRF). We validate the id_token's `iss`/`aud`/`exp`/`sub` and **store no
  Google access/refresh tokens** — only the stable `sub` + email/name/picture
  for display. See ARCHITECTURE_DB_AUTH.md §1.4/§3 Stage 6.

### Uploaded avatars — production readiness (optional, Stage 17)

Signed-in players can upload a custom avatar (processed server-side to a 192×192
WebP, stored in Postgres, shown on lobby/King-table seats). **Processing shells out
to the `ffmpeg` binary** (a deliberate no-native-dependency choice — see
AVATAR_UPLOAD_PLAN.md §3).

**Readiness conclusion for THIS repo's default deploy:** `render.yaml` uses
`runtime: node` (the native Node environment — **no `apt` packages, no Docker,
no ffmpeg**). So on a stock deploy **avatar upload is OFF**: `POST /api/me/avatar`
returns a clean **`503`** ("avatar processing unavailable"), and everything else —
gameplay, rooms, stats, emoji avatars, the profile "This device" local image —
works exactly as before. Every boot logs which state you are in:

```
[King] avatar uploads: ffmpeg found — uploads work when DATABASE_URL is set
[King] avatar uploads: ffmpeg NOT found — POST /api/me/avatar returns 503 (see RENDER_DEPLOY.md)
```

Uploads need **BOTH** a Postgres `DATABASE_URL` (with migrations applied) **and**
`ffmpeg` on the host. Enabling them is an explicit, owner-approved choice — **do not
switch the service to Docker unless you intend to**.

**Read readiness from diagnostics:** `curl -s $HOST/health/diagnostics` → `avatarUploads`:
- `status:"enabled"` (with `ffmpeg:true`, `database:true`) → uploads work;
- `status:"disabled"` + `reason` `no_ffmpeg` / `no_database` / `no_database_and_ffmpeg` →
  uploads answer a fast **`503`** and the Profile shows "unavailable" (emoji + local avatar
  still work);
- `status:"unknown"` → the boot ffmpeg probe hasn't resolved yet (retry in a moment).

The upload never leaves the button spinning: the client aborts after 30 s
(`AVATAR_UPLOAD_TIMEOUT_MS`) and **every server phase is bounded BELOW that** so the client
gets a real HTTP status, not its own timeout — body read `AVATAR_BODY_TIMEOUT_MS` (12 s →
`408 upload_timeout`), ffmpeg `AVATAR_FFMPEG_TIMEOUT_MS` (8 s → SIGKILL → `503
processing_unavailable`), DB write `AVATAR_DB_TIMEOUT_MS` (8 s → `503`).

**Client precompression (Stage 24.8) makes a timeout unlikely.** The browser decodes,
center-crops, resizes to 192×192, and re-encodes to a small WebP (JPEG fallback) targeting
**≤ 100 KB** BEFORE the POST — a multi-MB photo uploads as a ~1–3 KB payload, so `ffmpeg` and
the DB write finish in milliseconds. The server remains authoritative (still validates magic
bytes / size, re-encodes, strips metadata, whitelists png/jpeg/webp).

**Diagnosing a slow/failed upload from the logs.** `POST /api/me/avatar` emits a safe
phase trace (no filename / bytes / email / token / session / full userId) — read it in the
Render logs during an upload:

```
[King] avatar upload_start
[King] avatar auth_ok
[King] avatar content_length 84213
[King] avatar body_read_start
[King] avatar body_read_ok 84102     ← body received (bytes)
[King] avatar ffmpeg_start 84102
[King] avatar ffmpeg_ok 5820         ← processed WebP size
[King] avatar db_write_start
[King] avatar db_write_ok
[King] avatar response_sent 640      ← total ms
```

Where the trace STOPS tells you the culprit and the client's error code matches:
- stops after `body_read_start` → `body_read_timeout` (**408 upload_timeout**, client
  "server_timeout") — the body never fully arrived (Render proxy buffering / slow client);
- `ffmpeg_timeout` / `ffmpeg_unavailable` → **503 processing_unavailable** (ffmpeg slow or
  missing);
- `db_write_timeout` / `db_write_error` → **503 processing_unavailable** (Postgres write
  slow/unhealthy — check the DB instance + `DATABASE_POOL_MAX`);
- `magic_check_fail` → **415/400** (not a png/jpeg/webp, or corrupt).

The safe error code also shows in small text under the Profile message and in **Copy
diagnostics**, so a user can report the exact phase without guessing.

#### To ENABLE uploads on Render (two independent requirements)

1. **Database (see the Postgres section above).** Set `DATABASE_URL` and run the
   migrations so table `user_avatars` + `user_settings.avatar_image_version` exist:

   ```bash
   DATABASE_URL=<render-postgres-url> npm run db:migrate   # applies ALL *.sql in order, incl. 0008_avatar_upload
   ```

   `db:migrate` is idempotent (safe to re-run); **migration `0008` is required** for
   uploads (without it a signed-in `/api/me` still works, but uploads error).
   **No persistent disk is needed** — avatars live in Postgres as `bytea`, so they
   survive restarts/redeploys on the free tier (unlike `.data/rooms.json`).

2. **ffmpeg (the runtime binary).** The native `runtime: node` service can't `apt
   install`, so choose one:
   - **Recommended — Docker runtime (owner opt-in).** This repo now **ships a
     `Dockerfile`** (+ `.dockerignore`) that installs ffmpeg, runs `npm ci`, builds
     the client, and starts the SAME `npm run server:prod` command as the native
     path (Node 22 / npm 10; no secrets baked in). Switching runtimes does not change
     app behaviour — it only adds ffmpeg. Step by step on Render:

     1. **Web Service → Settings → Runtime → Docker** (Render auto-detects the root
        `Dockerfile`). In a Blueprint you would set `runtime: docker` instead of
        `runtime: node` — but `render.yaml` is intentionally left on `runtime: node`
        so the native path stays the default; flip it in the dashboard when you want
        uploads.
     2. Keep the env vars from the native service (`NODE_ENV`, `HOST=0.0.0.0`,
        `ALLOWED_ORIGINS`, `ROOM_TTL_HOURS`, …). **Do NOT** set `PORT` — Render injects
        it and the server binds `process.env.PORT`. Add `DATABASE_URL` (step 1) for
        uploads, and optionally `AVATAR_FFMPEG_TIMEOUT_MS`.
     3. **Migrations:** run once against the Postgres URL — either a Render **one-off
        job** / the service **Shell** (`npm run db:migrate`) or a pre-deploy step. It
        is idempotent, so re-running on later deploys is safe.
     4. **Deploy** and confirm the boot log shows `avatar uploads: ffmpeg found` (and
        `ffmpeg -version` works in the Shell).

     Build/verify the image locally the same way Render does:

     ```bash
     docker build -t card-majlis:test .
     docker run --rm -p 3005:3001 -e PORT=3001 card-majlis:test
     # → boot log includes: [King] avatar uploads: ffmpeg found …
     curl -s http://localhost:3005/health           # → ok
     ```
   - **Alternative — `FFMPEG_PATH`.** If your host already has an ffmpeg binary
     somewhere, set the env var `FFMPEG_PATH=/path/to/ffmpeg` (read at runtime) — no
     Docker needed.
   - **Do nothing** — leave the native runtime; uploads stay a clean `503` and the
     app is fully usable with emoji avatars.

3. **Tune (optional):** `AVATAR_FFMPEG_TIMEOUT_MS` (default `8000` ms) caps how long
   one conversion may run before the watchdog kills it.

#### Verify (in the Render shell / after deploy, signed in)

```bash
ffmpeg -version                 # in the Render Shell — confirms the binary exists (Docker path)
# then, from your machine (replace host + use your session cookie):
curl -i -X POST https://<host>/api/me/avatar -H "Cookie: king_session=<...>" -F file=@small.png
#   → 200 { "avatarImageUrl": "/api/avatar/<uuid>.webp?v=1" }   (uploads ON)
#   → 503 { "error": "unavailable" }                            (ffmpeg missing)
#   → 503 { "error": "db_disabled" }                            (no DATABASE_URL)
curl -i https://<host>/api/avatar/<uuid>.webp   # image/webp + nosniff + immutable cache
curl -i -X DELETE https://<host>/api/me/avatar -H "Cookie: king_session=<...>"  # → 200 { avatarImageUrl: null }
```

#### Storage sizing (Postgres `bytea`)

Each stored avatar is a 192×192 WebP, **hard-capped at 120 KB** (typical solid/photo
avatars land ~5–40 KB). One row per user (replacing overwrites, not appends). Rough
budget: **1,000 users ≈ 5–40 MB; 10,000 users ≈ 50–400 MB** — comfortably within
Render's free Postgres (~1 GB), and there is nothing to prune since each user keeps
at most one avatar.

Nothing here is required for gameplay — leave it all unset and the app runs exactly
as before, with emoji avatars only.

---

## Security notes

- **Render provides HTTPS/WSS.** Traffic (including the room password) is TLS-
  encrypted end to the load balancer — never plain `ws://` in production.
- **Room password is an MVP join gate, not authentication.** It is a salted hash
  controlling room entry only; there are no user accounts. Don't rely on it for
  anything sensitive.
- **Set `ALLOWED_ORIGINS` to your exact Render URL**, not `*`. With it unset the
  server allows any origin and only logs a warning in production.
- **Add rate limiting before a public launch** (per-IP connection/join limits)
  to blunt brute-forcing room codes/passwords. Render does not do this for you.
- **Logs never contain secrets** — only deal `seed`/`deckHash` for audit, never
  passwords, full hands, or the deck.
