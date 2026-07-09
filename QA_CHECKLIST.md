# QA Checklist — King

Automated coverage: `npm test` (unit) and `npm run e2e` (full online flow over
WebSocket against a real server, incl. restart restore). This file is the
**manual / device** pass to run before a release.

## Automated (run first)

```bash
npm run verify   # runs the four checks below, SEQUENTIALLY (recommended)
```

`verify` = `typecheck:server && test && build && e2e`. Or run each on its own:

```bash
npm run typecheck:server  # server/index.ts import graph (tsc -p tsconfig.server.json)
npm test                  # unit + pure-logic tests (all 4 games + net/UI)
npm run build             # client type-check + production build
npm run e2e               # spawns a server, plays full online rounds, restart restore
npm run soak              # Durak deterministic bot soak: 2/3/4 × simple/transfer × 30 seeds
```

All must be green.

> **Run heavy checks SEQUENTIALLY on this Windows dev machine.** Running
> `test` + `build` + a `tsc` at the same time has intermittently exhausted memory
> (VirtualAlloc / worker-fork OOM). `npm run verify` chains them one-at-a-time; a
> lone check that OOMs re-runs clean. Do NOT launch them in parallel.
>
> **Gated DB tests** (stats integration) stay skipped unless `TEST_DATABASE_URL`
> points at a migrated Postgres: `TEST_DATABASE_URL=postgres://… npm test`.

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

## Manual — Durak online (released `available`, Stage 9.13)

> King stays the default. Durak is **released** (no Experimental tag) and now
> **records outcome stats** (fool/draw) with its own leaderboard.

- [ ] **No Experimental tag** anywhere for Durak — the game picker shows the
      **Simple · Transfer** subtitle (not "Experimental"), the Host sheet has no
      experimental note, and the Lobby header shows only the variant.
- [ ] **Select Durak** in the menu → the **Host** tile is enabled; the Host sheet
      shows a **variant** picker (Simple/Transfer) and **2/3/4** players.
- [ ] **Help modal** (❓ in-game and the setup "How to play"): explains Simple,
      Transfer, and **throwing in after Take**.
- [ ] **Host a Durak room** (e.g. 2 players, Transfer), **Add bot**, **Start** →
      the **Durak** table renders (not King), with your hand, trump and deck count.
- [ ] **Room browser** lists the room as **Durak · Simple/Transfer**; a second
      device can **Join** it.
- [ ] **Play it through:** attack / defend / take / pass / (Transfer variant)
      transfer all work over the network; bots take their turns; the game reaches
      a **fool / draw** finish.
- [ ] **Not-your-turn view:** the table is read-only and the prompt clearly says
      **"Bot is thinking…"**, **"Waiting for <name>…"**, or **"<name> — offline,
      AI may play"** (with a 📴 badge on the offline seat). Your cards are visible
      but not clickable.
- [ ] **Redaction:** you only ever see **your own** hand — opponents show a
      face-down count, never ranks (check across several bouts).
- [ ] **Reconnect:** reload mid-game / drop Wi-Fi → **Resume** returns you to the
      Durak table with your hand intact.
- [ ] **Disconnected substitute:** when an offline player's turn comes, after the
      delay the AI plays a legal move for them; reconnecting cancels it.
- [ ] **Leave game** → back to menu with **Resume** still offered; **Leave lobby**
      before start frees the seat.
- [ ] **Chat + reactions** work in a Durak room and never cover the hand/table
      (360/390, RTL).
- [ ] **Unknown game:** the server rejects a `CREATE_ROOM` with an unknown
      `gameType` (no room created).

## Manual — Tarneeb online (released `available`, Stage 10.8)

> Tarneeb is a fixed **2×2 partnership** bid-and-trump game (4 players, target 41).
> Released with stats; **no Experimental tag** anywhere.

- [ ] **No Experimental tag** for Tarneeb — the game picker shows a plain
      **♠️ Tarneeb · 2 teams** entry, the Host sheet has no beta note, and the
      Lobby header reads **"2 teams"** (not "Dealer's Choice").
- [ ] **Select Tarneeb** → Host tile enabled; a room is exactly **4 seats**
      (fixed 2×2); starting before 4 seats is rejected.
- [ ] **Help modal** explains: 4 players / partners opposite, bid 7–13, declarer
      names trump + leads, follow suit, made vs set scoring, all-13 = +13, target 41.
- [ ] **Host + Add bots + Start** → the **Tarneeb** table renders (seats around
      the felt, viewer bottom, partner top), with bidding → trump → trick play.
- [ ] **Readouts:** scoreboard shows the **highest bid + bidder**, the **trump**,
      the **led suit** during play, and per-team trick counts; illegal cards dim.
- [ ] **Redaction:** you only ever see **your own** hand — the other three show a
      face-down count, never ranks (check across several hands + after reconnect).
- [ ] **Reconnect** mid-hand → **Resume** returns you with your hand intact and no
      opponent-hand leak; **Leave lobby** before start frees the seat.
- [ ] **Chat + reactions** work and never cover the hand/table (360/390, RTL).
- [ ] **Stats + privacy (DB configured):** finishing a human-vs-human Tarneeb game
      records it under `game_type='tarneeb'`; the Profile **Tarneeb** stats tab +
      leaderboard show games/win%/contract success/team score. Verify the stored
      rows (`games`/`game_players`/`rounds`) hold **no cards** — only scores and a
      word-free bid+trump label (e.g. `9S`).

## Manual — Deberc combination stats (Stage 13.8)

> Deberc records the team outcome + jackpot **and** an aggregate combination
> breakdown — counts of the melds that scored (terz / platina / bella) + a meld
> frequency. Aggregate-only: **never any card, rank, suit, or hand order.**

- [ ] **Profile → My stats → Deberc → Combinations:** after a few Deberc games the
      section shows **Terz / Platina / Bella** counts, each with a **"% of hands"**
      frequency, plus **Hands with a meld** — at **360/390** with no overflow, RTL ok.
- [ ] **Empty state:** a brand-new Deberc player (no melds yet) sees
      **"No combinations recorded yet"** instead of an empty list.
- [ ] **Privacy (DB configured):** the `user_stats.stats` JSONB for a Deberc user
      holds only counters (`terz`/`platina`/`bella`/`totalMelds`/`handsPlayed`/
      `handsWithMeld`/`jackpotCount`) — **no card/rank/suit** anywhere.

## Manual — PWA / mobile

- [ ] Production HTTPS build: Chrome Android → **Install app**; launches
      standalone, portrait, with the King icon.
- [ ] Notch/safe-area: header and the hand are not hidden under system bars.
- [ ] Touch targets are comfortable; no horizontal overflow on a narrow screen.
- [ ] Offline after first load: **local** game still opens; online shows
      "Connecting…" (expected — online needs the network).

## Automated — online social visual QA (Stage 12.7)

Screenshot harness for the **online-only** RoomSocial surfaces (chat drawer, sticker
picker, floating stickers/reactions, raised social controls) that the local shot
scripts can't reach. Starts a real server on `:3001`, drives one browser as the host
of an online Durak room (host + 1 bot → reaches `playing` instantly), and captures at
**360×800 and 390×844**. This is **manual QA** (spins up a server + browser) — it is
NOT part of `npm run verify`; `npm run e2e` stays the behavioral source of truth for
social messaging (cooldowns, filtering, redaction).

```bash
npm run build && npm run preview     # serve the built client on :4173 (one shell)
node scripts/social-shots.mjs        # another shell → .shots/social/*.png (git-ignored)
```

Per-viewport states captured + auto-checked (no horizontal overflow + key selectors
present; prints `PASS/FAIL`, exit non-zero on any fail):

- [ ] `lobby-1-chat-open` — chat drawer open over the lobby.
- [ ] `lobby-2-media-picker` — in-drawer sticker grid.
- [ ] `lobby-3-chat-messages` — a text bubble **and** a media sticker bubble.
- [ ] `lobby-4-reaction-picker` — reaction picker (emoji row + sticker grid).
- [ ] `lobby-5-float-reaction` — a floating reaction chip.
- [ ] `game-1-hand-social` — active game: hand visible, social controls **raised**
      (`.social-controls--raised`) clear of the cards.
- [ ] `game-2-reaction-picker` — picker open over the active game (hand still visible).
- [ ] `game-3-float-sticker` — a floating sticker over the table.

Acceptance: **16/16 PASS** (8 states × 2 viewports), no overflow, hand/actions never
covered. Note: a floating chip is top-centre and may briefly overlap the top seat /
lobby title — transient (~2.6 s), opaque, and by design never over the hand/trick.

## Known limitations

- Room password is an **MVP gate**, not full account-level authentication; use
  **WSS** in production so it isn't sent in clear (see DEPLOYMENT.md).
- Join/create rate limiting is still the main missing public-launch hardening.
- Rooms can persist to file or Postgres, but the live room process is still a
  single Node instance. Use Redis/pub-sub or sticky sessions for multi-instance
  scale.
- Public-screen progression is server-timed; clients can't manually skip online.
- Chat/reactions are in-memory only and disappear after a server restart.
- Disconnected humans are AI-substituted after a delay, but there is no admin
  moderation console yet.
