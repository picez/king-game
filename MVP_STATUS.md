# Card Majlis — MVP Status

> **Product = Card Majlis** (Stage 14.0 rebrand) — a card lounge for six games:
> **King, Durak, Deberc, Tarneeb, Preferans, 51**. "King" now refers ONLY to the King game, not the
> app. Internal ids stay legacy: package `king-card-game`, `king.*` localStorage
> keys, `game_type='king'`, `king-game` repo — no rename/migration.

**Status: stable MVP — release `v0.3.8`** (51 meld & opening rule fixes — jokers may sit anywhere in a
meld, the 51 opening total is required only **once per round** (any valid meld afterwards), **Ace-low
runs extend** so an Ace lays off onto a `2-3-4`, and the public-meld cards no longer overlap/clip; on the
`v0.3.7` Syrian 51 sixth-game release that made **51 (Syrian 51)** a fully released `available` game
(local + online + stats + leaderboard + favorite + a "51 Winner" achievement + emblem), making Card Majlis
a **six-game** lounge; on the `v0.3.6` Tarneeb target score & compact table, the `v0.3.5` table HUD &
reactions polish, the `v0.3.4` Durak final-defence reveal + online timer polish, the `v0.3.3` Tarneeb
scoring correction + Deberc table resize, the `v0.3.2` Tarneeb Solo release & bandwidth-hardening patch,
over the `v0.3.0` social & voice release and v0.2.0 five-game platform, 2026-07-14; see [`CHANGELOG.md`](CHANGELOG.md)). Local pass-and-play and server-authoritative
online play both work end-to-end. This file is the running feature list; for the concise
"what it is / how it fits together" start at [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md).

- **Overview (start here):** [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md)
- Rules (source of truth): [`KING_RULES.md`](KING_RULES.md) · [`DURAK_RULES.md`](DURAK_RULES.md) · [`DEBERC_RULES.md`](DEBERC_RULES.md) · [`TARNEEB_RULES.md`](TARNEEB_RULES.md)
- Online design: [`ONLINE_ARCHITECTURE.md`](ONLINE_ARCHITECTURE.md)
- Deploy: [`DEPLOYMENT.md`](DEPLOYMENT.md) (VPS/HTTPS/WSS) · [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md) (hosted)
- QA: [`QA_CHECKLIST.md`](QA_CHECKLIST.md)
- `GAP_ANALYSIS.md` / `CHANGES_2026-07-06.md` are **historical** — ignore for current state.

**Games shipped (all `available`, local + server-authoritative online, each
recording its own per-`game_type` stats + leaderboard):**

| Game | Players | Notes |
|------|---------|-------|
| **King** (default) | 3–4 | 7 modes, Dealer's Choice; source of truth [`KING_RULES.md`](KING_RULES.md) |
| **Durak** | 2–5 | Simple + Transfer variants; [`DURAK_RULES.md`](DURAK_RULES.md) |
| **Deberc** | 3–4 | **3 solo (every-player-for-self) / 4 team**, target 510/1020; [`DEBERC_RULES.md`](DEBERC_RULES.md) |
| **Tarneeb** | 4 | Two released modes — **Pairs** (2×2, default) & **Solo** (4p cutthroat); bid 3–13, **host-configurable target (default 41; presets 31/41/61/101, Stage 29.8)**. Solo **fully released local + online + stats** (Stage 28.4), [`TARNEEB_SOLO_PLAN.md`](TARNEEB_SOLO_PLAN.md); [`TARNEEB_RULES.md`](TARNEEB_RULES.md) |
| **Preferans** | 3 | Solo contract auction + talon, 32-card, target 10; [`PREFERANS_RULES.md`](PREFERANS_RULES.md) |
| **51** (Syrian 51) | 2–4 | **RELEASED — local + online + stats + favorite + achievement (Stage 30.7).** Pure core + shared UI; **both Local and Host pickers enabled** (no "Experimental" tag). Online is server-authoritative (create/join/start, bots, seeded round advance, per-viewer redaction, rematch/reconnect). **Score-only stats + leaderboard** under `game_type='fifty-one'` (no DB migration) with a Profile sub-tab; **favoritable** + `fifty-one-winner` achievement + counts toward All-Rounder; own PNG emblem. Rummy-style meld/discard; 51-point opening; elimination at 510. [`51_RULES.md`](51_RULES.md) · [`51_PLAN.md`](51_PLAN.md) |

**51 / Syrian 51** (the **6th game**) is **released** (Stage 30.7) — the **pure core**
(`src/games/fiftyOne/`, Stage 30.1) plus a **shared UI** (`src/ui/fiftyOne/`: setup + table + hand +
meld controls, 1 human + bots locally; the `FiftyOneOnlineGame` adapter online) run through the
catalog/registry (id **`fifty-one`**, `status: 'available'`, `supportsLocal` + `supportsOnline` +
`supportsBots` true). Both the **Local** and **Host/online** pickers enable it with no "Experimental"
tag. Online is **server-authoritative** — `CREATE_ROOM` accepts a 2–4-seat 51 room, `START_GAME`
deals server-side, every move flows through the generic `ACTION_REQUEST` (acting-seat authorised,
illegal moves no-op'd), the server drives bots and the public `round_complete` advance (seeded
`START_NEXT_ROUND`), and each client is redacted to its own hand; rematch/reconnect reuse the shared
flows. It records **score-only stats + leaderboard** under `game_type='fifty-one'` (no DB migration;
per-seat final penalty / eliminated / winner, aggregated to win rate + avg/best penalty + eliminations
+ rounds) with a Profile sub-tab, is a **favorite-game** option, and has a **`fifty-one-winner`**
achievement that also counts toward **All-Rounder** (now a win in all six games). It ships its own PNG
emblem (`game-fifty-one.png`, two fanned cards). It is a rummy-style get-rid-of-your-hand game (form
runs/sets, open with 51+ points, jokers wild, penalty scoring, eliminate at 510). Rules are in
[`51_RULES.md`](51_RULES.md) (all §16 MVP defaults implemented in 30.1); the staged build (30.1 core →
30.7 release) is in [`51_PLAN.md`](51_PLAN.md).

**Preferans / Преферанс** (5th game) is **released** (Stage 19.7): `status: available`,
local + server-authoritative online + score-only stats/leaderboard, a favorite-game
option, and a "Preferans Declarer" achievement. A 3-player, 32-card, each-for-self
contract-bidding trick game (declarer + talon vs two defenders). Shared UI in
`src/ui/preferans/` (+ the `PreferansOnlineGame` adapter). Remaining Preferans variants
(misère, распасы, whist/pass, classic Sochi pool/mountain scoring, 4-player) are
documented as post-MVP, not built. Spec + plan:
[`PREFERANS_RULES.md`](PREFERANS_RULES.md) / [`PREFERANS_PLAN.md`](PREFERANS_PLAN.md).

## What works

- **Online rematch / "Play again" (Stage 25.9)**: after an online game finishes, the finish
  screen offers a real **Play again** that restarts the **same game in the same room** (same
  gameType / options / members / seats) — it no longer silently leaves to the menu. A room with
  **one human + bots** restarts immediately (bots are always ready); with **multiple humans**,
  Play again marks you **Ready**, others see "<name> wants a rematch" and a ready-count note,
  and the server restarts only when **every connected human is ready** (no auto-start). Leaving /
  disconnecting updates or cancels the pending rematch. Server-authoritative (`restartGame` reuses
  `startGame`); WS `REMATCH_READY` / `REMATCH_DECLINE` / `REMATCH_STATE`; in-memory only, no DB,
  no token/session/email; a fresh game records its own stats (no duplication). All 6 games.
- **Friends & room invites (Stage 25.1–25.9, needs Postgres + migration `0009`)**: add friends
  **by code** (never by email); an app-level presence connection keeps a signed-in user **online**
  at the menu and drives an **incoming-request badge**; the Lobby shows an **always-visible "Invite
  friends"** block (online first) so a host can invite a friend into the current room (WS
  `FRIEND_INVITE` → target Join/Dismiss toast reusing `?room=`; failures — offline / not friends /
  not in room — surface a non-fatal notice). All over `/api/friends/*` + WS; presence is
  per-instance. Plan: [`FRIENDS_PLAN.md`](FRIENDS_PLAN.md).
- **In-room voice chat (Stage 25.3–25.8, opt-in)**: a room-scoped **WebRTC mesh** (≤5) over the
  `VOICE_*` signaling relay — Join/Mute/Leave in the Lobby card + a compact in-game mic; a safe
  debug block (Mic / Peers / ICE state / Audio). **No server audio, no recording, no DB.** STUN by
  default; a deployment adds **TURN** via `VOICE_ICE_SERVERS` (runtime, `/api/voice/ice-config`) or
  `VITE_VOICE_ICE_SERVERS` (build-time) — credentials env-only, redacted from diagnostics. Strict-
  NAT users without TURN fall back to text. Reconnect rebuilds the mesh; real cross-network audio
  is a manual check (CI has no mic). Plan: [`VOICE_CHAT_PLAN.md`](VOICE_CHAT_PLAN.md).
- **Quick-rules help hub (Stage 22.0)**: a single generic **"How to play"** sheet
  (`GameHelpModal`) that works for every game from a pure catalog
  (`src/games/gameHelp.ts`) + i18n content (`help.<game>.<section>`) — short
  Goal / Players / Deck / Turns / Scoring / Notes lines, opened from a ❓ button in
  the Local/Host game picker for the selected game. i18n ×4; no gameplay/server change.
- **Game rules** (3p/4p): 32/52 decks, dealing, follow-suit, trick resolution
  with/without trump, all 7 modes, Dealer's Choice with per-dealer mode sets
  (9 games/dealer → 27 rounds 3p, 36 rounds 4p), kitty take + legal discard,
  scoring. Covered by unit tests.
- **Local pass-and-play**: single device, PassScreen handover, AI opponents.
- **Online (server-authoritative)**: Node `ws` server owns the GameState, runs
  the reducer, redacts hands per client. Lobby with room code, host start,
  per-turn screens, read-only waiting view.
- **Room invite link / share (Stage 18.1)**: the lobby has an **Invite** row under the
  room code — **Copy code**, **Copy link**, and **Share** (shown only when
  `navigator.share` exists). The invite link is `<origin>/?room=<CODE>` — the browser
  origin + the **room code only** (already the public join secret): **no session/token/
  userId**, and never the ws/custom-server URL. Opening such a link **prefills the Join
  sheet** with the code (the user still presses Join — no auto-join, so an active game is
  never disrupted) and clears the `?room` param. Copy uses the Clipboard API with a
  selectable-text fallback; a cancelled Share is silent. **Edge cases (Stage 18.2):**
  the Join sheet shows an **"Invited room: CODE"** banner; if a *different* room is
  saved in progress it offers a clear **Resume current room vs Join invited room**
  choice (never auto-anything, saved session preserved); an invalid/blank `?room` is
  ignored (no broken sheet) but still stripped from the URL; lowercase/whitespace codes
  normalise. Pure helpers (`src/net/invite.ts`) are unit-tested; no server/protocol/DB
  change.
- **Team lobby clarity (Deberc / Tarneeb, Stage 18.0)**: the lobby for the 2×2
  partnership games groups all four seats by team (**Team A = seats 0 & 2, Team B =
  1 & 3**), shows empty seats per team, highlights your team, and marks You / Partner —
  so who's with whom, who's opposite, which seats are free, and what's needed to start
  are all clear before Start ("Need 4 players for teams" → "Teams ready"). Purely
  presentational: seat order, the start gate (Deberc still starts at 3 = each-for-self;
  Tarneeb needs 4), avatars (SeatAvatar), and the rules are unchanged; King/Durak keep
  the flat member list.
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
  RTL). **A reaction/sticker floats over the SENDER's seat** (Stage 27.1 — from the
  existing public `seatIndex`; centred fallback for spectators/lobby), not the table
  centre. See [`ONLINE_ARCHITECTURE.md`](ONLINE_ARCHITECTURE.md) → Room social.
- **Profile navigation (Stage 27.1):** the Profile screen is a **grid of sections**
  (Account / Friends / Statistics / Achievements / Leaderboards), each drilling into its
  own screen — no crowded/truncated tab row; the incoming friend-request badge shows on
  the Friends section.
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
- **Achievements / badges foundation (Stage 16.0; +1 in 28.6)**: a Profile **Achievements**
  tab (4th tab, next to Account / My stats / Leaderboard) showing **13** badges in a
  compact grid — earned = gold coin, locked = muted padlock with the goal still
  shown. Badges are a **pure client-side catalog** (`src/stats/achievements.ts`,
  `evaluateAchievements(AllStats)`) **derived entirely from the existing per-game
  stats** — **no new DB column, no server route, no write path, no popups**, and
  nothing from private/card-level or chat data. Missing/unloaded stats → locked;
  a clean no-session state shows the sign-in hint. Badges: First Win, Veteran (25),
  Centurion (100), All-Rounder (win every canonical game — now all **six**, **Solo
  excluded**), King Winner, Durak Survivor, Tarneeb Bidder / Contractor (5) /
  **Soloist (Stage 28.6 — win a Tarneeb Solo; reads the separate `tarneeb-solo`
  stats)**, Preferans Declarer, **51 Winner (Stage 30.7 — win a game of 51)**,
  Deberc Meld Maker (10) / Bella / Jackpot. i18n ×4.
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

- **Solo / individual modes (Stage 28.0–28.2).** Deberc's two released modes are **named
  explicitly and fully playable local + online** — **Solo · 3 players** (each-for-self,
  `teamOf = [0,1,2]`) and **Pairs · 4 players** (fixed 2×2). Same engine/scoring; the seat count
  *is* the mode. **Stage 28.2** fixed the product gap the owner reported (Deberc still felt
  team-only): the online **Host** sheet now has a Solo/Pairs picker, the server honors the host
  `playerCount` (was hard-forced to 4), and the lobby shows **3 individual seats for Solo** (not the
  Team A/B grid) while keeping the grid for Pairs. Score table/finished already read per-player. **Tarneeb
  solo now has a working PURE CORE (Stage 28.1)** behind a `variant: 'pairs' | 'solo'` flag
  (default `'pairs'`): 4-player cutthroat, per-seat contract scoring identical to Pairs §8
  (**Stage 29.0**: exact make → bid×2, overtrick → tricks won, fail → −bid with each defender
  banking its own tricks; first to 41, ties safe), solo bots, redaction. **Stage 28.3** added the local playable UI;
  **Stage 28.4 fully released it — local + online + stats.** Solo is selectable in the online Host
  sheet (default Pairs); the lobby shows individual seats for Solo (no team grid); the server is
  authoritative via a `tarneebVariant` on the room (backward-compatible → legacy reads Pairs);
  rematch preserves the mode; stats + a leaderboard record solo under a **separate
  `game_type='tarneeb-solo'`** (Pairs/Solo toggle in the profile) — **no DB migration**, and the
  released Pairs aggregates are byte-for-byte untouched. Solo achievements deferred (post-MVP).
  **Stage 28.5 QA/hardening** fixed two drifts (room browser mislabelled Solo rooms; achievements
  could read the toggled solo stats) — both resolved; Pairs unchanged. Spec + status in
  [`TARNEEB_SOLO_PLAN.md`](TARNEEB_SOLO_PLAN.md).
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
- **Custom avatars — three tiers (emoji → local device image → server-synced upload).**
  The **local image** tier (Stage 14.1) is re-encoded and kept in `localStorage` on the
  device only — never uploaded, never in the WS payload/DB, and other players still
  see the **whitelisted emoji**. The **server-synced** avatar (uploaded, validated,
  visible online) is **RELEASED (Stage 17.4)** — see the rollout narrative below; its
  only runtime requirement (a remaining caveat) is **ffmpeg** (native Render → clean
  `503`). Design in [`AVATAR_UPLOAD_PLAN.md`](AVATAR_UPLOAD_PLAN.md)
  (originally Stage 17.0 docs-only): storage is a **hard-capped WebP in
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
   - **Social (Stage 25.0–25.9 — DONE, see "What works" above):** Friends + room invites +
     presence badge ([`FRIENDS_PLAN.md`](FRIENDS_PLAN.md)), online **rematch**, and opt-in in-room
     **WebRTC voice** with a runtime **TURN** config seam ([`VOICE_CHAT_PLAN.md`](VOICE_CHAT_PLAN.md)).
     Remaining post-MVP: short-lived TURN credentials, cross-instance presence (Redis), and a
     moderation console.
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
