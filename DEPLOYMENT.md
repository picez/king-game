# Deployment — Card Majlis (VPS, HTTPS/WSS)

This is the practical path to run Card Majlis online on a VPS with TLS, so the client
loads over **HTTPS** and the WebSocket connects over **WSS**. LAN/dev stays
trivial (see the last section).

See also: `ONLINE_ARCHITECTURE.md` (how online works) and the security notes
at the end of this file.

> **Just want the easiest hosted deploy?** Use **Render** — one Web Service
> serves both the client and the WebSocket on one HTTPS domain, no proxy to
> configure. See **`RENDER_DEPLOY.md`** (+ `render.yaml`). The VPS path below is
> for self-hosting with Caddy/nginx.
>
> **Docker (optional):** the repo ships a root **`Dockerfile`** (+ `.dockerignore`)
> that adds **ffmpeg** so server avatar upload works in production. It runs the same
> build + `npm run server:prod`; switch the Render service Runtime to **Docker** to
> use it (the default stays native `runtime: node`, where uploads return `503`). See
> **`RENDER_DEPLOY.md → "Uploaded avatars"`**.
>
> **After deploying,** run the quick [`PRODUCTION_SMOKE.md`](PRODUCTION_SMOKE.md)
> checklist (10–15 min) to confirm health / games / rooms / stats / avatars / social.

## 1. What runs where

| Piece              | What it is                          | How it's served            |
|--------------------|-------------------------------------|----------------------------|
| Client (`dist/`)   | Static Vite build (HTML/JS/CSS)     | Served by the reverse proxy |
| Server (`server/index.ts`) | Node + `ws`, server-authoritative | Run with `npm run server:prod`, fronted by the proxy for WSS |

A small `GET /health` endpoint on the server returns
`{"status":"ok","rooms":N,"uptime":S}` for proxy/uptime checks.

## 1b. Ubuntu VPS quick start (end-to-end)

Assumes a fresh Ubuntu 22.04/24.04 VPS, a domain you control, and SSH access.

```bash
# 1) Base packages: Node 20 LTS + Caddy + git
sudo apt update && sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# 2) Service user + app directory
sudo useradd --system --create-home --home-dir /srv/king --shell /usr/sbin/nologin king
sudo -u king git clone <your-repo-url> /srv/king        # or rsync the project in
cd /srv/king

# 3) Install deps and build the client (bake in the WSS /ws URL)
sudo -u king npm ci
sudo -u king env VITE_WS_URL=wss://king.example.com/ws npm run build

# 4) Configure environment
sudo -u king cp .env.example .env
sudo -u king sed -i 's#https://<domain>#https://king.example.com#' .env
sudo -u king mkdir -p .data && sudo chmod 700 /srv/king/.data

# 5) Run the server under systemd
sudo cp deploy/king.service /etc/systemd/system/king.service
sudo systemctl daemon-reload
sudo systemctl enable --now king
curl -s http://127.0.0.1:3001/health        # {"status":"ok",...}

# 6) Reverse proxy + automatic HTTPS
sudo sed -i 's/king.example.com/king.example.com/' /srv/king/Caddyfile   # set your domain
sudo cp /srv/king/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy

# 7) Open the firewall (if ufw is on)
sudo ufw allow 80,443/tcp
```

**DNS:** point an `A` record (and `AAAA` if you have IPv6) for `king.example.com`
at the VPS public IP. Wait for it to resolve, then Caddy issues the certificate
on first request. Verify: `curl -s https://king.example.com/health`.

## 2. Server environment config

All optional; defaults keep LAN/dev simple.

| Env var           | Default       | Purpose                                                        |
|-------------------|---------------|---------------------------------------------------------------|
| `PORT`            | `3001`        | Listen port.                                                  |
| `HOST`            | `0.0.0.0`     | Bind address. Behind a proxy on the same box use `127.0.0.1`. |
| `NODE_ENV`        | `development` | `production` enables stricter startup warnings.               |
| `ALLOWED_ORIGINS` | _(empty)_     | Comma-separated browser origins allowed to connect, e.g. `https://king.example.com`. Empty = allow any (LAN/dev). Non-browser clients (no Origin header) are always allowed. |
| `ROOM_STORAGE`    | _(file)_      | `file` (default) → JSON file; `memory` → no persistence (rooms lost on restart); `pg` → Postgres (Stage 2, **requires `DATABASE_URL`**). |
| `ROOM_STORAGE_FILE` | `.data/rooms.json` | Path to the rooms JSON file (overrides `DATA_DIR`). File mode only. |
| `DATA_DIR`        | `.data`       | Directory for `rooms.json` when `ROOM_STORAGE_FILE` is unset. File mode only. |
| `DATABASE_URL`    | _(unset)_     | Postgres connection string. Required when `ROOM_STORAGE=pg`; also enables the `/health` DB probe **and the Stage 4 `/api/*` profile/settings/session surface**. Unset = file/memory + every `/api/*` returns 503 (play unaffected). |
| `DATABASE_POOL_MAX` | `5`         | Max Postgres connections in the pool (pg mode). |
| `SESSION_SECRET`  | _(empty)_     | Stage 4: server-side pepper for hashing session tokens. **Required in production** (e.g. `openssl rand -hex 32`); rotating it invalidates all sessions. |
| `COOKIE_SECURE`   | _(prod=on)_   | Stage 4: force the `Secure` session-cookie flag (`true`/`false`). Default = secure when `NODE_ENV=production`, off on dev `http://localhost`. |
| `SESSION_TTL_DAYS`| `30`          | Stage 4: session lifetime in days (clamped 1..365). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | _(unset)_ | **Stage 6: Google sign-in.** Set all three to enable. While any is unset, `/auth/google/start` returns 503 `oauth_disabled` and the server runs normally (guest/local play unaffected). `GOOGLE_REDIRECT_URI` must EXACTLY match the Authorized redirect URI in Google Cloud Console: `https://<your-domain>/auth/google/callback`. |
| `APP_ORIGIN`      | _(request)_   | Stage 6: canonical app origin used for the post-login redirect (`https://<domain>`). Defaults to the request's host when unset. |
| `FFMPEG_PATH`     | _(ffmpeg)_    | **Stage 17: avatar uploads.** Path to the `ffmpeg` binary used to process uploaded avatars. Defaults to `ffmpeg` on `PATH`. If ffmpeg is absent, `POST /api/me/avatar` returns a clean `503` and the app is otherwise unaffected (emoji avatars everywhere). Uploads also require `DATABASE_URL` + migration `0008`. See RENDER_DEPLOY.md → "Uploaded avatars". Every boot logs `avatar uploads: ffmpeg found/NOT found`. |
| `AVATAR_FFMPEG_TIMEOUT_MS` | `8000` | Stage 17.4: watchdog — max ms one avatar conversion may run before ffmpeg is killed and the upload fails cleanly. |
| `ROOM_TTL_HOURS`  | `24`          | Idle rooms with **no connected players** are deleted after this many hours. |
| `ROOM_HARD_TTL_HOURS` | `48`      | Rooms with a connected player survive until this hard cap (so an active table is never yanked). |
| `ORPHAN_ROOM_TTL_MS` | `900000`   | **Stage 7.2:** an orphan room (no connected human — only bots/offline humans) is deleted after this many ms (15 min). Applies to lobby AND active game. |
| `DISCONNECTED_SUBSTITUTE_DELAY_MS` | `120000` | **Stage 7.2:** when a disconnected human's turn comes, wait this long (ms) before an AI plays a legal move for them (2 min). A shorter enabled room turn timer takes precedence; reconnecting cancels it; the seat stays human. |
| `ROOM_CLEANUP_INTERVAL_MS` | `600000` | How often (ms) the server sweeps for expired rooms. Cleanup also runs once at startup. |

## 3. Build & run

```bash
npm ci                        # full install — devDeps included (see note below)
VITE_WS_URL=wss://king.example.com/ws npm run build   # static client → dist/

# Run the server (Linux/VPS). Bind to localhost when a proxy terminates TLS:
HOST=127.0.0.1 PORT=3001 ALLOWED_ORIGINS=https://king.example.com npm run server:prod
```

> **devDependencies are required at runtime.** The server runs the TypeScript
> directly via `tsx` (a devDependency), and `npm run build` needs `vite`/`tsc`
> (also devDeps). So install with `npm ci` (NOT `npm ci --omit=dev`). If you
> build on a separate machine and ship only `dist/` + `server/` to the VPS, the
> runtime host still needs `tsx` installed.

> **`VITE_WS_URL` is effectively required here.** With the path-based proxy
> below (WS on `/ws`), the client must be built with `VITE_WS_URL=wss://<domain>/ws`.
> Without it, an HTTPS page defaults to `wss://<host>` (root), which the proxy
> serves as static files — the socket never reaches the server. See §5.

Copy `.env.example` → `.env` and edit it; systemd loads it via `EnvironmentFile`.

Keep it running with **systemd** (recommended) or **pm2**:

```bash
# systemd (unit provided at deploy/king.service)
sudo cp deploy/king.service /etc/systemd/system/king.service
sudo systemctl daemon-reload
sudo systemctl enable --now king
journalctl -u king -f          # follow logs; expect the startup line

# or pm2
pm2 start "npm run server:prod" --name king --update-env
pm2 save && pm2 startup        # survive reboots
```

Smoke check:

```bash
curl -s http://127.0.0.1:3001/health      # {"status":"ok",...}
```

## 4. Reverse proxy + TLS (Let's Encrypt)

The proxy terminates HTTPS, serves the static `dist/`, and upgrades the
WebSocket to the Node server over `wss://`. Routing WS by path `/ws` keeps the
client on a single origin (simplest CSP / no extra subdomain).

### Caddy (auto HTTPS) — `Caddyfile`

A ready-to-edit `Caddyfile` ships in the repo root (static `dist/`, WS proxy on
`/ws`, `/health` proxy, SPA fallback, security headers). Replace the domain, then:

```bash
sudo cp /srv/king/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy        # Caddy obtains/renews TLS automatically
```

```caddy
king.example.com {
    encode gzip zstd

    @ws path /ws /ws/*
    reverse_proxy @ws 127.0.0.1:3001        # WebSocket → Node (auto-upgrades)

    @health path /health
    reverse_proxy @health 127.0.0.1:3001    # health check → Node

    root * /srv/king/dist                   # everything else → static SPA
    try_files {path} /index.html
    file_server
}
```

### nginx — `/etc/nginx/sites-available/king`

```nginx
server {
    listen 443 ssl;
    server_name king.example.com;

    ssl_certificate     /etc/letsencrypt/live/king.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/king.example.com/privkey.pem;

    root /srv/king/dist;
    index index.html;

    # WebSocket → Node server (note the upgrade headers)
    location /ws {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;       # keep long-lived sockets open
    }

    # Static SPA
    location / {
        try_files $uri /index.html;
    }
}
# Obtain/renew the cert with: certbot --nginx -d king.example.com
```

> The server shares its HTTP port with the WS upgrade, so `/health` is reachable
> through the same upstream (e.g. proxy `location = /health` to `127.0.0.1:3001`
> if you want external health checks).

## 5. Point the client at WSS

The client picks the server URL in this order:

1. **`VITE_WS_URL`** (build-time) — set it to the proxied WSS URL and rebuild:
   ```bash
   VITE_WS_URL=wss://king.example.com/ws npm run build
   ```
2. Otherwise, on an **HTTPS** page it defaults to `wss://<host>` (so it never
   suggests insecure `ws://`); on **HTTP/LAN** it defaults to `ws://<host>:3001`.

If a user is on an HTTPS page but types a `ws://` address, the start menu shows
a mixed-content warning (the browser would block it).

## 6. Security notes (read before a public launch)

- **Always use WSS in production.** Over plain `ws://`, the room password (and
  everything else) is sent in clear text. TLS via the proxy fixes this.
- **Room password is an MVP gate, not authentication.** It's a salted but
  lightweight hash and only controls joining a room — there are no user
  accounts. Don't rely on it for anything sensitive.
- **Add rate limiting** (per-IP connection/join limits at the proxy or in the
  server) before exposing publicly, to blunt brute-forcing room codes/passwords.
- **Set `ALLOWED_ORIGINS`** in production so only your site's origin may open a
  socket; in `production` the server warns if it's unset.
- **Rooms persist to a JSON file** and survive a restart (§6b). It's a sensitive
  file (full hands + reconnect tokens) — `chmod 600`, keep it out of `dist/`, and
  encrypt backups. For multi-instance/scale, move to Redis/DB.
- **Logs never contain secrets.** The server logs deal `seed`/`deckHash` for
  audit but never passwords, full hands, or the full deck. Keep it that way if
  you add logging.

## 6b. Room persistence & backups

By default the server persists rooms to a JSON file so a restart/redeploy does
not drop in-progress games. Players who kept their reconnect token (tab still
open, or session in `sessionStorage`) can `RECONNECT` after a restart.

- **Location**: `ROOM_STORAGE_FILE` (or `<DATA_DIR>/rooms.json`, default
  `.data/rooms.json`). Put `DATA_DIR` on a persistent volume on the VPS.
- **Disable**: `ROOM_STORAGE=memory` (e.g. ephemeral/throwaway servers).
- **Atomic & safe**: writes go to a temp file then `rename`; a corrupt file is
  logged and ignored (server starts empty) rather than crashing.
- **What's on disk**: game state, members + reconnect tokens, the salted
  password **hash** (never plaintext), and the private deal audit log
  (seeds/deckHash). Treat `rooms.json` as **sensitive** — it contains full
  hands and reconnect tokens:
  - restrict file permissions (`chmod 600`, owned by the service user);
  - keep it out of web-served paths (it's under the app dir, not `dist/`);
  - if you back it up, encrypt/limit access to the backup.
- **Limitations**: single-file, single-instance MVP. For multiple instances or
  high volume, move to Redis/DB (the `RoomStorage` interface is the seam).

### Postgres room storage (optional, Stage 2)

The same `RoomStorage` seam now has a Postgres backend, selected with
`ROOM_STORAGE=pg`. It is **opt-in** — with `DATABASE_URL` unset (or
`ROOM_STORAGE` left at its file default) nothing changes.

1. **Provision Postgres** and set `DATABASE_URL`
   (`postgres://user:pass@host:5432/king`).
2. **Run migrations once** before starting in pg mode:
   ```bash
   DATABASE_URL=postgres://… npm run db:migrate
   ```
   Migrations are **not** run automatically on server start (avoids racing
   schema changes across instances/redeploys). Run them as a deliberate step.
3. **Start in pg mode:**
   ```bash
   ROOM_STORAGE=pg DATABASE_URL=postgres://… npm run server:prod
   ```
   On boot the server preloads rooms from Postgres, then behaves identically
   (restore, reconnect, TTL cleanup). If `ROOM_STORAGE=pg` and `DATABASE_URL` is
   missing, the server **fails fast** with a clear error rather than silently
   losing persistence.
- **Rollback to file storage:** unset `ROOM_STORAGE` (or set `ROOM_STORAGE=file`)
  and restart. No data migration is required to switch back; the two stores are
  independent.
- **What's stored:** one `rooms` row per room — the full `PersistedRoom` as JSONB
  (same shape as `rooms.json`), plus `game_type` (`'king'` today, the multi-game
  foundation) and `updated_at` for TTL. See `DB_SETUP.md` and
  `ARCHITECTURE_DB_AUTH.md`.
- **Stage 2 limits:** rooms only. No user accounts/auth/profiles/stats yet
  (later stages). Reconnect tokens are stored inside the JSONB payload as today
  (hashing them is a later-stage hardening).

### Cleaning up old / inactive rooms

The server removes stale rooms automatically and also lets you sweep on demand:

- **At startup**: immediately after restoring persisted rooms, the server runs
  one cleanup pass and deletes anything already past its TTL — it does **not**
  wait for the first interval. The startup log line reports how many rooms were
  restored and how many expired were removed, e.g.
  `[King] startup: restored 3 room(s) from storage, removed 2 expired (TTL 24h, hard TTL 48h)`.
- **Periodically**: every `ROOM_CLEANUP_INTERVAL_MS` (default 10 min) the same
  sweep runs; each removed room is logged (`auto-cleaned idle room <CODE>`) and
  dropped from `rooms.json`.
- **Rules**: a lobby / in-game room with **no connected players** is deleted
  once idle longer than `ROOM_TTL_HOURS`; a room with at least one connected
  player is kept until `ROOM_HARD_TTL_HOURS`.
- **Manual / admin sweep** (no server needed): `npm run rooms:cleanup` loads the
  configured storage, deletes expired rooms from `rooms.json`, prints a summary,
  and exits. Honours the same `ROOM_STORAGE*`, `DATA_DIR`, `ROOM_TTL_HOURS` and
  `ROOM_HARD_TTL_HOURS` env vars. Since rooms on disk have no live sockets, all
  are treated as idle — handy for trimming a file before a redeploy. To start
  with a clean slate instead, run with `ROOM_STORAGE=memory` (no persistence) or
  delete `rooms.json` while the server is stopped.

## 7. Install as an app (PWA / Android)

The client ships a web app manifest (`public/manifest.webmanifest`), maskable
icons (`public/icons/*`, regenerate with `npm run icons`) and a minimal
service worker (`public/sw.js`). No React Native / Flutter — it's an installable
web app.

**Install on Android (Chrome):** open the HTTPS site → menu **⋮ → Add to Home
screen / Install app**. It launches standalone (no browser chrome), portrait,
with the King icon.

Requirements & behaviour:

- **Installability needs HTTPS** (so production must be served over TLS, per the
  sections above). On `http://` LAN the app still runs, just isn't installable.
- The service worker registers **only in production builds** (`import.meta.env.PROD`),
  so `npm run dev` is never fighting a stale cache.
- **Service worker = app shell only.** It is network-first and caches only
  same-origin GET responses at runtime (HTML/JS/CSS/icons). WebSocket traffic
  (`ws://`/`wss://`) never passes through it, so **no game state or hand is ever
  cached.**
- **Offline:** after one online load, the **local pass-and-play** game works
  offline from the cached shell. **Online play requires a network connection**
  (it needs the WebSocket server); offline it will sit on "Connecting…/Reconnecting…".
- To point an installed build at your server, build with `VITE_WS_URL=wss://your-domain/ws`.

## 8. LAN / dev (unchanged, no TLS needed)

```bash
npm install
npm run server            # ws://0.0.0.0:3001 (open, no origin allowlist)
npm run dev -- --host     # Vite on your LAN IP
```

Other players open `http://<host-ip>:5173`, the client defaults to
`ws://<host-ip>:3001`, enter the room code (and password if the host set one).
