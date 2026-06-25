# Deploy King to Render (single Web Service)

The simplest hosted path: **GitHub repo → Render Web Service → Deploy**. One
service serves both the **frontend** and the **WebSocket** on the same domain,
and Render provides **HTTPS/WSS** automatically.

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

   - **Do NOT set `PORT`.** Render injects it; the server reads `process.env.PORT`.
   - **`VITE_WS_URL` is optional on Render.** Same-origin hosting means the client
     auto-derives `wss://<this-domain>/ws`. Set it only if you host the client on
     a different domain. If you do set it, it is baked in at build time, so a
     **redeploy** (rebuild) is required for a change to take effect.

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

### Google sign-in (optional, Stage 6)

Lets a player link their guest progress (profile/settings/**King stats**) to a
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
