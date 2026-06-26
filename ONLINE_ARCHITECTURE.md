# Online Multiplayer Architecture — King

This document describes how online play is layered on top of the existing
local (pass-and-play) game, what is already in place, and the concrete next
steps to finish it.

## 1. Guiding principle: one reducer, two transports

The whole game is a pure function:

```
gameReducer(state, action) -> state'   // src/core/gameEngine.ts
```

It has **no** I/O, no randomness outside the deal, and no UI. That makes it
usable unchanged in two places:

| Where it runs            | How actions arrive             | Transport            |
|--------------------------|--------------------------------|----------------------|
| Local pass-and-play      | `dispatch()` in `LocalGame.tsx`| none (in-memory)     |
| Online server (**now**)  | `ACTION_REQUEST` over the wire | `WebSocketTransport` |

**Online is now server-authoritative**: the Node server owns the `GameState`,
runs `gameReducer` on every request, and broadcasts redacted state. The Node
server imports the shared TypeScript core directly via **tsx** (no separate
build, no duplicated rules) — see `server/index.ts` and `src/net/serverCore.ts`.

`getActingPlayerId(state)` (also in `gameEngine.ts`) is the single source of
truth for *whose turn it is*. Locally it drives the pass-and-play handover;
online the server uses `authorizeAction` (built on the same idea) to check
"is this client allowed to act now?".

## 2. Wire protocol

Defined in **`src/net/messages.ts`** (shared types) — every message is JSON
with a `t` discriminator.

**Client → Server** (`ClientMessage`)
- `CREATE_ROOM` / `JOIN_ROOM` / `RECONNECT` / `LEAVE_ROOM`
- `LIST_ROOMS` — discovery; replies with `ROOMS_LIST` of public `RoomSummary`
  (code, hostName, hostAvatar, hostConnected, gameType, seats, hasPassword,
  status) — never tokens/hash/state/hands. **Room discovery is game-aware:**
  `gameType` is `'king'` today but is emitted from the room so the same server
  browser can list future card games without a protocol change. `hostAvatar` is
  re-sanitized to the emoji whitelist at the source (never free text);
  `hostConnected` is the host's live-socket flag (MVP connection-quality cue).
  > **Second game — Durak (experimental online, Stage 9.6).** `CREATE_ROOM` now
  > takes an optional `gameType: 'king' | 'durak'` (default King; unknown →
  > `BAD_MESSAGE`) plus, for Durak, a `variant: 'simple' | 'transfer'` and a
  > `playerCount` that may be **2**. `RoomSnapshot`/`RoomSummary` carry `gameType`
  > (+ `variant` for Durak). `STATE_UPDATE.state` / `ACTION_REQUEST.action` are
  > game-state / game-action **unions** routed by `gameType`; the server runs each
  > game through its `GameDefinition` (reducer / acting-player / **per-game
  > redaction** / bots). King's message shapes are unchanged. Durak online is
  > **experimental** — no stats yet. Design: [`DURAK_PLAN.md`](DURAK_PLAN.md).
- `UPDATE_SETTINGS` / `START_GAME` (host only)
- `ACTION_REQUEST { action }` — a request to mutate game state
- `HOST_STATE { state }` — retired legacy relay only; ignored by the server (§4b)
- `PING`

**Server → Client** (`ServerMessage`)
- `WELCOME { clientId, reconnectToken, room }`
- `ROOM_UPDATE { room }` — lobby changes
- `STATE_UPDATE { state }` — authoritative game state, **already redacted**
- `ACTION_FORWARD { action, fromSeat }` — retired legacy relay only (§4b); unused
- `ERROR { code, message }`
- `PONG`

### Privacy / anti-cheat

`redactStateFor(state, viewerPlayerId)` replaces every hand except the
viewer's with face-down placeholders (counts preserved, ranks/suits hidden),
and hides the dealer's kitty-exchange cards from everyone else. The authority
**must** redact before sending `STATE_UPDATE`, so a tampered client can never
read an opponent's hand off the wire. The server-authoritative server imports
this canonical helper directly (`src/net/serverCore.ts` → `redactStateFor`).

## 3. Lobby / room model

- **Room**: created by a host, identified by a short **room code** (4 chars,
  unambiguous alphabet, e.g. `KQJ7`). Holds members, settings and the latest
  authoritative state.
- **Members**: `player` (takes a seat, `seatIndex` → `player-<seatIndex>`,
  matching the ids `gameEngine` assigns) or `spectator` (receives fully
  redacted state, cannot act). Each member has a `type`: `human` or `ai` (bot).
- **Host**: controls settings, `START_GAME`, `KICK_MEMBER`, and `ADD_BOT`;
  promoted automatically if the current host leaves (never to a bot — a room
  with no humans left is torn down).

### Online bots (server-side AI seats)

The host can fill free player seats with **AI bots** before the game starts, so
e.g. **two humans + one bot** play a full 3-player game.

- **Lobby**: host sends `ADD_BOT` (host-only, lobby-only, seat free, name `Bot N`
  unique). A bot is a normal `player` member with `type: 'ai'`, `connected: true`,
  a seat assigned in order, and **no socket**. Remove a bot with `KICK_MEMBER`
  (same as a human). A bot's `reconnectToken` is never sent to any client (bots
  get no `WELCOME`), and `reconnectMember` refuses bot tokens — so a bot cannot
  be hijacked.
- **Start**: `buildStartAction` maps each seat to `playerTypes` (`human`/`ai`),
  so the engine's `players[seat].type` marks the bot.
- **Play**: the server drives bots. After every state transition, if the acting
  player is a bot (`botMemberToAct`), the server schedules `applyBotTurn` after
  `BOT_DELAY_MS` (default 800ms). The bot's action comes from the shared core
  heuristics (`aiChooseMode/Trump/KittyDiscards/Card`) and is applied through the
  **same authorised reducer path** as a human (`applyActionRequest`) — so all
  legality (follow-suit, forced ruff, legal discards, turn order) is enforced,
  never bypassed. Public screens (`trick_complete`/`round_scoring`) keep their
  existing auto-advance timers; a bot that wins a trick then leads is handled by
  re-entering the advance/bot scheduler. The chain only re-schedules when a step
  actually changed state, so there is no infinite loop.
- **Bots are MVP heuristic AI** — the same opponents used in local play, run
  server-side. They are *not* a strong engine.
- **Privacy**: a bot's hand is redacted exactly like any other opponent's hand
  (`redactStateFor` hides every non-viewer hand); bots are never a viewer.
  Snapshots/room list expose only the bot's name + `type: 'ai'` — no socket,
  token, or cards.
- **Persistence**: bots are part of the persisted room; a restored room with
  bots resumes (bots stay `connected: true`; their turns are rescheduled).
- **Reconnect**: each member gets a `reconnectToken` in `WELCOME`. On a dropped
  socket the member is kept and marked disconnected; sending `RECONNECT { code,
  reconnectToken }` re-attaches the new socket and re-syncs room + state.

### Room persistence (survives a server restart) — MVP

Rooms are no longer memory-only: the server can persist them so a restart
doesn't drop in-progress games.

- **Pure (de)serialization** in `serverCore.ts`: `serializeRoom` /
  `deserializeRoom` convert a `ServerRoom` to/from a JSON-safe `PersistedRoom`.
  The members `Map` becomes an array; **transient socket refs are never part of
  `ServerRoom`** (sockets live in `server/index.ts`), so nothing live is
  captured. On restore every member is marked `connected: false`.
- **What is stored**: code, members (incl. `reconnectToken`, seat, host),
  `gameState`, `dealLog` (private audit), `passwordSalt` + `passwordHash`,
  `createdAt`/`updatedAt`, status. **Never the plaintext password** (only the
  salted hash). The deal log is persisted but, like always, never put in a
  snapshot/STATE_UPDATE.
- **Storage interface** `RoomStorage { loadRooms, saveRoom, deleteRoom }`.
  `MemoryRoomStorage` (default for tests/dev) keeps it in process memory;
  `server/storage.ts` adds a file-backed `FileRoomStorage` (atomic temp-file +
  rename, debounced writes, corrupt-file-safe) chosen via env.
- **Restore flow**: on boot `server/index.ts` calls `storage.loadRooms()` and
  re-registers each room (and reschedules public-screen auto-advance). A client
  that kept its `reconnectToken` can `RECONNECT` after a restart and resume with
  correctly redacted hands. A corrupt store logs a warning and starts empty
  rather than crashing.
- **Save triggers**: create / join / reconnect / start / every valid action /
  leave (delete). Not on pings or rejected/no-op actions. Writes are flushed on
  `SIGINT`/`SIGTERM`.

### Room password (optional join secret) — MVP

For public/VPS hosting a 4-char room code is guessable, so a room can require a
join password.

- **Protocol**: `CREATE_ROOM` / `JOIN_ROOM` carry an optional `password`. The
  `RoomSnapshot` exposes only `hasPassword: boolean` — never the password, hash,
  or salt. Wrong/missing password → `ERROR { code: 'BAD_PASSWORD' }`.
- **Server**: on `CREATE_ROOM` with a password, `serverCore` stores a salted
  hash (`passwordSalt` + `passwordHash`) — **never the plaintext**. `addMember`
  calls `verifyPassword` first and rejects with `BAD_PASSWORD`. `snapshot()`
  emits `hasPassword` only; the hash/salt stay server-side and are never logged.
- **Reconnect**: `RECONNECT` authenticates by `reconnectToken` only — a
  returning player never re-enters the password.
- **Client**: the start menu has an optional password field for hosting and a
  password field for joining; the lobby shows a 🔒 indicator when
  `room.hasPassword`. The password is **not** saved in the session (only the
  reconnect token is).
- **Strength / scope**: this is an MVP access gate, *not* authentication. The
  hash is salted but lightweight, and `ws://` traffic is unencrypted. For real
  deployments use **TLS/WSS** (so the password isn't sent in clear), add
  **rate limiting** on join attempts, and consider a stronger KDF
  (bcrypt/scrypt/argon2) and per-account auth.

### Session resume (tab reload / short drop)

Client-side resume is backed by **`src/net/session.ts`** (pure helpers +
`localStorage` wrappers):

- **What is stored** (`OnlineSession`): `serverUrl`, `roomCode`,
  `reconnectToken`, `playerName`, `role` (`host`/`join`), `seatIndex`,
  `version`, `savedAt`. That is the entire reconnect handle.
- **What is NEVER stored**: the `GameState`, any hand, scores, or deck.
  `parseSession` rebuilds the object from known fields only, so any injected
  extra (e.g. a stray hand) is dropped, and sessions are ignored if malformed,
  wrong-version, or older than `SESSION_TTL_MS` (2 h).
- **Lifecycle**:
  - saved on every `WELCOME`/`ROOM_UPDATE` (so a new token / changed seat /
    promoted host stays current) — in `useNetworkGame`;
  - **kept** on a temporary disconnect (so the player can resume);
  - **cleared** only on explicit leave / "Back to menu" (`leave()`), or via the
    "Forget" actions in the start menu / error screen.
- **Two reconnect paths, one wire message** (`RECONNECT`):
  1. *Short network drop* — the hook's reconnect timer reuses the in-memory
     `code`/`token` and auto-retries; the UI shows "Reconnecting…".
  2. *Tab reload* — `StartMenu` calls `loadSession()` on mount and offers a
     **"Resume online game"** panel; one click starts an online session with a
     `resume` intent, whose `firstConnectMessage` is `RECONNECT`. A failed
     resume lands on the error screen with **Back** / **Forget saved game**.

### Room social: reactions + chat (Stage 7) — EPHEMERAL, not game rules

Emoji reactions and room chat are **room-social UX, NOT game state**. They are
deliberately kept OUT of the `gameReducer`, the `GameState`, and persistence:

- **No reducer/state coupling.** `SEND_REACTION` / `SEND_CHAT` are handled
  entirely in the WS I/O layer (`server/index.ts`); they never call the reducer,
  never touch `GameState`, never `persistRoom`, and never affect stats.
- **In-memory only.** Per room the server keeps last-action timestamps + a small
  ring buffer of the last 50 chat messages (`roomSocial`). Nothing is written to
  the DB or `rooms.json`; **chat is lost on restart** (acceptable for MVP). The
  buffer is dropped when the room is cleaned up.
- **Server-authoritative anti-abuse** (`src/net/chatFilter.ts`, pure + shared):
  - reactions are a fixed **whitelist** (no arbitrary emoji/text);
  - a **30s reaction cooldown** and **3s chat rate limit** per client, enforced
    server-side (the client UI only mirrors them) → `RATE_LIMITED`;
  - chat is normalised + **profanity-censored** (`***`), URLs → `[link]`, capped
    at 160 chars; an empty result → `MESSAGE_BLOCKED`. The filter is a layered
    MVP (NFKC + de-leet + collapse-repeats + a small EN/UK/RU/DE/AR blocklist) —
    honestly **non-exhaustive**; it never logs raw/filtered chat text.
- **Privacy.** Broadcast `REACTION`/`CHAT` payloads carry only `clientId` +
  display name + emoji avatar — **never** a userId/session/token, and never any
  card/hand data. A freshly joined client gets `CHAT_HISTORY` (recent messages).
- **Client:** `useNetworkGame` exposes `reactions`/`chat` + `sendReaction`/
  `sendChat`; a fixed-position `RoomSocial` overlay (bottom-right reaction bar +
  collapsible chat drawer + floating reactions) sits above the table and **never
  covers the hand/current trick** (collapsed by default on mobile).

### Orphan rooms + disconnected substitute (Stage 7.2)

Two related lifecycle rules keep abandoned/stalled tables healthy without
touching the reducer, rules, scoring, or deck. A **connected human** =
`type==='human' && connected===true`; bots never count.

- **Orphan room cleanup.** A room with **no connected human** (only bots and/or
  offline-but-reconnectable humans) is an *orphan*. `recomputeOrphan(room, now)`
  stamps `room.orphanSince` the moment the last human disconnects and clears it
  when any human (re)connects — the timestamp is **not** bumped by activity, so
  the countdown runs from when humans actually left. The existing cleanup sweep
  deletes orphans `>= ORPHAN_ROOM_TTL_MS` old (default **15 min**) from memory
  **and** storage, cancelling their timers. Applies to **lobby and active game**.
  `orphanSince` is persisted, so a restart resumes the countdown (restored humans
  have no socket → the room is immediately re-evaluated as orphaned).
- **Disconnected-human substitute.** A disconnect during an active game does NOT
  play instantly. When a **disconnected human's** turn comes, the server waits
  `substituteDelayMs(...)` then plays a **legal AI move** for them via the SAME
  authorised reducer path as a bot (`applyTimeoutAction` → `botAction` →
  `applyActionRequest`) — covering `mode_selection` / `select_trump` /
  `kitty_exchange` / `playing`. The member **stays human** (never converted to a
  bot), keeps its seat/`userId` (so finished-game **stats still attribute to the
  human**), and shows as **offline** ("📴 Waiting for X to reconnect…"). The
  timer is recomputed on every advance: **reconnecting cancels** the substitute.
  - **Precedence** (`substituteDelayMs`): connected human + room timer → the
    timer; connected human, no timer → wait; **disconnected** human → after
    `DISCONNECTED_SUBSTITUTE_DELAY_MS` (default **2 min**), OR the room turn timer
    if it is enabled **and shorter** (players agreed to that timer).
- **Not orphan-affected:** explicit **Leave lobby** still removes the member +
  frees the seat immediately; **Leave game** still drops the socket (offline,
  reconnectable) and keeps Resume; bots still run normally.
- **Privacy:** none of this adds protocol fields — no `userId`/tokens, no private
  hands. The offline state is already public via the room member `connected` flag.
- Env: `ORPHAN_ROOM_TTL_MS` (900000), `DISCONNECTED_SUBSTITUTE_DELAY_MS` (120000).

## 4. Server modes

### (a) Server-authoritative — **default, current**

`server/index.ts` (run via **tsx**, `npm run server`) owns the game. The pure
room logic lives in **`src/net/serverCore.ts`** (framework-free, unit-tested);
`index.ts` is only WebSocket I/O.

```
host taps Start ──START_GAME──▶ server: state = gameReducer(null, START_GAME)   ← server deals
player taps a card ──ACTION_REQUEST──▶ server:
        authorizeAction(state, action, fromSeat)      ← right actor only
        next = gameReducer(state, action)
        if next === state → reject (ERROR)            ← illegal move
        else store + STATE_UPDATE (redacted per seat) ──▶ everyone
```

- The **server** performs the deal, so randomness is server-controlled (no
  client is trusted to generate the deal). Each deal runs under a recorded
  **seed** (see §4c) so it can be replayed for audits/disputes.
- Authorisation per action: PLAY_CARD only the player on turn; CHOOSE_MODE /
  EXCHANGE_KITTY / SELECT_TRUMP only the dealer (`authorizeAction`). Illegal
  moves are rejected because the reducer returns the same state reference.
- Public screens (`trick_complete`, `round_scoring`) are advanced by the
  **server** on a timer (`autoAdvance`); clients never send NEXT_TRICK /
  NEXT_ROUND.
- No client runs the reducer. If the host disconnects, the game continues
  (the server is the authority) and the host can reconnect.

How Node imports the TS core: **tsx** resolves the project's `.ts` modules at
runtime, so `server/index.ts` imports `src/net/serverCore.ts` →
`src/core/gameEngine.ts` directly. No bundling, no `dist-server`, and the Vite
client build is untouched (`server/` is outside `tsconfig` `include`).

### (c) Server-controlled randomness & deal metadata

The deal is reproducible and auditable without ever exposing hidden cards.

- **Seeded shuffle**: `core/rng.ts` provides `makeRng(seed)` (mulberry32). The
  deal (`shuffleDeck` + first-dealer pick) uses the reducer's optional
  `rng` context. Local play passes no rng → `Math.random`, unchanged.
- **Per-round seed**: the server generates a fresh seed for each deal
  (`startGame`, and `NEXT_ROUND` via `autoAdvance`) and runs the reducer with
  `makeRng(seed)`. Re-running the reducer for that round with the same seed
  reproduces the exact deal.
- **Deal log** (`ServerRoom.dealLog`, in `serverCore.ts`): one `DealRecord`
  per round — `{ roundIndex, dealerIndex, dealerId, modeId, seed, deckHash,
  timestamp }`. `modeId` is backfilled when a Dealer's-Choice dealer picks.
  `deckHash` is an FNV-1a fingerprint of the dealt hands+kitty for quick
  integrity comparison.
- **Privacy**: the deal log lives **only in `ServerRoom`**, never in
  `GameState`, so it is never broadcast. `STATE_UPDATE` carries only the
  redacted `GameState` (own hand + public fields) — no seed, no full deck, no
  other hands. The server logs a seed/deckHash summary line per deal (no
  hands) for debugging.
- **Why**: in a dispute ("that deal was rigged"), the operator replays the
  round from its recorded seed and compares `deckHash` — without anyone having
  to reveal or trust a client's view.
- **Future**: publishing the `deckHash` to clients as a pre-deal *commitment*
  (reveal the seed at round end) would make fairness verifiable by players too;
  not implemented yet.

### (b) Host-authoritative relay — **retired (historical only)**

The old relay (where the *host client* was the authority via `HOST_STATE` /
`ACTION_FORWARD`) has been **retired** (Stage 8.6). It is **not compatible** with
the current client and is no longer wired to any npm script. The source is kept
for history only at **`legacy/server-relay.mjs`** — do not run it for real play
and do not develop this path. The supported server is the server-authoritative
one above (`npm run server`). The `HOST_STATE` / `ACTION_FORWARD` message types
remain in the protocol union but the server-authoritative path ignores
`HOST_STATE`.

## 5. Client integration — **implemented**

The UI is transport-agnostic via **`src/net/transport.ts`**:

- `WebSocketTransport(url)` — browser ↔ Node server (now with an `onClose`
  hook for reconnect).
- `LocalTransport(authority)` — in-memory loopback (tests / offline).

What is wired up:

- **`src/App.tsx`** is a top-level switch: `menu → local | online`. Local
  pass-and-play is unchanged (moved verbatim into **`src/ui/LocalGame.tsx`**).
- **`src/ui/StartMenu.tsx`** — pick Local game / Host online / Join online,
  with name, server address and room code inputs.
- **`src/hooks/useNetworkGame.ts`** — owns the transport, runs CREATE/JOIN,
  tracks the room snapshot, stores the latest **redacted** `STATE_UPDATE`, and
  exposes a `dispatch` that sends `ACTION_REQUEST`. It **never runs the reducer
  itself** — the server is the authority. Minimal auto-reconnect uses the
  stored `{code, reconnectToken}` and is StrictMode-safe (deferred teardown so
  a dev double-mount never opens a second connection / room).
- **`src/ui/online/Lobby.tsx`** — room code, member list, host Start button
  (enabled when seats are full).
- **`src/ui/online/OnlineGame.tsx`** — lobby → game; renders the **shared**
  `src/ui/GameRouter.tsx` screens on your turn (and on public screens), and a
  read-only `OnlineWaitingScreen` otherwise. Screens are identical to local.
- **Privacy**: a client only ever receives its own hand (server redaction);
  the waiting view shows only your own hand; opponents render as card counts.
- **Pure, tested adaptor logic** lives in **`src/net/online.ts`**
  (`buildStartAction`, `authorizeAction`, `applyForward`, `seatToPlayerId`).

### Remaining limitations (server-authoritative)

- Optional room password gates joins (MVP), but there is still no per-account
  auth and no rate limiting. On a public VPS, require TLS/WSS and add join
  rate limiting; treat the password as a soft gate, not authentication.
- Room persistence is MVP file-based (single JSON, one node). It survives a
  restart but is not built for multiple server instances or high write volume —
  use Redis/DB for horizontal scaling and long-term audit retention.
- Deal seeds are recorded server-side for replay, but not yet exposed to
  clients as a verifiable pre-deal commitment (see §4c "Future").
- Online seats can be human clients or server-side AI bots. A disconnected human
  remains a human seat and can reconnect; the server may temporarily AI-play for
  them after the configured delay.
- Session resume is **client-side** (`localStorage`, 2 h TTL) and depends on the
  room still living in the configured server store. For production, use
  `ROOM_STORAGE=pg` (or another durable `RoomStorage`) for restart survival.
- `ws://` only; put the server behind a TLS reverse proxy and use `wss://` in
  production.

## 6. Running

### Local LAN host (one phone/PC hosts for the same Wi-Fi)

```bash
npm install
npm run server          # server-authoritative (tsx). ws://0.0.0.0:3001 (PORT=8080 to change)
npm run dev -- --host   # Vite served on your LAN IP
```

Find the host's LAN IP (`ipconfig` on Windows, `ip addr` / `ifconfig` on
Unix). Other players open `http://<host-ip>:5173`, enter the room code, and
the client connects its `WebSocketTransport` to `ws://<host-ip>:3001`.

### Dedicated server / VPS

**Full HTTPS/WSS VPS guide: see [DEPLOYMENT.md](DEPLOYMENT.md)** (Caddy/nginx
configs, TLS, env vars, health check). In short:

```bash
# on the VPS
git clone <repo> && cd king-game
npm ci && npm run build
HOST=127.0.0.1 PORT=3001 ALLOWED_ORIGINS=https://your-domain npm run server:prod
# reverse proxy (Caddy/nginx) terminates TLS, serves dist/, upgrades /ws → :3001
# build the client against the proxied socket: VITE_WS_URL=wss://your-domain/ws npm run build
```

Server env config (all optional; defaults keep LAN/dev simple):
`PORT`, `HOST`, `NODE_ENV`, `ALLOWED_ORIGINS` (browser-origin allowlist; empty =
allow any). A `GET /health` endpoint reports `{status, rooms, uptime}`.

Client URL selection (`defaultServerUrl`): `VITE_WS_URL` wins; else an HTTPS
page → `wss://<host>` (never insecure `ws://`); else `ws://<host>:3001`. The
start menu warns if a `ws://` address is used on an HTTPS page (mixed content).

## 7. Status summary

| Item                                             | Status            |
|--------------------------------------------------|-------------------|
| Pure reducer reusable locally + online           | ✅ done           |
| `getActingPlayerId` authorization helper          | ✅ done           |
| Network message types                            | ✅ `src/net/messages.ts` |
| Transport interface + WS/Local adapters          | ✅ `src/net/transport.ts` |
| Hand redaction helper                            | ✅ `redactStateFor` |
| Client `useNetworkGame` hook + UI wiring         | ✅ menu, lobby, online play |
| Start menu / lobby / waiting-view UI             | ✅ `src/ui/StartMenu.tsx`, `src/ui/online/*` |
| Per-client hand redaction on the wire            | ✅ verified (server + tests) |
| **Server-authoritative** reducer + deal on server | ✅ `server/index.ts`, `src/net/serverCore.ts` |
| Node imports shared TS core (no dup rules)        | ✅ via tsx |
| Server-controlled seeded deal + per-round metadata | ✅ `core/rng.ts`, `serverCore.dealLog` |
| Session resume after reload / short drop          | ✅ `src/net/session.ts`, StartMenu resume |
| Optional room password (MVP join secret)          | ✅ salted hash server-side, `hasPassword` only |
| Production VPS path (env config, HTTPS/WSS, health) | ✅ `DEPLOYMENT.md`, `server:prod`, `/health` |
| Installable PWA (manifest, icons, app-shell SW)    | ✅ `public/manifest.webmanifest`, `public/sw.js`, `npm run icons` |
| Room persistence (file storage, restart survival)  | ✅ `serverCore` (de)serialize, `server/storage.ts` |
| Room discovery list (public summaries, no leaks)   | ✅ `LIST_ROOMS`/`ROOMS_LIST`, `useRoomList` |
| End-to-end online QA (real WS, restart restore)    | ✅ `npm run e2e`, `QA_CHECKLIST.md` |
| Rate limiting · per-account auth · Redis/DB store  | ⏳ next step  |
| AI opponents online                              | ⏳ next step       |
