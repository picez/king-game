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
