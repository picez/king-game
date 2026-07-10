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
- **19.3 — local UI prototype.** A `PreferansGameScreen` (1 human + 2 bots, hot-seat)
  reusing the shared table/seat/trick components: bidding bar, talon-exchange
  (take → discard 2 → declare), trick play, score sheet. Flip `supportsLocal: true`.
- **19.4 — online readiness / redaction.** Wire the online start seam + per-viewer
  `redactStateFor` (own hand only; talon hidden pre-take; discards hidden). Redaction
  leak tests (mirror `tarneeb/redact.test`). Still not user-facing online.
- **19.5 — experimental online.** `status: 'experimental'`, `supportsOnline: true`:
  host/join rooms with bots, reconnect/restart, an online soak + a multi-human e2e with
  **no redaction leak**. Experimental label in menu/host/lobby.
- **19.6 — stats.** Additive per-`game_type` stats (`game_type='preferans'`): games/wins,
  contracts made/failed, avg contract level — score-only, additive migration, DB-gated,
  graceful with no DB. New `getPreferansStats` + a Profile stats panel + leaderboard.
- **19.7 — polish / release.** Remove the experimental label (`status: 'available'`),
  QA_CHECKLIST section, visual/RTL/mobile pass, docs update (MVP_STATUS/PROJECT_OVERVIEW),
  achievements hooks if desired.

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
