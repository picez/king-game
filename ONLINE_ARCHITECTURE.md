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
  (code, hostName, seats, hasPassword, status) — never tokens/hash/state/hands.
- `UPDATE_SETTINGS` / `START_GAME` (host only)
- `ACTION_REQUEST { action }` — a request to mutate game state
- `HOST_STATE { state }` — relay-mode only (see §4)
- `PING`

**Server → Client** (`ServerMessage`)
- `WELCOME { clientId, reconnectToken, room }`
- `ROOM_UPDATE { room }` — lobby changes
- `STATE_UPDATE { state }` — authoritative game state, **already redacted**
- `ACTION_FORWARD { action, fromSeat }` — relay-mode only (server → host)
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
  redacted state, cannot act).
- **Host**: controls settings and `START_GAME`; promoted automatically if the
  current host leaves.
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
`sessionStorage` wrappers):

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

### (b) Host-authoritative relay — **legacy / deprecated**

`server/index.mjs` (`npm run server:relay`) is the old relay where the host
client was the authority (`HOST_STATE` / `ACTION_FORWARD`). It is kept for
reference only and is **not compatible** with the current client, which no
longer plays the host-authority role. Do not use it for new work.

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
- Online play expects all seats to be **human** clients (no AI online).
- Session resume is **client-side** (`sessionStorage`, per-tab, 2 h TTL) and
  depends on the room still living in the server's memory. For production,
  persist rooms server-side (Redis/DB) and consider `localStorage` or a signed
  cookie so resume survives a server restart or a fully closed tab.
- `ws://` only; put the server behind a TLS reverse proxy and use `wss://` in
  production.

## 6. Running

### Local LAN host (one phone/PC hosts for the same Wi-Fi)

```bash
npm install
npm run server          # server-authoritative (tsx). ws://0.0.0.0:3001 (PORT=8080 to change)
npm run dev -- --host   # Vite served on your LAN IP
# npm run server:relay  # legacy host-authoritative relay (deprecated)
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
