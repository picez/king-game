# QA Checklist — Card Majlis

Automated coverage: `npm test` (unit) and `npm run e2e` (full online flow over
WebSocket against a real server, incl. restart restore). This file is the
**manual / device** pass to run before a release. See
[`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) for what each feature is.

> **Just want the quick live pass?** Start with [`OWNER_SMOKE_GUIDE.md`](OWNER_SMOKE_GUIDE.md) (20–30 min,
> how-to-test + how-to-report-a-bug) and record results in
> [`PRODUCTION_SMOKE_LOG_TEMPLATE.md`](PRODUCTION_SMOKE_LOG_TEMPLATE.md). This file is the exhaustive
> per-feature reference behind it.

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
npm test                  # unit + pure-logic tests (all 6 games + net/UI)
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

## Manual — Tutorials (Stages 31.1–31.2)

- [ ] **Menu entry:** the main menu shows a **🎓 Tutorials** tile → opens a hub listing **all 6 games**
      with icon, name, a one-line "what you'll learn", and a **⏱ ≈ Ns** duration.
- [ ] **All six enabled (31.2):** every row — King, Durak, Deberc, Tarneeb, Preferans, 51 — shows a
      **Start** button (no "Coming next" left). **Back to menu** returns.
- [ ] **51 tutorial (7 steps):** demo table (melds / discard / hand), highlighted cards, short captions.
      Visual moments: **A-2-3 / Q-K-A** runs + a red **K-A-2 ✗** note; **Take & open 51**; a **joker**
      with its stand-in card. **Back / Next / Skip** + **←/→/Esc** work; **Done** returns to the hub.
- [ ] **Durak (6):** attack/defense **pairs**, **Trump ♥** badge, **trump beats non-trump**, **Take vs
      Defended** contrast.
- [ ] **King (6):** a standard trick with a **① lead** badge + a **winner** ring; "follow suit"; a
      **modes** step (avoid hearts/queens…, Trump round scores +); "lowest total wins".
- [ ] **Deberc (7):** Solo/Pairs; **Terce + Палтіна** (never "Платіна"); the **5-card Палтіна beats a
      4-card** step; the **7/6 trump exchange**; **Bela** on a trump K/Q.
- [ ] **Tarneeb (6):** teams; **bid 3–13**; **Trump ♠**; follow-suit; **void → trump wins**; scoring
      (**exact = ×2**, over = tricks, miss = penalty, target 41).
- [ ] **Preferans (6, light):** declarer vs 2 defenders; contract; **talon**; 10 tricks; winner leads;
      the last step notes advanced variants are **not in the app yet** (no over-promise).
- [ ] **Client-only:** nothing is sent to the server on any tutorial (DevTools → Network quiet); no
      stats/achievements change.
- [ ] **Mobile 360/390:** no horizontal page overflow on the hub or any step; caption never hides the
      cards; buttons ≥44px. Automated: `node scripts/tutorial-shots.mjs <preview-url>`.
- [ ] **Arabic (RTL):** captions/controls mirror correctly; **card runs still read low→high** because
      card rows are `dir="ltr"`. Reduced-motion: the highlight pulse stops.

## Manual — drag hand ordering (all games, Stage 30.12b)

- [ ] In **every** game (King / Durak / Deberc / Tarneeb / Preferans / 51) you can **drag a card**
      within your hand (touch, mouse or pen) to reorder it. The dragged card lifts, a bright insertion
      bar shows where it will drop, and releasing commits the new order. Default order is the usual
      sort until you drag.
- [ ] A **quick tap still plays / selects** the card (drag starts only after a small movement), so
      dragging never fires a play. A **↺ Auto-sort** button appears once you've reordered → back to default.
- [ ] After reordering, a **newly drawn/received card appears at the far LEFT** (Durak refill, 51 draw).
      A **new deal** returns to the default sort. This is **display-only** — online opponents / the
      server never see your order (no reducer/action/`ACTION_REQUEST` change).
- [ ] The hand tray is **roomy** (bigger drop area, wraps to fit) with **no horizontal page overflow**
      at 360/390, action buttons stay reachable, and the 51 stage/meld area is not hidden. Dragging
      does **not** change which cards are legal to play (trick games) or meldable (51).
- [ ] **51 joker position by order:** select cards so a joker sits where you want (`[🃏, 8♠, 9♠]` reads
      7-8-9, `[8♠, 9♠, 🃏]` reads 8-9-10) — the selection is never auto-sorted; use the meld-builder
      ← / → (or pre-arrange the hand) to fix its spot, then lay + discard to go out.

## Manual — 51 elimination score (Stage 30.15)

- [ ] **Local setup:** the 51 setup sheet shows an **elimination-score picker** with **210 / 310 /
      410 / 510**, default **510** highlighted. Pick **210**, play a short match — a player is knocked
      out as soon as their running penalty reaches **210** (not 510).
- [ ] **Online host:** the Host sheet for 51 shows the same picker. Create a room at **310**; the
      **lobby meta** reads `🀄 … · ☠ 310`. Joiners see the same score before Start.
- [ ] **Rematch / legacy:** after a finished online match, **Play again** deals the next match at the
      **same** score. An old room opened from before this change shows **☠ 510** (nothing breaks).

## Manual — 51 meld table, help + joker replacement (Stage 30.14)

> `node scripts/fifty-one-shots.mjs http://localhost:4173/ .shots/fifty-one` covers the layout
> automatically (it FAILS if it reaches no public meld — a silent pass used to hide regressions).
> These are the things it cannot see.

- [ ] **Public melds read cleanly:** on the 51 table at **360 and 390**, the cards in every meld are
      **large and fully visible with a clear gap** — no card sits on top of another, none is cropped,
      and the page never scrolls sideways. Check a **3-card set**, a **4-card set**, a long run
      (`A-2-3-4-5`), a `Q-K-A` run, and a meld **with a joker** (the joker shows the card it stands
      in for + a small 🃏 badge). A long meld scrolls **inside its own block**.
- [ ] **Controls never cover cards:** the **＋ Add** and **🃏 Replace joker** buttons sit in a row
      **under** the cards on every meld, at both widths, and in **Arabic (RTL)** the cards still read
      low→high left→right.
- [ ] **Help sheet (❓ in-game, all 4 languages):** the sheet shows **Card values** (2–10 face value,
      J/Q/K = 10, A = 10 but `A-2-3` = 6, `Q-K-A` = 30, joker in a meld = the card it represents,
      joker in hand = 25) and **Melds** (`A-2-3`, `Q-K-A`, `K-A-2` invalid, sets with no repeated
      suit, ≤ 1 joker at any position). **Turns** states you can take the discard before opening
      **only if you open with it**; **Notes** states joker replacement.
- [ ] **Joker replacement:** as an **opened** player holding the exact card a table joker represents
      (e.g. `J♥` vs a joker standing in as `J♥`), the meld shows **🃏 Replace joker**; pressing it puts
      your card into the meld **at the joker's slot** and the **joker lands in your hand**. The meld's
      point value is unchanged and no joker remains in it.
- [ ] **Joker replacement is properly gated:** the button is **absent** when you haven't opened, when
      it isn't your turn, before you've drawn (draw step), and when you don't hold the exact matching
      card (a `J♠` or `10♥` must NOT enable it against a joker representing `J♥`).
- [ ] **The round still ends on a discard:** after replacing, you must still **discard** to end the
      turn — replacing never ends the round, even from a one-card hand. If you keep the bought joker
      to the end of a lost round it costs the usual **25**.

## Manual — Deberc rule corrections (Stage 30.16)

- [ ] **Trump exchange restricted:** on your declaring turn, the **🔄 Swap low trump** button appears
      **only** when (a) the face-up table card is of the **trump suit** (i.e. the trump was taken from
      the table, not declared as a free suit in round 2), **and** (b) your 7/6-of-trump was **dealt to
      your hand**, not drawn from the прикуп. When the low trump came from the прикуп, or the trump is a
      free suit, the button is **absent** (and the online server rejects the swap too).
- [ ] **Палтіна length-first:** a **5-card палтіна beats a 4-card палтіна** even if the 4-run tops
      higher (e.g. a run to J beats a run to A). Two equal-length палтіни still compare by high card.
      The scoring table still says **"Палтіна"**.
- [ ] **Бела at play time:** бела is **no longer offered in the declaring phase**. During play, when
      you hold the trump **K+Q**, a **🔔 Declare Bela** toggle appears; arm it and play a trump **K or
      Q** to declare. You score **20 only if you win that trick** — declaring then losing, or playing the
      honor without arming, scores **0**. A public "X declared Bela" note shows to everyone.
- [ ] **Smaller table cards:** the played trick cards are **~10% smaller** than before; the trump +
      stock pile are unchanged; no overlap with seats/buttons/hand at **360/390** portrait.

## Manual — team names (Tarneeb / Deberc Pairs, Stage 30.12b)

- [ ] **Pairs** games label partnerships by their players, not abstract "Team A/B": the **lobby team
      grid**, the Tarneeb **HUD** ranked table, and the Tarneeb **finished** screen read like
      **"Alex & Dina"** vs **"Niko & Yara"** (Team = seats 0&2 vs 1&3). A partly-filled team (one bot /
      empty seat) falls back to **"Team Alex"**, and an all-unknown team to the localized **Team A/B**.
- [ ] **Solo** modes (Tarneeb Solo, Deberc Solo) show **individual player names** — no team labels.
      Nothing overflows at 360/390; Arabic RTL reads correctly.

## Manual — clockwise & table clarity (Stage 27.4)

- [ ] In **every** game the turn highlight moves **clockwise** (to your left first) —
      King, Durak, Deberc, Tarneeb, Preferans. (Tarneeb was mirrored in 27.4; partner
      still sits opposite at the top.)
- [ ] Current trick: the **led card** shows the "1" badge/ring; each played card sits in
      front of the player who played it; the **winning card + seat** pulse when the trick
      is taken. King now shows the lead badge too.
- [ ] **Durak:** each attack card is paired with its covering defense; still-open attacks
      stand out; after a take/beat the last bout lingers ~2 s and stays readable.
- [ ] **Tarneeb:** "🃏 Team tricks" review shows your side's tricks with the lead flagged.
- [ ] The final card/trick lingers **~2 s** before play advances (all games, local + online).
- [ ] 360/390 + RTL Arabic: seat labels and the lead badge don't overflow or crowd the hand.

## Final 27.x gameplay audit — results (Stage 27.6)

Automated + code audit after the 27.0–27.5 rules/UI pass. **No gameplay bugs found**; verify
green (1863 tests inc. the new audit lock; build + e2e). Confirmed by evidence (file:line):

- [x] **Legality single-source (no UI/server drift).** Tarneeb `canPlayCard → getValidPlayableCards
      → legalPlays`; Deberc `currentLegalPlays` + reducer `isLegalPlay → legalPlays` — the table
      dims exactly what the reducer accepts; illegal plays return the same state ref.
- [x] **Rules regressions clear.** Tarneeb bid 3–13 (bot floor 7) + trump obligation + clockwise
      mirror + team-tricks viewer; Deberc 3p-solo / 4p-pairs, trump exchange (7/6, reducer-gated),
      larger table cards, red skip-meld, "Палтіна"; King lead badge; ~2000 ms reveal everywhere.
- [x] **Online authority.** Non-King/Durak actions authorized only for the acting seat
      (`getActingPlayerId === seatToPlayerId`); the 2 s reveal is display-only and never gates input
      or desyncs online (the trick is already resolved server-side before the linger).
- [x] **Online flow.** Friends invite renders inside the Lobby card (`inviteSlot`); invite
      "Join room" performs a real JOIN; bot rematch restarts in-room (no leave-to-menu); multi-human
      rematch waits for all-ready; reconnect restores game state + own hand.
- [x] **Display safety.** Cards never render blank (`showArt = attemptArt && artLoaded`); Durak
      attack/defense pairs group (`durak-pair` / `durak-pair__def`, unbeaten highlighted); Tarneeb
      team-tricks viewer reads only public `completedTricks` (no hand leak).

**Manual / visual — still owed a device pass (harness has no DOM):** 360/390 portrait for the
lobby + one in-game table per game; Arabic RTL spot-check of menu / profile sections / lobby /
friends badges; no horizontal overflow. Not automatable here — listed honestly as manual.

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
- [ ] **Deberc LOCAL setup (Stage 28.0):** names the two modes explicitly — **"Solo · 3 players"**
      and **"Pairs · 4 players"** mode cards (not bare 3/4 tabs); picking Solo actually starts a
      3-player game, Pairs a 4-player game.
- [ ] **Deberc ONLINE host (Stage 28.2):** the **Host** sheet shows a **Solo / Pairs** segmented
      picker (defaults to **Solo**) above the match-size toggle. Creating **Solo** makes a **3-seat**
      room; **Pairs** a **4-seat** room.
- [ ] **Deberc lobby, Solo (3):** game-line reads **"🎴 Short/Long · Solo"**; the players list is
      **3 individual seats (NO Team A/Team B grid, no "partner" chip)** with the hint
      **"🙋 Solo — every player for themselves (no teams)."**; **Add bot** fills to **3/3**; Start is
      enabled at **3**.
- [ ] **Deberc lobby, Pairs (4):** game-line reads **"🎴 Short/Long · Pairs"**; the **Team A/Team B
      2×2 grid** (partners opposite) renders with the partner hint; **Add bot** fills to **4/4**;
      Start reads **"Teams ready"** at 4.
- [ ] **Deberc table/finished, Solo (3):** the score table shows **3 per-player columns** (player
      names, not "Team A/B"); a Solo win shows an individual celebration.
      *(Stage 28.2: same released engine/scoring — 3p Solo vs 4p Pairs is the seat count; only the
      online host/lobby/celebration were made mode-aware. Arabic RTL: no horizontal overflow.)*
- [ ] **Deberc match-score strip readability (Stage 29.5):** the top score chips show a **larger,
      tabular score number**, and **your own** team/seat chip has a **green top edge**. Works the same
      for **3p Solo** (3 chips) and **4p Pairs** (2 team chips) — labels unchanged. No 360/390 overflow.
- [ ] **Tarneeb LOCAL Pairs (default):** local Tarneeb setup shows a **Pairs / Solo** picker with
      Pairs pre-selected; starting Pairs plays exactly as before — Us/Them team scoreboard, partner
      opposite, team-tricks viewer, "Team {A/B} won" finish. **Unchanged from release.**
- [ ] **Tarneeb LOCAL Solo (Stage 28.3):** pick **Solo** → a 4-player cutthroat table (1 human + 3
      bots). Verify: **no Team A/B labels**; the scoreboard shows a **4-player standings strip**
      (my chip + the leader highlighted); tricks button/viewer shows **MY OWN** tricks; bidding
      3–13, declarer picks trump, follow-suit works; the **hand-complete panel lists all 4 players**
      (declarer flagged, per-seat delta/score); at 41 the **finished screen names an individual
      winner** (🏆 You won / "{name} won") with 4-player final standings; **Play again** works.
      *(360/390 portrait + Arabic RTL: no horizontal overflow.)*
- [ ] **Tarneeb ONLINE Solo (Stage 28.4):** the online **Host** sheet shows a **Pairs / Solo**
      picker (default Pairs). Host a **Solo** room → the lobby reads **"♠️ Solo"** and shows **4
      individual seats (NO Team A/B grid, no partner chip)** with the solo hint; **Add bot** fills to
      4; Start at 4 (no "Teams ready"). Playing shows the 4-player standings / individual winner
      (same solo screens as local). A **Pairs** room is unchanged (♠️ Pairs, Team A/B grid,
      "Teams ready").
- [ ] **Tarneeb Solo rematch:** after a Solo match finishes, **Play again / rematch restarts the
      same Solo room** (still 4-player cutthroat, not Pairs).
- [ ] **Tarneeb Solo stats + leaderboard (needs Postgres):** Profile → Stats → Tarneeb shows a
      **Pairs / Solo** toggle; after a signed-in Solo game, the **Solo** tab shows gamesPlayed/
      winRate/contract rate/declarer hands/avg score; the **Pairs** tab is unaffected. Leaderboard →
      Tarneeb → **Solo** ranks solo players by wins. (Solo stored under `game_type='tarneeb-solo'`;
      pairs `tarneeb` untouched; no cards/tricks persisted.)
- [ ] **Mobile/RTL:** 360/390 portrait Solo host picker, lobby individual seats, table standings,
      and the stats Pairs/Solo toggle have no horizontal overflow; Arabic RTL reads correctly.
- [ ] **Room browser mode label (Stage 28.5 fix):** in the **Join** room list, a Tarneeb Solo room
      reads **"Tarneeb · Solo"** and a Pairs room **"Tarneeb · Pairs"** — never a blanket "· 2 teams".
- [ ] **Achievements are Pairs-only for the pair badges (Stage 28.5 fix):** open Profile → Stats →
      Tarneeb, toggle to **Solo**, then open **Achievements** — the Tarneeb **pair** badges (Bidder/
      Contractor) + All-Rounder reflect your **Pairs** record (solo games do not leak in).
- [ ] **Tarneeb Soloist badge (Stage 28.6):** after winning a signed-in Tarneeb **Solo** match, the
      **Achievements** grid shows **"Tarneeb Soloist" 🗡️** as earned (with the "new" toast the first
      time). A **Pairs** Tarneeb win alone does **not** earn it; a Solo win does **not** earn
      All-Rounder. Grid has no overflow at 360/390; Arabic RTL reads correctly.
- [ ] **Tarneeb scoring — exact-bid double (Stage 29.0), BOTH modes:** in the hand-complete panel,
      a declarer who takes **exactly** the bid scores **bid×2** (e.g. bid 7 → **+14**), shown with a
      **"✨ exact bid double"** note; taking **more** than the bid scores the **actual tricks**
      (e.g. bid 7, 10 tricks → **+10**); a **failed** contract is unchanged (declarer −bid, defenders
      bank their tricks). Solo (per-seat) and Pairs (per-team) both apply this.
- [ ] **Deberc table card sizing (Stage 29.0, owner):** on the Deberc table the **played trick
      cards are slightly smaller** than before and the **face-up trump + stock deck are ~20% larger**
      (they read closer to the trick cards). No horizontal overflow at 360/390; the trump/deck never
      overlaps the hand, action bar, or seat boxes.
- [ ] **Durak trump/deck sizing (Stage 29.2, owner):** on the Durak table the **face-up trump + draw
      pile are visibly larger** (~+22%); no 360/390 overflow, no overlap with the hand/actions/pairs.
- [ ] **Durak final-defence reveal (Stage 29.2, owner):** when the last attack is beaten (or the
      defender takes), the completed **attack+defence pair stays on the felt ~2 s** before the table
      clears — you can clearly see the card that beat the last attack. A new attack cancels the hold
      immediately. Works the same in local and online.
- [ ] **Tarneeb Solo trick counts (Stage 29.2, owner):** during a Solo game the standings strip shows
      **each of the 4 players' current trick count (🃏 N)** (updates as tricks are won, visible at
      hand-complete too), and a **larger dedicated "🃏 My tricks · N" button** sits under the standings
      (not the tiny topbar badge). No Team A/B labels. Pairs still uses the compact topbar team-tricks
      badge + team-tricks viewer (unchanged).
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
- [ ] **Reaction anchors over the SENDER for every viewer (Stage 29.5) — cross-device.**
      With **2+ devices** in the same game, each device sends a reaction in turn and confirms it
      floats over **that sender's own visible seat** on *all* screens (your own always bottom; an
      opponent's over their seat), not over the player opposite. Check **Tarneeb** specifically
      (Pairs and Solo) — its seats are mirrored, so the left/right opponents are the case that used
      to be wrong — plus one non-mirrored game (Durak/Deberc/Preferans/King) as a control.
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

### Reconnect & same-user cross-device (Stage 36.0)

- [ ] **Bot game survives a reload for ~5 min:** start an online room with **bots**, then
      close/reload the tab. Within **5 minutes** the room still exists → **Resume** returns you to your
      seat mid-game (was 90 s; `ORPHAN_ROOM_TTL_MS` overrides). After 5 min of no humans it's swept.
- [ ] **Same account, second device (UI, Stage 36.1):** on **device A** (signed in) start a game — e.g. a
      **51/King room with bots** — and play a turn. On **device B**, sign in with the **same account** and
      open the **main menu** → a **"Your active rooms"** block lists that room (game · code · **In game** ·
      players · updated). **Tap it** → you land in the **same game/seat** (the board + your hand restored);
      device A is dropped. A **different** account sees **no** such block; a **guest** sees none; an empty
      account sees none. The block shows **only your own** rooms — no other players' rooms, no
      tokens/hands. It doesn't duplicate device A's own local **Resume** card.
- [ ] **Old device doesn't disconnect the new one:** after B reclaims, closing A's tab does **not** knock B
      offline (the race guard — B stays connected and playing).
- [ ] **Expired room:** if the room was swept before you tap Resume, you get a normal "room not found"
      error and returning to the menu refreshes the list (the stale room drops).
- [ ] **Reconnect race:** with a flaky mobile connection (background/foreground), a stale socket's late
      close does **not** knock the freshly-reconnected client offline (the seat stays connected).

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

> Tarneeb is a **2×2 partnership** bid-and-trump game (4 players; host-configurable
> match target, default 41). Released with stats; **no Experimental tag** anywhere.

- [ ] **No Experimental tag** for Tarneeb — the game picker shows a plain
      **♠️ Tarneeb · 2 teams** entry, the Host sheet has no beta note, and the
      Lobby header reads **"2 teams"** (not "Dealer's Choice").
- [ ] **Select Tarneeb** → Host tile enabled; a room is exactly **4 seats**
      (fixed 2×2); starting before 4 seats is rejected.
- [ ] **Match target selector (Stage 29.8):** the Host sheet shows a **🎯 Play-to** picker with
      presets **31 / 41 / 61 / 101** (default **41**), for **both Pairs and Solo**. Pick **61** →
      the **lobby line shows `· 🎯 61`**, and after **Start** the in-game `🎯` reads **61** and the
      match ends at 61 (not 41). An older client that sends no target → the room defaults to **41**.
      The **local** Tarneeb setup has the same picker; per-hand scoring is unchanged either way.
- [ ] **Help modal** explains: 4 players / partners opposite, bid 3–13, declarer
      names trump + leads, follow suit, made vs set scoring, all-13 = +13, target (default 41).
- [ ] **Host + Add bots + Start** → the **Tarneeb** table renders (seats around
      the felt, viewer bottom, partner top), with bidding → trump → trick play.
- [ ] **Readouts:** scoreboard shows the **highest bid + bidder**, the **trump**,
      the **led suit** during play, and per-team trick counts; illegal cards dim.
- [ ] **Ranked score table (Stage 29.7; compact/centered in 29.8):** the HUD is a **compact,
      centered table** (capped width + a subtle card, not full-board-wide) sorted by total score
      (highest first) with columns **# · player/team · ▶bid · 🃏tricks · ★score**. The
      **declarer/highest bidder** row shows **▶ + the bid amount**; **🃏** is tricks this hand, **★** is
      the running total. **Solo** lists the **4 players by name** (no Team A/B); **Pairs** lists the two
      teams as **Us/Them** and keeps the team-tricks viewer. Your row is tinted, the **acting** row is
      washed + ● marked, and the **leader** shows 👑 (only once someone is ahead). Check that rows do
      **not** reorder mid-trick (only at hand end), and no horizontal overflow at 360/390.
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
      win (6 games — since Stage 30.7 it also requires a 51 win).
- [ ] **Regression:** local play, online create/join/start, redaction (no opponent-hand
      leak), reconnect, and stats recording all still work (covered by `npm run verify` +
      the `[2p]` e2e section).

## Manual — 51 (Syrian 51) — RELEASED (available, Stage 30.7)

> **51 is now `status: available`** — a first-class **6th** game alongside King/Durak/Deberc/Tarneeb/
> Preferans (local + server-authoritative online + bots + score-only stats + leaderboard + favorite +
> achievement + PNG emblem). The pure core + shared UI live under `src/games/fiftyOne/` /
> `src/ui/fiftyOne/` ([`51_RULES.md`](51_RULES.md) · [`51_PLAN.md`](51_PLAN.md)). Stats + leaderboard
> record under `game_type='fifty-one'` (**no DB migration** — latest stays 0009). The stage ledger below
> tracks how it got here (30.1 → 30.7); the **Release smoke** at the end is the pass to run for the flip
> to `available`. The other five games' stats and achievements are unchanged (51 adds its own fields).

- [x] *(Stage 30.1)* Pure core built: **no** catalog/registry `fiftyOne`, **no** UI, **no**
      `game_type='fifty-one'` wiring — 51 is invisible in the running app. `git grep -n fiftyOne
      src/components src/games/catalog.ts src/games/registry.ts server` returns nothing.
- [x] *(30.1)* Core unit tests (`npx vitest run src/games/fiftyOne`, **70 tests**): deck
      composition (2p 1-deck+2J = 54 / 3–4p 2-deck+2J = 106), deal 13/14, run/set validation
      incl. `A-2-3`=6, `Q-K-A`=30, reject `K-A-2`, no duplicate identical card in a set, joker
      resolution (≤ 1/meld, internal-gap runs), 51-opening total (51 valid / 50 invalid),
      draw→discard turn flow, discard-take gated on opening, lay-off, empty-hand win, penalties
      (Joker=25, never-opened=100), elimination at 510, continue-until-one-remains, redaction
      (no hand / draw-pile leak), and a bot-soak invariant guard.
- [x] *(30.2)* Catalog + registry show 51 (`fifty-one`) as **coming_soon**: it appears in the
      Local **and** Host game pickers **disabled with "Coming soon"** (never selectable/startable),
      is **absent from the favorite-game picker** and the per-game **stats tabs**, and `GET
      /api/games` lists it as `status:'coming_soon'` with `supportsLocal/Online:false`. The game
      emblem shows the 🀄 emoji fallback (no PNG). The **five released games are unaffected**.
      Automated: `catalog/registry/platformAudit/apiDisabled` + `fiftyOne/comingSoon.test.ts`.
- [x] *(30.3)* Local 2–4p prototype wired (`src/ui/fiftyOne/`): Local picker enables 51
      ("Experimental"), Host picker stays disabled. Automated: `fiftyOne/localGating.test.ts` +
      `ui/fiftyOne/fiftyOneLocalWiring.test.ts` (headless drive of the local loop to a finished
      match, no invariant break) + updated catalog/registry/platformAudit/apiDisabled.
- [ ] *(30.3, manual)* Play a local 51 game at **360/390 portrait**: setup (2/3/4 + deck note),
      starter opens by discarding (14 cards, no draw), a normal turn draws→melds→discards,
      discard-pile take is blocked until you open, opening needs 51+, empty-hand win, round
      summary (penalties incl. never-opened 100 / joker 25), elimination at the host-set score
      (default 510). **No horizontal overflow; cards/controls do not overlap.** Arabic **RTL** smoke.
- [x] *(30.4)* **Online redaction / readiness — hosting stays OFF.** Automated:
      `fiftyOne/redaction.test.ts` (JSON-payload leak scan: no opponent hand / draw-pile card id
      or joker reaches the wrong viewer; own hand real, others blank placeholders with count kept;
      discard / melds+joker value / scores / opened / eliminated / turn public; spectator sees
      nothing) + `net/fiftyOneServerCore.test.ts` (serverCore drives 51 internally: `startGame`
      deal 13/14, `sanitizedStateFor` per-seat redaction, foreign-seat → `NOT_YOUR_TURN`, illegal
      → `ILLEGAL_ACTION` no-op, seeded `round_complete → START_NEXT_ROUND` redeal + determinism,
      serialize/deserialize round-trip mid-play, no draw-pile leak in `RoomSummary`/`snapshot`).
      (Stage 30.4 note — now superseded by 30.5, kept for the redaction leak-scan coverage.)
- [x] *(30.5)* **Online experimental ENABLED (no stats).** Automated: `net/wsHandlers.fiftyOne.test.ts`
      (CREATE_ROOM 51 accepts 2/3/4, clamps out-of-range to 4, ADD_BOT + START_GAME builds a
      FiftyOneState 13/14 deal, public room summary carries 51 metadata + no game state),
      `ui/fiftyOne/fiftyOneOnlineWiring.test.ts` (OnlineGame routes to `FiftyOneOnlineGame`, a thin
      client-only adapter that dispatches ACTION_REQUEST and owns no reducer/bot loop; online mode
      never dispatches `START_NEXT_ROUND`; StartMenu threads `gameType:'fifty-one'`; Lobby shows the
      Rummy meta), `net/fiftyOneRedactionOnline.test.ts` (2-human mutual non-leak + bot hand hidden +
      draw-pile hidden + reconnect snapshot still redacted + no hand/draw in `RoomSummary`), and
      updated catalog/registry/platformAudit/apiDisabled/localGating.
- [ ] *(30.5, manual)* **Online smoke** at **360/390 portrait** (two devices or two tabs + a bot):
      Host a 51 room (pick **51** 🀄 in the Host picker — it's a fully **released** game, not
      "Experimental"), Join from the other; each player sees **only
      their own hand** (opponents show 🂠counts, the draw pile is face-down); a normal turn
      draws→melds→discards over the wire; the acting player's buttons are enabled and the waiter's are
      disabled; the between-rounds summary appears and the **server** starts the next round (no
      "Next round" button online); match winner + **Play again** (rematch) works; **reconnect** after a
      reload restores own hand only. **No horizontal overflow; cards/controls do not overlap.** Arabic
      **RTL** smoke.
- [x] *(30.6)* **Score-only stats + leaderboard.** Automated: `net/fiftyOneStats.test.ts` (pure
      2p/3p/4p summaries + no-card JSON scan + stable signature), `net/fiftyOneStatsWiring.test.ts`
      (finish-path/API wiring + **latest migration still 0009** + achievements/All-Rounder untouched),
      `net/fiftyOneStats.integration.test.ts` (DB-gated: winner/loser deltas, bot/guest excluded,
      idempotent, privacy sweep), API-503 + catalog/registry/platformAudit/localGating. **51 records
      stats but stays experimental** — not favoritable, not achievement-eligible.
- [ ] *(30.6, manual — needs Postgres)* After a **signed-in** online 51 game (2+ humans, **no bots**
      or the game is skipped), Profile → **Stats → 51** shows games/win-rate/avg-penalty/eliminations;
      **Leaderboard → 51** lists the player (own row highlighted). A game **with a bot** or a **guest**
      records nothing. `curl -sI $HOST/api/games/fifty-one/stats` → 200 for a signed-in user.
### Release smoke (Stage 30.7 — flip to `available`)

> 51 is now released — this section is the release smoke, mirroring the other five games' release checks.
> Run it in place of the earlier stage smokes above (they are kept as the ledger of how each stage landed).

- [ ] **Picker (no Experimental tag):** the Local **and** Host sheets list **🀄 51 · 👥 2–4 · Melds** as a
      normal, selectable option — **no** "Experimental" / "Coming soon" tag, not dimmed. `GET /api/games`
      shows `fifty-one` with `status:"available"` and `supportsLocal/supportsOnline/supportsBots: true`.
- [ ] **Room browser + Lobby:** a 51 room shows its **🀄 "Rummy · Melds"** label (never "Experimental");
      the host player-count picker offers **2–4** seats.
- [ ] **Local play:** start a local 51 game (2/3/4) → deal 13/14, opener discards to start, a normal turn
      draws→melds→discards, discard-take gated on opening, empty-hand win, round summary (never-opened 100 /
      joker 25), elimination at the host-set score (default 510), match winner. No horizontal overflow at
      360/390; Arabic **RTL** smoke.
- [ ] **Meld / opening rules (Stage 30.9):** a **joker sits at any position** — stage `7♠ 8♠ 🃏` and it
      reads 7-8-9, `🃏 8♠ 9♠` reads 7-8-9, `Q♠ K♠ 🃏` reads Q-K-A (30), `🃏 2♠ 3♠` reads A-2-3 (6);
      `K♠ A♠ 🃏` stays **invalid**. Before opening the primary button reads **"Open (n/51)"** and is disabled
      under 51; after your first ≥51 lay-down it reads **"Lay meld"** and accepts **any** valid meld (e.g. a
      15-point 4-5-6 run) with **no** 51 requirement. Lay-off + discard-take still work after opening.
- [ ] **Ace-low lay-off + meld layout (Stage 30.10):** with a public `2♠ 3♠ 4♠` run on the table, select
      your **A♠** → the meld's **Add** is enabled and adds it as **`A♠ 2♠ 3♠ 4♠`** (displayed Ace-first,
      value 10); adding a **K** to an `A-2-3` run stays rejected. Public-meld cards render as a **clean,
      readable row** — no overlap, no clipped ranks/suits, Add button below the cards — with **no horizontal
      overflow** at 360/390 even with 4 players and several melds (long runs scroll within the meld block).
- [ ] **Joker position control + final discard (Stage 30.12):** with a joker in hand, select cards for a
      run so the joker is where you want it — the **meld builder strip** shows the selected cards in order
      with **← / →** to reorder (tap a card, then move) and the resulting **🃏 = <card>** so `[🃏, 8♠, 9♠]`
      reads 7-8-9 while `[8♠, 9♠, 🃏]` reads 8-9-10. The selection is **never auto-sorted**. After opening,
      lay the joker meld (any value), keep your **last card**, and **discard it to go out** — you win only
      by that final discard (melding all cards never auto-wins). Works local + online.
- [ ] **Discard-to-open + bigger meld cards (Stage 30.13):** BEFORE you've opened, the plain **Take
      discard** button is **disabled**. When the discard top helps you open, **tap it** (it gets a gold
      ring), add hand cards to build opening melds totalling **≥ 51 that include the top**, then press
      **"Take & open 51"** → you open and the top leaves the discard. Taking the discard **without** a
      valid opening is impossible (no way to scoop it into hand unopened). **After** opening, plain Take
      discard works as before. Public-meld cards are **noticeably bigger and clearly separated** (no
      overlap/clip) with **no 360/390 overflow** even with 4-5-card runs and several meld blocks. Arabic RTL ok.
- [ ] **Online play:** host + join (2 tabs + optional bot) → each client sees **only its own hand**
      (opponents show 🂠counts, draw pile face-down); a turn applies over the wire; the **server** drives the
      between-rounds advance (no client "Next round" button); match winner + **Play again** (rematch) +
      **reconnect** restores own hand only.
- [ ] **Favorite:** Profile → Favorite game now offers **51**; selecting it makes the Local/Host picker
      default to 51 next time; a bad stored value still falls back to King.
- [ ] **Achievement:** after winning at least one 51 game (online, human-vs-human, DB on), the **51 Winner**
      badge (🀄) appears earned in Profile → Achievements; the unlock toast may announce it. Locked before
      any 51 win. A 51 win now also counts toward **totalWins/totalGames**.
- [ ] **All-Rounder:** the cross-game "won every game" badge now also requires a **51** win (**6 games**).
- [ ] **PNG emblem:** the game shows its own **`game-fifty-one.png`** emblem (two fanned brass/gold cards)
      in the pickers / room browser / lobby — **not** the 🀄 emoji fallback.
- [ ] **Stats (needs Postgres):** a signed-in human-vs-human 51 game records under `game_type='fifty-one'`;
      Profile → **Stats → 51** (games/win-rate/avg-penalty/best-penalty/eliminations/rounds) + **Leaderboard
      → 51** populate; a game with a **bot** or a **guest** records nothing;
      `curl -sI $HOST/api/games/fifty-one/stats` → 200 for a signed-in user.
- [ ] **Regression:** local play, online create/join/start, redaction (no opponent-hand leak), reconnect,
      and stats recording all still work (covered by `npm run verify`).
- [ ] **Card calculator (Stage 36.0):** tap **🧮 Count cards** in the topbar — a preview panel opens
      **even on another player's turn**. Tapping hand cards shows the selection's meld validity/value and
      the **hand penalty total**; it **plays nothing**, removes no cards, and doesn't disturb your meld
      selection/staging or the manual hand order. Toggling it off clears the picks. Works at 360/390 + RTL.
- [ ] **Public melds (Stage 36.0):** with several melds down (incl. a joker-represented card and a long
      run), cards are **slightly bigger (72px)**, never **overlap or clip**, and a long run **scrolls
      inside** its meld block — no horizontal page overflow at 360/390.

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

> A Profile **Achievements** tab shows **29** badges (Stage 32.1 expansion, was 14) derived **purely
> from the existing per-game stats** — no DB writes, no server route, no popups. Earned = gold coin,
> locked = muted padlock (goal still shown). See [`ACHIEVEMENTS_PLAN.md`](ACHIEVEMENTS_PLAN.md).

> **Note:** the *populated* grid needs a **DB-backed environment** (auth + stats API) — a static
> `vite preview` leaves the panel in its loading/sign-in state, so grid QA is done against a real deploy.
> The grid is a responsive `auto-fill minmax(9rem,1fr)` with a **dynamic** `n/total` count (no hard-coded
> "14"/"29"), so a larger badge count cannot cause horizontal overflow.

- [ ] **Profile → Achievements:** the **34-badge** catalog renders at **360/390** with no horizontal
      overflow; **RTL (Arabic)** mirrors cleanly; the `n/total unlocked` count reads out of **34**.
- [ ] **Grouped filter (Stage 37.0):** a **styled** chip strip — **Global · King · Durak · Deberc ·
      Tarneeb · Preferans · 51** (each = icon + short name + its own **earned/total**) — opens on
      **Global** (there is **no "All" tab**) and shows **one group at a time** (never all 34). Tapping a
      chip filters the grid. The strip **scrolls inside itself** with a Card-Majlis-styled scrollbar on
      360/390 (**no page overflow**) and mirrors under **Arabic RTL**. The overall `n/34` count and which
      badges are earned are **unchanged** by filtering.
- [ ] **New badges (Stage 37.0):** **King** *Nothing Went Right* (minus points in all six negative
      rounds); **Deberc** *Paltina Hunter* (3 Палтіна) + *Double Declaration* (2+ combos in one hand);
      **Tarneeb** *In the Red* (negative team final) + *Overbidder* (declare 3+, make none) — each flips to
      gold once its condition is met and stays locked otherwise.
- [ ] **Locked state:** a fresh account (no games) shows every badge locked (padlocks) + the "Play games
      to unlock badges." hint; signed-out shows the sign-in hint.
- [ ] **New win badges (Stage 32.1):** after a first win in **Deberc / Tarneeb Pairs / Preferans / 51**,
      the game's new **winner** badge flips to gold (these games had no basic win badge before).
- [ ] **Depth + skill badges:** play-N badges (King Regular, Durak Regular, 51 Regular = 10 games) and
      win-N badges (King Champion = 10, 51 Champion = 5) unlock at their thresholds; **Sharp Bidder**
      stays **locked** until the decided-sample minimum (≥10) is met even at 100% success. **Uncommon**
      badges show a green accent.
- [ ] **Aggregates unchanged:** All-Rounder still needs a win in **all six** games; the new play/win
      badges never earn it on their own, and `n/total` reflects 29.

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

> **Android TWA readiness (Stage 33.1 done — [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md); no app built).**
> Web-side prerequisites, checkable now on the deploy:
> - [ ] `manifest.webmanifest` `description` names **all six** games; `name`/`short_name` = **Card
>       Majlis**; `start_url`/`scope` = `/`; `display` = `standalone`; 192 + 512 + **maskable** icons.
> - [ ] `index.html` `<meta description>` matches (six games); `theme-color` = `#0d4f28`.
> - [ ] `public/.well-known/assetlinks.example.json` exists (package `com.cardmajlis.app`, **placeholder**
>       fingerprint); **no real `assetlinks.json`** in the repo (`/.well-known/assetlinks.json` → 404 on
>       the deploy until store setup).
> - [ ] The install banner does **not** show in standalone/installed mode; the "Update available" pill
>       still works (guarded: `shouldOfferInstall({…, standalone:true}) === false`).
>
> **Android TWA — scaffold + runbook DONE (Stage 33.2/33.3), native project NOT built yet.** The config
> scaffold lives at [`android-twa/`](android-twa/) (`twa-manifest.json` + `check-env.ps1` + `.gitignore` +
> README build runbook; no Gradle project/APK/AAB — toolchain absent). iOS stays PWA add-to-home-screen
> until the 33.4 decision.
>
> **Scaffold hygiene (checkable now, no device — guarded by `src/pwa.test.ts`):**
> - [ ] `git ls-files android-twa` → only `twa-manifest.json`, `check-env.ps1`, `.gitignore`, `README.md`,
>       `BUILD_LOG_TEMPLATE.md` (no `app/`, `gradlew`, `*.gradle`, `*.apk`, `*.aab`, `*.keystore`).
> - [ ] `twa-manifest.json` `packageId` = `com.cardmajlis.app`; `host`/`startUrl`/theme `#0d4f28`/
>       `standalone`/`portrait`/icons match `public/manifest.webmanifest` + `assetlinks.example.json`.
> - [ ] `android-twa\check-env.ps1` runs read-only and reports JDK/SDK/adb/node/npm/Bubblewrap **plus
>       config-sanity** (packageId / webManifestUrl / README uses `@bubblewrap/cli`, no wrong `npx
>       bubblewrap init`); JDK must be **PASS** (17+) before building.
>
> **Owner build-log capture (Stage 33.8 — hand back for triage):** after running the build, fill
> [`android-twa/BUILD_LOG_TEMPLATE.md`](android-twa/BUILD_LOG_TEMPLATE.md) and paste it back:
> - [ ] `.\check-env.ps1` full output (PASS/WARN/FAIL + READY line).
> - [ ] `bubblewrap init` output (correct **web-manifest URL** command; prompt answers).
> - [ ] `.\gradlew.bat assembleDebug` output (BUILD SUCCESSFUL/FAILED + APK path).
> - [ ] `adb devices` + `adb install -r …` output.
> - [ ] **How it opened:** full-screen (DAL verified) vs **Custom Tab URL bar** (expected for debug) vs
>       generic WebView/crash (real issue). See the README **Known-expected-launch-states** table.
> - [ ] Only **text logs** are shared — **no** APK/AAB/keystore or generated Gradle project committed.
> - [ ] **Offline triage (optional):** `.\triage-build-log.ps1 .\<your-log>.md` classifies known failures
>       (`[environment]` vs `[repo/config]`) read-only — paste its output alongside the raw log.
>
> **Android TWA first run (after a 33.3 debug build — `.\check-env.ps1` → `bubblewrap init --manifest
> https://king-game-cqgd.onrender.com/manifest.webmanifest` (the **web** manifest URL, not
> `twa-manifest.json`; set package `com.cardmajlis.app` at the prompt) → `.\gradlew.bat assembleDebug`;
> until then N/A).** Install on a **physical Android** and check:
> - [ ] `adb install -r app\build\outputs\apk\debug\app-debug.apk` succeeds; **Card Majlis** icon appears.
> - [ ] **Opens the production URL** (`king-game-cqgd.onrender.com`) as the app's start — same content as
>       the deployed PWA, not a stale bundle.
> - [ ] **TWA, not a generic WebView** — launches full-screen standalone with **no address bar** when
>       Asset Links verify. **Debug build caveat:** a `assembleDebug` APK is signed with the debug key, so
>       it will typically show a **Custom Tab with a URL bar** — that is **expected** until a Play
>       App-Signing `assetlinks.json` matches (see [`android-twa/README.md`](android-twa/README.md)).
> - [ ] **Google sign-in** completes (TWA uses Chrome → OAuth not blocked; a plain WebView would fail).
> - [ ] Create/join an **online room** over `wss://…/ws`; a second device sees it and play advances.
> - [ ] **51 (Syrian 51)** smoke — start a local game, open a meld, discard; no overflow/clipped melds.
> - [ ] **Tutorials** — 🎓 hub opens; at least one game tutorial plays Back/Next/Skip cleanly.
> - [ ] **Achievements** — Profile → Achievements grid renders all badges (no broken icons).
> - [ ] **Hand drag on touch** — drag-reorder a card in hand works with a finger; tap still plays;
>       `↺ Auto-sort` resets.
> - [ ] **Voice** — Android **mic permission** prompt appears; two-device audio works on the **same
>       Wi-Fi** (cross-network needs TURN — `/health/diagnostics` `voice.ice: turn_configured`).
> - [ ] **Invite link** `https://<verified-domain>/?room=CODE` opens the **app** and joins **once**
>       Asset Links verify for that exact origin; otherwise it opens the **browser** PWA (document which
>       origin is verified — the onrender.com subdomain vs a custom domain — before testing).
> - [ ] **Install banner hidden** in standalone; the **"Update available"** pill still appears after a
>       web deploy and refreshes with no mid-game reload.
> - [ ] **Back button** navigates web history; from the start screen it backgrounds/closes cleanly (no
>       blank Custom Tab left behind).
> - [ ] **360/390** width: no horizontal overflow on menu or any table; re-check **Arabic RTL**.
> - [ ] **Offline** — cached shell loads; live features degrade like the in-browser PWA.
>
> Before store submission (33.3-release+): verify the real `assetlinks.json` matches the **Play
> App-Signing** SHA-256 (not the upload/debug key) — see [`android-twa/README.md`](android-twa/README.md).
>
> **Full-screen (verified) TWA — production path (Stage 33.9):** a build without a matching served
> `assetlinks.json` opens as a **Custom Tab** by design. To reach full-screen, follow the ordered runbook in
> [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) **§9**: custom domain (Render) → Google OAuth redirect/JS
> origins for the new origin → verify manifest/SW/login on it → signed AAB → **Play App-Signing SHA-256**
> (Play Console → App integrity → App signing; **not** the upload/debug key) → create + deploy the real
> `assetlinks.json` (copy the example locally, fill the SHA, deploy — **never commit it**) → verify with
> `curl`/`Invoke-WebRequest` and `adb shell pm get-app-links com.cardmajlis.app` (domain **verified**). A
> wrong/stale `assetlinks.json` can be **cached** — get the SHA right the first time.

> **iOS PWA (Stage 33.5 decision — PWA-only; no App Store app; [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md)
> §8).** The iOS meta already ships in `index.html` (apple-touch-icon, status-bar `black-translucent`,
> `apple-mobile-web-app-*`, `viewport-fit=cover`) and `pwaClient` detects `navigator.standalone`. On a
> real iPhone (Safari), smoke the installed PWA:
> - [ ] **iOS A2HS hint (Stage 33.6)** — in Safari on the **menu** (not installed), a non-intrusive
>       bottom card shows **"Install Card Majlis — Tap Share, then Add to Home Screen"** with a ✕. It is
>       **not** shown during a game, **not** shown once installed (standalone), and stays hidden after ✕
>       (persisted). No fake install button.
> - [ ] **Add to Home Screen** — Safari → Share → *Add to Home Screen*; the **Card Majlis** icon + title
>       appear; launching opens **standalone** (no Safari chrome), status bar legible over the emerald theme.
> - [ ] **Google sign-in** completes (Safari engine — OAuth not blocked).
> - [ ] **Online room** connects over `wss://…/ws`; **voice** join shows the iOS **mic** prompt (same-Wi-Fi
>       audio; TURN for cross-network).
> - [ ] **Invite** `…/?room=CODE` opens and joins in the PWA.
> - [ ] **Install card hidden** in standalone; the **"Update available"** pill still works.
> - [ ] **360/390 + Arabic RTL** — no horizontal overflow; safe-area insets respected (notch/home bar).
> - [ ] **Offline** — cached shell loads; live features degrade like in-browser.
>
> Deferred (no native work now): Apple **startup/splash** images and an iOS-only "Share → Add to Home
> Screen" hint are optional 33.6 polish. Any App Store wrapper is **33.8**, only after Android is validated.

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
      the alert hook only in `TurnTimerBar` (Stage 29.2); the removed decorative ids referenced nowhere
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
- [ ] **Timer now visible in ALL online games (Stage 29.2):** host an online **Durak / Deberc /
      Tarneeb / Preferans** game with a timer (30/60/90) → a **⏱ Ns** pill counts down each turn;
      with the timer **off** it does not appear. Local games still show no timer. The low-time alert
      still fires **only on your turn** (same rules as King above).
- [ ] **Timer lives in the social control cluster now (Stage 29.7):** the pill sits **just above the
      voice/emoji/chat buttons** (bottom-right corner), with a **larger clock icon + countdown**, and it
      **pulses** when low (colour-only under reduced-motion). Confirm on **360/390** it is **never over
      the table cards, hand, or bid/trump action bars** (`pointer-events:none` — a tap "through" it hits
      the control/card underneath). RTL: the cluster flips to the left edge, no horizontal overflow.

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
- [ ] **Lobby invite is visible (25.8/25.9):** in ANY game's Lobby (King/Durak/Deberc/Tarneeb) the
      **"👥 Invite friends"** block is **inside the lobby card, right after the players — visible
      without scrolling** (25.9 fix: it used to fall below the fold). States: **guest → "Sign in
      to invite friends"**, **loading → "Loading friends…"**, **API error → "Could not load
      friends" + Retry**, **no friends → "Add friends in Profile to invite them"**, otherwise
      online friends first with an **Invite** button (offline → disabled + hint). No overflow at
      360/390 or in RTL.
- [ ] **Invite (25.7):** A hosts an online room → A's Lobby Friends panel shows B with a clear
      **Invite** button (online) or a **disabled Invite** (offline, "friend is offline" hint). In
      the **menu** Friends tab a hint reads **"Create or join a room to invite friends."** Tap
      Invite → B gets an **"A invited you to a game · ABCD"** toast (**Join room** / Dismiss)
      whether B is **in a room OR on the menu**. Inviting an **offline** friend / a **non-friend**
      / **outside a room** shows a small inline notice (not the fatal error surface). Rapid invites
      are rate-limited.
- [ ] **Invite JOIN is actionable (Stage 26.1 — the core fix):**
      - **B on the menu** → tap **Join room** → B **actually joins A's lobby** (`ABCD`), not just a
        prefilled sheet. (If B has no name set, or a *different* saved resumable room, it falls back
        to the Join sheet prefilled — the explicit Resume-vs-Join choice.)
      - **B already in another room/game** → tap **Join room** → a **confirm** ("Leave your current
        room to join this invite?"); OK → B leaves and joins `ABCD`; Cancel → stays put.
      - **B already in room ABCD** (same room) → **Join room** just **dismisses** the toast.
      - **Dismiss** always clears the toast; **`?room=ABCD` deep-link** still prefills the Join sheet.
      - Join failures surface the normal errors (room not found / full / in-game / bad password).
- [ ] **Guest / privacy:** a guest sees the sign-in CTA only; no request/invite/presence payload
      contains an email, token, or session; the invite works only between accepted online friends.
- [ ] **Mobile 360/390 + RTL (Arabic):** the Friends tab (chips + badges + invite), the request
      badges, and the invite toast don't overflow and the toast never covers the hand/actions.

## Manual — Online rematch / Play again (Stage 25.9)

> After an online game FINISHES, "Play again" restarts the SAME game in the SAME room — it no
> longer leaves to the menu. No Postgres needed for the flow itself.

- [ ] **One human + bots:** host an online room, add bots, play to the finish. The finish screen
      shows **🔁 Play again** → tap it → the **same game restarts in the same room** (same
      players/seats/settings) — you are **not** sent to the menu. Works for King, Durak, Deberc,
      Tarneeb.
- [ ] **Two humans:** two clients (A + B) in one room, play to the finish. A taps **Play again**
      → A shows **"Starting…/Waiting"** and **B sees "A wants a rematch"** + its own Play again.
      The game restarts **only after BOTH** tap Play again (no auto-start). **Cancel** (on the
      ready client) clears readiness. If one client **leaves**, the pending rematch updates/cancels
      and never starts without consent.
- [ ] **Back to menu still works** on the finish screen (a secondary button), and after a rematch
      the new game plays normally; the previous game's stats are **not** duplicated (a fresh game
      records its own finish only, human-vs-human).
- [ ] **Privacy:** DevTools → the `REMATCH_*` frames carry only ready **clientIds** + a count —
      **no email/token/session**. Mobile 360/390: the finish actions don't overflow.

## Manual — Card reliability + trick pacing (Stage 25.8, any game, no Postgres)

> Both are display-only fixes — no rules/scoring change. Run a quick local game of each.

- [ ] **No blank cards:** play a hand of each game; every visible card shows either its **artwork**
      or, if the image is slow/broken, its **rank + suit text** — **never a blank rectangle**. To
      force the fallback: DevTools → Network → block `*/cards/*` (or throttle) and re-deal — faces
      render as text, not blank. Hidden cards still show the patterned back (or CSS back on error).
- [ ] **Trick/last-card reveal delay (~2 s, Stage 27.0 normalized):** the final card of a completed
      trick/bout stays readable ~**2 seconds** before play moves on, in **every** game (King / Deberc
      server pause, Tarneeb / Preferans review — **now online too**, Durak table-linger). Playing a
      new card immediately cancels a linger (no stall).
- [ ] **Lead-card badge (Stage 27.0):** in a trick game (Tarneeb / Deberc / Preferans) the card that
      **led** the current trick shows a small **"1" corner badge + gold ring**; it's always clear
      who led. No overflow at 360/390.

## Manual — Menu sections + sender-anchored reactions (Stage 27.1)

- [ ] **Profile sections:** open **Profile** → you see a **grid of sections** (Account / Friends /
      Statistics / Achievements / Leaderboards), each a tile with an icon + subtitle — **not** a
      crowded/truncated tab row. Tapping a tile opens that section with a **"← Sections"** back
      button; Statistics/Leaderboards still have the per-game sub-selector, Achievements still
      toasts new badges. With a pending friend request, the **red badge** shows on the **Friends**
      tile. No overflow at 360/390; RTL-safe.
- [ ] **Reactions over the sender (in-game):** in an online game, send an emoji/sticker → it floats
      **above your own seat** (bottom). A reaction from another player (or a bot) floats near
      **their** seat (top/left/right), **not** at the centre, and never covers the hand/trick.
      A spectator's reaction (or the lobby, where seats aren't laid out) stays **centred**.
      Multiple reactions don't break the layout (they clear on the ~2.6 s TTL).

## Manual — Game rules corrections (Stage 27.0)

> Rule changes are enforced in the pure reducer, so online play validates identically.

- [ ] **Tarneeb minimum bid = 3:** in the bidding sheet the buttons now start at **3** (3–13). A bid
      of 3 is accepted; 2 is not offered. Bots still open at 7+ (they won't bid a low contract).
- [ ] **Tarneeb team-tricks review (Stage 27.3):** in a Tarneeb game the top bar shows a **"🃏 N"**
      button (N = your team's tricks). Tap it → a modal lists every trick **your side** has taken
      this hand — trick number, winner, the 4 cards in play order with the **lead card badged**;
      opponents show as a **count** only. Before any trick it reads **"No tricks yet."** Works while
      **playing** and at **hand-complete**, local + online; no overflow at 360/390; no opponent hand
      is ever revealed (only already-played public cards).
- [ ] **Tarneeb trump obligation:** when you are **void in the led suit** but **hold a trump**, only
      your **trump(s)** are playable (a non-trump discard is rejected/greyed). If you hold a card of
      the led suit you must still **follow suit** (not trump). Void in both → any card is legal. This
      holds **online** too (the server rejects an illegal discard).
- [ ] **Deberc "Палтіна":** the 50-point run is labelled **"Палтіна" / "Paltina"** (not "Платіна")
      in the meld picker, stats, and rules — in all four languages.
- [ ] **Deberc skip-meld is red:** on the meld-declaration step the **skip** button is red
      (destructive); the table cards are **readable but not oversized** (trimmed ~10% in Stage 30.16).
- [ ] **Deberc trump exchange (Stage 27.2, restricted in 30.16):** in a Deberc hand, if you hold the
      **lowest trump** (**7** in 3-player, **6** in 4-player), on your **declaring turn** a **"🔄 Swap
      low trump"** button appears; tapping it puts the **face-up table trump into your hand** and leaves
      your low trump as the new table trump (your hand keeps the same number of cards). A public note
      **"X swapped the low trump"** shows; opponents never see your other cards. The button appears
      **only** for the eligible holder, **once** per hand, **only before the first card** is played,
      and (Stage 30.16) **only when the exposed table card is a real trump AND your low trump was
      dealt to hand** (not drawn from the прикуп). Skipping (declare / play) still works. Bots do the
      swap automatically when eligible. Works local + online; no overflow at 360/390.

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
covered. Note: a floating chip anchors **over the sender's seat** (Stage 27.1; Tarneeb's
mirrored layout corrected in 29.5) and may briefly overlap that seat / the lobby title —
transient (~2.6 s), opaque, and by design never over the hand/trick.

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
