# Poker Integration Plan — Stage 37.4 (Unreleased)

Adds **Poker (No-Limit Texas Hold'em)** as the **7th released game** with full platform
coverage. No version bump / tag; catalog `status: 'available'` (not experimental) once
every seam is wired. Source of truth for rules: `POKER_RULES.md`.

## Architecture map (pure core → UI → server → platform seams)

```
PURE CORE  src/games/poker/            (deterministic, no I/O, seeded RNG only)
  types.ts        PokerState / PokerAction / PokerCard / PokerPhase / telemetry
  deck.ts         52-card build, seeded Fisher–Yates shuffle, deal, burn
  handEval.ts     best-5-of-7 evaluator + full deterministic tie compare
  pots.ts         side-pot / split-pot / odd-chip computation
  rules.ts        helpers: acting seat/id, call amount, min-raise, legal actions,
                  blinds, button/blind rotation, isFinished, normalizePlayerCount
  engine.ts       pokerReducer(state, action, ctx?) — betting/street/showdown/hand loop
  ai.ts           pokerBotAction(state, seat) — tiered pre-flop + draw-aware post-flop
  redact.ts       pokerRedactStateFor(state, viewerSeat) — hole/deck/burn privacy
  invariants.ts   chip conservation + card/seat structural checks
  definition.ts   pokerGameDefinition (GameDefinition seam)
  index.ts        barrel

UI  src/ui/poker/                       src/styles/poker.css
  PokerSetup       local player-count picker
  PokerLocalGame   pass-and-play + handover screen (private-decision gate)
  PokerGameScreen  shared table: board, pots, seats, mobile-safe bet controls
  PokerFinished    match result
  PokerOnlineGame  online wrapper (server-authoritative)
  App.tsx / OnlineGame.tsx / StartMenu.tsx / Lobby.tsx / GameIcon.tsx  wiring

SERVER  src/net/ + server/              (server-authoritative, redacted per viewer)
  serverCore    MAX_PLAYERS 5→6; deserialize whitelist +5/+6; playerCount unions →6;
                autoAdvance + publicScreenOf poker branch (seeded next-hand/showdown)
  wsHandlers    generic ACTION_REQUEST path already authorizes by acting seat
  pokerStats.ts (src/net)   pure summarize / deltas / finish signature
  db/pokerStats.ts (server) JSONB read-modify-write, human-only, idempotent
  api.ts        GET /api/games/poker/stats + /leaderboard
  index.ts      finish signature + recorder dispatch

STATS / ACHIEVEMENTS / PROFILE
  statsApi.ts   PokerStats + parse + fetch + leaderboard trio
  achievements.ts   AllStats.poker; totalWins/totalGames/wonEveryGame/playedEveryGame
                    → 7 games; 4 poker badges; group order/icon
  ProfileMenu + PokerStatsPanel + PokerLeaderboardPanel

PLATFORM SEAMS (mostly derive from GAME_TYPES)
  catalog.ts (GAME_TYPES + entry) · registry.ts · anyGame.ts unions ·
  userSettings SUPPORTED_FAVORITE_GAMES · gameHelp POKER · tutorials(catalog+pokerTutorial)
  · visualAssets icon-poker + public/visual/icons/game-poker.png (<150KB) ·
  manifest + index.html descriptions · diagnostics games.count → 7 · i18n EN/UK/DE/AR
```

## Key decisions

- **Seats:** 2–6. The room cap `MAX_PLAYERS` rises 5→6 (the one shared limit). Widening
  is type-safe and covered by regression tests for all six existing games. Also fixes a
  latent `deserializeRoom` bug that already rejected persisted 5-seat Durak rooms.
- **Default seats:** 4 (social table; heads-up + 6-max both reachable and tested).
- **Blinds:** fixed SB 10 / BB 20, no host option → `buildStartAction` needs no extra
  `RoomSnapshot` field (simpler than 51's elimination score).
- **Match telemetry:** per-seat accumulators on `PokerState` (handsPlayed/handsWon/
  showdownsWon/potsWon/biggestPot/allInsWon/royalFlushCount) feed the stat deltas. No DB
  migration — `game_type='poker'` is free-text (latest migration stays `0009`).
- **Achievements:** `poker-winner`, `poker-all-in-survivor`, `poker-big-pot`,
  `poker-royal-flush`; All-Rounder expands to 7 canonical games.
- **Two tests use "poker" as the canonical UNKNOWN game id** (`catalog.test.ts`,
  `registry.test.ts`) — swap the sentinel to another bogus id.

## Phased audit checklist

### Phase A — shared 6-seat limit (regression-safe)
- [ ] `MAX_PLAYERS` 5→6; `deserializeRoom` whitelist add 5,6.
- [ ] Widen `2|3|4|5` playerCount unions → `…|6` (serverCore, messages, wsHandlers cast, catalog defaultPlayerCount, online intent 3|4).
- [ ] Regression: all six existing games still create/start/persist/restore.

### Phase B — pure core + core tests
- [ ] types/deck/handEval/pots/rules/engine/ai/redact/invariants/index/definition.
- [ ] Tests: deck 52-unique + deterministic; evaluator every category + kickers + wheel + board-only tie + best-5-of-7; blind/action order incl. heads-up; street transitions; check/call/bet/raise/min-raise; short-stack all-in; multiple side pots; split + odd chip; fold-to-win; showdown reveal; button rotation; match finish; invariants + chip conservation.

### Phase C — registration + server seams + server tests
- [ ] catalog GAME_TYPES + entry; registry; anyGame unions.
- [ ] serverCore autoAdvance/publicScreenOf poker branch.
- [ ] src/net/pokerStats.ts + server/db/pokerStats.ts (no migration).
- [ ] server/index.ts + api.ts routes; statsApi trio; userSettings favorite.
- [ ] Tests: pokerServerCore, wsHandlers.poker, pokerRedactionOnline, pokerStats(+wiring+integration).

### Phase D — stats / achievements / profile / leaderboard
- [ ] achievements (AllStats.poker, aggregates→7, 4 badges, group order/icon).
- [ ] ProfileMenu GameKey/GAMES/loaders/panels; PokerStatsPanel + PokerLeaderboardPanel.

### Phase E — game UI
- [ ] src/ui/poker/* + poker.css; App/OnlineGame/StartMenu/Lobby/GameIcon wiring + wiring tests.

### Phase F — tutorial + help + i18n
- [ ] pokerTutorial + tutorials/catalog + gameHelp POKER; EN/UK/DE/AR keys (parity).

### Phase G — emblem + manifest + diagnostics + docs + platform audit
- [ ] gen-visual-assets iconPoker → public/visual/icons/game-poker.png (<150KB); visualAssets manifest.
- [ ] diagnostics test 6→7; pwa.test + manifest + index.html descriptions; platformAudit + catalog/registry test updates.
- [ ] Docs: PROJECT_OVERVIEW, MVP_STATUS, PRODUCTION_SMOKE, CHANGELOG (Unreleased), NEXT_SESSION_MEMORY.

### Phase H — verify + ship
- [ ] Targeted poker tests + regression (6 games) + `npm run verify`.
- [ ] `git diff --check`; `libc=0`; no migration/dependency/version drift.
- [ ] Diff review for privacy leaks; mobile 360/390 + RTL source audit.
- [ ] Focused commit(s) + push to `main`.
```
