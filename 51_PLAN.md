# 51 (Syrian 51) — Implementation Plan

> **STATUS: RELEASED (Stage 30.7).** 51 is the fully `available` **6th game** on the Card
> Majlis platform — local + server-authoritative online + score-only stats/leaderboard +
> favorite + a `fifty-one-winner` achievement + PNG emblem — reusing the exact same seams as
> King / Durak / Deberc / Tarneeb / Preferans (pure core → `GameDefinition` → serverCore
> → UI → stats). Rules are in [`51_RULES.md`](51_RULES.md); every §16 open question shipped on
> its recommended MVP default. The staged rollout (30.1 core → 30.7 release) is recorded below.

## Identifiers

- Human name: **51**. Core folder: **`src/games/fiftyOne/`**. Registry key / game id:
  **`fiftyOne`**. Stats/DB `game_type`: **`fifty-one`** (no migration — reuses the existing
  per-game stats seam; see 30.6). Doc files: `51_RULES.md`, `51_PLAN.md`.

## Architecture (mirrors the five released games)

- **Pure TypeScript core** — no React, no I/O, no randomness except an injected `Rng`. The
  **same reducer** drives local play and server-authoritative online play.
- Files (planned), mirroring `src/games/tarneeb/`:
  - `types.ts` — `FiftyOneState`, `FiftyOneAction`, `Meld`, `Card`(+joker), player, options.
  - `deck.ts` — build the 1-deck+2J / 2-deck+2J deck (§3) and deal 13/14 (§4).
  - `rules.ts` — pure predicates/helpers: `isValidRun`, `isValidSet`, `meldValue`,
    `handPenalty`, `canOpen` (≥51 from own melds), `normalizeXXX` clamps, direction helpers.
  - `engine.ts` — the reducer (`fiftyOneReducer`) + `START_GAME`/turn/meld/discard/scoring.
  - `ai.ts` — `fiftyOneBotAction` (deterministic legal-first, see below).
  - `redact.ts` — `fiftyOneRedactStateFor(state, seat)` (per §14).
  - `definition.ts` — the `GameDefinition` (start action, acting player, redaction, bot,
    finished check) wired into the registry.
- **Meld validator is the crux** and is unit-tested to death before anything else: runs
  (incl. `A-2-3`=6, `Q-K-A`=30, reject `K-A-2`), sets (reject duplicate identical card),
  joker "clear card" resolution, and the 51 opening total.

## Redaction contract (see 51_RULES §14)

- Own hand: visible to owner only.
- Public: opened melds (incl. joker→represented card), discard pile (top at minimum;
  likely full pile), hand counts, opened flags, scores, eliminated flags, turn, draw count.
- Hidden: draw-pile order/contents, other hands. Redaction runs server-side per viewer; a
  redaction-leak test (like `tarneeb/redact.test.ts`) gates 30.4.

## Bot MVP (deterministic)

- **Legal-first, deterministic** (no RNG in the decision, so replays are stable):
  1. Draw: discard-pile top if it immediately completes/extends a meld the bot can use
     **and** the bot has opened; else draw from the pile.
  2. If **not opened** and it holds a set of melds totalling **≥ 51** (from its own cards),
     **open** them.
  3. If **opened**, lay off any trivially-fitting cards to reduce the hand.
  4. Discard the **highest-penalty card not in a useful meld** (greedy).
- Simple meld selection is acceptable for MVP (no deep search). Must never make an illegal
  move and must always end on a legal discard.

---

## Staged rollout

### 30.1 — Pure core (deck, meld validator, reducer, scoring, AI) — ✅ DONE
- Built `src/games/fiftyOne/` — `types.ts`, `deck.ts`, `melds.ts`, `rules.ts`, `engine.ts`,
  `ai.ts`, `redact.ts`, `invariants.ts`, `index.ts` — with **exhaustive unit tests** (70
  tests across `deck/melds/engine/scoring/redact/ai/invariants.test.ts`): deck composition
  per player count (54 / 106), deal 13/14, run/set validation (all Ace edge cases: `A-2-3`=6,
  `Q-K-A`=30, reject `K-A-2`), joker resolution (internal-gap runs, missing-suit sets),
  51-opening totals (51 valid / 50 invalid), draw-then-discard turn flow, discard-pile gating
  (open-only), lay-off, empty-hand win, per-round penalties (incl. Joker=25 and
  never-opened=100), elimination at 510, continue-until-one-remains, redaction (no hand /
  draw-pile leak), a deterministic greedy bot, and a bot-soak invariant guard
  (`checkFiftyOneInvariants`). **No React/server/catalog/registry/stats.** All MVP defaults
  from `51_RULES.md` §16 implemented as recommended (see the spec change log §17).
  **MVP assumption locked in:** at most **one joker per meld** and a run joker may only fill an
  **internal** gap (a joker at a run end is ambiguous → rejected).

### 30.2 — Catalog `coming_soon` + GameDefinition — ✅ DONE
- Game id chosen: **`fifty-one`** (hyphenated) — URL/API-safe, unifies with the future
  `game_type='fifty-one'` stats key, and works with the i18n template `gameType.${id}`. The
  core folder stays `src/games/fiftyOne/`. Added the `fifty-one` entry to `GAME_CATALOG`
  (**`status: 'coming_soon'`**, `supportsLocal:false`, `supportsOnline:false`,
  `supportsBots:true`, min/max 2–4, default 4, `rulesDoc:'51_RULES.md'`) and registered
  `fiftyOneGameDefinition` (`src/games/fiftyOne/definition.ts`, **`recordsStats:false`**) in the
  registry. It surfaces in `/api/games` and the picker as **"Coming soon" (disabled in both the
  Local and Host sheets)** — the existing data-driven `GamePicker` greys it out automatically,
  the CREATE_ROOM guard (`!entry.supportsOnline`) rejects an online 51 room, and it is
  **excluded from favorites and the per-game stats tabs**. Added `gameType.fifty-one` +
  `help.fifty-one.*` + `fiftyOne.metaShort` i18n to **en/uk/de/ar** and an emoji glyph (🀄, no PNG
  asset). Tests: catalog/registry/platformAudit updated to split available vs coming_soon; new
  `fiftyOne/comingSoon.test.ts` (gating + favorites + source isolation guards). **No behaviour
  change to the five games; no stats/DB/migration/dependency/asset.** `npm run verify` green.

### 30.3 — Local playable prototype — ✅ DONE
- Added `src/ui/fiftyOne/` — `FiftyOneLocalGame` (1 human at seat 0 + 1–3 bots, owns the pure
  state, drives bots via `fiftyOneBotAction`), `FiftyOneSetup` (player count 2–4 + the deck rule
  from the core: 2p = 1 deck + 2 jokers, 3–4p = 2 decks + 2 jokers), `FiftyOneGameScreen`
  (scoreboard with running penalties / opened / eliminated / current turn+step; draw + discard
  piles; public melds showing joker→represented value; own hand; context action bar), and
  `FiftyOneFinished`. Wired into `App.tsx` (`mode.gameType === 'fifty-one'`). Flipped the catalog
  to **`status: 'experimental'`, `supportsLocal: true`** (online stays false → Host picker stays
  disabled/"Coming soon"; Local picker enables it flagged "Experimental"). **Meld UX:** select
  hand cards → **stage** valid melds (run/set + points) → **Open** once staged total ≥ 51 →
  discard to end the turn; after opening, **Add** selected cards to any public meld; take the
  discard top only once opened; win a round by emptying the hand on the final discard. Joker
  handling uses the **core inference only** (ambiguous placement → the UI shows "Not a valid
  meld"; no joker-picker). i18n `fiftyOne.*` added for **en/uk/de/ar**; `fiftyone.css` (mobile-
  first, `overflow-x: hidden`, safe-area). **MVP limitation:** the core has no "lay a NEW meld
  after opening" action, so post-open you may only **add to existing** public melds (matches the
  bot). Tests: `fiftyOne/localGating.test.ts` + `ui/fiftyOne/fiftyOneLocalWiring.test.ts`
  (gating, source isolation, headless drive of the local loop to a finished match) + updated
  catalog/registry/platformAudit/apiDisabled. **Still offline only; no stats.** `npm run verify`
  green (2145 tests). Owed: manual 360/390 + Arabic-RTL visual pass (no automated pixel check).

### 30.4 — Online redaction / readiness — ✅ DONE
- **Server-authoritative wiring proven WITHOUT enabling online** (`supportsOnline` stays
  false → `CREATE_ROOM` still rejects 51). `FiftyOneState`/`FiftyOneAction` joined the
  `AnyGameState`/`AnyGameAction` unions (type-only). `serverCore` now drives 51 through the
  same generic path as the released games: `startGame` (via `buildStartAction`), generic
  turn-ownership authorization (`getActingPlayerId === seatToPlayerId(seat)`, the reducer
  enforces the rest), `applyActionRequest` rejecting foreign-seat (`NOT_YOUR_TURN`) and
  illegal (`ILLEGAL_ACTION` reducer no-op) actions, `applyBotTurn`/`applyTimeoutAction`, and
  a new `autoAdvance`/`publicScreenOf` branch that seeds the public **`round_complete` →
  `START_NEXT_ROUND`** redeal (reproducible/auditable, mirrors Tarneeb/Preferans). A minimal
  generic seam — an **optional `deal` seed on `applyActionRequest`** — threads a server seed
  into 51's mid-turn discard reshuffle (§5); it is off by default so the released games' WS
  path is byte-identical. **Redaction hardened**: a JSON-payload scan proves no opponent
  hand / draw-pile card id (or joker) ever reaches the wrong viewer; own hand real, others
  are same-length blank placeholders, draw pile hidden (count kept), discard/melds (incl.
  joker value)/scores/opened/eliminated/turn public, spectator sees nothing. **Persistence**
  round-trips a 51 game mid-play (hands/draw/discard/melds/scores/phase), redaction still
  works after restore, and the hidden draw pile never appears in a public `RoomSummary`/
  `snapshot`. Tests: `fiftyOne/redaction.test.ts` (leak scan) + `net/fiftyOneServerCore.test.ts`
  (readiness drive) + updated union/serverCore guards. **No release, no stats, no DB, no
  protocol/message change; the five released games are untouched.** LAN/online QA owed at 30.5.

### 30.5 — Online playable MVP (experimental) — ✅ DONE
- **51 is now hostable online as `experimental`** (NOT `available` — no stats/favorite yet).
  Catalog flipped to **`supportsOnline: true`** (status stays `experimental`), so the
  data-driven Host picker enables it flagged "Experimental" and the CREATE_ROOM guard
  (`!entry.supportsOnline`) now accepts a 51 room (2–4 seats; host-count honoured, else the
  4-seat catalog max). **No new WS message types** — the generic `ACTION_REQUEST` path from
  30.4 carries every move: the server builds the deal (`START_GAME` → seeded FiftyOneState),
  authorises the acting seat (foreign → `NOT_YOUR_TURN`, illegal → `ILLEGAL_ACTION` no-op),
  drives bots + the public `round_complete` advance (seeded `START_NEXT_ROUND` via the
  game-agnostic `broadcastAndAdvance`/`publicScreenOf`), and redacts per viewer (own hand
  only; opponents/draw pile hidden). **UI:** a thin `FiftyOneOnlineGame` adapter reuses the
  shared `FiftyOneGameScreen` with an `online` flag (read-only off-turn; the round-over
  overlay shows a waiting note instead of a client "Next round" — no START_NEXT_ROUND spoof),
  wired into `OnlineGame` next to Tarneeb/Preferans; `FiftyOneFinished` gains rematch
  controls (generic "Play again"); `StartMenu` threads `gameType:'fifty-one'` on create; the
  Lobby labels a 51 room by its Rummy meta (not a King mode). i18n `fiftyOne.nextRoundSoon`/
  `fiftyOne.spectating` (en/uk/de/ar). **Tests:** `wsHandlers.fiftyOne` (CREATE_ROOM 2/3/4 +
  clamp + START_GAME deal + summary), `fiftyOneOnlineWiring` (routing/adapter/START_NEXT_ROUND
  gating), `fiftyOneRedactionOnline` (2-human mutual non-leak + bot hidden + reconnect + no
  draw-pile in summary), updated catalog/registry/platformAudit/apiDisabled/localGating.
  **No DB migration, no stats/leaderboard/achievements/favorite, no PNG, no rule change, no
  new dependency; the five released games are unchanged.** Owed: manual cross-device online
  smoke + 360/390 portrait + Arabic RTL (no automated pixel check).

### 30.5b — Full online release (future)
- Flip catalog to **`available`**; production smoke entry, cross-device QA sign-off.

### 30.6 — Stats / leaderboard foundation (still experimental) — ✅ DONE
- **Score-only stats + leaderboard under `game_type='fifty-one'`, NO DB migration** (the
  free-text `game_type` column already accepts it; same pattern as `tarneeb-solo`/Preferans).
  Pure summarizer `src/net/fiftyOneStats.ts` turns a finished `FiftyOneState` into a
  public, score-level summary (per-seat **final running penalty**, **eliminated** flag,
  **isWinner**, winner set, rounds played) + per-player deltas + a `fiftyOneFinishSignature`
  — **NEVER** cards / hands / draw pile / melds / discards. DB repo
  `server/db/fiftyOneStats.ts` (record/get/leaderboard) increments the per-(user,
  `fifty-one`) `user_stats` cache (columns `gamesPlayed`/`gamesWon`/`gamesLost`/`roundsPlayed`
  + JSONB `timesEliminated`/`totalPenalty`/`bestPenalty`) in ONE transaction, **idempotent via
  `games.game_key`**, **bots/guests skipped** (existing human-vs-human owner rule). Wired into
  the WS finish path (`recordsStats: true` + `server/index.ts` signature/recorder branches) and
  the API (`GET /api/games/fifty-one/stats` + `/leaderboard`). Client `statsApi` types/parse/fetch
  + a **51 stats + leaderboard sub-tab** in ProfileMenu (`FiftyOneStatsPanel` / `FiftyOneLeaderboardPanel`:
  win rate, games, avg/best penalty, eliminations, rounds), i18n en/uk/de/ar. Derived view metrics:
  `winRate`, `averagePenalty`, `bestPenalty` (lowest = best), `timesEliminated`, `roundsPlayed`.
  (`roundsWon`/`opensMade`/`handPenalty100Count` are NOT tracked — the final state keeps no
  per-seat round/open history, so they are honestly omitted, not faked.) **Still `experimental`:
  NOT favoritable, NOT in achievements/All-Rounder** (a guard test enforces this until 30.7).
  Tests: `fiftyOneStats.test.ts` (pure 2p/3p/4p summaries + no-card JSON scan + signature),
  `fiftyOneStatsWiring.test.ts` (finish-path/API wiring + no migration + no achievements guard),
  `fiftyOneStats.integration.test.ts` (DB-gated), API 503 + catalog/registry/platformAudit/localGating.
  **No DB migration, no achievements, no favorite, no PNG, no rule change, no new dependency; the
  five released games' stats/achievements are unchanged.**

### 30.7 — Achievements / icon / release cleanup — ✅ DONE
- **51 released as the 6th `available` game.** Catalog flipped to **`status: 'available'`**
  (`supportsLocal`/`Online`/`Bots` true, 2–4 players) → both pickers show it with **no
  "Experimental" tag**, diagnostics/`/api/games` now count **6 available games**. **Favorite:**
  added `fifty-one` to `SUPPORTED_FAVORITE_GAMES` + the Profile favorite picker (emoji 🀄 / PNG
  emblem). **Achievements:** new derived **`fifty-one-winner`** badge (win ≥1 game of 51, icon 🀄,
  common) and `fiftyOne` joined the `AllStats` canonical set — `totalWins`/`totalGames` and
  **All-Rounder now require a win in all six games**; ProfileMenu's achievements loader fetches 51
  stats. **Icon:** procedural `game-fifty-one.png` (two fanned brass cards, ~26 KB) added to
  `scripts/gen-visual-assets.mjs` + the `visualAssets` manifest (10 P0 assets); the generator does
  not churn the existing assets. **Copy/docs:** removed "Experimental" language from the setup/
  picker/lobby/profile and refreshed `MVP_STATUS`/`PROJECT_OVERVIEW`/`QA_CHECKLIST`/
  `PRODUCTION_SMOKE`/`CHANGELOG`/visual docs to a **six-game platform**. Tests: catalog/registry/
  platformAudit/diagnostics/apiDisabled/localGating/fiftyOneStatsWiring/achievements/visualAssets/
  gameIconIntegration updated (6 available games, favorite + achievement coverage, PNG count).
  **No DB migration, no new dependency, no rule/protocol change, no version bump/tag** (changes stay
  under CHANGELOG "Unreleased"); the five released games are unchanged. `npm run verify` green.

### 30.8 — Six-game release audit + v0.3.7 — ✅ DONE
- **Release audit + guard hardening + v0.3.7 patch release.** Swept the codebase/docs for stale
  "five games / 5 games" and "51 experimental / coming soon" references and corrected the **canonical
  current-state** ones (`ONLINE_ARCHITECTURE`, `RENDER_DEPLOY`, `VISUAL_DIRECTION`, `PRODUCTION_SMOKE`,
  `anyGame.ts`/`useNetworkGame.ts` comments, `games/fiftyOne/index.ts`, redaction-test header) while
  leaving **dated stage records** (CHANGELOG/PLAN stage logs) as history. **Guards hardened** in
  `platformAudit.test.ts`: exactly **6 available** games, each with local + online + bots + stats +
  favorite coverage + **≥1 game-scoped achievement** + a PNG icon < 150 KB, and **All-Rounder spans
  exactly the available set** (dropping any one game unearns it). Gave `FiftyOneFinished` the shared
  **`finish-frame`** the other five wear (+ the `p1VisualIntegration` guard now lists all six) and
  added a `localGating` guard that the Profile achievements loader fetches 51 stats. **Release:**
  bumped `package.json` + `package-lock.json` **0.3.6 → 0.3.7** by hand (no `npm install`, lockfile
  diff = version lines only, libc count 0), moved the CHANGELOG "Unreleased" 30.x entries into
  **`[0.3.7] — 2026-07-14 — Syrian 51 sixth-game release`** with a fresh empty Unreleased, updated the
  release-line docs (`MVP_STATUS`/`PROJECT_OVERVIEW`/`RENDER_DEPLOY` diagnostics example/
  `PRODUCTION_SMOKE` §0 + §5b/`TARNEEB_RULES` banner) and tagged **`v0.3.7`**. **No DB migration, no
  dependency, no rule/gameplay change** beyond the shared finish-frame; the five games are unchanged.
  `npm run verify` green.

### 30.9 — Correct 51 meld / opening rules — ✅ DONE
- **Two owner rule corrections in the pure core (local + online share it).** (1) **Joker at any
  position** (§8): `melds.ts` `resolveRun` is now two-pass — pass 1 order-independent fills only
  INTERNAL gaps (every joker-free run + lay-off resolves regardless of input order), pass 2 falls
  back to INPUT ORDER so an END joker resolves by where the player put it (`7-8-[J]`=`7-8-9`,
  `[J]-8-9`=`7-8-9`, `Q-K-[J]`=`Q-K-A`=30, `[J]-2-3`=`A-2-3`=6); `K-A-[J]` and the ≤1-joker cap
  still reject. (2) **Opening 51 is once-per-round** (§7): the `OPEN_MELDS` reducer branch drops the
  "already opened → reject" guard and only applies the 51 gate when `!opened`, so an opened seat lays
  **any valid meld** (no minimum). **UI:** `FiftyOneGameScreen` stages/lays before AND after opening,
  the primary button switches **"Open (n/51)" → "Lay meld"**, with distinct copy (opening-needs-51 vs
  opened-lay-any); i18n en/uk/de/ar (`layMeld`/`meldTotal`/`openingNeeds51`/`openAnyMeld`). **Bot:**
  after opening it lays a fresh valid meld (any value) then lays off then discards (terminating).
  **Online:** same reducer path; a serverCore test proves an unopened sub-51 `OPEN_MELDS` is rejected
  `ILLEGAL_ACTION` and an opened low meld is accepted over the wire; redaction unchanged. Tests: new
  joker-position + opening-once cases in `melds.test`/`engine.test`, UI source guards, online gate.
  **No DB migration, no dependency, no stats/schema change; deck/scoring/510/joker-25/ace-values/
  discard-restriction/win-by-final-discard unchanged.** `npm run verify` green.

### 30.10 — Ace-low layoff + public-meld card layout — ✅ DONE
- **Ace-low run extension (core).** `melds.ts`: `runPositionLow` now defers to `runPositionHigh`
  for non-Aces (was `Number(rank)` → NaN for 10/J/Q/K), and the aceLow window relaxed `max>3`→`max>13`
  in both resolver passes. So Ace-low runs extend (`A-2-3-4`=10, `A-2-3-4-5`=15, …) and **laying an
  `A` onto a public `2-3-4`** resolves (order-independent pass 1) to canonical **`A-2-3-4`** (Ace-first
  display, Scope B free — `ADD_TO_MELD` stores `r.cards`). `K-A-2`/`A-2-3-K`/adding K to `A-2-3` stay
  invalid; UI `canAddTo` enables Add for the Ace automatically. **Meld card layout (CSS).**
  `.fiftyone-meld__cards` → `flex-wrap:nowrap; gap:0.3rem; overflow-x:auto; direction:ltr` +
  `object-fit:contain` on mini meld art + `flex:0 0 auto` cards + `.fiftyone-meld{min-width:0;
  max-width:min(100%,15rem)}` → no overlap/clip, in-block scroll for long runs, no 360/390 overflow.
  New `scripts/fifty-one-shots.mjs` headless harness asserts 0 overlap/clip/overflow at 360/390.
  Tests: melds/engine/serverCore Ace cases + UI CSS guard. Docs: 51_RULES §6/§10/§17, QA + SMOKE,
  CHANGELOG. **No DB migration, no dependency, no stats change; 510/joker-25/unopened-100/discard/win
  unchanged.** `npm run verify` green.

### 30.11 — v0.3.8 release QA (51 rule fixes) — ✅ DONE
- **Patch release v0.3.8 packaging the 30.9/30.10 fixes; no new code behaviour.** Drift audit fixed
  stale current-state comments (`server/db/fiftyOneStats.ts` + `games/fiftyOne/definition.ts` still said
  "51 is EXPERIMENTAL"; `melds.ts` "only A-2-3 qualifies") and refreshed the `help.fifty-one.turns/notes`
  i18n (en/uk/de/ar) to state opening-51-once + joker-any-position + Ace-low `A-2-3-4`. Confirmed the full
  release guard set exists (joker positions, Q-K-J, J-2-3, set+joker, opened low meld, unopened blocked,
  Ace→2-3-4, K-A-2 invalid, meld CSS overlap guard, online opened-low + Ace layoff) — none missing.
  **Release:** hand-bumped `package.json` + `package-lock.json` **0.3.7 → 0.3.8** (no `npm install`,
  lockfile diff = version lines only, libc count 0), moved CHANGELOG "Unreleased" 30.9/30.10 entries into
  **`[0.3.8] — 2026-07-14 — 51 meld and opening rule fixes`** + fresh empty Unreleased, updated the
  release-line docs (`MVP_STATUS`/`PROJECT_OVERVIEW`/`RENDER_DEPLOY` diagnostics example/`PRODUCTION_SMOKE`
  §0/`TARNEEB_RULES` banner) and tagged **`v0.3.8`**. **No DB migration, no dependency, no stats/schema/
  gameplay change; the six-game release state is intact.** `npm run verify` green.

---

## Boundaries carried through every stage

- **No scoring-formula surprises** — implement exactly what `51_RULES.md` specifies; any
  change updates the spec first.
- **No DB migration** for stats (reuse the `game_type` seam).
- **No dependency changes.**
- **Do not touch King / Durak / Deberc / Tarneeb / Preferans** behaviour — 51 is additive.
- Same reducer for local and online; redaction is server-side only.

## Confirmations blocking 30.1

Resolve [`51_RULES.md` §16 Open questions](51_RULES.md#16-open-questions--confirmations-needed)
(deck count, direction, finish-without-discard, lay-off-to-others, discard-take rules,
elimination/finish, the 100-penalty trigger, "Hand" win, joker-per-meld cap). The MVP will
proceed on the **recommended defaults** if the owner does not object.
