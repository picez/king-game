# QA Checklist — Card Majlis

Automated coverage: `npm test` (unit) and `npm run e2e` (full online flow over
WebSocket against a real server, incl. restart restore). This file is the
**manual / device** pass to run before a release. See
[`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) for what each feature is.

**Sections** (grouped; the detailed checks follow in stage order below):

- **Smoke / automated** — Automated (run first), local pass-and-play.
- **Online rooms & invite** — LAN online, Team lobby, Room invite link/share,
  reconnect & restart, orphan rooms + AI substitute.
- **Each game** — Durak online, Tarneeb online, Deberc (+ combination stats);
  King is covered by local pass-and-play + LAN online.
- **Social / chat / stickers** — Room social, online social visual QA.
- **Stats & achievements** — Deberc combination stats, Achievements / badges,
  Achievement unlock toast.
- **Avatars** — Custom avatar (local-only), Server avatar upload (+ seats).
- **Visual / mobile / RTL / reduced-motion** — PWA / mobile, Sound; RTL + reduced
  motion are checked within each screen's steps.
- **Deployment** — see [`RENDER_DEPLOY.md`](RENDER_DEPLOY.md) / [`DEPLOYMENT.md`](DEPLOYMENT.md)
  (avatar upload needs `ffmpeg`; Postgres optional) + Known limitations at the end.

## Automated (run first)

```bash
npm run verify   # runs the four checks below, SEQUENTIALLY (recommended)
```

`verify` = `typecheck:server && test && build && e2e`. Or run each on its own:

```bash
npm run typecheck:server  # server/index.ts import graph (tsc -p tsconfig.server.json)
npm test                  # unit + pure-logic tests (all 5 games + net/UI)
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

### Toolchain (Stage 14.3)

CI and the canonical verification environment run **Node 22** (see `.nvmrc` /
`.node-version`; CI pins `node-version: '22'`). Install with **`npm ci`** — never
`npm install` in CI, so the lockfile is never rewritten.

> **Do not commit npm-11 lockfile churn.** The committed `package-lock.json`
> (lockfileVersion 3) is maintained with **npm 10**. Running `npm install` under
> **npm 11** re-adds `libc` optional-dependency fields that npm 10 cannot reconcile,
> which makes CI's `npm ci` fail with *"Missing esbuild@… / @esbuild/* from lock
> file"*. If you must touch dependencies, regenerate the lock with **npm 10**
> (`npx -y npm@10 install`) and verify `grep -c '"libc"' package-lock.json` is `0`.
> A dev machine on Node 24 / npm 11 can still run `npm ci` + `npm run verify` (both
> only *read* the lock), so local builds are fine — just don't `npm install`.

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

## Manual — Team lobby (Deberc / Tarneeb, Stage 18.0)

> Deberc + Tarneeb are 2×2 partnership games (**Team A = seats 0 & 2, Team B = seats
> 1 & 3** — partners sit opposite). The lobby groups all four seats by team, shows
> empty seats per team, and marks You / Partner. Purely presentational — seat order,
> the start gate, and the game rules are unchanged. King/Durak keep the flat list.

- [ ] **Tarneeb, 1 human + 3 empty:** Team A shows You (host) + an Empty seat; Team B
      shows two Empty seats; your team is highlighted; Start reads **"Need 4 players
      for teams"** and is disabled (360/390, no overflow).
- [ ] **Add bots → 4/4:** seats fill in order; the AI badge shows on bots; your
      **Partner** is marked (opposite seat); Start reads **"Teams ready"** and is enabled.
- [ ] **Deberc, 3 players:** teams still render, plus the note "*teams of 2 at 4 players;
      3 = each for themselves*"; Start is **enabled at 3** (Deberc's each-for-self is a
      valid game — not forced to 4). At 4/4 it reads "Teams ready".
- [ ] **Avatars:** a player with a synced avatar shows their image in the team seat;
      others show the emoji.
- [ ] **King / Durak regression:** the lobby still shows the plain flat member list —
      no team labels/rails; Start/add-bot/kick/timer unchanged.
- [ ] **RTL (Arabic):** team blocks + rails mirror to the leading (right) edge; no
      horizontal overflow; seat/team order is unchanged (only text direction flips).

## Manual — Room invite link / share (Stage 18.1)

> The lobby has an **Invite** row under the room code: **Copy code**, **Copy link**,
> and **Share** (only when the device supports `navigator.share`). The invite link is
> `<origin>/?room=<CODE>` — same browser origin, **room code only** (no session/token).

- [ ] **Copy code / Copy link:** tapping each copies to the clipboard and briefly shows
      **"✓ Copied!"**; the link is `https://<your-host>/?room=<CODE>` (360/390, no overflow, RTL ok).
- [ ] **Share (mobile):** on a device with the Web Share sheet, **Share** opens it with
      the link; **cancelling the share shows no error**. On desktop (no share API) the
      Share button is simply absent — Copy still works.
- [ ] **Clipboard blocked:** if the clipboard is unavailable, a **selectable link** is
      shown to copy manually (no crash).
- [ ] **Open an invite link:** load `https://<your-host>/?room=<CODE>` in a browser →
      the **Join sheet opens with the code prefilled**; you still press **Join** yourself
      (no auto-join). The `?room` param is cleared from the URL after it opens.
- [ ] **Bad/blank code in the link** (`?room=ab`) → no Join prefill, app opens normally.
- [ ] **Privacy:** the invite URL contains **no token / session / userId** and uses the
      browser origin even when a custom server is set in Profile → Advanced.
- [ ] **Not disruptive:** Leave / Start (and, for team games, the team layout) are all
      still visible; host and guests can both invite.

### Edge cases (Stage 18.2)
- [ ] **Invite banner:** opening `?room=Q7Z2` shows a banner **"Invited room: Q7Z2"** at
      the top of the Join sheet + a **"Check your profile name before joining"** nudge;
      the name stays read-only (edited only in Profile).
- [ ] **Resume conflict:** with a **saved room in progress** (e.g. WXYZ) AND a **different**
      invite (`?room=Q7Z2`), the banner shows **"You have a room in progress"** with a clear
      choice — **Resume current room (WXYZ)** vs **Join invited room**. Neither auto-fires.
- [ ] **Same room invited:** if the invite code equals your saved room code, there is **no
      "in progress" conflict warning** — just the invite banner + name nudge (Join / the
      existing NAME_TAKEN → Resume path still work).
- [ ] **Invalid link ignored:** `?room=ab` / `?room=` / `?room=!!` opens the app normally
      (no broken Join sheet), and the `?room` param is still **stripped from the URL**.
- [ ] **Lowercase / spaces:** `?room=q7z2` and `?room=%20q7z2%20` both prefill **Q7Z2**.
- [ ] **RTL (Arabic):** the banner + Resume/Join choice mirror cleanly, no overflow.

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

## Manual — Preferans LOCAL (Stage 19.3+)

> Preferans is a **3-player, each-for-themselves** contract-bidding trick game
> (32-card deck, 2-card talon), **released** (Stage 19.7) — this is the local (1 human
> + 2 bots) QA; online + stats have their own sections below. Automated smoke:
> `node scripts/preferans-shots.mjs` (360/390, checks for horizontal overflow); run a
> `vite preview` server first.

- [ ] **Picker:** the **Local** sheet lists **🎩 Preferans · 3 · Contract**, selectable —
      no "Experimental"/"Coming soon" tag (the **Host** sheet offers it too; see the online
      section).
- [ ] **Setup** shows "1 human + 2 bots", target **10**, and a "How to play" summary;
      **Start** deals a hand (you sit bottom; 2 bots up-left/right).
- [ ] **Bidding:** on your turn the 5×5 ladder (levels 6–10 × ♠♣♦♥ NT) shows **only
      legal** cells active (already-≤-high-bid cells are dimmed); **Pass** works; passing
      is final; an all-pass redeals to the next dealer.
- [ ] **Win the auction** → **Take the talon** (2 face-down cards join your hand → 12),
      then **bury exactly 2** (the confirm button stays disabled until 2 are selected),
      then **declare** a contract **≥ your winning bid** (lower cells are not offered).
- [ ] **Trick play:** left-of-declarer leads; you must **follow the led suit** when able
      (illegal cards dim); trump beats non-trump; the just-won trick freezes briefly.
- [ ] **Readouts:** scoreboard shows the three seat scores, target, the **contract +
      trump** (or highest bid pre-contract), the **led suit**, **talon** state, the
      **dealer (D)** + **declarer (★)** badges, and per-seat trick counts.
- [ ] **Hand complete** shows made/set, declarer tricks vs level, and the per-seat score
      delta; **Next hand** rotates the dealer left and deals again.
- [ ] **Finished** when a seat reaches the target: **You won / You lost / draw** with
      final scores; **Play again** restarts, **Back to menu** exits. A bot-only run always
      terminates (covered by the wiring soak test).
- [ ] **Mobile/RTL:** no horizontal overflow at 360/390; Arabic (RTL) reads correctly and
      the seat order is **not** mirrored (play still flows to your left).

### Hardening (Stage 19.4)

> Core hardening + online-redaction readiness. Most of this is covered automatically
> (`npm run verify`): invariants, all-phase/all-seat redaction, a 40-seed bot soak, and
> a serverCore seam drive. (Historical note: at 19.4 Preferans was still local-only;
> online hosting was enabled at 19.5 and released at 19.7.)

- [ ] **Clear prompts:** on your play turn while you still hold the led suit, a "Follow the
      led suit if you can" reminder shows; during **declare**, the bar shows the minimum
      contract ("at least {bid}"); the bury button counts **0/2 → 1/2 → 2/2**.
- [ ] **No stall:** repeatedly play bot-only hands (Play again a few times) — every hand
      resolves to a declarer and the match always reaches a winner/draw (no endless
      "all pass → redeal" loop).
- [ ] **Privacy:** across the whole hand you never see another seat's cards, the un-taken
      talon, or the 2 buried discards — not even your own buried cards once declared.
## Manual — Preferans ONLINE (Stage 19.5+)

> Preferans online is **released** (`supportsOnline: true`, `status: available`, records
> stats). Server-authoritative 3-seat rooms. Automated: `scripts/e2e-online.mjs`
> (the `[2p]` section) + `scripts/preferans-online-shots.mjs` (360/390, overflow check).

- [ ] **Host:** the Host sheet offers **🎩 Preferans** (no experimental note); the
      Create button is enabled and a room is exactly **3 seats**.
- [ ] **Lobby:** the room labels itself **🎩 Contract** (not "Dealer's Choice"); Add-bot
      fills toward 3/3; **Start** is blocked until 3 seats are occupied; a 4th joiner is
      rejected (ROOM_FULL).
- [ ] **Room browser:** the Preferans room appears with its emblem + a "Contract" hint.
- [ ] **Start → play:** all three clients receive the deal; on your turn you bid / take the
      talon / bury 2 / declare / play; off-turn the screen is read-only with a
      "waiting / bot thinking" note; the hand auto-advances (no "Next hand" button online).
- [ ] **Redaction:** you only ever see **your own** hand; opponents show a face-down count;
      the un-taken talon and the buried discards never appear in your client (check across
      hands + after reconnect).
- [ ] **Reconnect / leave:** reconnecting mid-hand restores your hand + phase with no leak;
      Leave-lobby before start frees your seat; the board ✕ leaves the game (reconnectable).
- [ ] **Social:** chat + reactions work and never cover the hand/table (360/390, RTL); the
      action bars stay clear of the emoji/chat corner.
### Stats (Stage 19.6, score-only)

> Preferans records score-only stats via the existing per-`game_type` pattern (no
> schema migration, no cards). Only **human-vs-human** finished games count (any bot →
> skipped); needs Postgres (`DATABASE_URL`) — otherwise the panels degrade softly.
> Automated: `preferansStats` aggregator + `statsApi` parser tests + a DB-gated
> integration test (skips without `TEST_DATABASE_URL`) + `scripts/preferans-stats-shots.mjs`.

- [ ] **Profile → My stats → Preferans** shows a sub-tab; empty state ("no games") before
      any game, then record / win-rate / contract-rate / declarer-hands / avg-score
      (with best/worst) after a finished human-vs-human online game.
- [ ] **Profile → Leaderboard → Preferans** lists public rows (name/avatar/games/wins/
      win-rate/contract-rate); your own row is highlighted; no user id is exposed.
- [ ] **Privacy (DB configured):** the stored `games`/`game_players`/`rounds` rows hold
      **no cards / talon / discards / tricks** — only scores + a word-free contract label
      (e.g. `7H`, `6NT`). A draw counts as neither a win nor a loss.
- [ ] **No overflow:** the Preferans stats + leaderboard panels fit at 360/390 and read
      correctly under Arabic RTL (same layout as the Tarneeb panels).

## Manual — Preferans RELEASE (available, Stage 19.7)

> Preferans is now `status: available` — a first-class game alongside King/Durak/Deberc/
> Tarneeb. This section is the release smoke.

- [ ] **Picker:** the Local **and** Host sheets list **🎩 Preferans · 👥 3 · Contract** as a
      normal, selectable option — **no** "Coming soon" / "Experimental" tag, not dimmed.
- [ ] **Room browser + Lobby:** a Preferans room shows the 🎩 contract label (not
      "Experimental"); host is fixed at **3 seats** (no player-count picker).
- [ ] **Favorite:** Profile → Favorite game offers **Preferans**; selecting it makes the
      Local/Host picker default to Preferans next time; a bad stored value still falls back
      to King.
- [ ] **Achievement:** after declaring at least one Preferans contract (online, human-vs-
      human, DB on), the **Preferans Declarer** badge (🎩) appears earned in Profile →
      Achievements; the unlock toast may announce it. Locked before any declaration.
- [ ] **All-rounder:** the cross-game "won every game" badge now also requires a Preferans
      win (5 games).
- [ ] **Regression:** local play, online create/join/start, redaction (no opponent-hand
      leak), reconnect, and stats recording all still work (covered by `npm run verify` +
      the `[2p]` e2e section).

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

## Manual — Achievements / badges (Stage 16.0)

> A Profile **Achievements** tab shows 11 badges derived **purely from the existing
> per-game stats** — no DB writes, no server route, no popups. Earned = gold coin,
> locked = muted padlock (goal still shown).

- [ ] **Profile → Achievements:** the badge grid renders at **360/390** with no
      horizontal overflow; **RTL (Arabic)** mirrors cleanly.
- [ ] **Locked state:** a fresh account (no games) shows every badge locked (padlocks)
      + the "Play games to unlock badges." hint; signed-out shows the sign-in hint.
- [ ] **Earned state (DB configured):** after winning a game, **First Win** (and the
      relevant per-game badge) flip to gold; the `n/11 unlocked` counter updates.

## Manual — Achievement unlock toast (Stage 16.1)

> A compact **"Achievement unlocked"** toast appears **only on the Profile screen after
> the stats load** — never during a game, never over cards/hands. A device-local seen
> ledger (`localStorage` key `cardMajlis.achievementsSeen.v1`) means each unlock is shown
> once. **No sound is played.**

- [ ] **First open with earned badges:** open **Profile → Achievements** on an account
      that already has wins → a bottom toast announces the unlock(s); the grid shows a
      gold **"New"** chip on those badges. **360/390** no horizontal overflow.
- [ ] **Multiple unlocks:** with several earned-but-unseen badges the toast shows one at a
      time with a **"+N more"** chip and **Next**; ✕ closes the whole queue.
- [ ] **Seen is sticky:** dismiss the toast, leave Profile, reopen → **no toast** and no
      **New** chips (ledger persisted). Signed-out / no stats → **no toast**.
- [ ] **RTL (Arabic):** toast + New chip mirror cleanly, no overflow.
- [ ] **Motion:** reduced/off (Profile → Animation) → the toast fades / appears instantly
      instead of sliding; it is never hidden. Confirm **no sound** plays.

## Manual — Custom avatar (local-only, Stage 14.1)

> A user may pick a local image avatar. It is **local-only**: re-encoded client-side,
> stored in `localStorage` (`cardMajlis.customAvatar.v1`), **never uploaded, never in
> WS/game state, never in the DB**. The whitelisted **emoji** stays the server-safe
> identity everyone else sees online.

- [ ] **Profile → Avatar → Upload image:** pick a PNG/JPEG/WebP → the circular
      preview + the top **AccountBar** avatar show the image (360/390, no overflow, RTL ok).
- [ ] **Reject bad input:** an SVG/GIF (or a >2 MB image) shows an error and does
      **not** change the avatar; the emoji picker still works.
- [ ] **Remove image:** "Remove image" resets to the emoji everywhere; refresh keeps
      the reset (localStorage cleared).
- [ ] **Online is emoji-only:** host/join a room with a custom image set — your seat
      + the lobby + other players show your **emoji**, never the image. Confirm no
      `data:image`/base64 is sent (the WS payload only carries the emoji avatar id).

## Manual — Server avatar upload

> **Stage 17.1 BACKEND is implemented but HIDDEN (no UI wiring).** Design in
> [`AVATAR_UPLOAD_PLAN.md`](AVATAR_UPLOAD_PLAN.md). The API endpoints exist; the UI
> checks below activate in Stage 17.2–17.3. Automated coverage: `avatarImage.test.ts`
> (magic bytes / multipart / WebP dims / traversal-safe id), `avatarProcess.test.ts`
> (ffmpeg-gated decode→192×192 WebP + svg/gif/oversize rejection), `avatarApi.test.ts`
> (routing + no-DB 503/404 + privacy guards), `avatarUpload.integration.test.ts`
> (DB-gated repo round-trip). The processing tests need **ffmpeg** on PATH; the
> integration test needs **TEST_DATABASE_URL** (both present in CI).

### Backend API (17.1 — curl against a DB-enabled server)
- [ ] **Auth required:** `POST /api/me/avatar` and `DELETE /api/me/avatar` without a
      session cookie → `401`; with no `DATABASE_URL` → `503 db_disabled`.
- [ ] **Upload:** `POST` multipart `file=@small.png` (signed-in, allowed Origin) →
      `200 { avatarImageUrl: "/api/avatar/<uuid>.webp?v=1" }`; `GET` that URL serves
      `image/webp` with `X-Content-Type-Options: nosniff` + immutable cache.
- [ ] **Reject:** an SVG / GIF / >2 MB image / bad-magic-byte file → `400`/`413`, no row.
- [ ] **Replace + delete:** re-`POST` bumps `?v=2`; `DELETE` → `200 { avatarImageUrl:
      null }` and the `GET` URL then 404s.
- [ ] **Guest forbidden:** a guest session `POST` → `403 guest_forbidden`.
- [ ] **Traversal-safe:** `GET /api/avatar/../../etc/passwd.webp` → not served (404).

### Profile UI (17.2 — LIVE)
- [ ] **Signed-in upload:** Profile → **Synced avatar** → "Upload synced avatar" → the
      circular preview + AccountBar update to the image (360/390, no overflow, RTL ok).
      The "Uploading…" state disables the button while it runs.
- [ ] **Priority:** with a synced avatar set, the preview shows it; **Remove synced
      avatar** reverts to the local custom image (if any) → else the emoji.
- [ ] **Guest gating:** a guest / not-signed-in user sees the **sign-in hint** in the
      Synced-avatar group and NO upload button; the **This device** (local) controls +
      emoji picker still work.
- [ ] **Errors:** an SVG/GIF/oversize → inline "Use a PNG/JPEG/WebP" / "too large"; when
      the server has **no ffmpeg** (503) the inline message reads **"Avatar processing
      is unavailable right now."** and nothing changes.
- [ ] **Separation:** the OAuth provider picture is not treated as the custom avatar;
      the uploaded image is not sent through the settings sync.

### Online seats (17.3 — LIVE)
- [ ] **Lobby seats:** a signed-in player with a synced avatar shows the image next to
      their name in the room lobby for OTHER players; bots + guests + no-upload show the
      **emoji** (360/390, no overflow, RTL ok).
- [ ] **King table:** the same image shows on the King table seats (name + avatar).
      Durak/Deberc/Tarneeb tables remain name-only (unchanged).
- [ ] **404 fallback:** delete your synced avatar mid-session (or force a stale URL) →
      other seats **fall back to the emoji** (no broken image); a reconnect refreshes.
- [ ] **Local image is private:** a player using only the **This device** (local) image
      shows their **emoji** to others — the local image never appears on another client.
- [ ] **Wire check:** the WS payload carries at most a short `/api/avatar/<uuid>.webp`
      URL — **no base64 / data URI / image bytes**. Create/join/reconnect unaffected.

### Production release smoke (17.4)
> Run against the live, DB-enabled deploy while signed in.
- [ ] **Upload each type:** a valid **PNG / JPEG / WebP** all succeed → the served
      `/api/avatar/<uuid>.webp?v=1` returns `image/webp`, `X-Content-Type-Options:
      nosniff`, `Cache-Control: public, max-age=31536000, immutable`.
- [ ] **Reject:** **GIF / SVG** and a **> 2 MB** image are refused (no avatar change);
      a non-multipart body → `415`.
- [ ] **Delete:** removing the avatar → the URL then `404`s; the emoji returns.
- [ ] **Re-upload cache-bust:** upload again → the URL version bumps (`?v=2`); the new
      image shows immediately (an old cached `?v=1` copy is harmless).
- [ ] **See it in rooms:** the avatar appears on **lobby seats** + the **King table**
      for other players; bots/guests stay emoji.
- [ ] **ffmpeg absent (if applicable):** on a host without ffmpeg, upload returns a
      clean **`503`** and the rest of the app is unaffected (verify `/health` stays 200).

## Manual — PWA / mobile

> Install / update / offline UX = Stage 21.0. Banners are a progressive enhancement:
> the install card only shows when Chrome fires `beforeinstallprompt`; the update pill
> only when the service worker has a WAITING new version; the offline pill only when
> `navigator.onLine` is false. Automated smoke: `node scripts/pwa-shots.mjs` (needs a
> `vite preview` — production build so the SW/PWA hook is active).

- [ ] Production HTTPS build: Chrome Android → **Install app** (or the bottom
      **"Install Card Majlis"** card → Install); launches standalone, portrait, with the
      Card Majlis medallion icon.
- [ ] **Install card:** shows on the menu only (bottom card, Install + ✕), **never during
      a game**; ✕ dismisses it and it stays hidden on later visits (localStorage). Already
      installed / iOS Safari → no card (no fake prompt).
- [ ] **Update available:** deploy a new build, reopen → a thin top **"Update available"**
      pill with **Refresh**. Refresh reloads into the new version; **no auto-refresh
      mid-game** (the SW waits for the tap).
- [ ] **Offline pill:** go offline → thin top **"You're offline. Local games may still
      work."** pill; it never covers the top-left ✕ / hand / actions / social; hides when
      back online. **Local** game still opens offline; online shows "Connecting…".
- [ ] **No stale API offline (Stage 21.1):** the service worker is **network-only** for
      `/api/*` + `/auth/*` (profile/stats/leaderboard/sessions/OAuth) — it caches only the
      static app shell + assets, so online data is always fresh and offline never serves a
      stale profile/stats. (WebSocket never passes through the SW.)
- [ ] Notch/safe-area: header, banners, and the hand are not hidden under system bars.

### Mobile safe-area & touch ergonomics (Stage 23.0)

> `viewport-fit=cover` + reusable `--safe-top/right/bottom/left` (base.css) + a 44px
> `--tap-min`. Installed apps stamp `<html data-standalone="true">` (PWA hook) for
> installed-only tweaks. Automated matrix: `node scripts/mobile-shots.mjs <previewUrl> .shots`
> now walks **360×800 / 390×844 / 430×932** portrait + **568×320 landscape** +
> **standalone-emulated 390×844**, and fails on any horizontal overflow. Source guards:
> `src/styles/mobileSafeArea.test.ts`. (`.shots/` is git-ignored — no artifacts committed.)

- [ ] **Bottom safe-area (home indicator):** on a notched device the player's hand, the
      King/Durak action bar, the install card, and the social FABs / "Leave game" pill all
      sit **clear of the home indicator** (never underlapped).
- [ ] **Top safe-area (notch / status bar):** the top-left ✕, top-right ❓, and the
      update/offline pills clear the notch; in **standalone** the pills keep a small top
      floor even where the OS reports no inset.
- [ ] **Tap targets ≥ 44px:** game picker, cards/actions, lobby buttons, social buttons,
      and the PWA **Install / Refresh / ✕** are all comfortably tappable.
- [ ] **No horizontal overflow** at 360 / 390 / 430; the card hand scrolls horizontally
      where needed **without** scrolling the page sideways.
- [ ] **Landscape:** rotate to landscape (≈568×320) — no "rotate your phone" blocker; menu,
      setup, and the table adapt (content scrolls vertically, no clipped controls).
- [ ] **RTL (Arabic):** the banners/pills and social controls mirror cleanly; safe-area
      padding still applies on the mirrored edge.

## Manual — Sound (preference+preview 15.2; ALERT-ONLY 15.4)

> **Assets (15.1) + preference & engine (15.2) are live. Stage 15.4 re-scoped sound
> to USEFUL ALERTS only** — the Stage 15.3 decorative cues (card-play / trick-collect
> / trump-reveal / finish) were **removed**. Sound is **OFF by default**. The only
> wired sound is a **low-time alert**: one `ui-error` cue when my turn timer crosses
> below 10s on my turn (King online with a host-set timer). A new-deal alert is
> deferred. Plan: [`SOUND_DESIGN.md`](SOUND_DESIGN.md).

**Asset verification (Stage 15.1 — automated, no device needed):**

- [ ] `npm run sounds` regenerates the set deterministically (same bytes) and prints
      each id's webm/mp3 size + a total under budget (ffmpeg with libopus + libmp3lame
      required).
- [ ] `npm test` — `src/audio/soundAssets.test.ts` passes: all 12 ids present as
      **webm + mp3**, unique, `/sounds/`-scoped, under the per-file cap, total < 500 KB,
      and the **wiring-boundary guard** holds (audio API only in the engine; the manifest
      imported only by the engine; `playSound` only in `useSoundAlerts` + `ProfilePanel`;
      the alert hook only in `TurnTimer`; the removed decorative ids referenced nowhere
      outside the manifest; no core/server/games/net module imports the audio layer;
      `messages.ts` carries no sound field).
- [ ] After `npm run build`, `dist/sounds/` contains the 24 files (Vite copies
      `public/sounds/`).

**Preference + preview (Stage 15.2 — manual, ~2 min):**

- [ ] Profile → Appearance shows a **Sound** row (`Off | Subtle | Full`), default
      **Off**, with the "off by default" hint. No native `<select>`.
- [ ] With **Off**: the **Preview sound** button is **disabled** and shows the quiet
      "turn sound on to preview" hint; nothing plays.
- [ ] Switch to **Subtle** / **Full**: Preview enables and plays a click on tap;
      Subtle is audibly quieter than Full.
- [ ] Reload the app: the chosen preference persists (localStorage `cardMajlis.sound.v1`);
      a signed-in account on another device is **unaffected** (local-only, not synced).
- [ ] No other button in the app makes a sound (only the explicit Preview is wired).
- [ ] **RTL (Arabic):** the Sound row + Preview button lay out correctly at 360/390,
      no overflow, label/hint mirror properly.

**Low-time alert (Stage 15.4 — manual, needs 2 devices/tabs + a host timer):**

- [ ] Host an **online King** game with a **turn timer** set (e.g. 30s) and start it.
- [ ] Set **Sound = Subtle** on your device. On **your turn**, let the timer run down:
      exactly **one** alert (`ui-error`) fires as it crosses **10s** — not every second.
- [ ] It does **not** fire again for the rest of that turn; the next turn re-arms it.
- [ ] It does **not** fire on an **opponent's** turn (their countdown ticks silently for you).
- [ ] Reconnect / reload while your timer is **already below 10s** → **no** alert (only a
      fresh crossing on a new turn fires).
- [ ] Switch **Sound = Off** → the whole game is **silent**, including the low-time moment.
- [ ] Confirm **no** card-play / trick-collect / trump / finish sounds anywhere (removed).
- [ ] (Expected gaps) Local games and Durak/Deberc/Tarneeb online have no turn timer, so
      no low-time alert there — that is by design for now.

- [ ] **Default OFF:** a fresh user hears **nothing** until they opt in via
      Profile → Sound (`off | subtle | full`).
- [ ] **First-gesture unlock:** after enabling, the next tap/click sounds; no
      "tap to enable audio" nag; no autoplay before a gesture (iOS Safari + Android
      Chrome + desktop).
- [ ] **Tab hidden → muted:** backgrounding the tab silences sound; returning resumes
      silently (no queued backlog plays).
- [ ] **Subtle vs Full:** `subtle` plays only the P0 set at a lower volume; `full`
      adds P1/P2. Reduced-motion does **not** auto-mute; muting sound does not change motion.
- [ ] **No hidden info / no double-sound:** sounds only accompany what's on screen;
      an online room sounds the same for everyone and never reveals a hidden hand/turn.
- [ ] **Throttle:** dealing a full hand does not stack into a burst of taps.
- [ ] **Fallback:** a missing/undecodable SFX silently no-ops (no error, no gameplay
      block); total sound payload stays under budget (< 500 KB).

## Manual — Voice chat (Stage 25.4–25.5, WebRTC mesh; HTTPS + a mic required)

> Opt-in WebRTC mesh voice over the 25.3 signaling relay. **HTTPS is required** for
> `getUserMedia` (localhost counts as secure). Real audio is **manual-only** — CI has no mic.
> No Postgres needed (voice is in-memory; no server audio, no recording, no DB).

- [ ] **Default off:** in an online **Lobby**, the **Voice chat** card shows **Join voice**
      (nothing is captured until tapped). In-game, a compact 🎙️ mic button sits with the
      reaction/chat FABs and never covers the hand/actions (check 360/390 + RTL).
- [ ] **Join (two contexts in the same room):** both tap **Join voice** → grant the mic →
      each hears the other; the card shows **Connected · N** and lists the peer.
- [ ] **Mute/Unmute** toggles your mic AND the peer's row shows 🔇/🎤 (mute state propagates).
- [ ] **Leave** (or leaving the room / closing the tab) stops your mic and drops you from the
      others' peer list.
- [ ] **Fallbacks:** deny the mic → **"Microphone permission denied"** + a **browser-settings
      hint** (text chat still works); an unsupported browser → **"Voice chat isn't supported"**;
      if audio autoplay is blocked → a **"Tap to enable audio"** button appears.
- [ ] **Reconnect (25.5):** while both are in voice, drop one client's network for a few seconds
      (DevTools → offline, or toggle Wi-Fi). On reconnect the WELCOME re-fires and voice
      **rebuilds the mesh automatically** — no duplicate peer rows, mute state preserved, audio
      resumes. A peer that stays down shows **"reconnecting…"** then **"failed"**; you can
      **Leave + Join** again to recover.
- [ ] **No auto-rejoin in background:** background the tab / minimise the installed PWA while in
      voice → it does **not** silently re-request the mic; control stays explicit.
- [ ] **Audio actually flows (25.7/25.8):** two tabs on the **same machine/LAN**, both **Join
      voice**, speak → each hears the other. The Lobby card's **status block** reads **Mic:
      allowed · Peers: 1/1 · Connection: `connected`/`completed` (raw ICE state) · Audio: playing**.
      This is the primary regression check for the ICE-buffering fix + the DOM-attached audio
      sink (25.8). While connecting the ICE line steps **new → checking → connected**; if a peer
      links but no audio arrives it reads **Audio: no-track**; autoplay-blocked → **Audio: blocked**
      + a **"Tap to enable audio"** button → **playing**.
- [ ] **Failed / TURN hint (25.7):** if every peer ends up **failed/disconnected** (e.g. strict
      cross-network on STUN-only), the card shows **"Connection failed — a TURN server may be
      required on this network."** — same-LAN success means this is a NAT limitation, not a bug
      (configure TURN per 25.6).
- [ ] **ICE config indicator (25.6):** the Lobby Voice card shows a small **"Network: STUN"** or
      **"TURN + STUN"** line; `GET /health/diagnostics` → `voice.ice` matches (`stun_only` /
      `turn_configured`); `GET /api/voice/ice-config` returns `{ iceServers }`.
- [ ] **TURN two-network test (only if `VOICE_ICE_SERVERS` (runtime, preferred) or
      `VITE_VOICE_ICE_SERVERS` (build-time) is set):** join one client on Wi-Fi and one on **mobile
      data / a hotspot** (carrier CGNAT = the strict-NAT case). They connect P2P **via the relay**
      where STUN-only would fall back to text. Confirm **no TURN credential** appears in DevTools
      console, network logs, or `/health/diagnostics`. Changing the runtime env + **restarting**
      (no rebuild) takes effect on the next room entry.
- [ ] **Privacy:** DevTools → the `/ws` frames carry only SDP/ICE strings + clientId/name/muted
      — **no email/token/session, no audio bytes, no TURN secret**; nothing is recorded or stored.

> Automated coverage (`npm test`): VoiceSession mesh (join requests mic once, leave stops
> tracks + closes PCs, mute toggles the track, glare offerer, offer/answer/ice routing,
> peer add/remove, unsupported/permission errors, **reconnect resync rebuilds without dup PCs**)
> + `iceConfig` (STUN default, env override, TURN-cred parse, **redaction never leaks the secret**)
> + the 25.3 relay routing + source guards (WebRTC/getUserMedia confined to `src/voice/webrtc.ts`;
> **no committed TURN url/credential** across `src/`+`server/`; no server audio/DB)
> + **25.7**: buffered-ICE-before-remote-description → applied after `setRemoteDescription`,
> `ontrack` → remote audio sink, `connectionSummary().allFailed` → TURN hint. **Real two-party
> audio is manual-only** (CI has no mic); the mesh/signaling logic is fully mocked.

## Manual — Friends UI + room invites (Stage 25.2 + 25.7 bugfix, needs Postgres + a signed-in account)

> Two signed-in Google sessions (A + B) on a migrated Postgres. Guests see a sign-in CTA
> (no API calls). No email is ever shown; the invite carries only a room code + display name.

- [ ] Profile → **Friends** tab: your **friend code** (`CM-XXXX-XXXX`) + **Copy**; **Add** by
      B's code → B sees an **incoming request**; B taps **Accept** → both show each other under
      **Friends**, **online friends first**, each with an explicit **Online / Offline chip**.
- [ ] **Request badge (25.7):** while A has a pending incoming request, a **red badge** shows on
      the **⚙️ Profile tile** on the main menu **and** on the **Friends tab**; it clears after
      Accept/Decline. Works on mobile/RTL without overflow; with no Postgres/guest there is no
      badge and the menu is unaffected.
- [ ] **Presence at the menu (25.7):** with A and B both **signed in and sitting on the menu**
      (no room), A's Friends list shows B **Online**; when B closes the tab / signs out, A flips
      B to **Offline** within a few seconds (no manual refresh needed). Manual **↻** still works.
- [ ] **Lobby invite is visible (25.8):** in ANY game's Lobby (King/Durak/Deberc/Tarneeb) the
      **"👥 Invite friends"** block is **always shown** (not collapsed). A **guest** sees **"Sign
      in to invite friends"**; a signed-in user with **no friends** sees **"Add friends in Profile
      to invite them"**; otherwise online friends list first with an **Invite** button (offline →
      disabled + hint). No overflow at 360/390 or in RTL.
- [ ] **Invite (25.7):** A hosts an online room → A's Lobby Friends panel shows B with a clear
      **Invite** button (online) or a **disabled Invite** (offline, "friend is offline" hint). In
      the **menu** Friends tab a hint reads **"Create or join a room to invite friends."** Tap
      Invite → B gets an **"A invited you to a game · ABCD"** toast (Join / Dismiss) whether B is
      **in a room OR on the menu**. **Join** opens the Join sheet **prefilled** with `ABCD` (never
      auto-joins). Inviting an **offline** friend / a **non-friend** / **outside a room** shows a
      small inline notice (not the fatal error surface). Rapid invites are rate-limited.
- [ ] **Guest / privacy:** a guest sees the sign-in CTA only; no request/invite/presence payload
      contains an email, token, or session; the invite works only between accepted online friends.
- [ ] **Mobile 360/390 + RTL (Arabic):** the Friends tab (chips + badges + invite), the request
      badges, and the invite toast don't overflow and the toast never covers the hand/actions.

## Manual — Card reliability + trick pacing (Stage 25.8, any game, no Postgres)

> Both are display-only fixes — no rules/scoring change. Run a quick local game of each.

- [ ] **No blank cards:** play a hand of each game; every visible card shows either its **artwork**
      or, if the image is slow/broken, its **rank + suit text** — **never a blank rectangle**. To
      force the fallback: DevTools → Network → block `*/cards/*` (or throttle) and re-deal — faces
      render as text, not blank. Hidden cards still show the patterned back (or CSS back on error).
- [ ] **Trick/last-card reveal delay (~0.9–1.2 s):** the final card of a completed trick/bout stays
      readable before play moves on, in **every** game:
      - **King / Deberc** — the completed trick lingers on the felt (server `trick_complete` pause).
      - **Tarneeb / Preferans** — the just-won trick freezes ~1.1 s before the next lead.
      - **Durak** — after a bout is beaten/taken, the final attack/defense cards **linger ~1.1 s**
        before the table clears; playing a **new** attack immediately cancels the linger (no stall).
      Reduced-motion is respected elsewhere, but this readability delay is kept regardless.

## Manual — Friends backend (Stage 25.1, needs Postgres; API-level)

> Backend foundation only (DB/API/presence) — the Friends **UI** lands in 25.2. Requires a
> migrated Postgres (through `0009_friends.sql`) + a signed-in Google session cookie. Guests
> and no-DB deploys return `403` / `503` (expected). No email is ever returned.

- [ ] `GET /api/friends` (with your session cookie) → `{ friendCode:"CM-XXXX-XXXX", friends:[],
      incoming:[], outgoing:[] }`; the same call again returns the **same** friend code.
- [ ] `POST /api/friends/request {friendCode:<your own>}` → `400 self`; a bogus code → `404
      invalid_code`; a second session's code → `200 {status:"created"}`.
- [ ] From the second session, `POST /api/friends/accept {userId:<first user id>}` → `200`;
      then both `GET /api/friends` show each other under `friends` (with `online:true` while
      both WS sockets are connected).
- [ ] `DELETE /api/friends/:userId` → `200`; `areFriends` false afterwards.
- [ ] **Privacy:** no response body contains an email or session/token; `friendCode` is only
      ever your own. Guest session → every route `403 guest_forbidden`.
- [ ] DB-gated repo test: `TEST_DATABASE_URL=… npm test` runs `friends.integration.test.ts`
      (request/accept/auto-accept/remove/self/duplicate/cascade). Without it, it **skips**.

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
