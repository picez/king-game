# Card Majlis — MVP Status

> **Product = Card Majlis** (Stage 14.0 rebrand) — a card lounge for four games:
> **King, Durak, Deberc, Tarneeb**. "King" now refers ONLY to the King game, not the
> app. Internal ids stay legacy: package `king-card-game`, `king.*` localStorage
> keys, `game_type='king'`, `king-game` repo — no rename/migration.

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
- **PWA**: installable on Android (manifest, icons, app-shell service worker). App
  icon = the **Card Majlis medallion** (emerald coin + gold 8-point Levantine star +
  four suit pips); procedural, `npm run icons`.
- **Production path**: env config, `/health`, origin allowlist, HTTPS/WSS guide.
- **Profiles/auth foundation (partial — Stage 4)**: an **opt-in** HTTP API
  (`/api/me` · `/api/profile` · `/api/settings` · `/api/games/king/settings` ·
  `/api/guest-session` · `/api/logout`) on the **same port** as the WS server,
  backed by **DB-backed, revocable sessions** (httpOnly cookie; only a hashed
  token stored) and a **guest identity bridge** (no login wall). An optional
  account/profile area syncs display name, avatar, language, and the per-game
  King default timer, with **localStorage as the fallback**. A **custom avatar
  image** (Stage 14.1) is **local-only** — re-encoded client-side to a small data
  URL in `localStorage`, **never uploaded / synced / on the wire**; the whitelisted
  **emoji** stays the server-safe identity online. With **no
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
- **Achievements / badges foundation (Stage 16.0)**: a Profile **Achievements**
  tab (4th tab, next to Account / My stats / Leaderboard) showing 11 badges in a
  compact grid — earned = gold coin, locked = muted padlock with the goal still
  shown. Badges are a **pure client-side catalog** (`src/stats/achievements.ts`,
  `evaluateAchievements(AllStats)`) **derived entirely from the existing per-game
  stats** — **no new DB column, no server route, no write path, no popups**, and
  nothing from private/card-level or chat data. Missing/unloaded stats → locked;
  a clean no-session state shows the sign-in hint. Badges: First Win, Veteran (25),
  Centurion (100), All-Rounder (win all 4), King Winner, Durak Survivor, Tarneeb
  Bidder / Contractor (5), Deberc Meld Maker (10) / Bella / Jackpot. i18n ×4.
- **Achievement unlock toast (Stage 16.1)**: a compact, non-blocking
  "Achievement unlocked" toast surfaced **only on the Profile screen after the
  stats resolve** — never during active gameplay, never over cards/hands. A
  **device-local seen ledger** (`src/stats/achievementsSeen.ts`,
  `localStorage` key `cardMajlis.achievementsSeen.v1`) records which earned
  badges have been announced; earned-but-unseen ids queue into
  `AchievementToast` (walks one badge at a time, "+N more" chip + Next; ✕ closes
  the queue). Dismiss persists the ids (`markSeen`) so nothing re-announces. The
  Achievements grid shows a gold **"New"** chip on unseen earned badges. Logged
  out / missing stats → no toast. Motion-aware (full = slide/fade, reduced =
  fade, off = instant); **no sound**. **No DB / server / WS / gameplay change.**

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

### Toolchain (Stage 14.3)
- **Node 22** everywhere: CI (`.github/workflows/ci.yml` → `node-version: '22'`,
  `actions/checkout@v5` + `actions/setup-node@v5`) and local (`.nvmrc` /
  `.node-version` = `22`). No `engines` field — policy is documented, not enforced,
  so Render deploys are unaffected.
- **Install with `npm ci`** (reads the lock, never rewrites it). The committed
  `package-lock.json` is maintained with **npm 10**; do **not** commit npm-11
  lockfile churn (`libc` fields → breaks CI `npm ci`). See QA_CHECKLIST → *Toolchain*.

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

- **Sound: ALERT-ONLY, default OFF.** The MVP SFX set exists — **12 sounds × webm+mp3
  (~55 KB) under `public/sounds/`** + a manifest (`src/audio/soundAssets.ts`), generated
  dep-free by `npm run sounds` (Stage 15.1). A **sound preference** (Profile → Appearance,
  `off/subtle/full`, **default off**, **local-only** under `cardMajlis.sound.v1` — no
  profile/DB sync) drives a **client-side engine** (`src/audio/soundEngine.ts`, lazy,
  no-op when off/hidden/throttled) — 15.2. **Stage 15.4 re-scoped sound to useful ALERTS,
  not atmosphere:** the brief Stage 15.3 decorative cues (card-play / trick-collect /
  trump-reveal / finish) were **removed**. The only wired sound now is a **low-time
  alert** — one `ui-error` cue when my turn timer crosses below 10s on my turn (King
  online with a host-set timer; `useSoundAlerts` → `TurnTimer`). A new-deal alert is
  deferred. Client-side only, no hidden info, no server/rules change. Default off ⇒ silent
  until opt-in. Full plan in [`SOUND_DESIGN.md`](SOUND_DESIGN.md).
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
- **Custom avatars are LOCAL-ONLY (Stage 14.1); server upload is PLANNED, not
  implemented.** A picked image is re-encoded and kept in `localStorage` on the
  device only — never uploaded, never in the WS payload/DB, and other players still
  see the **whitelisted emoji**. A **server-synced** avatar (uploaded, validated,
  visible online) is designed in [`AVATAR_UPLOAD_PLAN.md`](AVATAR_UPLOAD_PLAN.md)
  (Stage 17.0, docs-only): recommended MVP storage is a **hard-capped WebP in
  Postgres behind a storage-driver seam** (the free Render tier has no persistent
  disk), served same-origin from `/api/avatar/<id>.webp?v=<version>` with
  magic-byte validation, no SVG/GIF, no remote URLs, and **no base64 on the socket**.
  Rollout 17.1 (server+API) → 17.2 (Profile UI) → 17.3 (seats) → 17.4 (QA/security).
  **Stage 17.1 backend is now IMPLEMENTED but HIDDEN (no UI wiring).** Additive
  migration `0008_avatar_upload.sql` adds a `user_avatars` blob table (+
  `user_settings.avatar_image_version`); the API exposes `POST`/`DELETE
  /api/me/avatar` (signed-in only, guests 403, Origin-checked, rate-limited, 2 MB
  cap) and public `GET /api/avatar/<id>.webp` (`nosniff` + immutable cache); `/api/me`
  gains `avatarImageUrl` (a same-origin URL, distinct from the OAuth `avatarUrl`).
  Image processing decodes/crops/resizes/re-encodes to a 192×192 WebP (metadata
  stripped) **via ffmpeg** — no new npm dependency (avoids the CI `libc` lockfile
  risk); on a host without ffmpeg the upload cleanly returns `503`.
  **Stage 17.2 wired the PROFILE UI (available now).** The Profile avatar section
  groups **Emoji / Synced avatar / This device**: signed-in users get an "Upload
  synced avatar" + "Remove" control (guests see a sign-in hint), with progress + inline
  error states. `MyAvatar` shows a **server avatar → local custom → emoji** priority
  (with a 404 fallback) on the Profile summary/preview + AccountBar. The OAuth provider
  picture stays a separate field; the uploaded image never rides `PATCH /api/settings`.
  **Stage 17.3 wired ONLINE SEATS (available now).** The room member payload carries
  an optional **same-origin** `avatarImageUrl`, stamped server-side from the signed-in
  user's avatar (bots/guests → emoji). Other players now see the uploaded avatar on
  **lobby seats** (all games) and the **King table** (a `<SeatAvatar>` with a 404 →
  emoji fallback + a same-origin gate). Durak/Deberc/Tarneeb tables are name-only (no
  avatar surface) and unchanged. The **local-only image is never sent to others**; no
  image bytes on the WebSocket, no DB schema change, no gameplay change.
  **Stage 17.4 released + hardened the feature (security audit).** Added an ffmpeg
  **watchdog timeout + SIGKILL** (a hung/hostile input can't wedge a request) + a
  stdout cap; the upload **rate-limits first** (in-memory, per server-resolved user)
  before any DB/body work and rejects an oversized `Content-Length` early; the serve
  route **clamps the Content-Type** to a safe image type with `nosniff`; the limiter
  map self-bounds. Confirmed off-wire (no bytes/base64), same-origin-only, opaque id
  (never the userId), magic-byte/polyglot rejection, and a 404 → emoji fallback.
  **Requires `ffmpeg` at runtime** — without it, `POST /api/me/avatar` returns a clean
  `503` (feature off, nothing else affected); see RENDER_DEPLOY.md.

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
