# King — MVP Status

**Status: stable MVP.** Local pass-and-play and server-authoritative online play
both work end-to-end. This file is the single "start here" — for details see the
linked docs.

- Rules (source of truth): [`KING_RULES.md`](KING_RULES.md)
- Online design: [`ONLINE_ARCHITECTURE.md`](ONLINE_ARCHITECTURE.md)
- Deploy (VPS/HTTPS/WSS, PWA): [`DEPLOYMENT.md`](DEPLOYMENT.md)
- QA: [`QA_CHECKLIST.md`](QA_CHECKLIST.md)
- `GAP_ANALYSIS.md` is **historical/obsolete** — ignore for current state.

## What works

- **Game rules** (3p/4p): 32/52 decks, dealing, follow-suit, trick resolution
  with/without trump, all 7 modes, Dealer's Choice with per-dealer mode sets
  (9 games/dealer → 27 rounds 3p, 36 rounds 4p), kitty take + legal discard,
  scoring. Covered by unit tests.
- **Local pass-and-play**: single device, PassScreen handover, AI opponents.
- **Online (server-authoritative)**: Node `ws` server owns the GameState, runs
  the reducer, redacts hands per client. Lobby with room code, host start,
  per-turn screens, read-only waiting view.
- **Online bots**: the host can add server-side AI bots to free seats in the
  lobby (and remove them) before start — e.g. **2 humans + 1 bot** play a full
  3-player game. Bots run entirely on the server (no extra socket/client), play
  through the same authoritative reducer, and their hands are redacted like any
  opponent's. (See ONLINE_ARCHITECTURE.md → Online bots.)
- **Room discovery**: the Join screen lists open rooms from the server (tap to
  join; 🔒 protected rooms ask for a password). Manual room code still works.
- **Server-controlled deal** with per-round seed + deal audit log (server-side
  only; never sent to clients).
- **Reconnect & resume** after a tab reload / short drop (sessionStorage handle).
- **Optional room password** (salted hash; MVP gate, not auth).
- **Room persistence** to a JSON file → survives a server restart.
- **Room cleanup**: idle rooms (no connected players) expire after
  `ROOM_TTL_HOURS` (default 24); connected tables survive to
  `ROOM_HARD_TTL_HOURS` (default 48). A sweep runs **at startup** (logs restored
  vs. expired counts) and every `ROOM_CLEANUP_INTERVAL_MS`; expired rooms are
  also dropped from `rooms.json`. Manual/admin sweep: `npm run rooms:cleanup`
  (see DEPLOYMENT.md).
- **PWA**: installable on Android (manifest, icons, app-shell service worker).
- **Production path**: env config, `/health`, origin allowlist, HTTPS/WSS guide.
- **Profiles/auth foundation (partial — Stage 4)**: an **opt-in** HTTP API
  (`/api/me` · `/api/profile` · `/api/settings` · `/api/games/king/settings` ·
  `/api/guest-session` · `/api/logout`) on the **same port** as the WS server,
  backed by **DB-backed, revocable sessions** (httpOnly cookie; only a hashed
  token stored) and a **guest identity bridge** (no login wall). An optional
  account/profile area syncs display name, avatar, language, and the per-game
  King default timer, with **localStorage as the fallback**. With **no
  `DATABASE_URL` the whole API gracefully 503s and play is unaffected**. See
  [`ARCHITECTURE_DB_AUTH.md`](ARCHITECTURE_DB_AUTH.md) §3 Stage 4 and
  [`DB_SETUP.md`](DB_SETUP.md).
- **Google sign-in + guest merge (Stage 6)**: an active **Sign in with Google**
  button (Authorization-Code + PKCE; signed 10-min state cookie for CSRF). On
  login a guest's profile/settings/**King stats** are kept — a first-time login
  **promotes the guest in place**, a returning Google account **merges** the
  guest in (transactional, idempotent, **per `game_type`** — no stat loss or
  double-count). We store only the Google `sub` + email/name/picture, **never
  tokens**. `/api/me` reports `provider`/`email`; **Sign out** ends the session
  (a new guest can start again). **With no `GOOGLE_*` env the server runs exactly
  as before** and `/auth/google/start` 503s `oauth_disabled`. Setup:
  [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md) → Google sign-in.
- **Room social — reactions + chat (Stage 7)**: in an online room (lobby or
  game) players can send **whitelisted emoji reactions** (server-enforced **30s
  cooldown**) and **chat** (server-enforced **3s rate limit**, 160-char cap,
  layered **profanity filter** + URL stripping). Both are **ephemeral room-social
  state** — never in the game reducer/`GameState`, never persisted long-term
  (in-memory last-50 ring buffer; lost on restart), never in stats. Payloads
  carry no userId/session/token and no card data. A collapsible chat drawer +
  reaction bar overlay never cover the hand/trick and are mobile-clean (360/390,
  RTL). See [`ONLINE_ARCHITECTURE.md`](ONLINE_ARCHITECTURE.md) → Room social.
- **UI polish (Stage 7)**: a unified, casino/felt **segmented Profile /
  Statistics / Leaderboard** menu replaces the two separate toggles; card artwork
  is clipped to the rounded border with no duplicate suit/rank badge (full-image
  cards; Ace not cropped; face-down cards unchanged).
- **Stats & leaderboard (Stage 5 / 5.1 / 5.2)**: when a `DATABASE_URL` is set,
  finished **online** games record per-`(user, game_type)` stats (bots excluded;
  idempotent; **score-only**, no cards). `GET /api/games/king/stats` returns a
  full derived view (games, win rate, avg, **best/worst**, **trump/negative
  rounds**, per-mode breakdown, last game) and `GET /api/games/king/leaderboard`
  returns public rows (display name, **avatar**, counters, `self` marker — **no
  user id**). A collapsible **Statistics** panel in the start menu shows My stats
  + a mobile-clean leaderboard (no horizontal overflow, RTL-safe), degrading to a
  soft "unavailable" with **no DB** and "save progress" for signed-out guests.
  King fields live in the `user_stats.stats` JSONB (`STATS_VERSION = 2`; old rows
  read tolerantly, recomputable via `rebuildUserStats`). **No gameplay/rules/
  scoring change.** See [`ARCHITECTURE_DB_AUTH.md`](ARCHITECTURE_DB_AUTH.md)
  §3 Stage 5/5.1/5.2.

## Run it

### Local pass-and-play (or dev)
```bash
npm install
npm run dev            # http://localhost:5173 → "Local game"
```

### LAN online (one machine hosts)
```bash
npm run server            # ws://0.0.0.0:3001
npm run dev -- --host     # client on your LAN IP
```
Players open `http://<host-ip>:5173` → Host/Join online → room code.

### VPS / production (HTTPS + WSS)
See [`DEPLOYMENT.md`](DEPLOYMENT.md). In short:
```bash
npm run build
HOST=127.0.0.1 PORT=3001 ALLOWED_ORIGINS=https://your-domain npm run server:prod
# reverse proxy (Caddy/nginx) terminates TLS, serves dist/, upgrades /ws → :3001
# build client for the proxied socket: VITE_WS_URL=wss://your-domain/ws npm run build
```

### PWA install
Open the HTTPS site on Android Chrome → menu → **Install app**. Installability
needs HTTPS; online play needs a network. See [`DEPLOYMENT.md`](DEPLOYMENT.md) §7.

## Verify
```bash
npm test          # unit + pure-logic tests
npm run build     # type-check + production build
npm run e2e       # full online flow over WS (spawns + restarts a server)
```

### Scripts
| Script | Purpose |
|--------|---------|
| `dev` | Vite dev server (client) |
| `build` | type-check + production build to `dist/` |
| `preview` | preview the production build |
| `test` / `test:watch` | unit tests (Vitest) |
| `e2e` | end-to-end online scenario over WebSocket |
| `server` | server-authoritative WS server (dev/LAN) |
| `server:prod` | same, `NODE_ENV=production` (VPS) |
| `server:relay` | legacy host-authoritative relay (deprecated) |
| `icons` | regenerate PWA icons |

## Known limitations

- Online expects all seats to be **human** (no AI online).
- Room password is an **MVP gate**, not authentication; production needs **WSS**
  + rate limiting (not implemented yet).
- Persistence is a single JSON file, single server instance.
- Public screens advance on a server timer; no manual skip online.
- Resume is per-tab `sessionStorage`; needs the room still in the server store.

## Recommended next steps (after manual LAN/mobile QA)

1. Run the manual [`QA_CHECKLIST.md`](QA_CHECKLIST.md) on real phones (LAN + PWA install).
2. Add join **rate limiting** and deploy behind **WSS** before any public launch.
3. (Scale) move persistence to Redis/DB via the `RoomStorage` interface.
4. (Optional) AI fill for online seats; public deal-commitment for verifiable fairness.
