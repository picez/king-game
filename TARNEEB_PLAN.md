# Tarneeb — Architecture & Implementation Plan (Stage 10)

> **Status: DONE — Tarneeb is RELEASED (`available`, Stage 10.8).** Stages
> 10.1–10.8 all shipped: pure core, GameDefinition, local + server-authoritative
> online play, polished AI/UX, a release-readiness audit, and per-`game_type`
> stats. Stage 10.9 was a post-release docs/comment cleanup. This document is
> retained as the historical engineering plan for **Tarneeb** (see
> [`TARNEEB_RULES.md`](TARNEEB_RULES.md)), the **fourth game** on the multi-game
> seam shared with King, Durak, and Deberc (which stayed untouched throughout).

Guiding rule (same as Durak/Deberc): **do not force Tarneeb into another game's
`GameState`.** Tarneeb gets its own pure state, actions, reducer, AI, and UI. The
shared layer (catalog, `GameDefinition` registry, room, lobby, transport,
redaction seam, stats) is already game-agnostic and is **reused, not rebuilt**.

---

## 1. What already exists (reuse, don't rebuild)

- `src/games/catalog.ts` — `GameType`, `GAME_CATALOG`, `publicGameCatalog()`,
  `isGameType`, `GameAvailability` (`'available' | 'coming_soon' |
  'experimental'`). Tarneeb becomes a new `GameType` entry.
- `src/games/definition.ts` + `src/games/registry.ts` — generic
  `GameDefinition<TState, TAction>` and `getGameDefinition`. Durak/Deberc already
  plug in here; Tarneeb follows the same contract.
- `serverCore.ts` resolves a definition per room (`startGame` / `applyBotTurn` /
  `applyTimeoutAction`), so once Tarneeb has a definition the online plumbing is
  largely automatic.
- `RoomSummary.gameType` is on the wire and the room browser renders it.
- Stats are **per `game_type`** in the DB, so `tarneeb` rows fit with **no schema
  change**.
- **Card art is 52-card ready** — Tarneeb uses the full deck incl. **2–6**.
  *(Owner-confirmed 2026-07-08: King already ships a **full 52-card deck**, so
  Tarneeb reuses the same `CardView` / `public/cards/faces/` assets — no new art
  needed.)*

---

## 2. The crux — where Tarneeb differs from the existing three

- **Fixed 4-player partnerships** (2 v 2, seats 0/2 vs 1/3). King is individual;
  Durak is individual; Deberc is 3-solo **or** 4-team. Tarneeb is **always** 2×2 —
  a fixed-teams-only game. Reuse Deberc's 4-player team plumbing where possible.
- **Counter-clockwise** turn order and **deal-to-the-right** rotation (King/Durak
  are clockwise). The core must not assume clockwise.
- **A true auction** (integer 7–13 as originally planned; the **minimum bid was later
  lowered to 3** — auction **3–13** — in Stage 27.0, see [`TARNEEB_RULES.md`](TARNEEB_RULES.md))
  followed by a **separate
  trump-choice** phase by the declarer — a two-step setup the other games lack.
- **Team trick-count scoring** with **set/made** asymmetry (§8) + the **exact-bid
  double** (Stage 13.4: exactly the bid → `+2×bid`, overtricks → `+tricks`); the
  **kaboot BONUS is off in MVP** (§9) and lands later behind `kabootMode`.

None of these need changes to the shared seam; they live in Tarneeb's own core.

---

## 3. Stages

> **All stages below are ✅ DONE (2026-07-08).** Tarneeb shipped through 10.8 and
> is `available`; 10.9 was a docs/comment cleanup. Stage descriptions are kept as
> the original plan of record.

### Stage 10.1 — Pure Tarneeb core only ✅ DONE
- `src/core/tarneeb/` (or `src/games/tarneeb/core.ts`, matching the repo's
  existing per-game core layout): types, deck, deal, reducer, legal-move
  generation, scoring (§8), redaction helper, and a simple AI (§14).
- Actions & phases per **§11**; state shape per **§12**.
- **Kaboot BONUS** (§9) is **off in MVP** — implement `kabootMode` with the enum in
  place but only the `'off'` branch wired (no flat all-13 bonus; the §8 exact-bid
  double still applies, so bid 13 made exactly = +26); other branches
  stubbed for a later stage.
- **Deliver with the full test suite from §15**, incl. the all-13-off (#21) and
  tie-at-target (#22) tests; the kaboot-enabled test (#23) waits for a later
  stage. Deterministic **bot-only soak** must terminate.
- **No** catalog / definition / UI / server changes in this stage.

### Stage 10.2 — GameDefinition + catalog registration as `coming_soon` ✅ DONE
- Add `'tarneeb'` to `GAME_TYPES`; add a `GAME_CATALOG.tarneeb` entry with
  `status: 'coming_soon'`, `minPlayers: 4`, `maxPlayers: 4`,
  `defaultPlayerCount: 4`, `rulesDoc: 'TARNEEB_RULES.md'`, i18n title keys.
- Implement `GameDefinition<TarneebState, TarneebAction>` and register it.
- Wire `getActingPlayerId` / `buildStartAction` / redaction into the definition.
- Menu shows Tarneeb as **coming soon** (not startable). No UI board yet.

### Stage 10.3 — Local Tarneeb UI ✅ DONE
- Board component: 4 seats around the table, viewer at the bottom (**§2 UI**),
  counter-clockwise highlighting.
- Bidding panel (7–13 / Pass), trump-picker (declarer only), trick area, running
  team scores, hand/target readout.
- Local hot-seat + bots playable end to end. Flip catalog to allow **local** play.

### Stage 10.4 — Online Tarneeb union / redaction ✅ DONE
- Fold `TarneebState` / `TarneebAction` into the shared online union.
- Server-side **redaction** per **§13** (hide hands → counts; bids/trump/trick/
  scores public) and **validation** (turn, legal bid, declarer-only trump,
  card-ownership, follow-suit).
- Reconnect / restart parity with Durak/Deberc.

### Stage 10.5 — Experimental online Tarneeb ✅ DONE
- Flip catalog to `status: 'experimental'`; enable online host/join with bots.
- Online QA pass: multi-client, disconnect/reconnect, bot fill, dead-auction
  redeal, kaboot (if enabled) across the wire.

### Stage 10.6 — Polish + mobile + bots ✅ DONE
- UX polish, in-game help/rules, mobile layout, stronger bidding/play AI.
- Optionally enable the **kaboot** modes (§9) and `[VARIANT]` targets (31/61) as
  setup options — MVP ships with kaboot **off** and target **41**.

### Stage 10.7 — Release-readiness audit ✅ DONE
- State-machine + invariants review; online auth/redaction audit (seat derived
  server-side, actions carry no spoofable actor); reconnect/restart during each
  phase; deterministic bot soak (4 players × seeds).
- Audit PASSED; the one bug found (a Lobby label showing a King-only mode term for
  Tarneeb) was fixed. Stats + release were deferred to Stage 10.8.

### Stage 10.8 — Stats + release to `available` ✅ DONE
- `definition.recordsStats = true`; catalog `status: 'available'`; the Experimental
  tag removed from Setup/Help/host picker/Lobby.
- Score-only stats (no cards): pure aggregator `src/net/tarneebStats.ts`, repo
  `server/db/tarneebStats.ts` (reuses `games`/`game_players`/`rounds`/`user_stats`
  JSONB — **no schema migration**), API routes, and Profile stats + leaderboard
  panels. A score-only `handHistory` was added to `TarneebState`.
- King, Durak, Deberc stats shape + behaviour unchanged.

### Stage 10.9 — Post-release docs/comment cleanup ✅ DONE
- Removed stale `coming_soon`/`experimental`/"second game" comments across the
  game-definition seam; deleted the dead `GameSelector` component and the unused
  `tarneeb.experimental`/`tarneeb.onlineBeta` i18n keys + dead CSS. No behaviour,
  rules, DB, or protocol changes.

**Post-MVP options (documented, not scheduled):** §9 kaboot modes, §6 No-Trump,
§10 target variants 31 / 61 — all still opt-in future work.

---

## 4. Decisions — resolved (owner, 2026-07-08)

All Stage-10.0 open items are now settled; nothing blocks Stage 10.1:

- **§9 Kaboot BONUS** — ✅ **OFF in MVP.** No separate flat all-13 bonus / instant
  win; but the §8 **exact-bid double** applies (bid 13 made exactly = **+26**). The
  kaboot bonus table becomes a **later option** (`kabootMode`, default `'off'`).
- **§8 Exact-bid double** — ✅ **ON (Stage 13.4).** Exactly the bid → `+2×bid`;
  overtricks → `+tricks`; failed → `−bid` / defenders `+tricks` (unchanged).
- **§7 first-lead** — ✅ **declarer leads the first trick.**
- **§10 tie / simultaneous target crossing** — ✅ both ≥ target → **higher score
  wins**; **equal → play one more hand.**
- **§6 No-Trump** — ✅ **not in MVP** (reserved future contract type).
- **Card assets** — ✅ **reuse King's full 52-card deck**; no new art.

Post-MVP options (documented, not scheduled): §10 target variants **31 / 61**,
§9 **kaboot** modes, §6 **No-Trump**.

---

## 5. Acceptance for the current stage (Stage 10.0, this document)

- Only **documentation** files are added/changed
  (`TARNEEB_RULES.md`, `TARNEEB_PLAN.md`).
- **No code, no catalog changes, no `GameDefinition`** yet.
- **King, Durak, and Deberc untouched.**
- `npm test` / `npm run build` are **optional** at this stage, but if run they
  must **stay green** (this doc changes no source, so they are unaffected).
