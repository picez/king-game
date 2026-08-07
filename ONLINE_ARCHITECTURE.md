# Online Multiplayer Architecture — Card Majlis

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
  `gameType` is emitted from the room so the same server browser lists every card
  game. `hostAvatar` is re-sanitized to the emoji whitelist at the source (never
  free text); `hostConnected` is the host's live-socket flag (MVP connection-quality cue).
  > **Multi-game online (six games).** `CREATE_ROOM` takes an optional
  > `gameType: 'king' | 'durak' | 'deberc' | 'tarneeb' | 'preferans' | 'fifty-one'`
  > (default King; unknown → `BAD_MESSAGE`) plus per-game options: Durak
  > `variant: 'simple' | 'transfer'`, Deberc `matchSize: 'small' | 'big'`, and a
  > `playerCount` that ranges 2–5 by game (Durak may be **2**, Tarneeb is fixed **4**,
  > Preferans is fixed **3**, 51 is **2–4** with no extra options).
  > `RoomSnapshot`/`RoomSummary`
  > carry `gameType` (+ variant/matchSize). `STATE_UPDATE.state` /
  > `ACTION_REQUEST.action` are game-state / game-action **unions** routed by
  > `gameType`; the server runs each game through its `GameDefinition` (reducer /
  > acting-player / **per-game redaction** / bots / start action). King's message
  > shapes are unchanged. All six games are `available` and record their own
  > **per-`game_type` stats**. Designs: [`DURAK_PLAN.md`](DURAK_PLAN.md),
  > [`TARNEEB_PLAN.md`](TARNEEB_PLAN.md), [`PREFERANS_PLAN.md`](PREFERANS_PLAN.md).
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
  deletes orphans `>= ORPHAN_ROOM_TTL_MS` old (default **5 min**, Stage 36.0) from memory
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
  - **Precedence** (`resolveHumanFireAt`): connected human + room timer → the room
    deadline; connected human, no timer → wait; **disconnected** human → after
    `DISCONNECTED_SUBSTITUTE_DELAY_MS` (default **2 min**), OR the room turn timer
    if it is enabled **and shorter** (players agreed to that timer).

### Authoritative turn timer (Stage 37.5)

The per-turn timer is part of the **authoritative room state**, not a local browser
stopwatch. Each timed human turn has ONE server deadline that every client shares:

- **`turnDeadlineAt`** (epoch ms) + **`turnTimerRevision`** live on the room and are
  **persisted**. `beginTurnDeadline(room, now)` mints a fresh deadline (bumps the
  revision) **only on a real gameplay transition** to a new turn — a connection event
  (reconnect / reclaim / disconnect / rebroadcast / restore) never mints one, so it
  can neither **reset nor extend** the clock.
- Every `STATE_UPDATE` (and the reconnect/reclaim/join state sends) carries a
  `RoomTimerInfo` (`{ deadlineAt, revision, serverNow }`). The client derives the
  remaining time from `deadlineAt` against `Date.now()` each tick, correcting for skew
  via `serverNow` — so reload/reconnect resumes the same countdown and a throttled
  background tab catches up instantly. A reload 12 s into a 30 s turn shows ~18 s.
- `armRoomTimer` schedules ONE `setTimeout` at the **absolute** deadline (re-arms fire
  at the same wall-clock time, not a fresh full length). The callback is
  **revision-guarded**: a callback from an old turn no-ops once a newer turn began, so
  a stale timer can never double-move.
- A `substituteDeadlineAt` (server-only, persisted, never sent to clients) covers a
  disconnected acting human when the room timer is off; it starts on disconnect, stays
  stable across other events, and cancels on reconnect. The room timer, when enabled,
  governs and is never extended by the substitute delay.
- **Restore:** a persisted future deadline schedules only its *remaining* time; a past
  one resolves on the next tick; legacy rooms without the fields restore conservatively
  (revision 0, no deadline). No cards/tokens/user ids appear in the timer metadata.
- On expiry the server applies a **legal** auto-action through the same reducer path
  (`applyTimeoutAction` → `botAction`), audited across all 7 games so a deadline never
  leaves the table stuck; a failure to act is logged (card-free) rather than looping.
- **Not orphan-affected:** explicit **Leave lobby** still removes the member +
  frees the seat immediately; **Leave game** still drops the socket (offline,
  reconnectable) and keeps Resume; bots still run normally.
- **Privacy:** none of this adds protocol fields — no `userId`/tokens, no private
  hands. The offline state is already public via the room member `connected` flag.
- Env: `ORPHAN_ROOM_TTL_MS` (300000 — 5 min, Stage 36.0), `DISCONNECTED_SUBSTITUTE_DELAY_MS` (120000).

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

## Poker bankroll escrow lifecycle (Stage 37.7 §16)

An online poker room with a server-derived `pokerBuyIn` is a **bankroll** room
(authenticated-humans-only; ADD_BOT refused). `server/pokerEscrow.ts` orchestrates the
wallet ledger over the room lifecycle:

- **START_GAME** (async, re-entrancy guarded): validate seats (all human+userId, no dup,
  ≥2), mint a server `matchId`, debit every seat's buy-in in ONE all-or-nothing
  transaction, then `startGame` + the usual broadcast/timer/persist. Insufficient chips →
  `INSUFFICIENT_CHIPS`, room NOT started. Escrow (`matchId`/`buyIn`/status/seat→user map)
  is persisted in the room JSON (no room migration) so a restart can settle/refund.
- **game_finished** (`maybeRecordFinished`): credit each seat's final stack (payout ==
  escrow). Idempotent via the ledger + escrow status.
- **orphan/teardown** (`cleanupRooms` / `handleLeave` → `deleteRoomWithSettlement`): a
  funded, unfinished table is refunded before deletion; a settlement failure KEEPS the
  room for a retry. Payout and refund are mutually exclusive (a `settling` transient).

The showdown review is server-paced: the poker `round_scoring` advance waits ~7 s for a
contested showdown / ~2.5 s for a fold-win, then auto-deals the next hand once. The Stage
37.5 turn timer is untouched (escrow hooks sit outside the deadline/arming mechanics).

### Bankroll lifecycle hardening (Stage 37.7.1)

- **Online Poker is bankroll-only.** CREATE_ROOM for poker rejects unless the chip economy
  (Postgres) is on, the stakes are a whitelisted preset, AND the creator is a signed-in
  NON-GUEST (awaited via `getAccountUserId`, so it can't race the async session resolution).
  There is no free online Poker table; local pass-and-play stays free.
- **Per-room serialization** (`withRoomLock`): one start/debit/rematch/payout/refund/teardown
  flow per room at a time; the synchronous handlers (leave/kick/set-timer) refuse to reshape
  a bankroll table's composition while a lifecycle op is in flight (`isRoomBusy`). A committed
  debit whose start/restart then fails is refunded immediately.
- **Rematch = a brand-new paid match** (`debitRematch`): requires the previous escrow fully
  resolved (payout/refund), then mints a NEW matchId + fresh escrow and debits atomically;
  a stale settled/cancelled escrow is never reused; insufficient chips → no restart, no charge.
- **DB settlement gate** (`settleMatchTx`, migration 0011): payout ↔ refund mutual exclusion is
  DB-authoritative (not just an in-memory flag).
- **Crash reconciliation** (`reconcileEscrow`, on restore): a restored transient
  pending/settling escrow is reconciled against the durable ledger/settlement — committed
  debit → funded, uncommitted → dropped; committed settlement → settled/cancelled, else back
  to funded (retryable). No partial settlement; invalid escrow fails closed.
- **Payout conservation** (`validatePayoutConservation`): before any credit, every final stack
  must be a finite non-negative safe integer and Σ(final stacks) must equal Σ(buy-ins), else
  fail closed (no wallet mutation).

### Crash durability + auth-seat hardening (Stage 37.7.2)

- **Debit crash durability (FAIL 1):** the durable `poker_matches` record + the buy-in ledger
  rows commit atomically with the debit. A boot `reconcileOrphanedDebits` refunds any committed
  match with no active started room (crashed between debit commit and room persistence),
  exactly once — no reliance on room JSON.
- **Authenticated seat gate (FAIL 2):** JOIN of a bankroll PLAYER seat requires a resolved
  non-guest account (awaited like CREATE); the userId is stamped ATOMICALLY at join (not via a
  later attachIdentity); one account cannot take two player seats; guests may still spectate
  (no private cards). RECONNECT/RECLAIM keep the existing seat identity.
- **Cancellable async CREATE/JOIN (FAIL 3):** a per-connection monotonic navigation revision +
  an open flag mean a delayed auth callback completes only if it is still the latest navigation
  and the socket is open — a second CREATE/JOIN or a socket close cancels the first, so no
  stale/duplicate room; two parallel CREATE make one room.
- **Navigation ↔ lock (FAIL 4):** CREATE/JOIN/LEAVE that would leave the current room are refused
  while it is a bankroll table with a lifecycle op in flight (`isRoomBusy`); the session is never
  silently detached mid-debit; a socket disconnect only marks connected=false.
- **Strict persisted-escrow validation (FAIL 5):** a malformed durable escrow fails CLOSED
  (marks the room corrupt + alerts, never silently "no escrow that deletes a room with chips
  owed"); the DB scan refunds the underlying match by room code.
- **Idempotent-repeat wallet fix (FAIL 6):** `adjustWalletTx` short-circuits on an existing
  ledger key before any balance math, so a repeat after the balance dropped / near overflow is a
  clean `applied:false` no-op. Proven with a real concurrent PostgreSQL same-key test.

### Target-room JOIN serialization + durable fail-closed (Stage 37.7.3)

- **Target-room JOIN vs debit (FAIL 1):** a bankroll PLAYER join re-checks `isRoomBusy(target)`
  right before `addMember` (after the async auth) — a seat can't be added while the target's
  start/debit/rematch/settlement/teardown is in flight. START_GAME additionally verifies
  `escrowMatchesRoomSeats` before dealing (refund + abort on any divergence), so the game state
  seats always equal the funded/paid seats.
- **Stale/deleted target after auth (FAIL 2):** `finishJoin` verifies `ctx.rooms.get(code) === room`
  before + after `addMember`; a deleted/replaced room → ROOM_NOT_FOUND, membership rolled back —
  never welcomed into a ghost room.
- **All-or-nothing durable parse (FAIL 3):** `parseDurableMatch` rejects the WHOLE record on any
  malformed seat (no partial refund). `listUnsettledMatches` returns `{ valid, corrupt }`;
  reconciliation never writes a terminal settlement for a corrupt record — it is left unresolved
  with an operator alert.
- **Durable metadata conflict (FAIL 4):** `recordMatchTx` throws `DurableMatchConflictError` (rolling
  back the whole transaction, no debit) when a matchId is re-recorded with different
  roomCode/buyIn/canonical seats; an exact repeat is idempotent.
- **Corrupt/refunded active room (FAIL 5):** on restart a bankroll room with a game state but no
  live funded escrow is terminally CANCELLED (buy-ins refunded → game cleared to a clean lobby) or
  FROZEN (corrupt durable record → no gameplay/advance/start, kept for operator). `rescheduleAdvance`
  and ACTION_REQUEST/START are blocked for frozen/cancelled rooms.
- **Navigation cancellation on all transitions (FAIL 6):** CREATE/JOIN/RECONNECT/RECLAIM/LEAVE +
  socket close all bump the per-connection nav revision, so a delayed CREATE/JOIN callback can't
  resurrect a room/member/session after any transition.
- **Host identity atomic at CREATE (FAIL 7):** the Poker host's account id is passed into `createRoom`
  and stamped on the host member at creation — never dependent on a later attachIdentity.

### Recovery-state reset + no-DB fail-closed (Stage 37.7.4)

- **Recovery-cancelled lobby is playable again (FAIL 1):** `pokerMatchCancelled` describes only the
  PREVIOUS recovered match. START_GAME clears it ONLY after a successful debit + startGame (a failed
  paid start refunds once and leaves a safe cancelled lobby, never hiding recovery status); the new
  match then accepts actions, runs the timer/advance, and settles at finish. Rematch never inherits
  stale recovery flags. `pokerFrozen` is NOT auto-cleared (needs operator resolution).
- **Restored funded room with no DB fails closed (FAIL 2):** a bankroll room restored with unsettled
  escrow while the economy (DB) is unavailable is NOT advanced/timed and NOT cancelled/refunded (that
  needs DB proof). `bankrollEconomyUnavailable()` gates `rescheduleAdvance` + ACTION_REQUEST +
  START_GAME + rematch (→ `ECONOMY_UNAVAILABLE`); the escrow + game state are kept intact for a later
  DB-backed restart to reconcile/settle without a double debit/refund.
- **Durable seat upper bound (FAIL 3):** `parseDurableMatch` requires `0 ≤ seat ≤ 5` (6-max) — seat=6/999 is corrupt.
- **Fresh durable metadata validated before INSERT (FAIL 4):** `recordMatchTx` runs the strict validator
  on the incoming metadata and throws `InvalidDurableMatchError` (rolling back the whole transaction, no
  debit) — a corrupt `poker_matches` row can never be created.
- **Canceled async request is fully silent (FAIL 5):** the async CREATE/JOIN check `isCurrentNav` BEFORE
  any `sendError`, so a superseded/closed navigation never pushes a stale error into a newer session.
- **Recovery UX:** `RoomSnapshot.pokerRecovery` carries a minimal PUBLIC status (`cancelled` / `frozen`)
  — never a userId/matchId/escrow — and is omitted once a fresh match starts; the no-DB case surfaces via
  the `ECONOMY_UNAVAILABLE` error on any action.

### Recovery retry + real recovery UI (Stage 37.7.5)

- **Fresh paid start after a terminal escrow (FAIL 1):** `debitFreshStart` (used by START_GAME)
  handles BOTH the initial start AND a retry after a recovery/refund — a TERMINAL escrow
  (settled/cancelled) is never reused: a brand-new matchId + escrow is minted and a new atomic
  debit runs (old ledger/settlement untouched). A `funded` escrow is idempotent; `pending`/
  `settling` is rejected; a FROZEN room is rejected (never bypassed). The terminal/absent escrow
  is cleared ONLY once its settlement is confirmed; `pokerMatchCancelled` is cleared ONLY after a
  successful debit+start; concurrency is handled by `withRoomLock` + the started/gameState guard.
- **Failure-safe rematch (FAIL 2):** if the rematch debit commits but `restartGame` fails, the
  buy-in is refunded once and the room becomes a persisted, broadcast CANCELLED lobby
  (`pokerMatchCancelled`, cleared state, rematch readiness reset) from which a fresh START works.
- **Real recovery UI (FAIL 3):** `PokerRecoveryBanner` renders the PUBLIC `RoomSnapshot.pokerRecovery`
  status in the online Lobby and the poker game view — `cancelled` (previous match cancelled, buy-ins
  refunded, start a new match) / `frozen` (economy recovering; Start disabled). No userId/matchId/escrow;
  EN/UK/DE/AR; wraps on 360/390 + Arabic RTL. The banner clears once a fresh match starts.

### Refund-failure safety + read-only recovery table + rematch (Stage 37.7.6)

- **Refund result is always honored (FAIL 1):** `refundBuyIns` returns a boolean — `true` only when
  the refund is CONFIRMED (or the escrow was already terminal), `false` when it could not be committed
  (the escrow is left `funded` for retry). Every start/rematch failure path that used to *assume* a
  refund now branches on that boolean: only a `true` result sets `pokerMatchCancelled` + the public
  "refunded" state; a `false` result keeps the escrow funded, mints **no** new matchId, refuses START/
  ACTION/REMATCH, and persists+broadcasts an honest **settlement-pending** state.
- **`settlement_pending` is a DERIVED public state — no new field/migration.** `snapshot()` derives
  `RoomSnapshot.pokerRecovery = 'settlement_pending'` from *bankroll room + `pokerEscrow.status ==
  'funded'` + no `gameState`* (predicate `settlementPending(room)`; `pokerRecoveryBlocked(room)` =
  frozen ∨ settlement-pending ∨ economy-unavailable). No economy fields ever leave the server.
- **A funded escrow at START is an ORPHAN, never a "fresh" start.** `debitFreshStart` no longer treats
  a `funded` escrow as idempotent-ok (which could have reused an old failed match from a clean lobby):
  it **refunds the orphan first**; if that refund fails it returns `{ ok:false, settlementPending:true }`
  and the START handler emits `SETTLEMENT_PENDING` (fail closed). Only a confirmed refund falls through
  to mint a brand-new matchId + debit.
- **Background retry:** `retrySettlementPending()` (in `cleanupRooms`) sweeps settlement-pending rooms
  under `withRoomLock`, re-attempts `refundBuyIns`, and — only on success — flips the room to a cancelled
  lobby (persist + broadcast). Completes exactly once; safe after a DB recovery.
- **Read-only recovery table (FAIL 2):** `PokerGameScreen` takes a `readOnly` prop; `PokerOnlineGame`
  passes `readOnly = (recovery === 'frozen' || 'settlement_pending')`, hiding **every** action control
  (Fold/Check/Call/Bet/Raise/All-in + next-hand) and showing a paused note instead — the banner explains
  why. Lobby Start is likewise disabled for any recovery-blocked room.
- **Poker rematch wired end-to-end (FAIL 3):** `OnlineGame` → `PokerOnlineGame` → `PokerFinished` now
  pass the shared `rematchUi`; `PokerFinished` renders the shared `RematchControls` (online) / local Play
  Again (local). A new **paid** match starts only after the previous one settles; rematch is suppressed
  whenever the table is in any recovery state.
- **Testability (FAIL 4):** a test-only seam `__setRefundFailure(v)` deterministically injects a transient
  refund failure, so the failure path has real fault-injection regression tests (escrow-level + START-handler
  level on real PostgreSQL) instead of an unverified fire-and-forget branch.

### Payout-failure recovery + verified rematch lifecycle (Stage 37.7.7)

- **Payout returns an explicit result (FAIL 1):** `payoutStacks` now returns `PayoutResult`
  (`paid` | `already_paid` | `already_refunded` | `retry_pending` | `invalid`) instead of void, so
  every caller drives the finished-table recovery lifecycle. A **transient** failure (`retry_pending`)
  leaves the escrow `funded`; `already_refunded` (the DB gate says the match was refunded) is honored —
  the finished table is turned into an honest cancelled lobby, never paid or continued as a paid game.
- **`payout_pending` is a DERIVED public state — no new field/migration.** `payoutPending(room)` =
  *bankroll room + escrow `funded`/`settling` + a FINISHED poker game*; `snapshot()` derives
  `RoomSnapshot.pokerRecovery = 'payout_pending'` from the same shape (checked before `settlement_pending`).
  `pokerRecoveryBlocked` now also covers it. Three states are kept **distinct** so cleanup/retry never
  mis-settles: a **live** match (funded + UNFINISHED game — untouched), **settlement-pending** (funded +
  NO game — retry the refund), and **payout-pending** (funded/settling + FINISHED game — retry the payout).
- **Symmetric background sweep:** `retryPendingSettlements()` (in `cleanupRooms`) handles BOTH — it retries
  the refund for settlement-pending rooms and the **payout** (with the authoritative final `PokerState`) for
  payout-pending rooms, paying out exactly once (settlement gate + ledger keys), then broadcasts so the
  recovery clears and rematch re-enables. `maybeRecordFinished`'s payout also broadcasts its result.
- **Rematch waits for a confirmed payout (FAIL 1):** `handleRematch` broadcasts the honest recovery snapshot
  (instead of silently returning) when `pokerRecoveryBlocked`, and the debit-rejected branch broadcasts too —
  a Ready press while the payout is pending shows *why*, never a silent readiness reset.
- **Extracted, unit-tested rematch lifecycle (FAIL 2):** the bankroll rematch body moved to
  `server/pokerRematch.ts` → `runBankrollRematch(room, deps)` (dependency-injected: `debitRematch`,
  `refundBuyIns`, `restartGame`, and broadcast/persist/advance callbacks). It is verified on real PostgreSQL:
  success (fresh matchId, one new debit each, restart+broadcast+advance+persist, dedup no double-debit),
  debit-rejected (previous not settled → no charge, honest broadcast), and restart-fail+refund-fail
  (→ settlement-pending, never a false cancelled; a retry then allows a fresh start with a different matchId).
- **Single recovery banner (FAIL 3):** the banner is owned by `PokerOnlineGame` (it renders it above the
  active table; `PokerFinished` renders the one on the finish screen) — `OnlineGame`'s poker branch no
  longer renders its own, so a frozen/recovery finished table shows the banner **exactly once**.

### Settlement-before-stats + permanent invalid freeze + real rematch request handler (Stage 37.7.8)

- **Settlement-before-stats (FAIL 1):** the old `maybeRecordFinished` ran payout (fire-and-forget) and
  stats (fire-and-forget) in PARALLEL, so a bankroll match's stats could be written before — or without —
  a confirmed payout. Extracted `server/pokerFinish.ts` `settleAndRecordBankrollPokerFinish(room, state, deps)`
  makes it ONE serialized flow (under `withRoomLock`): payout first, then `recordConfirmedPokerStats` ONLY on
  `paid`/`already_paid`. `retry_pending` → stats deferred (the sweep records them after a later paid);
  `already_refunded` → cancelled table, no stats; `invalid` → frozen, no stats. Bankroll poker no longer falls
  through to the generic (pre-payout) stats path; the six other games + local poker are unchanged. Stats stay
  idempotent (per-room signature + `games.game_key`) — no dup on rebroadcast/reconnect/restart/retry.
- **Permanent invalid freeze (FAIL 2):** `payoutStacks` → `invalid` is a fail-CLOSED operator condition
  (impossible conservation / structurally-broken escrow), NOT a transient DB error. `freezeRoomForOperator`
  sets `pokerFrozen` (logs the room code + a safe reason ONCE), and `payoutPending`/`settlementPending` now
  return **false** for a frozen room, so `retryPendingSettlements` never re-attempts the impossible payout
  (no 45s log spam). `deleteRoomWithSettlement` keeps a frozen room (never auto-pays/refunds/purges). A frozen
  room blocks START/ACTION/REMATCH, exposes only the public `frozen` recovery status (no escrow/economy leak),
  and survives serialize→restore.
- **Real REMATCH request handler (FAIL 3):** the request-level authorization + readiness routing moved to
  `server/pokerRematch.ts` `handleRematchRequest(session, decline, deps)` (index.ts routes `REMATCH_READY`/
  `REMATCH_DECLINE` to it). Unit-tested with spies: seated-human authorization (spectator/AI/unknown → no-op),
  first-human-Ready progress, last-human-Ready → exactly one `runBankrollRematch` under the lock, the
  no-double-restart `isRoomFinished` re-check, DECLINE, and `pokerRecoveryBlocked` → honest recovery broadcast
  with no false readiness. A real-PostgreSQL case confirms READY starts a genuine new paid match (one debit/seat).
- **Fault-seam hygiene (FAIL 4):** every suite using `__setRefundFailure`/`__setPayoutFailure` resets both in
  an `afterEach`, so a mid-test failure can never cascade into later suites.

### Finish/rematch correctness hardening (Stage 37.7.9)

- **Stable stats identity (FAIL 1):** `games.game_key` for a BANKROLL match now derives from the stable unique
  escrow `matchId` (`gameKey(roomCode, summary, matchId)` → `sha256('poker|match|<matchId>')`), not the match
  CONTENT. Two consecutive paid matches in the same room with an identical outcome no longer collide (the second
  was silently dropped by `onConflictDoNothing`). `recordFinishedPokerGame` takes an optional `matchId`; the
  in-memory dedup marker also keys on it (`recordConfirmedPokerStats` uses `room.pokerEscrow.matchId`). Non-bankroll
  poker keeps the content-based fallback. The raw matchId never reaches a snapshot/log (only its hash is stored).
- **Persisted stats-pending (FAIL 2):** a payout can CONFIRM (escrow `settled`) and its stats write then fail
  transiently — the old boolean lost it (nothing retried once settled). `recordConfirmedPokerStats` now returns a
  4-way `StatsResult` (`recorded` | `already_exists` | `skipped` | `failed`), and a `failed` write after a paid
  finish sets **persisted `room.pokerStatsPending`**. New predicate `statsPending(room)` (bankroll + flag, not
  frozen) feeds `pokerRecoveryBlocked` (blocks a new paid rematch) and a DERIVED public `pokerRecovery:
  'stats_pending'` (money is out → NOT payout_pending; no economy leak). `retryPendingSettlements` gained a
  stats-pending branch that retries ONLY the stats write (never re-pays) until it resolves, then clears the flag
  and re-enables rematch; `deleteRoomWithSettlement` flushes owed stats before purging. Survives serialize→restore
  (the flag + escrow matchId persist; the durable `game_key` guarantees exactly-once even with a fresh in-memory
  marker). The marker is set only AFTER every early-return gate and undone on a transient failure.
- **Queued-rematch consent re-validation (FAIL 3):** `handleRematchRequest` checked readiness/recovery BEFORE
  `withRoomLock` but re-checked only `isRoomFinished` inside. It now **re-validates under the lock**: finished +
  `!pokerRecoveryBlocked` + `allHumansReady`. A DECLINE / disconnect / recovery change that lands while the rematch
  is queued behind a busy lock aborts `runRematch` (no new debit) with an honest `broadcastRematch`/`broadcastRoom`,
  and two queued last-Ready tasks still run the lifecycle at most once (the finished re-check stops the second).

### Paid-finish recovery + teardown correctness (Stage 37.7.10)

- **Bootstrap classifies a PAID finish (FAIL 1):** the restart recovery pass treated any escrow that wasn't
  `funded`/`settling` — INCLUDING a `settled` (paid) escrow — as a refund, wiping the finished state (and losing
  owed stats). Extracted `server/pokerBootstrap.ts` `classifyBootstrapRecovery(room, isFinished)` (pure) +
  `applyBootstrapRecovery`: a restored bankroll room with a game state is now `live` / `payout_pending` /
  `paid_finish` (settled + finished → keep the result; index.ts sets `pokerStatsPending` so the sweep finalizes
  stats idempotently, NEVER re-paying) / `cancelled` (refunded) / `frozen`. This also fixes the crash-window where
  a room persisted `settling` but the durable payout had committed — `reconcileEscrow` promotes it to `settled`,
  which now classifies as `paid_finish`, not a cancel.
- **Teardown uses the settle→stats lifecycle (FAIL 2):** `deleteRoomWithSettlement` ran a RAW `payoutStacks`→purge
  for a finished room and never recorded stats (owed stats lost on teardown). Extracted
  `server/pokerFinish.ts` `settleRoomForDeletion(room, deps)`: a FINISHED match runs the SAME
  `settleAndRecordBankrollPokerFinish` (payout → stats) as finish/sweep and returns `'purge'` ONLY when fully
  resolved (escrow terminal, not frozen, no owed stats); a transient payout/stats `failed` returns `'keep'` (room
  persisted for the next sweep). Hard invariant: a paid finished room is never purged with stats owed, and a stats
  retry never re-runs the payout. The delete guard also keeps a room that still carries a finished game.
- **Immutable stats attribution (FAIL 3):** `recordConfirmedPokerStats` derived `seatUsers` + the human-only gate
  from the CURRENT `room.members`, which `handleLeave` empties BEFORE teardown — so a valid paid match recorded
  `skipped` (and cleared the owed flag) once players left. For a bankroll match it now takes the seat→userId
  snapshot from the persisted **`pokerEscrow.seats`** (authenticated participants captured at buy-in; ≥2, no bots
  by construction) and keys stats identity on the escrow `matchId`. A missing/malformed escrow for a bankroll room
  that owes stats returns `failed` (retryable) — never a silent `skipped` that would drop the record. Non-bankroll
  poker keeps the membership-based fallback.
- **Persist/broadcast ordering:** the paid finish now computes the stats outcome and sets the final recovery flag
  (`stats_pending` or cleared) BEFORE the single persist+broadcast, so the table never flickers "rematch enabled"
  between a confirmed payout and a stats-pending state.

### Fail-closed recovery of incoherent paid matches (Stage 37.7.11)

- **`settled` + UNFINISHED is INCOHERENT, not `live` (FAIL 1).** `classifyBootstrapRecovery` returned `live` for a
  restored bankroll room whose escrow was already `settled` (durable payout committed) but whose persisted state was
  still mid-hand — the real crash window is: finish in memory → payout commits → room JSON still holds the pre-finish
  state → crash → `reconcileEscrow` promotes `settling` to `settled`. The match would then resume, arm timers, accept
  `ACTION_REQUEST`, and could be paid/refunded again. New classification **`incoherent_paid`** → `applyBootstrapRecovery`
  clears the room timers and **freezes** it permanently (`pokerFrozen`, logged once with the room code + a safe reason).
  It is NOT `pokerMatchCancelled` (nothing was refunded) and the state is kept as evidence. Frozen already blocks
  START/ACTION (wsHandlers) and REMATCH (`pokerRecoveryBlocked`), is excluded from `payoutPending`/`settlementPending`/
  `statsPending` (no sweep retry, no log spam), keeps `hasUnsettledEscrow` true (never purged), survives serialize→restore,
  and surfaces publicly only as `pokerRecovery: 'frozen'`.
- **No bankroll room advances before classification (FAIL 1).** The restore loop deferred the advance only for
  `hasUnsettledEscrow` rooms, so a `settled`/`cancelled`/stats-pending room was advanced BEFORE the recovery pass ran.
  New pure predicate **`shouldDeferBootstrapAdvance(room)`** (true for every bankroll room) gates that line in
  `bootstrap()`; only classification `live` re-arms it. Non-bankroll rooms (the other 6 games, local poker) are unchanged.
- **`settleRoomForDeletion` no longer purges a paid-but-unfinished room (FAIL 1).** It froze nothing and saw
  `hasUnsettledEscrow === false`, so it returned `purge` and destroyed the evidence of a paid match. It now returns
  `keep` for a frozen room, and freezes + keeps a `settled` escrow with an unfinished state. `deleteRoomWithSettlement`'s
  synchronous fast-path guard also widened from "a FINISHED game" to "**any carried game state**", so such a room can no
  longer skip the lock-serialized settlement flow entirely.
- **ONE shared strict participant validator (FAIL 2).** New `server/pokerParticipants.ts`
  `validatePaidMatchParticipants(escrow, state)` is the single source of truth for a paid match's identity:
  non-empty matchId, safe `buyIn > 0`, 2–6 seats, safe in-range seat indices, no duplicate seat, no duplicate account,
  `amount === buyIn`, `playerCount` consistent with `players`/`stacksBySeat`, the escrow seat set EXACTLY equal to the
  state's player seat set, **no `ai` seat**, and a participant winner. `validatePayoutConservation` now delegates its
  structural half to it (then checks Σ stacks == Σ buy-ins), and `recordConfirmedPokerStats` uses it to build `seatUsers`
  — no weaker second copy of the rules. `payoutStacks` also stopped short-circuiting a `settled` escrow to `already_paid`
  without validation: `already_paid` is the caller's green light to record stats, so it now runs the same check first.
- **`invalid` is a distinct, PERMANENT stats outcome (FAIL 2).** `StatsResult` gained `invalid` (structurally impossible →
  freeze, keep the owed flag, never write, never retry), kept apart from `failed` (transient → retried), `already_exists`
  (durable duplicate → resolved) and `skipped` (policy). `settleAndRecordBankrollPokerFinish` and the `retryPendingSettlements`
  stats branch both freeze on `invalid`; a malformed escrow that owes stats can never silently become `skipped`.
- **Test evidence gap closed.** Stage 37.7.10's `pokerBootstrapRecovery.integration.test.ts` re-created the bootstrap
  orchestration inside the test (`recover()`), so it did NOT exercise the production path — which is why the early
  `rescheduleAdvance` and the `settled` + unfinished classification went unnoticed. Its claim of driving the "production
  recovery path" was inaccurate. The orchestration is now `server/pokerBootstrap.ts` **`recoverRestoredBankrollRoom(room, deps)`**
  (reconcile → classify → apply/persist/advance decision) — `server/index.ts` pass (d) calls it under `withRoomLock`, and the
  integration suite calls the SAME function plus `shouldDeferBootstrapAdvance`, so the test can no longer drift from production.

### Durable gameState ↔ escrow-generation binding (Stage 37.7.12)

- **The crash window (FAIL 1).** `runBankrollRematch` calls `debitRematch` → `performDebit` replaces `room.pokerEscrow`
  with M1 (`pending`) and only THEN awaits the DB debit; `restartGame` runs afterwards. While the debit is in flight the
  room holds **escrow M1 + the FINISHED state of M0**, and the socket close handler persists the room without taking the
  room lock — so exactly that pair can reach the room JSON. If the process dies before `restartGame`, bootstrap saw
  `reconcileEscrow` promote M1 `pending → funded`, `isFinished(state)` true → **`payout_pending`**, and the sweep paid
  **M1's fresh buy-ins to M0's winner** and wrote a second stats/game row for M0's result under M1's identity — a
  redistributed buy-in for a hand that was never dealt. RED reproduction: `src/net/pokerRematchCrash.integration.test.ts`
  (real PostgreSQL) showed `recovery=payout_pending`, `table_payout` rows for M1 = 1, `refund` rows for M1 = 0, `games` = 2.
- **The binding.** New server-only persisted field **`ServerRoom.pokerGameMatchId`** + `server/pokerBinding.ts`:
  - `bindGameToEscrow(room)` — sets it ONLY when the room is bankroll, has a game state, and the escrow is **`funded`**
    with a matchId. Called at exactly two places: `wsHandlers` START (after a successful debit AND a successful
    `startGame`) and `runBankrollRematch` (after a successful debit AND a successful `restartGame`).
  - `clearGameBinding(room)` — called wherever the game state is dropped (failed start/rematch refund, `cancelled`
    bootstrap recovery, the finish path's refund branch, the unbound resolution).
  - `escrowGameBinding(room)` — the pure classifier: `not_bankroll` / `no_game` / `no_escrow` / `bound` / `unbound` /
    `unknown` (a legacy save: state + escrow, no marker). `gameBoundToEscrow(room)` = `=== 'bound'`.
  - Persistence: `serializeRoom`/`deserializeRoom` carry it (restored only as a non-empty string). It is **never** in
    `RoomSnapshot`/`RoomSummary`/any public message and **never logged** (only room codes + safe reasons are).
  - A per-room lock is NOT a substitute: the lock serializes work inside one process, the binding is what survives the
    crash/restore boundary where the damage happens.
- **Every economy path requires `pokerGameMatchId === pokerEscrow.matchId`.** `payoutPending` (so an unbound pair is not
  a payable finish), `settleAndRecordBankrollPokerFinish` (hard gate → new `FinishResult` value **`unbound_state`**, no
  wallet touched), `recordConfirmedPokerStats` (→ `invalid`), `classifyBootstrapRecovery`, `settleRoomForDeletion`, and
  the bootstrap **`activeMatchIds`** set fed to `reconcileOrphanedDebits` (an unbound durable debit is deliberately NOT
  "active", so the orphan scan refunds it once through the failed-start lifecycle instead of protecting it).
- **The unbound lifecycle.** New predicate `unboundEscrowGame(room)` (live escrow + `unbound` binding; folded into
  `pokerRecoveryBlocked`, so no timers/actions/rematch) and `resolveUnboundEscrowGame(room, deps)`: drop the stale state
  + binding, clear timers, `refundBuyIns` (idempotent) → `refunded` (→ `pokerMatchCancelled`, an honest lobby a fresh
  START can reuse) or `settlement_pending` (transient DB failure → escrow stays funded with no state, retried by
  `retryPendingSettlements`, and `hasUnsettledEscrow` keeps the room from being purged). Driven from three production
  callers: `recoverRestoredBankrollRoom` (classification **`unbound_debit`**), the settlement sweep, and
  `settleRoomForDeletion` (`purge` only after a CONFIRMED refund, else `keep`).
- **Fail-closed for what can't be proven.** Classification **`unknown_binding`** (a legacy save with a state + a live
  escrow but no marker) freezes the room for operator review — the generation is never guessed. `settled` + `unbound`
  is likewise frozen (an incoherent paid state). A `pending` escrow that survived reconcile (uncommitted debit) is
  classified `cancelled`: nothing was charged, so nothing is paid, refunded or recorded.
- **Six crash windows covered** (`pokerRematchCrash.integration.test.ts`, real PostgreSQL): (1) M1 `pending`, debit NOT
  committed → reconcile drops it, 0 payout / 0 refund / 0 stats; (2) M1 `pending`, debit committed → exactly one refund,
  0 payout, 0 stats; (3) M1 `funded` + M0's state → refund once, 0 payout, 0 stats, balances back to pre-rematch, and a
  fresh M2 then starts and finishes normally; (4) new state + matching binding → the live match restores as `live`;
  (5) matching finished state → payout + stats exactly once; (6) missing binding → frozen, no payout/refund/stats.
- **Strict FINISHED paid-state validation (FAIL 2).** `validatePaidMatchParticipants` stayed the participant/identity
  layer but was tightened (`stacksBySeat.length` **exactly** `playerCount`; a POSITIVE `type === 'human'` test instead
  of the old `!== 'ai'`, which let `undefined`/`'bot'`/any unknown value pass; unique non-empty player ids). The new
  **`validateFinishedPaidMatch`** layers the finished-only invariants on top: `phase === 'game_finished'`, exactly one
  participant `winnerSeat`, the winner's stack == Σ buy-ins and every other stack == `0`. `validatePayoutConservation`
  and `recordConfirmedPokerStats` both delegate to it, so payout and stats can never disagree; the split keeps live,
  payout-independent gameplay validation untouched. Every malformed shape is `invalid` → nothing paid, nothing recorded,
  room frozen permanently, teardown `keep`.

### Bootstrap settlement ordering + ambiguous pending recovery (Stage 37.7.13)

- **CORRECTION to 37.7.12.** That stage claimed "an `unknown` binding freezes with NO payout and NO refund". The
  per-room helper did behave that way, but PRODUCTION did not: `server/index.ts` ran the passes in the order
  reconcile → build `activeMatchIds` from a room SHAPE test (`funded|settling` + a game state + `gameBoundToEscrow`)
  → `reconcileOrphanedDebits` → classify/apply. An `unknown` binding fails that shape test, so the room was NOT in
  `activeMatchIds` and the GLOBAL orphan scan **refunded its durable match** seconds before `applyBootstrapRecovery`
  froze it — leaving a room that is `funded` + `pokerFrozen` in memory while the DB says `cancel_refund`. The 37.7.12
  integration test missed it because it drove `recoverRestoredBankrollRoom` directly and never ran the global scan.
  RED evidence (real PostgreSQL, the old ordering replayed verbatim): `table_cancel_refund` rows for the frozen room's
  match = **2**, expected 0.
- **One shared pipeline (FAIL 1 fix).** `server/pokerBootstrap.ts` **`runBootstrapEconomyRecovery(rooms, deps)`** is now
  the whole startup economy sequence, called by `server/index.ts` AND by `pokerBootstrapOrdering.integration.test.ts`:
  1. reconcile every transient escrow under `withRoomLock`, keeping the EXPLICIT outcome per room;
  2. **classify** (pure) with that outcome;
  3. derive **`settlementProtectedMatchId(room, recovery, reconcile)`** from those classifications;
  4. `reconcileOrphanedDebits(protected)`;
  5. corrupt-escrow room pass;
  6. apply recovery per room (`recoverRestoredBankrollRoom(room, deps, reconciled)` — the SAME reconciliation result,
     so protection and recovery can never disagree within one boot).
  Protected: `live`, `payout_pending`, `paid_finish`, `incoherent_paid`, `unknown_binding`, `recovery_pending`,
  `corrupt_debit`, `frozen`, plus ANY room whose escrow is `pending`/`settling` or whose reconciliation returned
  `retry_pending`/`corrupt_partial` (even with no game state). NOT protected: `unbound_debit` (an explicitly stale
  generation IS an orphan → the failed-start refund, exactly once), a resolved escrow, and a plain funded orphan with
  no game (a failed start the scan legitimately refunds).
- **Explicit reconciliation result (FAIL 2 fix).** `reconcileEscrow` returned `void`, so `classifyBootstrapRecovery`
  inferred the outcome from the escrow status and mapped a surviving `pending` to **`cancelled`** — wiping the game
  state + binding and declaring a clean cancellation while the durable outcome was UNKNOWN. A surviving `pending` only
  ever means "unproven": a transient `matchLedgerState` read failure, no economy, or a PARTIAL debit. New
  **`EscrowReconcileResult`** = `noop | funded | settled | cancelled | proven_uncommitted | retry_pending |
  corrupt_partial`, and `classifyBootstrapRecovery(room, isFinished, reconcile)` consumes it:
  `corrupt_partial` → **`corrupt_debit`** (freeze — a refund would short a debited seat, a payout would mint chips);
  `retry_pending`, or any escrow still `pending`/`settling`, → **`recovery_pending`**; `cancelled` now requires durable
  proof (a `cancelled` escrow, or `proven_uncommitted`, which drops the escrow).
- **`recovery_pending` is inert, not cancelled.** `applyBootstrapRecovery` clears only the timers and persists: state,
  binding and escrow are kept as evidence, nothing is frozen and nothing is settled. New predicate
  **`escrowUnresolved(room)`** (bankroll + `pending`/`settling`) feeds `pokerRecoveryBlocked` (no rematch), guards
  `rescheduleAdvance` (no advance/timer/bot) and `ACTION_REQUEST` (`SETTLEMENT_PENDING`); `settleRoomForDeletion`
  returns `keep` (never purged, never settled) and freezes a `corrupt_partial`; `snapshot` reports the opaque
  `settlement_pending`. The next boot with a working DB resolves it: zero debit → `cancelled`, full + bound → `live` /
  the matching finish recovery, full + unbound → refunded once.
- **Test-suite isolation (a real, pre-existing flake).** `reconcileOrphanedDebits` is cluster-wide, so a scan in one
  integration FILE refunded another concurrently-running file's in-flight match — reproducible on the 37.7.12 baseline
  (1 failure in 6 poker-suite runs). `src/net/pokerDbSuite.testutil.ts` adds `withPokerDbSuiteLock(beforeAll, afterAll)`
  (a Postgres ADVISORY lock on a reserved connection, so it serializes across vitest workers and self-releases if a
  worker dies), registered by all 13 poker DB files, plus `scopedOrphanScan` (protects every match the suite does not
  own) as second-order defence. 8/8 clean poker-suite runs after the change.

### Runtime recovery sweep + settlement precedence + corrupt durable freeze (Stage 37.7.14)

- **CORRECTION to 37.7.13.** That stage documented that an unresolved (`pending`/`settling`) escrow is "retried on the
  next sweep/restart". The RESTART half was true; the SWEEP half was not. `retryPendingSettlements` never called
  `reconcileEscrow`, and `settlementPending`/`payoutPending` both require a FUNDED escrow, so an unresolved room matched
  no branch at all and stayed blocked for the life of the process (RED: sweep branch = `no_branch`, escrow still
  `pending`). Worse, the FIRST branch — `unboundEscrowGame` — accepted `pending`/`settling`, so
  `resolveUnboundEscrowGame` dropped `gameState` + `pokerGameMatchId` and only THEN called `refundBuyIns`, which refuses
  a pending debit: the generation evidence was destroyed with nothing refunded (RED: `gameState = null`,
  `binding = undefined`, escrow still `pending`). For a `settling` escrow a payout may already have committed.
- **`runRoomRecoverySweep(room, deps)` (FAIL 1 fix).** A new production helper in `server/pokerBootstrap.ts`, called by
  `server/index.ts` AND by `pokerRuntimeSweep.integration.test.ts` — no second copy of the recovery branching in
  index.ts. Under `withRoomLock`: frozen → no-op; escrow not transient → idle (the funded retries own it); otherwise
  `reconcileEscrow` → `classifyBootstrapRecovery` → the SHARED apply policy (via `recoverRestoredBankrollRoom`, or a
  direct freeze for `corrupt_partial` when the room has no game state). It returns
  `{ reconciled, recovery, changed }`; `changed` is false while the outcome is unproven, so an unresolved room neither
  mutates nor log-spams every 45 s. Because the ENTRY condition is "escrow is transient", a revived room stops matching
  once resolved — `rescheduleAdvance` fires EXACTLY once, never on every tick.
- **Reconciliation PRECEDENCE.** `retryPendingSettlements` now tests `escrowUnresolved(room)` FIRST, ahead of
  `unboundEscrowGame` / `settlementPending` / `payoutPending` / `statsPending`. To make that airtight, `unboundEscrowGame`
  and `payoutPending` were narrowed from `!settled && !cancelled` / `funded|settling` to **`funded` only**: an unproven
  escrow can no longer be routed into a refund or a payout, and `payoutStacks` would have answered `retry_pending` for a
  `settling` escrow anyway.
- **Settlement precedence in `reconcileEscrow` (FAIL 2 fix).** The durable settlement row is now consulted for EVERY
  transient status, not just `settling`: `payout` → `settled`, `cancel_refund` → `cancelled`. Only with NO settlement row
  does the buy-in ledger decide (`pending`: full → `funded`, zero → `proven_uncommitted`, partial → `corrupt_partial`;
  `settling` → retryable `funded`). RED: a `pending` escrow with a committed payout reconciled to **`funded`**, so an
  unfinished bound state was classified `live` and could resume an already-PAID match — bypassing the 37.7.11
  `settled` + unfinished → `incoherent_paid` invariant; a committed `cancel_refund` was likewise ignored.
- **Corrupt durable match freezes its room (FAIL 3 fix).** `reconcileOrphanedDebits` returned `corrupt` match ids that
  `runBootstrapEconomyRecovery` discarded, so a room with a structurally VALID escrow (hence `pokerEscrowCorrupt` false)
  but a malformed `poker_matches` row was classified `live` and re-armed (RED: `recovery = live`, `advanced = [room]`).
  The scan result gained **`corruptRoomCodes`** (room codes only — no matchId/userId/seats/balances), and a new pipeline
  step (e2) freezes those rooms BEFORE the apply pass; classification then short-circuits to `frozen`, so nothing is
  advanced, refunded, paid, recorded or purged, and state/binding/escrow/durable evidence are all preserved. The freeze
  logs once (`corrupt durable match record`) and the public snapshot shows only `frozen`. Note this is the OPPOSITE
  shape to `pokerEscrowCorrupt` (a malformed persisted room JSON) — both are now covered.
- **Regression suite:** `src/net/pokerRuntimeSweep.integration.test.ts` (real PostgreSQL) drives BOTH production entry
  points across: a bound pending room revived by the sweep (advance exactly once, teardown `keep`, actions rejected
  while unproven); a pending room with NO game state; a pending UNBOUND escrow (evidence kept until proven, then
  refunded exactly once, balances back to pre-rematch); pending + durable payout with an unfinished state
  (→ `incoherent_paid`, frozen) and with a finished state (→ `paid_finish`, stats exactly once, payout never repeated);
  pending + durable refund (→ `cancelled` only on that proof); `settling` parity; the corrupt-durable freeze with full
  privacy + idempotence checks; plus explicit non-regression for the healthy live / payout_pending / stats_pending /
  unbound flows and for non-poker + LOCAL free poker rooms (never touched). `pokerBootstrap.test.ts` adds a pure
  precedence/guard matrix for `runRoomRecoverySweep`.

### Exact durable ownership + collision-safe corrupt handling + secret-free logs (Stage 37.7.15)

- **CORRECTIONS to 37.7.14.** (a) Corrupt durable records were associated with a restored room by ROOM CODE. Codes are
  4 chars and `makeRoomCode` only avoids collisions with the LIVE in-memory rooms, while an unresolved corrupt
  `poker_matches` row survives indefinitely — RED: a stale corrupt record for code `RQ1A` froze a brand-new healthy
  table that reused it (`recovery = frozen`, `advanced = []`), a permanent false-positive denial of service.
  (b) Bootstrap only checked that a durable row PARSED, never that it OWNED the escrow — RED: a room whose
  `poker_matches` row was deleted, and a room whose row described a different match (other buyIn + swapped accounts),
  were both classified `live`; a `pending` room whose buy-in ledger had the right COUNT but one row moved to another
  account reconciled to `funded` → `live`. (c) "The operator log carries the room code + a safe reason, never a
  matchId" was false — RED captured `[Poker] orphaned match corr-… is CORRUPT` and
  `[Poker] crash-recovery refund for orphaned match 2a1d0137-…`.
- **Exact ownership contract (FAIL 2 fix).** New `db/pokerWallet.matchDurableEvidence(matchId)` loads the COMPLETE
  evidence — the parsed `poker_matches` row, EVERY `table_buy_in` ledger row (userId / delta / idempotencyKey /
  roomCode) and the settlement outcome — replacing `matchLedgerState`'s count-only view for recovery. New PURE
  `server/pokerDurableOwnership.ts` `validateDurableOwnership(roomCode, escrow, evidence)` returns
  `settled_payout | settled_refund | exact_funded | proven_uncommitted | missing_durable | corrupt_durable |
  metadata_mismatch | ledger_partial | ledger_mismatch`. It requires: settlement precedence first; then the row to
  exist, parse, and match `roomCode` / `buyIn` / canonical `seat:user:amount` set; then EXACTLY one buy-in row per
  participant with `delta === -amount`, the right roomCode and the canonical `buyInIdempotencyKey(matchId, userId)`
  (now shared with `performDebit`, so writer and validator cannot drift), and no extra/duplicate rows.
- **`resolveEscrowEvidence(room)` (pokerEscrow).** The single DB read the RECOVERY path uses. It covers
  `pending`/`settling` AND **`funded`** — a funded escrow with no matching durable record must not resume either —
  while `reconcileEscrow` keeps the narrower transient-only scope for teardown (which settles, never resumes).
  `EscrowReconcileResult` gained `missing_durable | corrupt_durable | metadata_mismatch | ledger_mismatch`
  (`corrupt_partial` remains the half-charged ledger); `isCorruptEvidence()` groups all five, and
  `classifyBootstrapRecovery` maps them to the ONE fail-closed `corrupt_debit`. `proven_uncommitted` only drops a
  **pending** escrow; a FUNDED escrow with no trace of its debit is `missing_durable`, not a rollback. A transient
  read failure is still `retry_pending`. `server/index.ts` `bootstrapRecoveryDeps` now injects `resolveEscrowEvidence`.
- **Collision-safe corrupt association (FAIL 1 fix).** `reconcileOrphanedDebits` returns
  **`corruptRefs: { matchId, roomCode, reasonCode }[]`** (INTERNAL only — never logged, never sent to a client) instead
  of `corruptRoomCodes`. Pipeline step (e2) freezes a restored room only when `room.pokerEscrow.matchId` is in the
  corrupt set; `roomCode` is audit context. `pokerEscrowCorrupt` (a malformed persisted room JSON, where the current
  matchId cannot be proven) keeps its separate roomCode-based fail-closed path.
- **Secret-free logs (FAIL 3 fix).** All five poker economy log lines were rewritten to `room <code>: <bounded reason>`
  — no matchId, userId, seats or balances. A regression test spies on the REAL `console.log`/`console.error` across a
  corrupt-durable scan, a valid orphan refund, an invalid payout validation and a repeated bootstrap, asserting the
  output contains no match id, no account id and no private field name, while safe room codes/reasons/counts remain.
- **Regression suites:** `src/net/pokerDurableOwnership.integration.test.ts` (real PostgreSQL) covers the room-code
  collision (healthy table stays `live`, stale record stays operator-owned and unrefunded), the room's OWN corrupt
  record (still frozen), the full ownership matrix — missing row; wrong roomCode / buyIn / seat set / seat count;
  ledger wrong account / wrong delta / wrong room / extra row — each asserting the complete fail-closed contract
  (frozen, zero refund/payout/stats/settlement, balances unchanged, evidence kept, teardown `keep`, opaque snapshot,
  idempotent repeat, one log line); the healthy exact-evidence live case; settlement precedence; the explicit unbound
  generation still refunding exactly once; a transient failure being `retry_pending` then resuming; and the logging
  audit. `src/net/pokerDurableOwnership.test.ts` adds the pure contract matrix.

### Terminal settlement integrity + settlement-time guard + consistent snapshot (Stage 37.7.16)

- **CORRECTIONS to 37.7.15.** (a) `validateDurableOwnership` checked the SETTLEMENT ROW FIRST and returned, so a
  committed payout/refund skipped the structural proof — RED: `settled` + payout row + finished state + a DELETED
  `poker_matches` row classified `paid_finish` AND `recordConfirmedPokerStats` returned `recorded` (a real stats row
  attributed from the room escrow alone); `cancelled` + refund row + a corrupt row classified `cancelled` and CLEARED
  the game state. (b) `settled`/`cancelled` escrows were never validated (the evidence pass filtered on
  `hasUnsettledEscrow`) — RED: a room whose escrow merely SAID `settled` with no DB settlement row still became
  `paid_finish`, and a room saying `cancelled` while the DB held a PAYOUT was wiped as a cancelled lobby. (c) The proof
  ran at recovery but not at settlement — RED: deleting `poker_matches` after START and then finishing returned
  `paid` with a real payout row + settlement row. (d) The loader ran three separate READ COMMITTED statements — RED:
  replaying them around an atomic debit observed `{matchRowExists: false, buyIns: 2}`, which the validator reads as
  `missing_durable` → a false permanent freeze.
- **Combined result model (FAIL 1 fix).** `validateDurableOwnership` now returns
  `{ financial: 'unresolved'|'payout'|'cancel_refund', structure: 'exact'|'proven_uncommitted'|'missing'|'corrupt'|
  'metadata_mismatch'|'ledger_partial'|'ledger_mismatch' }`, computed INDEPENDENTLY. `resolveEscrowEvidence` requires
  BOTH: `exact` + payout → `settled`, `exact` + refund → `cancelled`, `exact` + unresolved → `funded`; any other
  structure maps to the corresponding permanent value (`missing_durable` / `corrupt_durable` / `metadata_mismatch` /
  `corrupt_partial` / `ledger_mismatch`), and `proven_uncommitted` with a settlement row is `corrupt_durable` (a
  settlement with zero evidence is corruption, not a rollback). All still funnel into the ONE `corrupt_debit`
  classification. `recordConfirmedPokerStats` additionally refuses outright for a FROZEN bankroll room.
- **Terminal claims are validated (FAIL 2 fix).** The bootstrap evidence pass filter became
  **`claimsEconomyMatch(room)`** — any escrow (terminal included), game state, generation binding or owed stats — and
  `resolveEscrowEvidence` no longer exits early for `settled`/`cancelled`. A terminal claim the DB does not confirm is
  **`terminal_unconfirmed`**; one it contradicts is **`terminal_conflict`**; both are in `isCorruptEvidence`.
  `settlementProtectedMatchId` now protects a room whose reconciliation/classification is corrupt-evidence BEFORE its
  terminal-status early return, so an unconfirmed `settled` room is not orphan-refunded seconds before it is frozen.
- **Atomic settlement-time guard (FAIL 3 fix).** New `settleMatchWithOwnershipTx(roomCode, expected, outcome, mutate,
  validate)` in `db/pokerWallet.ts`: inside ONE transaction it locks the durable row `FOR UPDATE`, reads the buy-in
  ledger + settlement from the SAME snapshot, requires `structure === 'exact'`, and only then claims the settlement gate
  and mutates wallets. A failure throws the typed `DurableOwnershipError` and the transaction rolls back — no settlement
  row, no chip movement. `payoutStacks` uses it for a fresh payout (and proves ownership again before returning
  `already_paid`, since that is the caller's green light to record stats); `refundBuyIns` was split into
  **`refundBuyInsResult` → `resolved | retry_pending | invalid`** with `refundBuyIns` kept as the boolean wrapper.
  `settleRoomForDeletion` freezes on `invalid` (keep, never purge, never retried). Financial precedence is untouched:
  the opposite existing outcome still raises `SettlementConflictError`, same-outcome replays stay idempotent.
- **One consistent snapshot (FAIL 4 fix).** `matchDurableEvidence` runs its three reads in a single
  `REPEATABLE READ`, read-only transaction (`readEvidence` is shared with the settlement guard, which takes the row
  lock). New test seam `__setEvidenceReadGap(fn)` is awaited BETWEEN the reads so a test can commit an atomic debit in
  that window and prove the observation is still self-consistent.
- **Regression suite:** `src/net/pokerSettlementIntegrity.integration.test.ts` (real PostgreSQL, 11 tests) covers
  A–H (settled+payout with missing/mismatched evidence; cancelled+refund with a corrupt row; `terminal_unconfirmed`;
  both `terminal_conflict` directions; the exact healthy payout and refund), the settlement-time guard 1–6 (durable row
  deleted / metadata altered / ledger altered before finish; the teardown refund; the healthy finish and teardown),
  replays 7–10 (exact payout/refund idempotent, corrupt ones never mutate and freeze), the deterministic
  consistent-snapshot test, and non-regression for transient failures plus non-poker + LOCAL poker rooms. Each
  fail-closed case asserts: `corrupt_debit`, frozen, no new settlement row, zero stats, unchanged balances, evidence
  kept, a direct stats write refused, teardown `keep` and an opaque `frozen` snapshot.

### Guarded orphan settlement + escrowless recovery claims (Stage 37.7.17)

- **CORRECTIONS to 37.7.16.** (a) The atomic ownership guard was wired into the ROOM payout/refund only. The GLOBAL
  `reconcileOrphanedDebits` → `refundDurableMatch` path (and `reconcileCorruptRoom`, which shares it) still used the
  UNGUARDED `settleMatchTx`, trusting a `poker_matches` row merely because `parseDurableMatch` accepted it — RED: an
  orphan whose ledger was missing one seat's debit was refunded to BOTH seats (`refunded: true`, 2 `table_cancel_refund`
  rows, the never-debited account back at **1,000,000** — minted chips — and a `cancel_refund` settlement closing the
  match). The same held for an empty ledger, a wrong-account debit, a wrong delta/room/key and an extra row.
  (b) `claimsEconomyMatch` correctly included escrowless rooms, but `resolveEscrowEvidence` returned `noop` for them and
  `classifyBootstrapRecovery` mapped `!esc` straight to `cancelled` — RED: with a transient scan failure, with a durable
  PAYOUT, and with no binding at all, the room was still `cancelled` with `gameState` and `pokerGameMatchId` CLEARED.
  (c) `refundBuyInsResult` answered `resolved` for ANY terminal escrow status — RED: a room whose escrow merely said
  `settled` resolved with **0** settlement rows in the DB.
- **One guarded settlement contract (FAIL 1 fix).** `refundDurableMatch` now calls `settleMatchWithOwnershipTx` with the
  parsed record as the EXPECTED metadata and returns `RefundResult`. `reconcileOrphanedDebits` counts only `resolved` as
  refunded, routes `invalid` into `corruptRefs` (operator-owned, safe log: room code + bounded reason) and reports
  transient failures in a new **`retryable`** array; `reconcileCorruptRoom` requires `resolved` too. The unguarded
  **`settleMatchTx` was deleted** — there is no longer any poker settlement API without an ownership proof (the pure
  `resolveSettlementOutcome` decision remains, unit-tested).
- **Escrowless recovery state machine (FAIL 2 fix).** New `resolveEscrowlessClaim(room)`: with no binding →
  **`escrowless_unknown`** (frozen); otherwise the binding's evidence is loaded and validated AGAINST THE DURABLE RECORD
  ITSELF (the ledger must back the row) → `cancelled` (durable refund), `proven_uncommitted`, `escrowless_unknown` (a
  durable PAYOUT — participants cannot be rebuilt), `corrupt_durable` / `missing_durable` / `metadata_mismatch` /
  `corrupt_partial` / `ledger_mismatch`, or **`escrowless_unresolved`** (exact + unsettled → inert). `classifyBootstrapRecovery`
  maps `!esc` accordingly (`cancelled` only on explicit proof, `escrowless_unresolved` → `recovery_pending`, everything
  else → `corrupt_debit`). New predicate **`escrowlessClaim(room)`** feeds `pokerRecoveryBlocked`, the `rescheduleAdvance`
  guard, the `ACTION_REQUEST` guard, the public `settlement_pending` snapshot status, and `settleRoomForDeletion`
  (which now returns `keep` instead of purging a claim whose `hasUnsettledEscrow` is false).
- **Confirmed-refund gating before cleanup (FAIL 2 fix).** `runBootstrapEconomyRecovery` gained step (e3): an
  `escrowless_unresolved` room becomes `cancelled` ONLY when its `pokerGameMatchId` is in the scan's confirmed
  `orphanRefunded` set for THIS boot; step (e4) freezes an unprovable claim that has no game state (e.g. owed stats with
  no escrow) since it cannot reach the apply pass.
- **Terminal fast path re-proved (FAIL 3 fix).** `refundBuyInsResult`'s `settled`/`cancelled` branch routes through the
  shared `resolveEscrowEvidence` → `retry_pending` stays retryable, corrupt evidence returns `invalid` (teardown
  freezes + keeps), and only a DB-confirmed terminal outcome answers `resolved`.
- **Regression suite:** `src/net/pokerGuardedSettlement.integration.test.ts` (real PostgreSQL, 8 tests) covers the six
  malformed-ledger orphan shapes (never refunded, reported corrupt, zero settlements, balances untouched, idempotent
  repeat), the corrupt-room path plus an exact orphan still refunding once, and escrowless cases 1–9 (transient scan
  failure; confirmed refund → clean lobby; durable payout/refund/corrupt/partial; no binding; owed stats with no
  escrow; repeated boots), each asserting blocked gameplay, `teardown === 'keep'`, zero settlement/stat mutation and a
  leak-free snapshot — plus a healthy-live / non-poker / LOCAL-poker non-regression case.

### Settlement outcome integrity + runtime orphan recovery (Stage 37.7.18)

- **CORRECTIONS to 37.7.17.** (a) `RefundResult` was `resolved | retry_pending | invalid`, and BOTH a real refund and a
  `SettlementConflictError` whose resolved outcome was `payout` returned `resolved` — RED: a funded room whose match was
  durably PAID answered `resolved`, and the deterministic scan race (the scan reads the match unsettled, a payout commits
  before the refund claims the gate) put the matchId in `scan.refunded` while `poker_match_settlements.outcome = 'payout'`
  and 0 refund rows existed. Bootstrap step (e3) trusts `orphanRefunded`, so a PAID escrowless room could be wiped as
  cancelled. (b) `reconcileCorruptRoom` refunded every unsettled durable match sharing the room's 4-char code — RED:
  `reconcileCorruptRoom` returned `true` and wrote a `cancel_refund` settlement + 2 refund rows for a match it could not
  own. (c) The global orphan scan ran only at bootstrap — RED: after a transient guarded-refund failure the orphan stayed
  debited (995 000) and no runtime coordinator existed.
- **Precise settlement outcomes (FAIL 1 fix).** `RefundResult` is now
  `confirmed_refund | already_paid | nothing_to_refund | retry_pending | invalid`, returned by BOTH `refundBuyInsResult`
  and `refundDurableMatch`. `reconcileOrphanedDebits` puts only `confirmed_refund` into `refunded` and reports
  `alreadyPaid` on its own axis (alongside `corrupt`/`corruptRefs`/`retryable`). The boolean `refundBuyIns` was DELETED;
  every production caller now branches on the exact outcome: `debitFreshStart` mints a fresh match only after
  `confirmed_refund`; `resolveUnboundEscrowGame` gained a `paid_conflict` resolution that the bootstrap/teardown callers
  turn into a freeze; the `settlementPending` sweep freezes on `already_paid`/`invalid` instead of cancelling;
  `runBankrollRematch` and the failed-start handlers require `confirmed_refund`; `settleRoomForDeletion` never purges on
  `already_paid`.
- **Room codes never authorise a settlement (FAIL 2 fix).** `reconcileCorruptRoom` no longer refunds by roomCode: if any
  unsettled durable match names the code it returns `false` (freeze, records/settlements/wallets untouched); the flag
  clears only when nothing durable references it. `reconcileOrphanedDebits(protectedMatchIds, protectedRoomCodes)` gained
  a fail-closed room-code protection set, filled from `pokerEscrowCorrupt` rooms by BOTH the bootstrap and runtime passes
  BEFORE the scan runs.
- **Runtime orphan recovery (FAIL 3 fix).** New `runRuntimeEconomyRecovery(rooms, deps)` in `server/pokerBootstrap.ts`,
  driven by `server/index.ts` `runtimeEconomyRecovery()` on the cleanup interval under a module-level SINGLE-FLIGHT flag
  that bootstrap also holds. Order: resolve escrowless claims under their room locks → classify EVERY bankroll room for
  PROTECTION only → guarded global scan (with protected match ids + corrupt room codes) → apply ONLY escrowless outcomes,
  and only turn a claim into a cancelled lobby when its matchId is in this pass's confirmed `orphanRefunded`. A healthy
  `live`/`payout_pending`/`paid_finish` room is never re-applied, so no timer or advance is re-armed on a 45 s tick.
- **Regression suite:** `src/net/pokerSettlementOutcomes.integration.test.ts` (real PostgreSQL, 6 tests): `already_paid`
  vs an idempotent `confirmed_refund`; the deterministic payout race (not in `refunded`, reported in `alreadyPaid`, an
  escrowless room bound to it frozen rather than cancelled); a corrupt room never settling by code, two generations
  sharing a reused code both protected and idempotent across passes; a roomless orphan refunded by the NEXT runtime pass
  exactly once; an escrowless claim inert after a transient scan then cancelled on a confirmed refund; two concurrent
  runtime passes producing exactly one credit while live/paid rooms stay untouched and no advance is re-armed. Older
  suites were migrated to the precise outcomes, and 37.7.17's "an exact orphan still refunds via reconcileCorruptRoom"
  expectation was replaced — that behaviour was the unsafe room-code path.

### Paid-conflict closure + terminal proof before reuse + debit/scan serialization (Stage 37.7.19)

- **CORRECTIONS to 37.7.18.** (a) "Every production caller branches on the exact outcome" was not true: the START
  seat-divergence cleanup, the START failed-start cleanup, `runBankrollRematch` and the runtime unbound sweep all did
  `(await refundBuyInsResult(room)) === 'confirmed_refund'` with ONE else branch — RED: a funded room whose match was
  durably PAID answered `settlement_pending` while `refundBuyInsResult` had already set the escrow to `settled`; the
  room then matched no pending predicate and a retried START minted a brand-new `poker_matches` row + buy-in.
  (b) `debitFreshStart`/`debitRematch` trusted the room JSON's terminal status and cleared the escrow — RED: a room
  claiming `cancelled` with NO settlement row (and one claiming `cancelled` while the DB said `payout`) both minted a
  fresh paid match. (c) The runtime scan built protection and then read `poker_matches` — RED: a START committing in
  that window had its LIVE match refunded (`cancel_refund` settlement + refund ledger) while the room stayed
  funded+live.
- **One refund policy (FAIL 1 fix).** `applyRefundOutcome(room, result, deps, { escrowExpected })` →
  `RefundDisposition` = `cancelled | settlement_pending | frozen`, used by the two START cleanups, the
  settlement-pending sweep, `runBankrollRematch` and the runtime unbound branch. `already_paid`/`invalid` clear timers,
  freeze with a bounded reason (`paid match cannot be refunded` / `durable match evidence does not match this table`),
  keep the evidence and never set `pokerMatchCancelled`. `RematchOutcome` gained **`paid_conflict`** (state + binding
  kept); `BankrollRematchDeps` gained a `freeze` callback; `WsContext` gained `freezeRoom`; `debitRematch` now refuses a
  FROZEN table; `DebitResult` gained `paidConflict` so the WS layer freezes instead of answering a bypassable error.
  The dead `refundTerminallyResolved` helper (which re-merged refund and payout) was deleted.
- **Terminal proof before reuse (FAIL 2 fix).** `proveTerminalBeforeReuse(room, expected)` runs `resolveEscrowEvidence`
  before either debit path clears a terminal escrow: the durable outcome must equal the claim, the structure must be
  exact, and a `settled` escrow additionally requires no owed stats and any carried state to be BOUND. Transient →
  `settlementPending` (escrow kept); anything else → `paidConflict` (frozen, no durable row, no new buy-in).
- **Economy barrier (FAIL 3 fix).** `withEconomyBarrier` (FIFO, in-process) wraps every `performDebit` transaction and
  every global orphan scan; the bootstrap and runtime coordinators REBUILD their protection sets inside it and
  fail-closed protect any `pending`/`settling` escrow. `performDebit` sets its `pending` marker BEFORE entering the
  barrier, so an in-flight debit is always visible to a scan that follows it. LOCK ORDER: `withRoomLock` →
  `withEconomyBarrier`, never the reverse; the scan never takes a room lock while holding the barrier. This is an
  IN-PROCESS mutex: correct for the single authoritative Node instance this project deploys, explicitly NOT
  cluster-wide.
- **Regression suite:** `src/net/pokerPaidConflict.integration.test.ts` (real PostgreSQL, 8 tests): a failed START over
  a paid match (frozen, not cancelled, paid escrow kept, retried START mints nothing, balances unchanged, opaque
  snapshot); a rematch restart failure over a paid match (`paid_conflict`, evidence kept, further rematch refused); the
  runtime unbound sweep freezing a paid conflict in the same tick and staying idempotent; the full disposition matrix
  incl. `nothing_to_refund` where an escrow was expected; the five terminal-proof refusals plus the healthy
  fresh-START and single-rematch cases; a START launched inside the scan window whose live match is never refunded; and
  a START waiting behind an in-flight scan with no deadlock and exactly one debit.

### Reversible debit transition + complete scan protection + terminal no-state integrity (Stage 37.7.20)

- **CORRECTIONS to 37.7.19.** (a) `debitFreshStart`/`debitRematch` cleared the previous TERMINAL escrow before
  `performDebit`, which then unconditionally cleared its own marker on rollback — RED: a rematch refused for
  insufficient chips left `pokerEscrow === undefined` beside the finished state + binding (an escrowless claim), turning
  an ordinary refusal into a recovery-freezable state. (b) The barrier only fail-closed protected `pending`/`settling`
  escrows, re-read from the array captured BEFORE the barrier — RED: a match whose debit had committed but whose
  `startGame`/`bindGameToEscrow` had not run (escrow `funded`, NO game state) classified as `not_bankroll` and was
  refunded by the global scan; a room created after the coordinator's snapshot was invisible entirely. (c) The terminal
  proof only checked a state that was PRESENT, bootstrap returned `not_bankroll` for `settled` + no state, and
  `deleteRoomWithSettlement`'s synchronous fast path purged a terminal room without any evidence — RED: a paid table
  whose final state was lost could be reused by a fresh START and deleted without proof.
- **Reversible debit (FAIL 1 fix).** `performDebit` takes a DEEP snapshot of the previous escrow, replaces it, and
  restores it verbatim on every non-commit path; the callers no longer pre-clear. An initial START rolls back to a clean
  lobby, a post-refund START restores the exact cancelled escrow, and a crash snapshot with a `pending` M1 is unchanged.
- **Complete scan protection (FAIL 2 fix).** New `currentRooms()` dep on both coordinators; inside the barrier
  `protectLiveRoomMatches(deps.currentRooms(), …)` protects EVERY `pokerEscrow.matchId` a live room holds (any status)
  and every corrupt room code, then the scan runs. The global scan therefore owns only genuinely roomless durable
  orphans and escrowless claims; funded/unbound/failed-start matches belong to their per-room lifecycle. Lock order is
  unchanged (`withRoomLock` → `withEconomyBarrier`; the scan takes no room lock while holding the barrier).
- **Terminal no-state integrity (FAIL 3 fix).** `proveTerminalBeforeReuse` now requires a FINISHED BOUND state for a
  `settled` escrow, and `debitFreshStart` refuses a `settled` escrow outright. `classifyBootstrapRecovery` returns
  `incoherent_paid` for `settled` + no state (frozen by the (e4) stateless pass, which also covers corrupt evidence).
  `deleteRoomWithSettlement` replaced its `hasUnsettledEscrow`-based fast path with a full economy-claim test and
  injects `resolveEscrowEvidence`; `settleRoomForDeletion` freezes-and-keeps any terminal claim the DB does not
  confirm (and any paid escrow with no finished state), purging only on exact proof.
- **Regression suite:** `src/net/pokerDebitRollback.integration.test.ts` (real PostgreSQL, 6 tests): a refused rematch
  leaving the paid finished table byte-identical and a retry then minting exactly one match; transient rollback for a
  post-refund START and a clean-lobby initial START; a funded-but-unbound match protected from the scan and completing
  its start; a room joining the registry after the snapshot still protected while a roomless orphan is refunded once;
  the paid-no-state room frozen with START/rematch/purge all refused; and the terminal-claim teardown matrix
  (unconfirmed → keep+freeze, opposite payout → keep+freeze, exact refund → purge + one fresh match, idempotent).

### Poker client control surfaces (Stage 38.0.2)

UI-only; the protocol, the server-authoritative flow and every redaction rule are unchanged.

- **`RoomSocial.utilitySlot` is the single online extension point.** `OnlineGame.renderSocial()` now takes a
  fourth `utilitySlot` argument and the poker branch passes `<PokerActionLog state={pokerState} />` into it,
  so the action-history button renders inside the existing bottom-right control cluster next to
  timer/voice/emoji/chat. `RoomSocial` keeps **no** game-specific import — it renders whatever node it is
  handed, exactly like `timerSlot`. `PokerGameScreen` no longer renders a log of its own, so there is
  exactly ONE history control and ONE panel per table (local supplies the same component itself, since it
  has no RoomSocial).
- **The action log is public by construction.** A `PokerActionEntry` is `{ seat, street, kind, amount }`;
  the panel reads only that plus the public player name. It survives `pokerRedactStateFor` untouched
  because there is nothing private in it — no hole cards, deck, burn cards, user ids, tokens or escrow
  data can reach the client through this surface.
- **The wallet has ONE client store.** `usePokerWallet` (in `src/ui/poker/`) is instantiated once by
  `StartMenu` and shared by the wallet card and `PokerStakesPicker`; the picker no longer calls
  `fetchPokerWallet` itself. This removes the only place where two independently fetched copies of the
  balance could disagree. The store mirrors the server verbatim — it never computes a balance, never
  decides claim eligibility, and reports `no_economy` only for a real `503`.

### Docked social cluster (Stage 38.0.3)

UI-only; protocol, server authority and redaction unchanged.

- **`RoomSocial` gained a layout mode, not a game switch.** `variant="floating"` (default)
  is the historical fixed bottom-corner cluster used by the other six games.
  `variant="docked"` renders the same controls as a compact horizontal toolbar in NORMAL
  FLOW wherever the caller mounts it, with any open panel as a normal-flow sibling under
  the row. Poker must use it: its action controls live at the bottom of the screen, so a
  fixed cluster was measured sitting 208×74 px on top of them on a phone.
- **`PokerGameScreen.socialSlot`** is where that toolbar goes — between the table/showdown
  review and the action row — so the overlap is structurally impossible rather than tuned
  away. Online, `OnlineGame`'s poker branch builds the docked `RoomSocial` and passes it
  through `PokerOnlineGame`; local passes the history control the same way.
- **One open surface at a time.** `RoomSocial` accepts a CONTROLLED `openPanel` +
  `onPanelChange` (`none | reactions | chat | utility`). The poker branch owns that state,
  so chat, the emoji picker and the action history can never stack on the same spot. The
  history is supplied as two generic nodes — `utilitySlot` (the button) and
  `utilityPanelSlot` (the panel) — so RoomSocial still contains no game-specific import.
- **The geometry is a gate, not a screenshot.** `scripts/poker-layout-qa.mjs` +
  `scripts/layout-harness/` mount the REAL components in a REAL browser and assert
  pairwise rectangle non-intersection on `getBoundingClientRect()` for pods vs board/pot/
  each other/topbar/actions, cluster vs controls, open panels vs controls, board-card
  clipping, page overflow and 44px tap targets. `npm run layout:poker` exits non-zero on
  any violation.

### Online between-hands rebuy (§17, Stage 38.0.3C)

- **Protocol.** `POKER_REBUY_REQUEST` / `POKER_REBUY_DECLINE` carry an EMPTY payload. The
  server derives the room from the socket's session, the userId from the authenticated
  non-guest account, the seat from authoritative membership, the matchId from the BOUND
  escrow, the hand from the authoritative state and the amount from `room.pokerBuyIn`, and
  refuses when `state.options.startingStack !== room.pokerBuyIn`. Rebuys never travel as a
  generic `ACTION_REQUEST` — the three pure actions are lifecycle actions.
- **Window.** `pokerRebuyDeadlineAt` (absolute) + `pokerRebuyRevision` +
  `pokerRebuyMatchId`/`pokerRebuyHand` are persisted; the deadline is minted once per
  (match, hand) by `ensureRebuyDeadline`, so a reconnect/rebroadcast/restart cannot extend
  it. `shouldCloseRebuyWindow` closes on the deadline OR once every eligible seat answered,
  and NEVER while `pokerRebuyInFlight` is non-empty. Only the deadline reaches the public
  snapshot — the match id and hand stay server-side. It is independent of the Stage 37.5
  turn timer.
- **Lock order** — `withRoomLock(code) → withEconomyBarrier → DB transaction`, never
  inverted. The room lock serializes a request against the timeout and teardown; the
  barrier against the global orphan scan; the transaction's wallet-row lock plus the UNIQUE
  idempotency key make the debit itself atomic.
- **Durable evidence.** One `table_rebuy` row per rebuy, key
  `rebuy:<matchId>:<handNumber>:<userId>`, delta `-buyIn`, exact match and room.
  `MatchDurableEvidence.rebuys` is read in the SAME REPEATABLE READ snapshot as the
  buy-ins and the settlement; `validateRebuyContributions` parses each key FULLY and
  rejects a foreign match, a non-participant, a wrong delta or room, or two rebuys for one
  user in one hand — any of which is the `rebuy_mismatch` structure (permanent freeze).
- **Conservation.** `fundedTotalOf` = initial buy-ins + one buy-in per applied rebuy. The
  payout requires the winner to hold exactly that and cross-checks the durable rebuy count
  against `state.appliedRebuys`; the refund credits each account `initial + its own rebuys`
  under the existing one-key-per-user rule. Payout and refund stay mutually exclusive.
- **Crash recovery.** `reconcileRebuys` compares the ledger with `state.appliedRebuys`:
  a durable row missing from the state is applied exactly once when the room is exact,
  bound and still paused on that hand; a state claiming a rebuy with no row, or any
  unbindable/malformed evidence, freezes; a DB failure is `retry_pending` (never a decline,
  a close, a payout or a purge). It runs BEFORE any expiry close, on bootstrap for every
  restored room in a window, and its result gates the close.

### Permanent "Leave game" — irreversible active-game forfeit (Stage 38.0.5)

Applies to the **six online non-Poker games** (King, Durak, Deberc, Tarneeb, Preferans,
51). Poker is deliberately out of scope: its seats carry real chips and already own a
durable match record (§16).

**Three exits, three messages, no overlap.**

| Exit | Message | Seat | Result |
| --- | --- | --- | --- |
| Leave lobby | `LEAVE_ROOM` | removed, seats re-numbered | none |
| Back to menu / ✕ | socket close | kept, **reconnectable** | none |
| Quit for good | `LEAVE_GAME_PERMANENTLY` | replaced by an AI **on the same seat** | one durable technical loss |

- `LEAVE_ROOM` is now **lobby-only**. During a started game it behaves as an ordinary
  disconnect (`ctx.detachSession` — the member and its seat are KEPT). Before this stage it
  ran `removeMember` → `assignSeats` mid-match, which repointed every remaining player at a
  different `player-<n>` than the live `gameState` used, silently shifting turn order,
  dealer, teams and contracts. King's in-game ✕ used to send it; it now uses Back to menu
  like the other five games.
- `LEAVE_GAME_PERMANENTLY` and its ACK `PERMANENT_LEAVE_ACCEPTED` both carry **no payload**.
  The server derives the room + clientId from the socket's session, the seat from
  authoritative membership, the account from the session cookie, and the match from the
  room's frozen metadata. Refusal is the retryable `PERMANENT_LEAVE_UNAVAILABLE`.

**Frozen match metadata (`ServerRoom.onlineMatch`, `src/net/onlineMatch.ts`).** Created
ONCE per `START_GAME` (and once more per rematch — a rematch is a NEW match) by
`freezeOnlineMatch`: a server-minted `matchId`, the gameType/roomCode, the **category**
(`human_only` | `with_bots`), the starting roster (seat → type → account) and an append-only
`forfeits` list. The category is **never recomputed**, so an AI takeover cannot turn a
human-only match into a bot table. SERVER-ONLY: persisted in the room JSON, never in a
`RoomSnapshot`/`RoomSummary`/message, never logged.

**Ordering — `server/permanentLeave.ts` `runPermanentLeave`, under `withRoomLock`:**

1. validate against authoritative state only (started, non-Poker, seated human, not
   finished, frozen metadata present and matching this room/game);
2. **commit the durable forfeit FIRST.** For an account: ensure the match is durable
   (idempotent), then one gated transition `pending → loss + forfeited`. A transient DB
   failure → **retryable** refusal with nothing changed; a durable record describing a
   different match, or a row that already carries another result → **refused**, never
   overwritten. A guest (no resolved account) needs no account row, so the write is
   best-effort and the takeover stays authoritative;
3. only then `takeoverSeatAfterForfeit` — the member entry is REPLACED IN PLACE (same map
   position, same `seatIndex`), never `removeMember`/`assignSeats`, and `gameState` is not
   touched at all. The AI gets a fresh clientId + token hash, `userId: null` and an
   obviously-AI name/avatar; rematch consent is dropped; the host badge moves to a
   remaining **human**, never a bot. No human left → the room is closed instead;
4. persist → broadcast the remaining room → ACK the leaver. The re-evaluation is the
   CONNECTION-EVENT variant of `broadcastAndAdvance` (no `turnAdvanced`), so the current
   turn deadline is neither reset nor extended and exactly one bot action is scheduled when
   the taken-over seat is the one on the clock.

#### The validation is SPLIT at the commit (Stage 38.0.5.1 — corrected race)

Stage 38.0.5 re-ran the FULL step-1 contract after the DB await. That was wrong, and the
window is real: the room lock does not stop the synchronous timer callbacks, so a turn
timeout / auto-advance can finish the match between the forfeit committing and the
orchestration regaining control. The recheck then answered `already_finished`, the code
returned `kind: 'already_left'`, `handlePermanentLeave` sent `PERMANENT_LEAVE_ACCEPTED` and
the client cleared its session — while the human member, its reconnect token and its
reclaimable account were all still in the room and **no replacement AI existed**. RED
evidence (a probe replaying the old block verbatim): `result = already_left`,
`member c1 alive = true`, `RECONNECT t1 → c1`, `RECLAIM u1 → c1`, `replacement AI = 0`.

The two checks are now different functions and answer different questions:

- **before the DB write** — `planPermanentLeave` (unchanged): the full gameplay contract,
  including "the match must be ACTIVE". A decided table is still refused here, with no
  durable write at all;
- **after the DB write** — `planPermanentLeaveTakeover(room, clientId, {seatIndex, userId})`:
  **identity only**. Same clientId, still human, still seated, still the SAME seat and the
  SAME account we just forfeited. A finished match may no longer veto the teardown.

Post-commit outcomes, all of them terminal for the identity:

| situation | result |
| --- | --- |
| room gone from the registry (or replaced) | `already_left` — nothing left to annul |
| `not_a_member` (its socket closed, member dropped) | `already_left` — the identity is already gone |
| `seat_changed` / `account_changed` / `not_human` / `not_seated` | **`refused`**, fail closed — never tear down an innocent member; the durable gate makes a retry a no-op, so no second loss |
| identity intact, other humans remain | takeover on the SAME seat (finished or not) |
| identity intact, no human remains | `closeRoom` |

`isRoomFinished(live)` is read once, before the transition, for exactly one purpose: a
FINISHED match is **not** re-driven — `deps.advance` (the connection-event
`broadcastAndAdvance`) is skipped, so no deadline is minted and no bot move is played after
a terminal state. `deps.broadcastRoom` still runs, because the membership genuinely changed.
The finish itself can never rewrite the forfeit: `recordOnlineMatchFinish` only updates rows
that are still `pending` **and** not `forfeited`.

**Client + connection lifecycle (same stage).** `leavePermanently` used to gate on React
state, which is written asynchronously — two presses before the next render both read the
stale `idle` and both put an intent on the wire. The decision now comes from a synchronous
ref driven by the pure `src/net/permanentLeaveClient.ts` (`planLeaveIntent` /
`applyLeaveAccepted` / `applyLeaveRefusal`), and the ACK is **absorbing**: a
`PERMANENT_LEAVE_UNAVAILABLE` that arrives after it is ignored, so a duplicate intent's
refusal can never repaint a completed departure as an error. On the server, a socket whose
leave was accepted is remembered in a `WeakSet`, and a duplicate `LEAVE_GAME_PERMANENTLY`
**re-ACKs** instead of answering `ERROR`.

A takeover without a committed forfeit is impossible by construction; a committed forfeit
whose ACK is lost is retried by the client and the DB gate makes the retry a no-op, so a
second loss can never be recorded. The departed member — and therefore its reconnect-token
hash and `userId` — is gone, so `RECONNECT`, `RECLAIM_ROOM` and `FIND_MY_ROOMS` all stop
working for it; the client drops its saved session only on the ACK, and an authoritative
`ROOM_NOT_FOUND` answering a reconnect clears a stale Resume.

**Durable model (migration 0014).** `online_matches` (match id, room code, game type,
frozen category, player count, status, timestamps) + `online_match_participants`
(`PRIMARY KEY (match_id, seat_index)`, nullable account FK, starting member type, outcome
`pending|win|loss|draw`, `forfeited` + timestamp). CHECK constraints make a forfeit always a
timestamped LOSS and forbid a bot seat from holding an account or forfeiting; a partial
UNIQUE index on `(match_id, user_id)` gives **exactly-once account attribution**.

**Ownership split (no duplicated result).** `online_match_participants.outcome` is the ONE
canonical per-participant record of an ONLINE match — written once per seat, at forfeit
time for the leaver and at finish for everyone else (both categories, since the Stage 38.0.6
profile tracker reads this model). The legacy `games`/`game_players`/`rounds`/`user_stats`
path keeps its own unchanged ownership of the RATING aggregate; the forfeit never writes
there, and the finish drops forfeited seats from `seatUsers`. `maybeRecordFinished` now
gates on `ratedByFrozenCategory(meta)` instead of live membership (the old live rule
survives only as the fallback for a legacy room with no frozen metadata) and builds
`seatUsers` from `finishSeatUsers(meta, …)` — so a `human_only` match stays rated after a
takeover, a `with_bots` match stays unrated, the replacement bot earns nothing for the
departed account, and the leaver never receives a second result even if that bot wins.
