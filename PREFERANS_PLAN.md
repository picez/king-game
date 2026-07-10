# Preferans — Implementation Plan (Card Majlis) v0.1 (docs-only)

> **Stage 19.0 — plan only.** No code, catalog, registry, UI, or server changes ship
> with this document. Rules source of truth: [`PREFERANS_RULES.md`](PREFERANS_RULES.md).
> This plan shows how a 4th trick-taking game (after King/Durak/Deberc/Tarneeb) fits the
> existing architecture and the staged path to release.

## Why Preferans is a good fit

It is a **contract-bidding, trump, trick-taking** game — structurally the closest to
**Tarneeb** (bidding → choose contract → play tricks → score a hand → repeat to a
target). Tarneeb is the working template for the state shape, phases, redaction, and
score-only `handHistory`. The new mechanics are only: **3 players** (not 4/teams), a
**2-card talon (прикуп)** exchange, and **No-Trump** contracts. Everything else reuses
patterns already shipped four times.

## How it fits the current `GameDefinition` registry

The multi-game seam already exists and needs no new abstraction:

- **`src/games/catalog.ts`** — a `GameCatalogEntry` per game with
  `{ id, minPlayers, maxPlayers, supportsLocal, supportsOnline, recordsStats, status,
  rulesDoc }` and `GameType = typeof GAME_TYPES[number]`. Preferans adds one entry
  (`id: 'preferans'`, `min/max = 3`, `rulesDoc: 'PREFERANS_RULES.md'`) and `'preferans'`
  to `GAME_TYPES`.
- **`src/games/definition.ts`** — `GameDefinition<TState, TAction>` with the seam the
  app + server already call: `reducer`, `getActingPlayerId`, `buildStartAction`,
  `botAction`, `redactStateFor`, `isFinished`, `recordsStats`, plus `catalog`/`rulesDoc`/
  `supportedPlayerCounts`. Preferans implements exactly these — no new fields.
- **`src/games/registry.ts`** — `GAME_DEFINITIONS`; add `preferansGameDefinition`.
- Online plumbing (`serverCore` room → `buildStartAction`, per-viewer `redactStateFor`,
  `getActingPlayerId` for turn authority, `isFinished` to record/stop) is **generic over
  `AnyGameDefinition`** — Preferans gets online play "for free" once the definition + a
  Preferans-aware start seam land, exactly as Deberc/Tarneeb did.

## Pure core folder `src/games/preferans/`

Mirror the Tarneeb layout (each file pure + unit-tested; **no** node/DOM/server imports
so it stays client-bundle-safe):

```
src/games/preferans/
  types.ts        // PreferansState / PreferansAction / phases (RULES §12–13)
  deck.ts         // 32-card build + seeded deal (10+10+10+2 talon)
  rules.ts        // legal moves: bid ladder, follow-suit, trick winner, contract checks
  engine.ts       // pure reducer (state, action, ctx?) → next state
  ai.ts           // deterministic legal-first bot (RULES §15)
  redact.ts       // redactStateFor(viewerSeat) — own hand only; talon/discards hidden
  invariants.ts   // 32-card conservation, trick sums, score integrity (test helper)
  definition.ts   // preferansGameDefinition: GameDefinition<PreferansState, PreferansAction>
  index.ts        // barrel
  *.test.ts       // deck/rules/engine/ai/redact/invariants (RULES §16)
```

Reuse shared primitives: `models/types` (`Card`/`Suit`/`PlayerType`), `core/rng`
(seeded shuffle), the `player-<seat>` id convention, and the score-only `handHistory`
pattern for stats.

## Catalog status progression

1. **`coming_soon`** — registered + visible in docs/menu as "coming soon", **not
   startable** (Stage 19.2).
2. **`experimental`** — startable online behind the experimental treatment while it is
   soak-tested (Stage 19.5), like Durak/Tarneeb were before release.
3. **`available`** — released after the QA/redaction/stats audit (Stage 19.7).

## Staged path

- **19.1 — pure core.** `types/deck/rules/engine/ai/redact/invariants` + full unit tests
  (RULES §16) + a bot-only **soak** (`scripts/preferans-soak.mjs`, like durak/deberc)
  proving termination + invariants over many seeds. No catalog/UI/registry yet.
- **19.2 — catalog + definition (`coming_soon`). ✅ DONE.** `'preferans'` added to
  `GAME_TYPES` + `GAME_CATALOG` (min/max 3, `supportsLocal/Online: false`, `supportsBots`,
  `status: 'coming_soon'`, `rulesDoc: PREFERANS_RULES.md`); `preferansGameDefinition`
  (reducer / getActingPlayerId / buildStartAction / botAction / redactStateFor /
  isFinished / `recordsStats: false`) wired into `GAME_DEFINITIONS`. `/api/games` now
  returns Preferans as `coming_soon`; the Local/Host game picker shows it **disabled**
  ("Coming soon") so it is visible but **not startable** (no local/online path). Favorite
  picker excludes it. `DEFAULT_GAME_TYPE` unchanged (King). Tests: catalog/registry/api +
  picker wiring. **Still NOT playable.** Next: 19.3 local UI prototype.
- **19.3 — local UI prototype. ✅ DONE.** `src/ui/preferans/` (`PreferansLocalGame` +
  `PreferansSetup` / `PreferansGameScreen` / `PreferansFinished` / `PreferansHelp` +
  pure `bids.ts`): 1 human (seat 0) + 2 bots, reuses `CardView` + the felt/seat/trick
  primitives. Phases wired end-to-end — bidding (5×5 legal ladder + Pass), talon-exchange
  (take → bury exactly 2 → declare ≥ winning bid), trick play (illegal cards dimmed),
  hand-complete score sheet, finished (winner **or draw**). `App` routes local
  `gameType==='preferans'` to it; the game picker is now gated **per mode**
  (`supportsLocal` locally / `supportsOnline` when hosting), so Preferans is selectable
  in the Local sheet and **disabled** ("coming soon") in Host. Catalog flipped to
  `supportsLocal: true`, `status: 'experimental'` (still `supportsOnline: false`,
  `recordsStats: false`; favorite picker still excludes it). i18n ×4. Tests:
  `preferansLocalWiring` (routing/source/no-server-or-stats-imports/reducer flows +
  bot-only soak to `game_finished`) + `preferansUi` (validBids/validDeclareContracts,
  discard-exactly-2, declare ≥ bid). Visual smoke `scripts/preferans-shots.mjs` (360/390,
  **no horizontal overflow**). Verify green (1452 unit + build + E2E). **Playable locally.**
  Next: 19.4 online readiness / redaction.
- **19.4 — local hardening + online-redaction readiness. ✅ DONE.** No rule drift found
  (engine/rules match this doc). **AI:** added a termination guard — the last active
  bidder facing an all-pass (no high bid) opens the minimum instead of passing, so a
  bot-only auction ALWAYS yields a declarer → the match is *guaranteed* to terminate
  (no endless redeal loop). **Invariants:** `checkPreferansInvariants` strengthened
  (strictly-ascending bids, contract ≥ winning bid, talon/discards ∈ {0,2}, per-seat
  trick bounds) + new `invariants.test.ts` (32-card conservation across every zone,
  hand sizes by phase 10/10/10+2 → 12 → 10, no-dup, trick ≤ 10, acting-seat validity,
  corruption is actually flagged, and a **40-seed bot soak** that finishes well under
  cap with hands played). **Redaction:** `redact.phases.test.ts` covers every phase ×
  every seat + spectator — own hand only, talon hidden pre-take, after TAKE_TALON the
  talon is visible ONLY inside the declarer's hand, discards hidden from EVERYONE
  (incl. the declarer), trick/bids/contract/scores/`handHistory` public + score-only,
  UI counts preserved, no mutation. **Server seam:** `autoAdvance`/`publicScreenOf`
  gained a `preferans` branch (hand_complete → seeded START_NEXT_HAND / `round_scoring`);
  `preferansServerCore.test.ts` drives startGame / sanitizedStateFor / authorization /
  applyBotTurn / applyTimeoutAction / serialize↔deserialize / autoAdvance / bot-only
  finish through serverCore. **Still NOT hostable:** `supportsOnline` stays `false`;
  `wsHandlers.preferans.test.ts` asserts CREATE_ROOM preferans is rejected (BAD_MESSAGE,
  no room). Preferans is NOT in the wire `AnyGame` union yet (joins at 19.5). **UI:**
  clearer prompts — a follow-suit reminder + the declare minimum (≥ winning bid); i18n
  ×4. Verify green. Next: 19.5 experimental online.
- **19.5 — experimental online. ✅ DONE.** `GAME_CATALOG.preferans.supportsOnline: true`
  (still `status: experimental`, `recordsStats: false`). `PreferansState`/`PreferansAction`
  joined the wire `AnyGame` union (STATE_UPDATE / ACTION_REQUEST carry them); **no new
  message types**. serverCore already drove the game (19.4 seam) — `createRoom` needs
  exactly 3 seats, start requires 3 occupied, room full at 3/3, `maybeRecordFinished`
  skips it (recordsStats false). `wsHandlers` now allows `CREATE_ROOM preferans` (3 seats,
  guarded by the `supportsOnline` gate). Client: `OnlineGame` routes `gameType==='preferans'`
  → new **`PreferansOnlineGame`** (thin adapter: dispatch → ACTION_REQUEST, no local
  reducer/bot loop); `PreferansGameScreen` gained an `online` mode (read-only off-turn,
  offline-seat badges + "AI may play", hides "Next hand" → server auto-advances). StartMenu
  Host offers Preferans (Experimental), room browser + Lobby flag it experimental; favorite
  picker **still excludes** it (experimental — revisit at release). i18n ×4. Tests:
  `wsHandlers.preferans` (CREATE_ROOM allowed), `preferansServerCore` (auth / follow-suit /
  bot+timeout / redaction / serialize+restore / bot-only finish), `preferansOnlineWiring`
  (routing/adapter/online-mode source guards), and an **online Preferans e2e section**
  (create → browser → start<3 rejected → 3/3 start → PreferansState over WS → human acts →
  trick → out-of-turn rejected → chat/reaction → reconnect no-leak → leave frees seat).
  Visual smoke `scripts/preferans-online-shots.mjs` (host/lobby 1&3-of-3/bidding/talon/
  playing, 360/390, **no overflow**). **No stats yet.** Verify green (typecheck + tests +
  build + E2E). Next: 19.6 stats.
- **19.6 — stats. ✅ DONE.** Per-`game_type='preferans'` score-only stats reusing the
  shared `games`/`game_players`/`rounds`/`user_stats` JSONB pattern — **NO schema
  migration, NO WS/protocol change**. `preferansGameDefinition.recordsStats: true`;
  `maybeRecordFinished` records via the existing game-agnostic finish path (human-vs-human
  only; bots skipped; idempotent via `game_key`; DB-gated → no-op without Postgres). Pure
  aggregator `src/net/preferansStats.ts` (per-SEAT win/loss/draw, declarer/contract tallies,
  per-hand score deltas + a word-free contract label like `7H`/`6NT`, finish signature) —
  NEVER cards/talon/discards/tricks. Repo `server/db/preferansStats.ts` (record + read +
  leaderboard; `gamesDrawn`/best/worst in the JSONB blob). API `GET /api/games/preferans/
  stats` + `/leaderboard`; client `fetchPreferansStats`/`fetchPreferansLeaderboard` +
  parsers (graceful defaults). UI `PreferansStatsPanel` + `PreferansLeaderboardPanel`
  (reuse existing stats i18n; empty/auth/unavailable/error states); Profile adds a
  **Preferans** sub-tab under My stats + Leaderboard. Achievements deliberately UNCHANGED
  (Preferans excluded from `AllStats` until release). Fields: gamesPlayed/Won/Lost/Drawn,
  winRate, handsPlayed, handsAsDeclarer, contractsMade/Failed, contractSuccessRate,
  totalScore, averageScore, best/worstGameScore. Tests: aggregator (win/loss/draw/no-cards/
  signature), statsApi parse+fetch+leaderboard, apiDisabled 503, DB-gated integration
  (idempotency + bots-excluded + privacy sweep — skips without `TEST_DATABASE_URL`), UI
  source guards. Visual smoke `scripts/preferans-stats-shots.mjs` (360/390, no overflow).
  `status` stays **experimental**. Verify green. Next: 19.7 release.
- **19.7 — polish / release. ✅ DONE.** `GAME_CATALOG.preferans.status: 'available'`
  (supportsLocal/Online/Bots true, recordsStats true, fixed 3 players) — the game picker
  now shows Preferans as a normal available option (**👥 3 · Contract**) in Local AND Host;
  the room browser + Lobby drop the experimental tag; PreferansSetup drops the 🧪 badge.
  **Favorite:** `SUPPORTED_FAVORITE_GAMES += 'preferans'` (Profile favorite picker offers
  it, ProfilePanel emoji map 🎩; StartMenu Local/Host default respects it; unknown values
  still fall back to King). **Achievement:** new **`preferans-declarer`** ("Preferans
  Declarer", common, 🎩) = `handsAsDeclarer >= 1`; Preferans joined `AllStats` +
  `totalWins`/`totalGames`/`wonEveryGame` (all-rounder now spans 5 games); ProfileMenu
  loads Preferans for the Achievements tab; i18n ×4. **Audit:** verify green — local play,
  online create/join/start, redaction (e2e no-leak), reconnect, stats record path, stats +
  leaderboard panels, favorite default, achievement evaluation. **No new asset** (Preferans
  stays emoji-only 🎩 — gameIconIntegration test excludes it from the on-disk PNG check);
  **no DB migration, no protocol message types, no rules change.** App subtitle now lists
  all 5 games. Visual smoke (picker/setup/host/lobby/stats/leaderboard, 360/390, no
  overflow). **Preferans is RELEASED.** Remaining post-MVP variants (misère, распасы,
  whist/pass, classic Sochi pool/mountain scoring, 4-player) stay documented, not built.

## Local UI stages (detail)

- Reuse the shared `TablePlayers`/seat/trick renderers where possible; add a compact
  **bidding ladder** control (level × suit, "pass"), a **talon panel** (reveal the 2
  taken cards to the declarer only, pick 2 to discard, then a contract picker ≥ bid),
  and a **score sheet** (per-seat running score + last hand). Mobile-first, 360/390, RTL,
  reduced-motion aware — the same bar as every other screen.

## Online redaction stages (detail)

- `redactStateFor(state, viewerSeat)`: replace every non-viewer `handsBySeat` entry with
  hidden cards; empty/redact `talon` for non-declarers pre-take and always after take;
  drop `discards` for everyone (MVP). Keep bids/contract/tricks/scores/`handHistory`
  public. Server derives the acting seat from `getActingPlayerId` (never trusts client
  input) — same authority model as the other games.

## Stats plan

- Score-only, per-`game_type='preferans'`, additive (no change to existing games): a new
  `user_stats` row shape (games/wins/losses; contractsDeclared/Made/Failed; avg level),
  fed from the public `handHistory` at `game_finished`. New migration `00XX_preferans_stats`
  (additive), `server/db/preferansStats.ts`, `getPreferansStats`, a Profile panel +
  leaderboard — mirroring Deberc/Tarneeb stats exactly.

## Risks

- **Scoring complexity / variant ambiguity.** The classic pool/mountain/whist ledger is
  the single biggest risk (bookkeeping + no clean single-match end). **Mitigation:** the
  MVP uses the simplified single-score model (RULES §10); the classic ledger is post-MVP
  and gated on an owner decision.
- **Rule-variant drift.** Many regional rules. **Mitigation:** one fixed MVP variant, all
  else marked post-MVP + **[CONFIRM]** flags collected below.
- **UI density.** Bidding ladder + talon exchange + trick play + score sheet is a lot on a
  phone. **Mitigation:** phase-gated panels (only show the control for the current phase),
  reuse shared components, keep the score sheet collapsible.
- **Bot strength.** A legal-first bot plays weakly (mostly passes/min-bids). **Mitigation:**
  acceptable for MVP (it must be *legal* + *terminating*, not strong); a stronger bidder/
  play heuristic is a post-release improvement, isolated in `ai.ts`.
- **3-player table layout.** Reuse the existing 3-seat table (King already supports 3).

## Owner confirmations needed

Recommendations are marked **▶**; please confirm or override before Stage 19.1.

1. **Scoring variant.** ▶ **Recommend the simplified single-score "contract points"
   model (RULES §10)** for the MVP — integer, one ledger, a clean target-score end, low UI
   density — and add the classic **Sochi (Сочинка)** pool/mountain/whist model **post-MVP**
   (most common + beginner-friendly of Сочинка / Ленинградка / Ростов). Confirm?
2. **Misère in MVP?** ▶ **Recommend NO** (post-MVP) — keeps rules/scoring/defence clean.
3. **Распасы (all-pass) in MVP?** ▶ **Recommend NO** — all-pass is a **redeal** for MVP;
   add распасы (play-for-fewest) post-MVP.
4. **Whist/pass defender choice in MVP?** ▶ **Recommend NO** — **compulsory whist**
   (both defenders always play to defeat); add WHIST/PASS_WHIST + open/closed whist post-MVP.
5. **Game-value weighting.** ▶ **Recommend level-only `G(L)` = 1…5** for MVP simplicity
   (suit still governs the auction order + trump); classic per-suit/NT weights post-MVP.
6. **Target / end condition.** ▶ **Recommend a target score** (default **10**), highest
   score wins, negatives allowed — mirrors Tarneeb. Confirm the target value (and whether
   a fixed-deal-count alternative is preferred).
7. **Reveal discards at hand end?** ▶ **Recommend keep hidden** for MVP (simpler
   redaction); reveal is a small post-MVP nicety.
8. **First-trick lead.** ▶ **Recommend the player left of the declarer leads** the first
   trick. Confirm.
