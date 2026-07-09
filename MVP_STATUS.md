# King — MVP Status

**Status: stable MVP.** Local pass-and-play and server-authoritative online play
both work end-to-end. This file is the single "start here" — for details see the
linked docs.

- Rules (source of truth): [`KING_RULES.md`](KING_RULES.md)
- Online design: [`ONLINE_ARCHITECTURE.md`](ONLINE_ARCHITECTURE.md)
- Deploy (VPS/HTTPS/WSS, PWA): [`DEPLOYMENT.md`](DEPLOYMENT.md)
- QA: [`QA_CHECKLIST.md`](QA_CHECKLIST.md)
- `GAP_ANALYSIS.md` is **historical/obsolete** — ignore for current state.

**Games shipped (all `available`, local + server-authoritative online, each
recording its own per-`game_type` stats + leaderboard):**

| Game | Players | Notes |
|------|---------|-------|
| **King** (default) | 3–4 | 7 modes, Dealer's Choice; source of truth [`KING_RULES.md`](KING_RULES.md) |
| **Durak** | 2–5 | Simple + Transfer variants; [`DURAK_RULES.md`](DURAK_RULES.md) |
| **Deberc** | 3–4 | 3 solo / 4 team, target 510/1020; [`DEBERC_RULES.md`](DEBERC_RULES.md) |
| **Tarneeb** | 4 | Fixed 2×2 partnerships, bid 7–13, target 41; [`TARNEEB_RULES.md`](TARNEEB_RULES.md) |

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
- **Reconnect & resume** after a tab reload / short drop (localStorage handle).
- **Optional room password** (salted hash; MVP gate, not auth).
- **Room persistence** to a JSON file → survives a server restart.
- **Room cleanup**: idle rooms (no connected players) expire after
  `ROOM_TTL_HOURS` (default 24); connected tables survive to
  `ROOM_HARD_TTL_HOURS` (default 48). A sweep runs **at startup** (logs restored
  vs. expired counts) and every `ROOM_CLEANUP_INTERVAL_MS`; expired rooms are
  also dropped from `rooms.json`. Manual/admin sweep: `npm run rooms:cleanup`
  (see DEPLOYMENT.md).
- **Orphan cleanup + disconnected substitute (Stage 7.2)**: a room with **no
  connected human** (only bots/offline humans) is deleted after
  `ORPHAN_ROOM_TTL_MS` (default **15 min**) — lobby or active game. A human who
  **disconnects mid-game is not played for instantly**: when their turn comes the
  server waits `DISCONNECTED_SUBSTITUTE_DELAY_MS` (default **2 min**, or the room
  turn timer if shorter) then plays a **legal AI move** for them via the normal
  reducer path; they **stay a human seat** (stats still theirs) and **reconnect
  cancels** the substitute. The waiting screen shows "📴 Waiting for X to
  reconnect…". No rules/scoring change. See ONLINE_ARCHITECTURE.md §3.
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
- **UI polish (Stage 7)**: card artwork is clipped to the rounded border with no
  duplicate suit/rank badge (full-image cards; Ace not cropped; face-down cards
  unchanged).
- **Main-menu redesign (Stage 7.1)**: a premium mobile card-game layout — a **top
  account bar** (avatar + name, **Sign in / Sign out** here, not buried in a tab),
  three large **action tiles** (Play locally / Host / Join) with a prominent
  **Resume** continue card, and a secondary **Profile / Statistics / Leaderboard**
  drawer that keeps the first screen uncluttered. Host/Join are dedicated sheets
  (segmented controls, unified fields). The **language selector lives only in
  Profile** now. RTL-safe, no horizontal overflow at 360/390. No gameplay/server
  change.
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
npm run verify           # typecheck:server + test + build + e2e, run SEQUENTIALLY
# …or individually:
npm run typecheck:server # server/index.ts import graph (tsc -p tsconfig.server.json)
npm test                 # unit + pure-logic tests
npm run build            # client type-check + production build
npm run e2e              # full online flow over WS (spawns + restarts a server)
```
> Run heavy checks **sequentially** on the Windows dev box — parallel `test`+`build`+`tsc`
> has intermittently OOM'd (VirtualAlloc); `npm run verify` chains them one at a time.
> Gated DB stats tests need `TEST_DATABASE_URL` (else skipped).

### Scripts
| Script | Purpose |
|--------|---------|
| `dev` | Vite dev server (client) |
| `build` | type-check + production build to `dist/` |
| `preview` | preview the production build |
| `test` / `test:watch` | unit tests (Vitest) |
| `verify` | typecheck:server + test + build + e2e, **sequentially** |
| `typecheck` / `typecheck:server` | client / server type-check (no emit) |
| `e2e` | end-to-end online scenario over WebSocket |
| `server` | server-authoritative WS server (dev/LAN) |
| `server:prod` | same, `NODE_ENV=production` (VPS) |
| `icons` | regenerate PWA icons |

## Known limitations

- Room password is an **MVP gate**, not full moderation/auth; production should
  keep **WSS** enabled before a public launch.
- **Per-connection** WS rate limiting is in place (message + CREATE_ROOM token
  buckets, env-tunable via `WS_MSG_BURST`/`WS_MSG_PER_SEC`/`WS_CREATE_BURST`/
  `WS_CREATE_PER_SEC`). It caps amplification through one socket; **per-IP /
  connection-count** limiting is still an infra/proxy concern for a public launch.
- The production server is still a **single Node instance**. Rooms can persist to
  Postgres (`ROOM_STORAGE=pg`), but horizontal scaling needs Redis/pub-sub or
  sticky sessions.
- Public screens advance on a server timer; no manual skip online.
- Chat/reactions are ephemeral in-memory room-social state; they disappear on a
  server restart.
- Disconnected humans are AI-substituted after a delay, but there is no full
  spectator/admin moderation console yet.

## Recommended next steps (after manual LAN/mobile QA)

1. Run the manual [`QA_CHECKLIST.md`](QA_CHECKLIST.md) on real phones (LAN + PWA install).
2. Add join/create **rate limiting** before any broader public launch.
3. **Durak (released — `available`, Stage 9.13).** Local Durak (simple + transfer)
   and **online Durak** rooms (host/join with bots) are fully playable — King
   state/action are a union over the wire, hands are redacted per game, the
   not-your-turn view is read-only ("bot thinking / waiting / offline — AI may
   play"), and reconnect/restart/leave/chat all work (QA'd via a full-game +
   multi-human e2e with no redaction leak). The **release audit** verified the
   state machine + invariants, online authorization/redaction (acting seat is
   derived server-side; Durak actions carry no spoofable actor), restart/reconnect
   during defense/taking/transfer, and a deterministic bot soak (`npm run soak` —
   2/3/4 players × simple/transfer × 30 seeds = 180 games, all invariants hold).
   The **Experimental** label has been removed from the menu, Host sheet, and
   Lobby. **Durak now records outcome stats** (`recordsStats: true`, fool/draw)
   with its own leaderboard, alongside King/Deberc/Tarneeb. Spec:
   [`DURAK_RULES.md`](DURAK_RULES.md); design: [`DURAK_PLAN.md`](DURAK_PLAN.md).
4. **Deberc + Tarneeb are released** (`available`) — local + online with
   per-`game_type` stats + leaderboards. Deberc records team outcome + jackpot +
   an aggregate **combination breakdown** (terz/platina/bella counts + meld
   frequency, Stage 13.8 — counts only, never cards);
   Tarneeb records win/loss + contract success + team score (score-only, no cards).
   Specs: [`DEBERC_RULES.md`](DEBERC_RULES.md) / [`TARNEEB_RULES.md`](TARNEEB_RULES.md).
5. (Scale) add Redis/pub-sub only if one Node process is no longer enough.
6. (Optional) public deal-commitment for verifiable fairness.
