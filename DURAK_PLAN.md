# Durak — Architecture & Implementation Plan

> **Status (Stage 9.6):** pure core ✅, catalog/definition/registry ✅, local UI
> (simple + transfer) ✅, UX/rules hardening ✅, state/action **union** ✅, and
> **experimental online Durak** ✅ — host/join rooms with bots, per-game redaction,
> reconnect. **Remaining:** Durak stats + a leaderboard, and online polish. King
> is unchanged throughout.

Engineering plan for adding **Durak** (see [`DURAK_RULES.md`](DURAK_RULES.md)) as
the **second game**, on top of the multi-game seam already built (Stages 8.3–8.6:
catalog, `GameDefinition`, registry, `room.gameType`, server-authoritative
online). This document is the plan only — **no Durak code ships in Stage 9.0**.

Guiding rule: **do not force Durak into King's trick-taking `GameState`.** Durak
has its own state, actions, reducer, AI, and UI. The shared layer (room, lobby,
transport, redaction seam, stats) becomes game-agnostic.

---

## 1. What already exists (reuse, don't rebuild)

- `src/games/catalog.ts` — `GameType`, `GAME_CATALOG`, `publicGameCatalog()`,
  `isGameType`. King is `DEFAULT_GAME_TYPE`.
- `src/games/definition.ts` — `GameDefinition` (today King-shaped) + registry
  (`src/games/registry.ts`, `getGameDefinition`).
- `serverCore.ts` already resolves a definition per room and uses it in
  `startGame` / `applyBotTurn` / `applyTimeoutAction` (Stage 8.5). `ServerRoom`
  has `gameType` (persisted, legacy → king).
- `RoomSummary.gameType` is already on the wire; the room browser renders it.
- Stats are **per `game_type`** in the DB (`user_stats`), so `durak` rows already
  fit without a schema change.
- Card art is 36-card-ready: King uses 32 (7–A); Durak adds the **sixes** — same
  `CardView` component and `public/cards/faces/`.

---

## 2. Required generalization (the crux)

`GameDefinition` and a few shared types are currently King-typed. Durak needs
them generic. Proposed shape (finalized in 9.1, wired in 9.3):

```ts
// src/games/definition.ts — generalized
export interface GameDefinition<TState = unknown, TAction = unknown> {
  id: GameType;
  catalog: GameCatalogEntry;
  variants?: readonly string[];          // durak: ['simple','transfer']; king: undefined
  supportedPlayerCounts: number[];
  reducer(state: TState | null, action: TAction, ctx?: ReducerContext): TState | null;
  getActingPlayerId(state: TState): string | null;
  buildStartAction(room: RoomSnapshot): TAction;
  botAction(state: TState): TAction | null;
  redactStateFor(state: TState, viewerSeat: number | null): TState; // NEW: per-viewer view
  isFinished(state: TState): boolean;                                // NEW: end detection
  recordsStats: boolean;
}
```

- **Redaction moves into the definition.** Today King redaction lives in
  `messages.redactStateFor`. Durak redaction differs (hide opponents' hand cards
  → counts only; table/discard/trump/deck-count are public). So each game owns it.
- `registry.ts` holds `Record<GameType, GameDefinition>` (heterogeneous;
  `GameDefinition<any, any>` at the boundary). Callers already narrow by
  `room.gameType`.
- **State/action unions over the wire** (messages.ts):
  `type AnyGameState = KingGameState | DurakGameState` and
  `type AnyGameAction = KingAction | DurakAction`. `STATE_UPDATE.state` and
  `ACTION_REQUEST.action` use the union; the client routes by `room.gameType`
  (already known from the snapshot). No discriminator field is strictly required,
  but Durak/King states should carry a `kind`/`game` tag for safe narrowing.
- `serverCore` finishes routing **every** game decision through the definition:
  `applyActionRequest` → `def.reducer` + a game-specific `authorize`;
  `sanitizedStateFor` → `def.redactStateFor`. (`startGame`/bot/timeout already do.)

This generalization is the **main risk** and is contained to Stage 9.3; it must
leave King byte-identical (King's definition methods are its existing functions).

---

## 3. New module layout

```
src/games/durak/
  types.ts        # DurakGameState, DurakAction, Card reuse, Variant = 'simple'|'transfer'
  deck.ts         # 36-card deck build, deal, trump reveal (seeded rng)
  engine.ts       # pure reducer: ATTACK/DEFEND/TAKE/PASS/TRANSFER + bout resolve + draw + end
  rules.ts        # legality helpers: canBeat, legalThrowIn, canTransfer, maxAttack
  ai.ts           # Durak bot: pick attack / defense / take / transfer
  definition.ts   # durakGameDefinition: GameDefinition<DurakGameState, DurakAction>
  index.ts        # barrel
src/ui/durak/
  DurakGameScreen.tsx, DurakTable.tsx, DurakHand.tsx, DurakControls.tsx
```

- **Pure core is engine-only** (no Node/DOM), unit-testable like King's core.
- **DurakGameState is separate** from King's `GameState` — table (attack/defense
  pairs), each player's hand, deck count, trump card, discard pile, attacker/
  defender seats, variant, phase, winner/fool.
- **UI reuses** `CardView` + the felt/table primitives only; **new** Durak
  screens (no King mode/trump/kitty/trick screens).

---

## 4. Protocol changes (Stage 9.3)

Backward-compatible; King clients unaffected (all new fields optional/defaulted).

- **CREATE_ROOM**: add `gameType?: GameType` (default `king`) and
  `variant?: string` (durak: `'simple' | 'transfer'`). Server validates against
  the chosen game's `variants`; unknown game/variant → graceful `ILLEGAL_ACTION`.
- **RoomSnapshot / RoomSummary**: add `variant?: string`. Room browser shows
  `gameType` (chip already exists) **+ variant** label.
- **STATE_UPDATE.state**: `AnyGameState | null` (union). Client renders via
  `getGameDefinition(room.gameType)` → the right screen tree.
- **ACTION_REQUEST.action**: `AnyGameAction` (union). Server routes to
  `def.reducer` for the room's game; `authorize` is game-specific.
- **No change** to WELCOME/ROOM_UPDATE/chat/reactions/reconnect/leave.
- Retire nothing; King message shapes stay exactly as today.

---

## 5. UI routing

- `GameRouter` becomes **game-aware**: switch on `room.gameType` (online) or the
  chosen local game → King screens vs Durak screens. King's path is unchanged.
- The Stage 8.3 menu **game selector** flips Durak from "coming soon" to a real
  selectable game once `durak` is added to the catalog (9.2). Add a **variant**
  picker (Simple / Transfer) in the Host sheet, only when `gameType==='durak'`.
- Local pass-and-play Durak reuses the King `PassScreen` handover pattern.

---

## 6. Stats / DB

- No schema change: `user_stats` is keyed per `game_type`. Durak records its own
  score-only summary (games, wins=not-fool, fool-count, etc.) under
  `game_type='durak'`. `recordsStats` on the definition gates it.
- `GET /api/games/durak/stats` mirrors the King endpoint shape when 9.4 lands.

---

## 7. Catalog entry (added in 9.2, NOT in 9.0)

```ts
durak: {
  id: 'durak', titleKey: 'gameType.durak', shortTitleKey: 'gameType.durak',
  minPlayers: 2, maxPlayers: 4, defaultPlayerCount: 2,
  supportsLocal: true, supportsOnline: true, supportsBots: true,
  rulesDoc: 'DURAK_RULES.md',
}
```

> ⚠️ Adding `'durak'` to `GAME_TYPES` forces a `durakGameDefinition` to exist
> (`GAME_DEFINITIONS: Record<GameType, GameDefinition>`) and makes `/api/games`
> + the menu advertise it. So the catalog entry lands **only when 9.1's core +
> 9.2's local definition are ready** — never before, or the build breaks.

---

## 8. Staged implementation

Each stage ships independently, keeps King green, and has its own tests.

### Stage 9.1 — Pure Durak core
- `src/games/durak/{types,deck,rules,engine}.ts` + tests. **No** UI, server, or
  catalog wiring yet (keeps `GAME_TYPES` king-only so the build stays green).
- Generalize `GameDefinition` to `GameDefinition<TState, TAction>` (King keeps
  working with its concrete types; no behavior change).
- **Tests:** deck/deal/trump; lowest-trump first attacker (+ fallback); legal
  attack; legal defense (suit/trump); take; successful defense; throw-in limit =
  defender hand size; draw order (attackers then defender); end game / fool /
  draw; transfer legal & illegal (capacity, after-beat). Fully deterministic via
  a seeded rng.

### Stage 9.2 — Local Durak UI
- `src/games/durak/{ai,definition}.ts`; `src/ui/durak/*` screens; **game-aware
  `GameRouter`**; **add `durak` to the catalog** + i18n (`gameType.durak`,
  variant labels) for EN/UK/DE/AR; menu selector + variant picker.
- Local pass-and-play Durak (both variants) playable end-to-end vs bots/humans.
- **Tests:** definition wiring (registry returns durak; reducer smoke via
  definition), i18n coverage, source-grep guards for screen routing. Mobile
  360/390 no-overflow + RTL smoke.

### Stage 9.3 — Online Durak room integration
- Protocol unions (CREATE_ROOM `gameType`/`variant`, STATE_UPDATE/ACTION_REQUEST
  unions, RoomSnapshot/Summary `variant`). serverCore routes **all** decisions
  through the definition (`applyActionRequest`/`sanitizedStateFor`/`authorize`).
- Room browser shows gameType + variant; reconnect/persistence round-trip Durak
  state (serialize is already game-agnostic JSON).
- **Tests:** serverCore unit (start/act/redact a Durak room), e2e online Durak
  bout (create durak room → attack/defend/take → reconnect), King e2e unchanged.

### Stage 9.4 — Bots & stats
- Harden the Durak AI (sensible attack/defense/transfer heuristics) and wire the
  disconnected-substitute/turn-timer to `def.botAction` (already generic).
- Durak stats recording + `GET /api/games/durak/stats` + a Durak stats panel.
- **Tests:** bot plays a full legal game; stats attribution per `game_type`.

### Stage 9.5 — Transfer polish & edge cases
- Transfer-variant chaining, multi-card transfers, capacity edge cases; optional
  co-attacker throw-ins (lift the MVP single-attacker limit) if desired.
- **Tests:** transfer chains around the table; capacity rejections; co-attacker
  throw-in limits.

---

## 9. Testing plan (summary)

Pure-core unit tests (9.1) are the backbone — every rule in DURAK_RULES.md maps
to at least one test:

| Rule | Test |
|---|---|
| Deck / deal / trump reveal | 36 cards, 6 each, trump suit = bottom card |
| First attacker | lowest trump holder; seat-0 fallback when none |
| Legal attack | first card any; throw-in only matching on-table ranks |
| Legal defense | higher same-suit OR trump; trump beaten only by higher trump |
| Throw-in limit | attack count ≤ defender hand size, ≤ 6 |
| Take | defender picks up all table cards; next attacker = player after defender |
| Successful defense | table → discard; defender becomes next attacker |
| Draw order | attacker(s) refill to 6 first, then defender; trump card last |
| End game | deck empty + one player with cards = fool; simultaneous empty = draw |
| Transfer legal | same-rank before any beat, within new defender capacity |
| Transfer illegal | after a beat, over capacity, wrong rank → rejected |

Plus: definition/registry wiring (9.2), serverCore + e2e online (9.3), bot full
game + stats (9.4), transfer chains (9.5). `npm test` / `npm run build` /
`npm run e2e` green at every stage; King paths untouched.

---

## 10. Risks & mitigations

- **`GameDefinition`/messages generalization** (state/action unions, redaction
  into the definition) — the one invasive change. Mitigation: King's definition
  methods are its existing functions, so King output stays byte-identical;
  contained to 9.1 (types) + 9.3 (server wiring); covered by King's existing
  unit + e2e suites as regression guards.
- **Catalog timing** — never add `durak` to `GAME_TYPES` before its definition
  exists, or `Record<GameType, GameDefinition>` + `/api/games` break. Gate it in
  9.2.
- **Persistence** — `serializeRoom` is JSON-of-gameState; Durak state must be
  plain JSON (no class instances) so save/restore and reconnect "just work".
- **Scope creep** — co-attacker throw-ins, 5–6 players, trump-show transfer, and
  regional variants are explicitly **out of MVP** (DURAK_RULES.md §6).
