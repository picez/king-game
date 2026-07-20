# Changelog

All notable, user-facing changes to **Card Majlis**. This is a concise release
snapshot, not the full stage-by-stage history (see the git log for that).

The format loosely follows [Keep a Changelog](https://keepachangelog.com/); the
project uses [Semantic Versioning](https://semver.org/). The running version is
also reported at `GET /health/diagnostics` (`version` field).

## [Unreleased]

### Docs

- **Mobile app strategy designed (Stage 33.0, design-only).** Added
  [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) — an audit of four paths to Android/iOS apps and a
  recommendation: **Android-first via a Trusted Web Activity** wrapping the production PWA (the Chrome
  engine keeps Google login, cookies and voice behaving exactly as on the web), with **iOS staying a PWA**
  until a later decision. Includes a feature-compatibility matrix, security/privacy + store-disclosure
  notes, store prerequisites, a technical-readiness checklist, and a staged rollout (33.1–33.5). No
  runtime change, no native project, no dependency.

## [0.4.1] — 2026-07-20 — Achievements expansion

### Added

- **More achievements (Stage 32.1).** The Profile **Achievements** grid grows from **14 to 29** badges —
  every game that lacked a basic "won a game" badge now has one (**Deberc / Tarneeb / Preferans / 51**),
  plus play-count and win-count depth badges, a **Sharp Bidder** skill badge (70% Tarneeb contract
  success over a real sample), and two global milestones (**Six-Game Regular** — play every game; and
  **Champion's Circle** — 25 total wins). A new **Uncommon** rarity tier joins Common/Rare/Epic. Every
  badge is still **derived purely from your existing stats** — no DB migration, no new tracking, no
  server push, and All-Rounder is unchanged (still a win in all six games). English, Ukrainian, German
  and Arabic. Designed in [`ACHIEVEMENTS_PLAN.md`](ACHIEVEMENTS_PLAN.md) (Stage 32.0).

## [0.4.0] — 2026-07-20 — Tutorials and final rule polish

> A minor release: the headline is **Tutorials for all six games** (Stages 31.1–31.2). It rides on the
> **v0.3.9** rule polish it builds on — the **51 configurable elimination score (210/310/410/510)** and
> the **Deberc rule corrections** (restricted trump exchange, length-first Палтіна, бела-declared-on-play,
> −10% table cards) — see the **[0.3.9]** notes below for that detail.

### Added

- **Tutorials — learn a game in 2 minutes (Stages 31.1–31.2).** A new **🎓 Tutorials** item on the main
  menu opens a hub listing all six games — and **all six** (King, Durak, Deberc, Tarneeb, Preferans,
  51) have a full **step-by-step tutorial**: a short, guided walk-through with a little demo table,
  highlighted cards, and plain-language captions (Back / Next / Skip, or ← / → / Esc). Each is under two
  minutes and needs **no account and no internet** — nothing you do in a tutorial affects your stats or a
  real game. Available in English, Ukrainian, German and Arabic. No DB migration, no dependency.

## [0.3.9] — 2026-07-20 — Hand drag, 51 polish, and Deberc rule fixes

### Changed

- **Deberc rule corrections (Stage 30.16).** Three owner rule fixes, plus smaller table cards:
  - **Trump exchange is restricted.** You can only swap your low trump (7 for 3p, 6 for 4p) for the
    face-up card when that exposed card is itself of the **trump suit**, and only if your low trump was
    in your **originally dealt hand** — a low trump you picked up in the прикуп (talon) can no longer be
    exchanged.
  - **Палтіна ranks by length first.** A **longer** run now beats a shorter one regardless of top card
    (a 5-card палтіна beats any 4-card палтіна); equal-length runs still compare by high card.
  - **Бела is declared when you play it, not at the start.** Instead of announcing бела up front, you
    now **declare it as you play a trump K or Q** (a "Declare Bela" toggle), and it scores **20 only if
    you win that trick**. Playing the honor without declaring, or declaring but losing the trick, scores
    nothing.
  - **Table cards are ~10% smaller** in Deberc so the played trick sits more comfortably; the trump and
    stock pile are unchanged.

### Added

- **51: choose how long a match runs (Stage 30.15).** When you set up a 51 game — local or as an
  online host — you can now pick the **elimination score**: **210 / 310 / 410 / 510**, with **510**
  still the default. A player is knocked out once their running penalty reaches the chosen score, so a
  lower value makes for a shorter match. The pick shows in the online lobby (`☠ 310`) and carries over
  when you play again. Nothing else about scoring changes, and existing rooms keep the classic 510. No
  DB migration, no dependency.
- **51: take a joker back off the table (Stage 30.14).** Once you've opened, if a meld on the table
  uses a **joker** and you hold the exact card it stands in for, you can swap them: press
  **"🃏 Replace joker"** on that meld to put your real card in and take the **joker into your hand**.
  It works on anyone's meld — your `J♥` replaces a joker standing in as `J♥`, and the joker is then
  yours to use in a meld of your own (or costs the usual 25 if you're still holding it at the end).
  The card has to match **exactly** — same rank *and* suit. Players who haven't opened can't do this,
  and you still go out on your final discard. No DB migration, no dependency.

### Changed

- **51: meld cards on the table are bigger and never overlap (Stage 30.14).** The cards in melds are
  larger and fully readable, with **Add** and **Replace joker** moved to their own row **under** the
  cards instead of sitting over them; long melds scroll inside their own block, so nothing spills off
  the screen at 360/390.
- **51: "How to play" now explains scoring and melds (Stage 30.14).** The help sheet gained **Card
  values** and **Melds** sections — what each card is worth (2–10 face value, J/Q/K 10, A 10 but
  `A-2-3` = 6, joker 25 in your hand), which combinations are legal (`A-2-3`, `Q-K-A`, why `K-A-2`
  isn't, sets without a repeated suit, one joker per meld) — plus the discard-to-open exception and
  the new joker replacement rule. Available in English, Ukrainian, German and Arabic.

- **51: take the discard only to open, and clearer melds (Stage 30.13).** In 51 you may now pick up
  the **top of the discard pile before you've opened — but only if you open with it that turn** (the
  card must be part of your 51+ opening melds); you can't just scoop it into your hand. Tap the discard
  top (it lights up), add your hand cards, and press **"Take & open 51"**. Once you've opened, taking
  the discard works as before. Bots use this too. The cards in melds on the table are also **bigger and
  clearer**, with no overlapping. No DB migration, no dependency; no change to scoring, penalties,
  elimination, or going out by the final discard.

### Added

- **Drag your hand into any order (Stage 30.12).** In every game you can now **drag a card** within
  your hand — touch, mouse or pen — to arrange it however you like; a quick tap still plays or selects
  the card. Once you've reordered, a **newly drawn card lands on the left** so it's easy to spot, and a
  **↺ Auto-sort** button snaps back to the default. The hand tray is roomier and easier to grab on a
  phone. It's purely how *you* see your hand — it never changes the cards, the rules, or what your
  opponents see (nothing is sent to the server). In **51**, the selected cards show as an ordered
  **meld builder** with the joker's stand-in card, so you can place a **joker exactly where you want**
  in a run (`[🃏, 8♠, 9♠]` = 7-8-9 vs `[8♠, 9♠, 🃏]` = 8-9-10) and still keep your last card to go out
  on the final discard.
- **Partnerships show your names (Stage 30.12).** In **Tarneeb** and **Deberc** Pairs the two teams
  now read like **"Alex & Dina"** vs **"Niko & Yara"** — in the lobby, the in-game standings, and the
  finished screen — instead of an abstract "Team A/B" (with a graceful "Team Alex" fallback while a
  seat is still empty). Solo modes keep showing individual names. Labels only — no scoring change.
  No DB migration, no dependency, no protocol change.

## [0.3.8] — 2026-07-14 — 51 meld and opening rule fixes

A 51-focused patch on **v0.3.7**. Two owner rule corrections to Syrian 51 — jokers may sit
anywhere in a meld, the 51 opening total is required only once per round, and Ace-low runs
extend so an Ace lays off onto a `2-3-4` — plus a fix so public-meld cards no longer overlap
or clip on phones. Fixes only; no new features, no schema/dependency change; the six-game
release state is intact.

### Changed

- **51 (Syrian 51) meld & opening rules corrected (Stage 30.9).** Two fixes, in the shared pure
  core so **local and online behave identically**: (1) a **joker can now sit anywhere in a meld** —
  the start, the middle, or the end of a run (the card it stands for is fixed by where you place it,
  so `7♠ 8♠ 🃏` = 7-8-9, `🃏 8♠ 9♠` = 7-8-9, `Q♠ K♠ 🃏` = Q-K-A, `🃏 2♠ 3♠` = A-2-3; illegal wraps
  like `K-A-🃏` are still rejected). (2) The **51 opening total is required only once per round** —
  once you have opened, you can lay **new melds of any value**, keep laying off, and take the discard
  top; you never have to reach 51 again. The table button now reads **"Lay meld"** after you have
  opened (it says **"Open (n/51)"** only while you still need to open), with clearer hints. Bots also
  lay new melds after opening. No rules changed beyond these two; no DB migration or new dependency.
- **51 (Syrian 51) Ace-low lay-off + meld card layout fixed (Stage 30.10).** An **Ace now extends a
  low run** — a `2-3-4` on the table accepts an Ace to become `A-2-3-4` (and an `A-2-3` accepts a
  `4`); `K-A-2` and adding a King to `A-2-3` stay invalid. Ace-low runs display Ace-first
  (`A-2-3-4`). And the **public-meld cards no longer overlap or get clipped** — each meld's cards lay
  out in a clean, readable row (full card faces, clear gaps, scrolls within the meld if long) with no
  horizontal overflow on 360/390 phones. No DB migration, dependency or other rule change.

## [0.3.7] — 2026-07-14 — Syrian 51 sixth-game release

The **6th game — 51 (Syrian 51)** graduated from experimental to a fully released
`available` member (Stage 30.7), and a six-game release audit (Stage 30.8) closed the
remaining "five games" drift and hardened the platform guards. Card Majlis is now a
**six-game** lounge (King, Durak, Deberc, Tarneeb, Preferans, 51). 51 is playable local +
server-authoritative online, records its own score-only stats + leaderboard under
`game_type='fifty-one'`, can be set as your favorite game, and earns a **"51 Winner"**
achievement that also counts toward **All-Rounder** (now a win in all six games); it ships
its own game emblem and finish-screen frame. No DB migration, no new dependency, no rule
change; the other five games are unchanged.

### Added

- **51 (Syrian 51) is released as the 6th game (Stage 30.7).** 51 is now a first-class member of
  the platform, no longer "Experimental": it appears in the **Local and Host pickers** without the
  Experimental tag, can be set as your **favorite game**, records **stats + a leaderboard** (win
  rate, avg/best penalty, eliminations), and earns a **"51 Winner"** achievement — which also counts
  toward **All-Rounder** (now a win in all six games). It ships its own game emblem (two fanned
  cards). Card Majlis is now a **six-game** lounge (King, Durak, Deberc, Tarneeb, Preferans, 51).
  No DB migration, no new dependency, no rule change; the other five games are unchanged.
- **51 (Syrian 51) is now playable ONLINE (Stage 30.5, experimental).** The 6th game can now be
  **hosted online** from the Host picker (flagged "Experimental"), not just locally: create a
  2–4-seat room, add bots or invite friends, and play server-authoritative 51 with the same table
  UI. The server owns the deal, turn order, bot moves and the between-rounds advance; each player
  sees only their own hand (opponents + the draw pile stay hidden); "Play again" and reconnect work
  like the other online games. **Still experimental — no stats, leaderboard, achievements or
  favorite yet** (those arrive with the full release). No new dependency, DB migration or protocol
  change; the five released games are unchanged.
- **51 (Syrian 51) is now playable locally (Stage 30.3, experimental).** The planned 6th game
  can be played **pass-free local** (1 human + bots, 2–4 players) from the **Local** game picker
  (flagged "Experimental"); the **Host/online** picker still shows it disabled. New `src/ui/fiftyOne/`
  — a setup screen (player count + deck rule), a table (running-penalty scoreboard, draw/discard
  piles, public melds showing each joker's represented value, own hand) and a context action bar
  (draw / take discard / stage + open melds ≥ 51 / add to a meld / discard). Meld validation reuses
  the pure core (Stage 30.1); jokers use the core's clear-card inference (ambiguous → rejected in
  the UI). i18n for **en/uk/de/ar**. **No online, stats, favorite or DB** — those come in 30.4+;
  the five released games are unchanged, no new dependency.

### Internal

- **Six-game release audit + guard hardening (Stage 30.8, no user-facing change).** Swept the
  codebase + docs for stale "five games / 5 games" and "51 is experimental / coming soon"
  references and corrected the canonical current-state ones (online architecture, render/QA/smoke
  checklists, visual direction, type-union + hook comments) while leaving dated stage records as
  history. Hardened the platform guard so it asserts **exactly six available games**, each with
  local + online + bots + stats + favorite coverage + **a game-scoped achievement** + a PNG icon
  under 150 KB, and that **All-Rounder spans exactly the available set** (dropping any one game
  unearns it). Gave 51's finish screen the shared ornamental **finish frame** the other five games
  wear, and added a source guard that the Profile achievements loader fetches 51 stats. No behaviour
  change to the five games; no DB migration, no dependency, no rule change.
- **51 (Syrian 51) stats + leaderboard foundation (Stage 30.6, experimental).** Finished ONLINE
  51 games now record **score-only** stats under `game_type='fifty-one'` — per-seat final running
  penalty, eliminated flag and the match winner, aggregated into a per-user cache (games, wins,
  win rate, average/best penalty, eliminations, rounds) with a public leaderboard. Added a **51
  stats + leaderboard sub-tab** to the Profile screen (i18n en/uk/de/ar). Stats are human-vs-human
  only (bots/guests skipped), idempotent per game, and store **no cards / hands / draw pile /
  melds**. **No DB migration** (reuses the free-text `game_type` column) and **no new dependency**.
  51 stays **experimental** — it is deliberately **excluded from favorites and from achievements /
  All-Rounder** (a guard test enforces this) until the full release (Stage 30.7). The five released
  games' stats and achievements are unchanged.
- **51 (Syrian 51) online redaction / readiness hardened (Stage 30.4, no user-facing change).**
  Proved the 51 `GameDefinition` is server-authoritative-ready **without enabling online** —
  `supportsOnline` stays `false`, so `CREATE_ROOM` still rejects a 51 room and `GET /api/games`
  still lists it as local-experimental. `serverCore` now drives 51 through the same generic path
  as the released games: `startGame`, generic turn-ownership authorization (foreign-seat →
  `NOT_YOUR_TURN`, illegal move → `ILLEGAL_ACTION` reducer no-op), `applyBotTurn`/
  `applyTimeoutAction`, and a seeded `autoAdvance`/`publicScreenOf` branch for the public
  `round_complete → START_NEXT_ROUND` redeal. Added `FiftyOneState`/`FiftyOneAction` to the
  `AnyGameState`/`AnyGameAction` type unions and an **optional `deal` seed on
  `applyActionRequest`** (off by default — the released games' WS path is byte-identical) so 51's
  mid-turn reshuffle stays reproducible. **Redaction hardened** with a JSON-payload leak scan
  (no opponent hand / draw-pile card ever reaches the wrong viewer; draw pile hidden with count
  kept; discard / melds+joker value / scores / opened / eliminated / turn public; spectator sees
  nothing) and a persistence round-trip test. **No online release, no stats, no DB migration, no
  protocol/message or dependency change; the five released games are untouched.**
- **51 (Syrian 51) registered as "coming soon" (Stage 30.2).** Wired the Stage-30.1 pure core
  into the platform as a `coming_soon` game (id **`fifty-one`**): added the `GAME_CATALOG` entry
  (`supportsLocal/Online:false`, `supportsBots:true`, 2–4 players, `rulesDoc:'51_RULES.md'`) and
  registered `fiftyOneGameDefinition` (`recordsStats:false`). It now surfaces in `GET /api/games`
  and the Local/Host game pickers as **"Coming soon" (disabled)** — the existing gates keep it
  non-startable (CREATE_ROOM rejects `!supportsOnline`; picker greys out `!usable`), and it is
  **excluded from favorites and per-game stats tabs**. Added `gameType.fifty-one` + quick-rules
  `help.fifty-one.*` i18n in **en/uk/de/ar** and a 🀄 emoji emblem (no PNG asset). **No new
  dependency, DB migration or stats; the five released games are unchanged.**
- **51 (Syrian 51) pure core (Stage 30.1, no user-facing change).** Added `src/games/fiftyOne/`
  — the pure TypeScript reducer for the planned 6th game: `types`, `deck` (1-deck+2J for 2p /
  2-deck+2J for 3–4p), `melds` (run/set validator with `A-2-3`=6, `Q-K-A`=30, reject `K-A-2`,
  ≤ 1 joker/meld, no duplicate identical card in a set), `rules`, `engine` (draw→meld→discard
  turns, 51-opening from own melds, open-gated discard-take + lay-off, empty-hand win,
  per-round penalties incl. Joker=25 and never-opened=100, elimination at 510,
  continue-until-one-remains, draw-pile reshuffle), a deterministic greedy `ai`, server-side
  `redact` (own hand + draw-pile order hidden), and `invariants` — with **70 unit tests**. **Not
  wired into any catalog/registry, UI, server/ws, stats or migration** — 51 is still invisible
  in the app; the five released games are untouched. No dependency or schema change.

### Docs

- **51 (Syrian 51) rules spec + implementation plan (Stage 30.0, docs-only).** Added
  [`51_RULES.md`](51_RULES.md) (MVP rules, reconciling the owner's Syrian 51 source with
  authoritative house-rule corrections; 10 open confirmations recorded) and
  [`51_PLAN.md`](51_PLAN.md) (staged rollout 30.1 core → 30.7 release, `src/games/fiftyOne/`,
  redaction/bot/stats guidance). Marked 51 as the **planned 6th game** in `MVP_STATUS.md` /
  `PROJECT_OVERVIEW.md` and added a `QA_CHECKLIST.md` placeholder. **No runtime code, catalog,
  UI, stats, dependency or schema change** — the five released games are untouched.

## [0.3.6] — 2026-07-14 — Tarneeb target score and compact table

A Tarneeb-focused patch on **v0.3.5**. The match **target score is now host-configurable** (presets
31/41/61/101, default 41, for Pairs and Solo), the in-game **ranked score table is compact and
centered**, the per-turn **timer now rides in the social control cluster** (not over the table), and
the Tarneeb HUD is the **ranked score table** introduced across 29.7. **No rules/scoring change, no DB
migration** (0009 stays the latest), **no dependency changes**; the one new online field
(`tarneebTargetScore`) is optional and backward-compatible. `/health/diagnostics` `version` reads
`0.3.6`.

### Added

- **Tarneeb match target is now host-configurable (Stage 29.8, owner).** When creating a Tarneeb
  room (online Host sheet) or a local Tarneeb game, you now choose how many points win the match —
  presets **31 / 41 / 61 / 101**, for **both Pairs and Solo**. The default stays **41**, so existing
  and legacy rooms are unchanged. The value is validated/clamped server-side (safe integer 21–201;
  invalid/missing → 41), flows through the whole online path (create → room → snapshot → start), is
  preserved across rematch and server restart, and the lobby shows it (e.g. `Solo · 🎯 61`). **Per-hand
  scoring is unchanged — only the finish threshold moves.** No DB migration, no protocol break
  (a new optional field), no new achievements.

### Changed

- **Tarneeb score table made compact and centered (Stage 29.8, owner).** The ranked standings table
  from 29.7 stretched the full board width; it is now capped to a small max-width, centered, and
  wrapped in a subtle card — easier to read on 360/390 with no horizontal overflow. Content/behaviour
  unchanged.
- **Per-turn timer moved into the social control cluster (Stage 29.7, owner).** After 29.5 put the
  online timer at the bottom of the table it could still sit over the cards/bidding bars. It now rides
  **inside the bottom-right RoomSocial cluster**, next to the voice/emoji/chat buttons — a compact pill
  with an enlarged clock that can never cover the hand, table, or action bars (`pointer-events:none`).
  Same gating: shown only when the host set a timer, low-time sound **only on your turn**, and it works
  for every online game that got the timer in 29.2. King keeps its in-banner timer.
- **Tarneeb HUD is now a ranked score table (Stage 29.7, owner).** The solo chip strip and the Pairs
  Us/Them boards are replaced by a compact, high-contrast **table sorted by total score (descending)**:
  columns are place, player/team, the **bidder ▶ + bid amount** (declarer once the auction resolves,
  else the current high bidder), **🃏 tricks this hand**, and **★ total score**. It highlights your
  row, the acting row, the bidder, and the leader (crown only once someone is ahead). **Solo** lists
  the 4 players by name (no Team A/B); **Pairs** lists the two teams as Us/Them and keeps its team-tricks
  viewer. Sorting keys off total score only (which changes at hand end), so there is no mid-trick
  jitter. Display-only — reads the existing public ledgers, never recomputes scoring or shows hidden
  hands; no rules/scoring/protocol/DB change.

## [0.3.5] — 2026-07-14 — Table HUD and reactions polish

A display-only polish patch on **v0.3.4**. Floating reactions/stickers now anchor over the sender's
**actual** seat in **Tarneeb** (whose on-screen seats are mirrored), the per-turn online timer moves
to a **bottom-of-table HUD** pill with a larger clock, and the in-game **score/tricks readouts** for
Tarneeb (Solo + Pairs) and Deberc are easier to read. **No rules/scoring change, no DB migration**
(0009 stays the latest), **no dependency changes, no protocol/payload change**. `/health/diagnostics`
`version` reads `0.3.5`.

### Fixed

- **Reactions/stickers now float over the sender's ACTUAL seat in Tarneeb (Stage 29.5, owner).** The
  floating-reaction anchor assumed every table seats players clockwise with `rel = fromSeat − mySeat`,
  but Tarneeb deliberately **mirrors** its seats on screen (its engine order is counter-clockwise by
  index, so the UI flips it to read clockwise). The sender always anchors to the bottom, so the sender
  never noticed — but every *other* viewer saw the chip on the wrong side of the table. The anchor now
  takes a `mirrored` flag (true only for Tarneeb, both Pairs and Solo) that flips the convention to
  match the screen. No protocol/payload change: it still uses the existing public `seatIndex` and the
  send is still emoji-only (the server stamps the seat).

### Changed

- **Per-turn timer moved to a bottom-of-table HUD pill with a bigger clock (Stage 29.5, owner).** The
  online timer that arrived in every game in 29.2 was a small top-centre overlay; it now sits at the
  **bottom of the table**, above the hand, with a larger clock icon and countdown, and pulses when
  time is low (respecting reduced-motion). Same gating: shows only when the host enabled a timer, and
  the low-time sound still fires **only on your turn**.
- **Current score/tricks HUD made more readable (Stage 29.5, owner).** Tarneeb **Solo** standings now
  stack a name row over a bold tricks·score row and **highlight the seat whose turn it is** (bright
  ring + ▶) alongside the my-seat and leader markers; the leader crown only appears once someone is
  actually ahead. Tarneeb **Pairs** Us/Them boards and **Deberc**'s match-score chips get larger,
  tabular score numbers and a coloured top edge so your side and the live trick count read at a
  glance. Display-only — no rules/scoring change; Solo shows no Team A/B labels, Pairs keeps them,
  and Deberc's 3p-Solo / 4p-Pairs labels are unchanged.

## [0.3.4] — 2026-07-14 — Durak reveal and online timer polish

A display-only polish patch on **v0.3.3**. Durak's trump/draw pile is enlarged and the **final
defended card now lingers ~2 s** so you can see what beat the last attack; the **per-turn timer is
now visible in every online game** (not just King) when the host enables it; and **Tarneeb Solo**
shows live per-player trick counts with a larger "review my tricks" button. **No rules/scoring
change, no DB migration** (0009 stays the latest), **no dependency changes**. `/health/diagnostics`
`version` reads `0.3.4`.

### Fixed

- **Durak trump/deck enlarged (Stage 29.2, owner).** The face-up trump + draw pile are ~22% larger
  and more readable, scoped to the Durak screen (Deberc's own deck sizing is untouched). CSS only.
- **Durak — the last defended card is now visible (Stage 29.2, owner).** A bout resolves in the same
  reducer action that places the final defence, so the table used to clear before you could see the
  card that beat the last attack. The engine now captures the resolved pairs into a display-only
  `lastBout` snapshot the instant the table clears, and the felt lingers on it for ~2 s (the existing
  review hold now shows the *final* beaten pairs, not the pre-defence table). No rules/scoring change;
  `lastBout` holds only public table cards.
- **Per-turn timer now visible in EVERY online game (Stage 29.2, owner).** The countdown was wired
  into King only; Durak/Deberc/Tarneeb/Preferans applied the server timeout but showed nothing. A
  shared, game-agnostic `TurnTimerBar` (extracted from King's `TurnTimer`) is now mounted for all
  online games as a top-centre overlay, computing the acting player via the `GameDefinition`. It
  shows only when the host set 30/60/90; the low-time sound alert still fires **only on your turn**.
- **Tarneeb Solo — live per-player trick counts + a bigger tricks button (Stage 29.2, owner).** The
  solo standings strip now shows each of the 4 players' current trick count (🃏 N) during play and
  between hands, and the "review my tricks" control moves from a tiny topbar badge to a larger,
  dedicated button under the standings (easier to reach on mobile). Pairs keeps its compact topbar
  team-tricks badge; no Team A/B labels appear in Solo.

## [0.3.3] — 2026-07-13 — Tarneeb scoring correction

A small correctness patch on **v0.3.2**. Aligns **Tarneeb Solo** contract scoring with **Pairs**
(exact make → bid×2, overtrick → tricks actually won, failure unchanged) per the owner's
clarification, and resizes the **Deberc** table (smaller played trick cards, ~20% larger
trump/stock). **No DB migration** (0009 stays the latest), **no dependency changes**, no bid-range
or trump-obligation change. `/health/diagnostics` `version` reads `0.3.3`.

### Fixed

- **Tarneeb Solo scoring — exact-bid double + overtricks (Stage 29.0, owner clarification).** Tarneeb
  **Solo** now scores a made contract like **Pairs** (§8): an **exact** make scores **bid×2** (e.g.
  bid 7 → +14) and an **overtrick** scores the **tricks actually won** (e.g. bid 7, 10 tricks → +10),
  instead of the earlier flat "+bid on any make". The **failure** model is unchanged (declarer −bid;
  each defender banks its own tricks). Pairs scoring was already correct — this only corrects Solo, so
  both modes now match. The solo hand-complete panel shows the "✨ exact bid double" note. Bid range
  (3–13) and trump obligation are untouched; no stats-schema/DB/dependency change (per-seat deltas
  flow through the existing `scoresBySeat`).
- **Deberc table card sizing (Stage 29.0, owner).** On the Deberc table the **played trick cards are
  slightly smaller** (×1.35 → ×1.15) and the **face-up trump + stock deck are ~20% larger**
  (`scale(0.85)` → `scale(1.02)`), so the trump/deck no longer looks dwarfed by the trick. CSS-only —
  no gameplay/engine change; mobile 360/390 stays overflow-safe.

## [0.3.2] — 2026-07-13 — Tarneeb Solo release & bandwidth hardening

A feature + hardening patch on **v0.3.1**. Headline: **Tarneeb now ships two released modes —
Pairs (2×2, default) and Solo (4-player cutthroat)** — playable local + online, with a separate
Solo stats/leaderboard (`game_type='tarneeb-solo'`) and one achievement. Also: a **static-bandwidth
cut** (proper Cache-Control + ETag/304 + gzip) that fixes the Render HTTP-egress overage, a
static-routing correctness fix (missing file-like paths now 404 instead of the app shell), and
**Deberc's Solo/Pairs modes made explicit + playable online**. **No DB migration** (0009 stays the
latest), **no dependency changes**, no gameplay-rule changes to Tarneeb Pairs / Deberc scoring.
`/health/diagnostics` `version` reads `0.3.2`.

### Added

- **Tarneeb Soloist achievement (Stage 28.6).** One new common badge — **"Tarneeb Soloist"** 🗡️ —
  unlocked by winning a Tarneeb **Solo** (cutthroat) match. It reads a **separate** solo stats
  dimension (`game_type='tarneeb-solo'`) that the profile loads independently, so it never mixes
  with the Pairs Tarneeb badges and is **not** required for **All-Rounder** (which still needs a win
  in every canonical game — Solo excluded). Purely derived from public stats (no server push, no
  card data); the "new badge" toast + seen ledger work with the new id **without migration**.
  No gameplay/rules/protocol/DB/dependency change; Pairs achievements + aggregates unchanged.
- **Tarneeb Solo — full release: local + online + stats (Stage 28.4).** The 4-player cutthroat
  (every-player-for-self) mode is now a **released** Tarneeb mode alongside Pairs (still the
  default). The online **Host** sheet has a Pairs/Solo picker; a `tarneebVariant` flows through
  `CREATE_ROOM` → the room → snapshots → `buildTarneebStartAction` (mirroring Durak's variant), and
  is persisted/restored (legacy rooms & clients read Pairs). The lobby shows the mode and renders
  **individual seats for Solo** (no Team A/B grid); rematch preserves the mode; the online table /
  finished screens use the same solo-aware UI as local. **Stats + a leaderboard** record solo under
  a **separate `game_type='tarneeb-solo'`** with a Pairs/Solo toggle in the profile — **no DB
  migration**, and the released Pairs aggregates (`game_type='tarneeb'`) are byte-for-byte
  untouched. Backward compatible; no new dependency; Solo achievements deferred (post-MVP).
  See `TARNEEB_RULES.md` §17 / `TARNEEB_SOLO_PLAN.md`.
- **Tarneeb Solo — local playable prototype (Stage 28.3).** The Tarneeb **local** setup now has a
  **Pairs / Solo** mode picker (default **Pairs**, so the released game is unchanged). Choosing
  **Solo** starts a 4-player cutthroat table (1 human + 3 bots) on the Stage 28.1 pure core: the
  scoreboard shows a **4-player standings strip** instead of Us/Them teams, the tricks viewer shows
  **your own** tricks, the between-hands panel is **per-seat**, and the finished screen names an
  **individual** winner. Trick play (follow-suit + trump obligation) is identical to Pairs. **Online
  Tarneeb stays Pairs-only** (the online host + lobby do not offer Solo) and Solo records **no
  stats/leaderboard/achievements** yet. No protocol/DB/dependency change; Pairs is byte-for-byte
  unchanged. See `TARNEEB_SOLO_PLAN.md` / `TARNEEB_RULES.md` §17.

### Fixed

- **Tarneeb Solo hardening (Stage 28.5 QA pass).** Two real drifts found after the 28.4 release,
  both fixed: (1) the **room browser** hard-coded "· 2 teams" for every Tarneeb room, mislabelling
  Solo rooms — it now shows the room's actual **Pairs / Solo** mode from `tarneebVariant` (which the
  room summary already carries); (2) the **profile achievements** derived from whatever the Tarneeb
  stats toggle last fetched, so viewing the **Solo** tab could feed solo data into achievements —
  Pairs stats are now the canonical achievements source and Solo has its own separate state, so the
  two never mix. Also: the game-picker subtitle for Tarneeb is now mode-neutral ("Pairs / Solo")
  instead of "2 teams". No rules/scoring/stats-schema change; Pairs and Deberc untouched.
- **Deberc Solo is now actually playable online (Stage 28.2).** Despite the Stage 28.0 labels,
  every hosted Deberc room was still forced to 4 seats (`server/wsHandlers.ts` hard-coded
  `playerCount = maxPlayers` and ignored the client's value), and the lobby drew the Team A/Team B
  2×2 grid for *any* Deberc room — so Solo was invisible in practice. Now: the online **Host** sheet
  has an explicit **Solo (3) / Pairs (4)** mode picker (defaulting to Solo); the server honors an
  in-range host `playerCount` (falling back to the catalog max, so other games and older clients are
  unchanged); and the lobby renders **individual seats + an "every player for themselves" hint** for
  3-seat Solo rooms while keeping the **Team A/B grid** for 4-seat Pairs. The seat cap and start
  gate now come from the room's own player count (Solo needs 3, Pairs needs 4). The Deberc score
  table / finished screen already showed per-player standings; the win celebration now reads as an
  individual win in Solo. **Engine, scoring, stats data model, and 4-player Pairs are unchanged; no
  protocol or DB change** (the `playerCount` field already existed on `CREATE_ROOM`).

### Added (foundation, not yet playable)

- **Tarneeb solo — pure core (Stage 28.1).** A `variant: 'pairs' | 'solo'` flag on `TarneebState`
  and `START_GAME`, **defaulting to `'pairs'`**, adds a 4-player cutthroat (every-player-for-self)
  game: per-seat scoring (declarer makes it → +bid, defenders +0; declarer fails → −bid, each
  defender +its own tricks; first to 41, ties are not a finish), a solo bot that assumes no partner,
  and variant-agnostic redaction. Trick legality (follow-suit + trump obligation) is the **same**
  `legalPlays` as pairs. **Not exposed anywhere yet** — no game picker entry, no online rooms, no
  stats, and the lobby/team UI is unchanged. Released Tarneeb **pairs** is byte-for-byte unaffected
  (a legacy state with no `variant` reads as pairs). Covered by `src/games/tarneeb/solo.test.ts`;
  the local-only playable prototype is the next stage. See `TARNEEB_SOLO_PLAN.md`.

### Fixed

- **Static file-like 404s + HEAD (Stage 28.1b).** A missing path with a file extension
  (`/cards/faces/AS.png`, `/assets/typo.js`) previously fell through to the SPA `index.html`, so it
  returned `200 text/html` instead of a real **404** — which masked broken/misnamed assets and made
  the bandwidth/cache smoke checks false positives. The static handler now 404s any missing
  *extension-bearing* path (`text/plain`, `no-store`) while extension-less routes (`/`, `/profile`,
  `/?room=CODE`) still fall back to the shell. `HEAD` requests now return the full headers
  (Content-Type, Cache-Control, ETag, Last-Modified, Content-Length) with **no body**. Card faces
  are `{suit}-{rank}.png` lower-cased (`spades-a.png`), documented with real example URLs.

### Performance

- **Static bandwidth cut (Stage 28.1).** The server previously sent every non-hashed static
  asset — the ~10 MB of card-face art, the menu hero, felt, icons, sounds, stickers — with
  `no-cache` **and no validator**, so a browser re-downloaded all of it on *every* visit (the main
  driver of Render HTTP egress). Now `server/httpStatic.ts` uses three Cache-Control tiers: hashed
  `/assets/*` stay `immutable`; static media is `public, max-age=604800` (a week, then a cheap
  ETag **304**); the app shell (`index.html`/`sw.js`/`manifest`) stays `no-cache`. Every response
  also carries an **ETag + Last-Modified** (conditional `If-None-Match` → 304, empty body), text is
  **gzip**'d on the fly, and previously-missing MIME types (`.webp`/`.webm`/`.mp3`/`.gif`/`.jpg`)
  are now correct instead of `application/octet-stream`. **No gameplay, protocol, or dependency
  change.** Trade-off documented in `RENDER_DEPLOY.md`: an in-place asset swap can take up to a
  week to reach clients (rename or bump the SW cache version to force it).

### Changed

- **Deberc — explicit Solo / Pairs modes (Stage 28.0).** The seat count has always *been* the
  mode (3 = every-player-for-self, 4 = fixed 2×2 pairs); now the setup and lobby **name it**.
  Local setup shows **"Solo · 3 players"** and **"Pairs · 4 players"** mode cards instead of bare
  3/4 tabs, and the online lobby game-line reads **"· Solo"** or **"· Pairs"** from the room's
  seat count. **No engine, scoring, or stats change** — label only.

### Added (foundation, not yet playable)

- **Tarneeb solo — implementation-ready spec.** [`TARNEEB_SOLO_PLAN.md`](TARNEEB_SOLO_PLAN.md)
  fixes the design for a future **4-player cutthroat** solo variant (Variant B), including the
  individual scoring model (declarer ±bid; set defenders earn defensive credit by their own
  tricks). A `soloGuard.test.ts` pins the released **4-player 2×2 pairs** behaviour so the future
  build can add a `variant` flag without touching the shipped team game, its stats, or its
  leaderboard. **Released Tarneeb is unchanged and remains team-only; solo is not implemented.**

## [0.3.1] — 2026-07-12 — Gameplay polish & friends/voice fixes

A patch release rolling up the **Stage 27.x gameplay polish** and the post-v0.3.0 **friends /
voice / invite** fixes. Additive and fairness-safe: **no new features, no schema/migration
changes** (0009 stays the latest), **no dependency changes**. `/health/diagnostics` `version`
reads `0.3.1`.

### Audit (Stage 27.6 — gameplay polish audit)

- **Post-27.x regression audit — no gameplay bugs found.** Verified the 27.0–27.5 changes left
  the five released games stable: Tarneeb and Deberc legality share **one source of truth**
  (`legalPlays`) between the table UI and the reducer, so the server accepts exactly what the UI
  offers (no authority drift) and illegal plays return the same state; Deberc's trump exchange
  stays reducer-gated; online turn-authority, friends-invite visibility, invite-accept join,
  bot/human rematch and reconnect all hold; cards never render blank; the Tarneeb team-tricks
  viewer reads only public data. Locked with a focused audit test; no runtime code changed.

### Changed (Stage 27.4 — clockwise & table-clarity audit)

- **Play now reads clockwise in every game.** Audited all five (`CLOCKWISE_AUDIT.md`); King,
  Durak, Deberc and Preferans were already clockwise. **Tarneeb** read counter-clockwise on
  screen and was corrected **UI-only** — the turn now sweeps to your left, with your partner
  still opposite at the top. Dealing, partnerships, play order and scoring are unchanged.
- **King now flags the led card** of the current trick with the same "1" badge + ring the other
  games use, so it's always clear who led. (The winning card already pulses when a trick is
  taken.) Reveal delay stays a readable ~2 s across every game.

### Added (Stage 27.3 — Tarneeb team-tricks review)

- **Tarneeb: view your team's taken tricks** — a "🃏 Team tricks" button opens a review of every
  trick your side has won this hand (winner + the 4 cards in play order, lead card flagged);
  opponents show as a count only. Display-only (the played cards are already public), so no rules,
  scoring, or stats change; works local and online.

### Added (Stage 27.2 — Deberc trump exchange)

- **Deberc trump exchange** — before the first card, the holder of the lowest trump (7 in
  3-player, 6 in 4-player) can swap it for the face-up table trump ("🔄 Swap low trump" on their
  declaring turn). The exposed card enters their hand and the low trump becomes the new table
  trump — the hand keeps the same number of cards, once per hand, optional. A public note shows
  the swap; no hidden hand is revealed. Bots do it automatically. Enforced in the pure reducer, so
  online validates identically.

### Changed (Stage 27.1 — menu sections + sender-anchored reactions)

- **Profile is split into clear sections** — Account, Friends, Statistics, Achievements and
  Leaderboards are each their own tappable section (with the incoming friend-request badge on
  Friends) instead of one crowded tab strip that overflowed on small phones.
- **Reactions & stickers float over the sender's seat** — an emoji/sticker now pops near the
  player who sent it (bottom for you, others around the table) instead of always at the centre.
  It reuses the existing public seat info — no protocol change.

### Changed (Stage 27.0 — game rules + table clarity)

- **Tarneeb:** the **minimum bid is now 3** (auction 3–13; scoring unchanged), and the **trump
  obligation** is enforced — void in the led suit while holding a trump means you **must trump**
  (you may discard another suit only when void in both). Enforced in the reducer (online too).
- **Deberc:** the 50-point run is spelled **"Палтіна" (Paltina)** everywhere (display only); the
  **skip-meld** button is red; **table cards are larger**.
- **Every game:** the **last card of a trick/bout now lingers ~2 seconds** (normalized) before play
  advances — including online Tarneeb/Preferans, which previously had no delay. The **card that led**
  the current trick shows a small **"1" badge + ring** so it's always clear who led.
- Deferred (with design notes in `RULES_UX_TODO.md`): profile/menu section split, Deberc trump
  exchange, Tarneeb "view my tricks", solo/individual variants, clockwise audit, reactions-over-sender.

### Fixed

- **Friend invite "Join" now works** (Stage 26.1): tapping **Join room** on an invite actually
  joins the inviter's room instead of doing nothing — at the menu it joins directly; from inside
  another room it confirms before leaving; in the same room it dismisses. The `?room=` deep-link
  still prefills the Join sheet. The invite still carries only a room code.
- **Tarneeb help text corrected** (Stage 27.8): the in-game "How to play" now says the auction
  **starts at 3** (3–13, all four languages), matching the shipped rule — the old "7–13" predated
  the Stage 27.0 minimum-bid change. Text only; no rule change.

## [0.3.0] — 2026-07-12 — Social & voice release

Adds the social layer on top of the five-game platform: **friends, room invites, online
rematch, and opt-in in-room voice chat** — plus a round of account/avatar production fixes
and gameplay polish. Additive and fairness-safe: no gameplay/scoring change; friends need
Postgres + migration `0009_friends.sql`.

### Added

- **Friends & presence** (Stage 25.1–25.9): add friends **by code** (never by email); an
  app-level presence connection shows who's **online** and drives an incoming-request **badge**
  on the Profile tile + Friends tab. Signed-in only; presence is per-instance.
- **Room invites**: a signed-in host can invite a friend into the current room from an
  **always-visible "Invite friends"** block in the Lobby (online friends first). The target gets
  a **Join/Dismiss** toast that reuses the `?room=` flow (never auto-joins); failures (offline /
  not friends / not in a room) surface a small non-fatal notice. The invite carries only a room
  code + display name.
- **Online rematch / Play again**: after a game finishes, Play again restarts the **same game in
  the same room** (same options/seats) instead of leaving to the menu. One human + bots restarts
  immediately (bots are always ready); multiple humans must **all** press Play again (no
  auto-start) and see who wants a rematch. In-memory only; a fresh game records its own stats.
- **In-room voice chat** (Stage 25.3–25.6, opt-in): a room-scoped **WebRTC mesh** (≤5) —
  Join/Mute/Leave in the Lobby card + a compact in-game mic, a safe status/debug block (Mic /
  Peers / ICE state / Audio), and reconnect that rebuilds the mesh. **No audio is stored,
  recorded, or sent through the server** (peer-to-peer; the server only relays signaling).
  STUN-only by default; a deployment adds a **TURN** relay via `VOICE_ICE_SERVERS` (runtime,
  `/api/voice/ice-config`) or `VITE_VOICE_ICE_SERVERS` (build-time) — credentials are env-only,
  never committed, and redacted from diagnostics. `/health/diagnostics` reports
  `voice.ice: stun_only|turn_configured`.

### Fixed

- **Account / auth resilience** (Stage 24.2–24.5): a transient DB blip on `/api/me` no longer
  dead-ends the Profile (falls back to a guest view); a missing migration surfaces a clear
  `503 migration_required` instead of masquerading as a guest; live, secret-free auth
  diagnostics help pinpoint an unreachable/cross-origin API base.
- **Avatar upload production** (Stage 24.6–24.8): the "Uploading…" button can no longer hang
  (client timeout always settles); every server phase (body read / ffmpeg / DB write) is bounded
  with a distinct safe error; the browser now **compresses the image before upload** (a multi-MB
  photo POSTs a ~KB WebP), making a Render timeout unlikely.
- **Cards never render blank**: a slow / stalled / broken card image now falls back to the
  rank+suit text (shown until the artwork actually paints) instead of a blank card.
- **Last-card reveal delay**: the final card of a trick/bout lingers ~1 s so it can be read before
  play advances — in every game, now including Durak (its bout lingers before the table clears).
- **Voice audio reliability**: ICE candidates that arrived before the remote description are now
  buffered (they used to be dropped, stalling the connection); remote audio sinks are attached to
  the DOM for reliable mobile playback; a "TURN may be required" hint shows when every peer fails.

### Notes

- Real **cross-network voice** is a manual check (CI has no mic); strict/symmetric-NAT users need
  a **TURN** relay to connect P2P (otherwise they fall back to text chat).
- Production with Postgres must run **`npm run db:migrate`** after deploy (Friends need `0009`).

## [0.2.0] — 2026-07-11 — Five-game platform release

First tagged snapshot of the rebranded **Card Majlis** card lounge — five games,
online play, profiles, stats, and an installable PWA.

### Highlights

- **Rebrand:** the product is **Card Majlis** (internal ids stay `king` /
  `king-card-game` for compatibility).
- **Five games, all fully playable** (local pass-and-play **and** online):
  **King**, **Durak**, **Deberc**, **Tarneeb**, **Preferans** — each with bots.
- **Online rooms:** host/join by 4-letter code, invite links (`?room=CODE`),
  team lobby, reconnect + server restart recovery, AI substitute for a
  disconnected player, room browser with filters and auto-refresh.
- **Room social:** whitelisted emoji reactions, chat, and media stickers
  (server-validated, no uploads/URLs).
- **Identity & profile:** guest play, optional Google sign-in, 3-tier avatars
  (emoji / local image / server upload), favorite game, appearance (card back +
  face themes), animation and sound-alert preferences.
- **Progress:** per-game stats, public leaderboards, and derived achievements
  with an unlock toast.
- **PWA:** installable app shell, user-controlled "Update available" refresh,
  offline pill, and mobile safe-area / touch polish.
- **Ops:** optional **Docker** runtime with `ffmpeg` for server avatar upload;
  a safe public **`GET /health/diagnostics`** snapshot (build/commit, uptime,
  DB + avatar readiness, room + socket counts, game ids — no private data).

### Security & privacy

- Server-authoritative game state with per-client redaction (no hand leaks).
- WSS + CSRF protection, `scrypt` password hashing, per-connection and per-IP
  rate limits, origin allowlist.
- Diagnostics and logs expose only aggregate/routing info — never user ids,
  emails, room codes, session ids, tokens, chat, or cards.

### Known limitations

- **Single Node instance** — rooms/social live in one process; horizontal
  scaling needs sticky sessions or a shared store.
- **Postgres required** for profiles, auth, stats, and leaderboards; without
  `DATABASE_URL` those `503` and local/guest/online play still works.
- **Avatar upload needs `ffmpeg`** at runtime — the native Render runtime has
  none, so uploads `503` there; use the shipped Docker runtime (or `FFMPEG_PATH`).
- **No moderation console** yet (chat/stickers are whitelisted, not moderated).
- **Preferans post-MVP variants** (misère, распасы, whist, Sochi, 4-player) are
  documented but not implemented.

[0.2.0]: https://github.com/picez/king-game/releases/tag/v0.2.0
