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
- [ ] **Bots**: host taps **Add bot** to fill a free seat (🤖 AI badge appears);
      host can **Remove** a bot; non-host has no add/remove buttons.
- [ ] **2 humans + 1 bot**: with one bot added, **Start Game** enables and the
      game starts; the bot takes its turns on its own (waiting view shows
      "Bot is thinking…"); the bot's cards are never shown to humans.
- [ ] Host **Start Game** enabled only when seats are full (humans + bots).
- [ ] On each device: action screen only on your turn; otherwise a read-only
      "Waiting for <name> to <action>" view with **your own hand only**.
- [ ] Opponents' cards never visible (card backs / counts only).
- [ ] Trick / round screens advance automatically (no dead buttons online).

## Manual — room social (reactions + chat, Stage 7)

- [ ] In a room (lobby or game), tap **😀** → the reaction row opens; tapping an
      emoji shows a floating reaction (sender name + emoji) for ~2.5s on **all**
      devices in the room. It **never covers your hand or the current trick**.
- [ ] Sending a **second reaction immediately** shows a "Too many messages /
      Wait…" toast (the **30s cooldown is server-side** — try from two devices to
      confirm it's per-player, not global).
- [ ] Tap **💬** → the chat drawer opens (collapsed by default on mobile); send a
      message → it appears for everyone with your name + avatar.
- [ ] A message with a bad word is **censored to `***`** for everyone (the filter
      runs server-side; a tampered client cannot bypass it). A URL becomes
      `[link]`. An over-long message is capped.
- [ ] Sending two messages within ~3s → the second shows a rate-limit toast.
- [ ] A new joiner sees the **recent chat history**; reactions/chat survive a
      reconnect but are **cleared on a server restart** (expected for MVP).
- [ ] No horizontal overflow on 360/390 with the drawer open; RTL (Arabic) mirrors
      the drawer/controls to the left.
- [ ] Cards: artwork cards show the **full picture** (no duplicate suit/rank
      badge poking past the edge); table/trick cards stay readable; the Ace is not
      cropped; face-down cards are unchanged.

## Manual — reconnect & restart

- [ ] Reload a player's tab → start menu shows **Resume online game** → one click
      returns them to their seat with their hand.
- [ ] Briefly drop Wi-Fi → "Reconnecting…" → auto-rejoins.
- [ ] Restart the server (`Ctrl-C`, `npm run server` again) → players Resume and
      the game continues from the same state (file persistence).
- [ ] **Leave room / Back to menu** clears the saved session (no stale Resume).

## Manual — orphan rooms + disconnected substitute (Stage 7.2)

> Tip: set short envs to test fast, e.g. `ORPHAN_ROOM_TTL_MS=20000` (20s) and
> `DISCONNECTED_SUBSTITUTE_DELAY_MS=10000` (10s) before `npm run server`.

- [ ] **Orphan room (lobby):** create a room, add a bot, then close the only
      human tab. The room is **deleted** after `ORPHAN_ROOM_TTL_MS` (gone from the
      Join list and from `rooms.json`).
- [ ] **Orphan room (active game):** start a game (host + bots), close all human
      tabs → room deleted after the orphan TTL.
- [ ] **Reconnect preserves the room:** go orphan, then reconnect a human before
      the TTL → the room survives and play continues.
- [ ] **Connected human keeps the room:** a room with ≥1 connected human is
      **not** deleted by the orphan TTL (only the long hard-TTL backstop).
- [ ] **Disconnected substitute:** during an active game, drop a human on/near
      their turn. Others see "📴 Waiting for X to reconnect…". After the
      substitute delay (or a shorter room turn timer) the **AI plays a legal
      move** for them and play continues — they stay an **offline human seat**
      (🤖 bot tag does NOT appear on them).
- [ ] **Reconnect cancels the substitute:** drop a human, then reconnect them
      **before** the delay → they keep their seat and take their own turn (no AI
      move was made for them).
- [ ] **Stats:** finishing a game where a human was substituted still attributes
      that human's stats to their account (with a DB configured).

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
