# QA Checklist — King

Automated coverage: `npm test` (unit) and `npm run e2e` (full online flow over
WebSocket against a real server, incl. restart restore). This file is the
**manual / device** pass to run before a release.

## Automated (run first)

```bash
npm test         # unit + pure-logic tests
npm run build    # type-check + production build
npm run e2e      # spawns a server, plays a full 3-player online round, restarts
```

All three must be green.

## Manual — local pass-and-play

- [ ] Start menu → **Local game** opens setup (no landing page).
- [ ] 3-player game: deal → dealer's-choice mode → kitty exchange (illegal
      penalty cards dimmed) → (Trump: choose trump) → play a full round.
- [ ] PassScreen appears before each human's hand; never shows the wrong hand.
- [ ] Round scoring matches KING_RULES.md; game ends after 27 rounds (3p) / 36 (4p).
- [ ] 4-player game deals 13 each, no kitty.

## Manual — LAN online

- [ ] `npm run server` and `npm run dev -- --host`; note the LAN IP.
- [ ] Host: **Host online room** → optional password → get room code.
- [ ] On **Join online room**, the open room appears in the list (↻ Refresh);
      tapping an open room joins it; protected rooms show 🔒 and ask for the
      password; full / in-game rooms are disabled. Manual room code still works.
- [ ] Two phones/tabs join with the code (and password if set).
- [ ] Lobby shows all players + online/offline + host badge; 🔒 if protected.
- [ ] Wrong/blank password on a protected room shows a clear error.
- [ ] Host **Start Game** enabled only when seats are full.
- [ ] On each device: action screen only on your turn; otherwise a read-only
      "Waiting for <name> to <action>" view with **your own hand only**.
- [ ] Opponents' cards never visible (card backs / counts only).
- [ ] Trick / round screens advance automatically (no dead buttons online).

## Manual — reconnect & restart

- [ ] Reload a player's tab → start menu shows **Resume online game** → one click
      returns them to their seat with their hand.
- [ ] Briefly drop Wi-Fi → "Reconnecting…" → auto-rejoins.
- [ ] Restart the server (`Ctrl-C`, `npm run server` again) → players Resume and
      the game continues from the same state (file persistence).
- [ ] **Leave room / Back to menu** clears the saved session (no stale Resume).

## Manual — PWA / mobile

- [ ] Production HTTPS build: Chrome Android → **Install app**; launches
      standalone, portrait, with the King icon.
- [ ] Notch/safe-area: header and the hand are not hidden under system bars.
- [ ] Touch targets are comfortable; no horizontal overflow on a narrow screen.
- [ ] Offline after first load: **local** game still opens; online shows
      "Connecting…" (expected — online needs the network).

## Known limitations

- Online expects all seats to be **human** (no AI online).
- Room password is an **MVP gate**, not authentication; use **WSS** in
  production so it isn't sent in clear (see DEPLOYMENT.md).
- No rate limiting yet — add before a public launch.
- Persistence is a single JSON file, single server instance (MVP). Use Redis/DB
  for multi-instance / durability at scale.
- Public-screen progression is server-timed; clients can't manually skip online.
- Session resume is per-tab `sessionStorage` and needs the room still in the
  server's store.
