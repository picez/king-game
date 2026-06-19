> ⚠️ **HISTORICAL / OBSOLETE — do not treat as current.**
> This was a one-time gap analysis (2026-04-07) of an early build against the
> original PRD. The gaps below have since been addressed. For the authoritative,
> current state use:
> - **Rules:** [`KING_RULES.md`](KING_RULES.md)
> - **Online architecture:** [`ONLINE_ARCHITECTURE.md`](ONLINE_ARCHITECTURE.md)
> - **MVP status / how to run:** [`MVP_STATUS.md`](MVP_STATUS.md)
> - **Deploy:** [`DEPLOYMENT.md`](DEPLOYMENT.md) · **QA:** [`QA_CHECKLIST.md`](QA_CHECKLIST.md)
> Kept only for historical reference.

# Gap Analysis — King Game vs PRD

**Date:** 2026-04-07  
**PRD version:** 1.0  
**Compared against:** `src/` directory of `projects/king-game/`

Severity labels: 🔴 Critical (rules broken) · 🟡 Significant (missing feature) · 🟢 Minor (UX/model deviation)

---

## Summary Table

| # | File(s) | Gap | Severity |
|---|---------|-----|----------|
| 1 | `core/deck.ts` | Dealing does not start from dealer's left | 🔴 |
| 2 | `core/gameEngine.ts` | First dealer is always player 0, not randomly selected | 🔴 |
| 3 | `core/deck.ts` | `Deck.validate()` missing — no duplicate/count checks | 🔴 |
| 4 | `core/gameEngine.ts` + new file | Dealer's Choice mode not implemented | 🟡 |
| 5 | `ui/SelectTrumpScreen.tsx` | "No Trump" option absent from trump selection | 🟡 |
| 6 | `core/gameEngine.ts` | KITTY_EXCHANGE → should go to SELECT_TRUMP, PRD says PLAYING | 🟡 |
| 7 | `models/types.ts` | `GameMode.trumpSuit` field missing | 🟡 |
| 8 | `models/types.ts` | `Player.isDealer` field missing | 🟡 |
| 9 | `models/types.ts` | `GameConfig.modes` field missing | 🟡 |
| 10 | `models/types.ts` | `Score.roundScores` is `number[]` not `Map<roundNumber, number>` | 🟢 |
| 11 | `models/types.ts` | `GameStatus` values differ from PRD naming | 🟢 |
| 12 | `models/types.ts` | `Round.status` missing intermediate values (`dealing`, `kitty_exchange`, `scoring`) | 🟢 |
| 13 | `models/types.ts` | PRD uses `currentLeaderId: string`, code uses `currentLeaderIdx: number` | 🟢 |
| 14 | `ui/RoundScoringScreen.tsx` | Cards collected per player not shown (PRD §9.2) | 🟢 |
| 15 | `ui/SetupScreen.tsx` | No Fixed vs Dealer's Choice toggle in setup (PRD §9.2) | 🟢 |
| 16 | `core/deck.ts` | Shuffle not seeded — no reproducibility for testing (PRD §11.3) | 🟢 |
| 17 | App overall | No Main Menu screen (PRD §9.2) | 🟢 |

---

## File-by-File Analysis

---

### `src/core/deck.ts`

**✅ Correct:**
- `createDeck(32)` produces exactly ranks 7–A × 4 suits = 32 cards
- `createDeck(52)` produces exactly ranks 2–A × 4 suits = 52 cards
- Rank values are 1-based indices matching PRD tables (7=1, 8=2…A=8 for 32-card; 2=1…A=13 for 52-card)
- Fisher-Yates shuffle is correctly implemented

**🔴 Gap 1 — Dealing start position ignores dealer:**

PRD §4.1 / §4.2:
> Cards are dealt clockwise, one at a time, **starting from the player to the dealer's left**.

Implementation always starts from `hands[0]`:
```typescript
for (let i = 0; i < cardsPerPlayer * playerCount; i++) {
  hands[i % playerCount].push(deck[i]);  // always index 0 first
}
```

When dealer is at index 2 (3-player game), dealing should start from index 0. When dealer is at index 0, dealing should start from index 1. Currently it always starts from index 0 regardless of dealer position.

Fix needed in `dealCards`: accept `dealerIdx` and start from `(dealerIdx + 1) % playerCount`.

**🔴 Gap 3 — No deck validation:**

PRD §10.3 / §10.4 / §11.3:
> `Deck.validate()` must run before every deal. If failed: reject deck, re-generate from scratch.

No `validateDeck` export exists. PRD requires it to check card count and detect duplicates before dealing each round.

**🟢 Gap 16 — Unseeded shuffle:**

PRD §11.3:
> Deck generation must be deterministic from a given seed (for reproducibility/testing).

`Math.random()` is used directly. No seed parameter. Cannot reproduce specific hands in tests.

---

### `src/core/rules.ts`

**✅ Correct:**
- `getValidCards` enforces suit-follow: returns only suited cards if player has any, otherwise full hand
- `isValidPlay` delegates to `getValidCards` — correct
- `resolveTrick` correctly prioritises trump plays, then falls back to highest led-suit card
- Tie resolution implicitly favours the first `best` (lowest playOrder) via `>` not `>=` — this is correct per PRD §10.5
- `cardEquals` identity check by (suit, rank) is correct
- `removeCardFromHand` removes first occurrence — correct
- `sortHand` sorts ♠♥♦♣ then ascending rank — correct for display

**🟢 Minor — No error logging for impossible ties:**

PRD §10.5:
> If a tie is somehow detected: log a critical error.

`resolveTrick` silently handles the impossible case. No logging.

---

### `src/core/scoring.ts`

**✅ Correct:**
- All 7 mode IDs are handled in the switch
- `no_tricks`: counts trick wins × `scoring.perTrick` — matches PRD
- `no_hearts`: counts heart cards in collectedCards × `scoring.perHeart` — matches PRD
- `no_queens`: counts queens in collectedCards × `scoring.perQueen` — matches PRD
- `no_jacks`: counts jacks in collectedCards × `scoring.perJack` — matches PRD
- `king_of_hearts`: flat penalty if K♥ in collectedCards — matches PRD
- `last_two_tricks`: uses `tricks.slice(-2)` to count only the last 2 trick winners — matches PRD §5 Mode 6
- `trump`: counts trick wins × `scoring.trumpRewardPerTrick` — matches PRD

- `applyKittyPenalties`: correctly returns 0 for trump/no_tricks/last_two_tricks, and counts relevant penalty cards for the other negative modes — matches PRD §4.1 kitty handling rules
- Scoring values are NOT hardcoded — all come from `ScoringConfig` parameter — matches PRD §11.1

**No gaps found in scoring logic.**

---

### `src/core/modeQueue.ts`

**✅ Correct:**
- Mode order matches PRD §7.1: no_tricks → no_hearts → no_queens → no_jacks → king_of_hearts → last_two_tricks → trump
- Each mode gets one entry per player (dealerIdx 0…N-1)
- Total length: 21 for 3-player, 28 for 4-player — matches PRD §2.1 / §2.2

**No gaps found in mode queue logic.**

---

### `src/config/gameConfigs.ts`

**✅ Correct — all scoring values match PRD exactly:**

| Field | 3P (PRD) | 3P (code) | 4P (PRD) | 4P (code) |
|-------|----------|-----------|----------|-----------|
| perTrick | −10 | −10 ✓ | −2 | −2 ✓ |
| perHeart | −15 | −15 ✓ | −4 | −4 ✓ |
| perQueen | −30 | −30 ✓ | −13 | −13 ✓ |
| perJack | −20 | −20 ✓ | −13 | −13 ✓ |
| kingOfHearts | −100 | −100 ✓ | −52 | −52 ✓ |
| perLastTrick | −50 | −50 ✓ | −26 | −26 ✓ |
| trumpReward | +10 | +10 ✓ | +4 | +4 ✓ |

Also correct:
- 3P: deckSize 32, cardsPerPlayer 10, kittySize 2, tricksPerRound 10
- 4P: deckSize 52, cardsPerPlayer 13, kittySize 0, tricksPerRound 13

**No gaps found in game configs.**

---

### `src/config/gameModes.ts`

**✅ Correct:**
- All 7 modes present with correct ids, names, and types
- Order matches PRD

**No gaps found.**

---

### `src/core/gameEngine.ts`

**✅ Correct:**
- `START_GAME`, `PLAY_CARD`, `SELECT_TRUMP`, `EXCHANGE_KITTY`, `NEXT_TRICK`, `NEXT_ROUND`, `RESET` actions all present
- `handlePlayCard`: removes card from hand, builds trick, resolves when complete, updates collectedCards, triggers round scoring on last trick — all correct
- `calculateRoundScore` + `applyKittyPenalties` called correctly at round end
- Kitty penalty applied only when `config.kittySize > 0 && mode.type === 'negative'` — correct
- Running totals in `Score` updated correctly
- `NEXT_ROUND` transitions to `game_finished` when queue exhausted — correct
- `handleSelectTrump` guarded by `status === 'select_trump'` — correct
- `handleKittyExchange` validates discard count and validates each discard is in dealer's hand — correct
- `getCurrentPlayer` derivation from `currentLeaderIdx + plays.length` is correct

**🔴 Gap 2 — First dealer is not random:**

PRD §7.1:
> Randomly select the first dealer (e.g., deal one card each — highest card is first dealer).

`generateModeQueue` always assigns `dealerIdx = 0` to the first entry of each mode. The first round always has dealer 0.

Fix: in `startGame`, pick a random `firstDealerIdx` and rotate the queue or offset the dealer assignments.

**🟡 Gap 4 — Dealer's Choice mode not implemented:**

PRD §2.3:
> Both systems must be supported. Fixed Order is default. Dealer Choice provides more strategic depth.

The engine only generates a fixed queue. No mechanism exists for the dealer to pick a mode at runtime. No `CHOOSE_MODE` action, no mode availability tracking, no `usedModes` per cycle.

**🟡 Gap 6 — State machine: KITTY_EXCHANGE → SELECT_TRUMP vs PLAYING:**

PRD §9 state machine:
```
[KITTY_EXCHANGE] → on discard confirmed → PLAYING
```

Implementation:
```
[KITTY_EXCHANGE] → [SELECT_TRUMP] → [PLAYING]
```

The PRD state machine omits the trump suit selection step after kitty exchange in fixed-mode trump rounds. The implementation's approach (adding `select_trump` after `kitty_exchange`) is **functionally necessary** and actually more complete than the PRD's state machine — but it's a deviation.

Note: PRD §5 Mode 7 clearly states "Before play begins, the dealer selects a trump suit", so the implementation's extra `select_trump` state is correct behaviour even though the state diagram doesn't show it explicitly.

**Recommendation:** The implementation is correct. The PRD's state machine has a gap here that the implementation fixes. Document this as an intentional deviation.

---

### `src/models/types.ts`

**✅ Correct:**
- `Suit`, `Rank`, `GameModeId`, `ModeType` all match PRD
- `Card`, `Trick`, `TrickPlay`, `ScoringConfig`, `GameConfig`, `ModeQueueEntry` all structurally correct
- `GameState` contains all essential runtime fields

**🟡 Gap 7 — `GameMode.trumpSuit` field missing:**

PRD §8:
```
GameMode {
  trumpSuit:  Suit | null  // set only during Trump mode, after dealer selects
}
```

Implementation: `GameMode` has no `trumpSuit`. Trump suit is stored in `GameState.trumpSuit` instead. Functionally equivalent at runtime, but the data model deviates from the PRD contract. If trump state is read from `currentRound.mode.trumpSuit`, it would always be undefined.

**🟡 Gap 8 — `Player.isDealer` field missing:**

PRD §8:
```
Player {
  isDealer:   boolean
}
```

Implementation Player interface has no `isDealer`. The dealer is tracked via `GameState.dealerIndex`. Functionally covered, but model deviates from PRD.

**🟡 Gap 9 — `GameConfig.modes` field missing:**

PRD §8:
```
GameConfig {
  modes: GameMode[]  // ordered list of 7 modes
}
```

Implementation `GameConfig` has no `modes` field. Modes come from `ALL_MODES` in `gameModes.ts`. Functionally covered, but model deviates from PRD.

**🟢 Gap 10 — `Score.roundScores` type:**

PRD: `Map<roundNumber: number, number>` (keyed by round number)  
Implementation: `number[]` (keyed by array index)

Functionally equivalent since rounds are sequential, but the PRD model allows random-access lookup by round number.

**🟢 Gap 11 — `GameStatus` values differ from PRD:**

| PRD State | Implementation | Note |
|---|---|---|
| `setup` | absent (null state) | ✓ handled by null check |
| `dealing` | absent | merged into `startRound()` |
| `kitty_exchange` | `kitty_exchange` | ✓ |
| `mode_selection` | `select_trump` | renamed |
| `playing` | `playing` | ✓ |
| `resolving_trick` | absent / `trick_complete` | renamed/split |
| `round_scoring` | `round_scoring` | ✓ |
| `next_round` | absent | merged into `NEXT_ROUND` action |
| `game_finished` | `game_finished` | ✓ |

The implementation merges transient states (`dealing`, `next_round`) into atomic operations and splits `resolving_trick` into an explicit `trick_complete` acknowledgment step. The functional coverage is complete.

**🟢 Gap 12 — `Round.status` missing intermediate values:**

PRD: `'dealing' | 'kitty_exchange' | 'playing' | 'scoring' | 'complete'`  
Implementation: `'playing' | 'complete'`

The intermediate statuses are tracked at the `GameState` level instead.

**🟢 Gap 13 — `currentLeaderId` vs `currentLeaderIdx`:**

PRD: `currentLeaderId: string | null` (stores player ID)  
Implementation: `currentLeaderIdx: number` (stores player array index)

Both identify the same player. Index is more efficient for array lookups. No functional gap.

---

### `src/ui/SetupScreen.tsx`

**✅ Correct:**
- Player count selection (3 or 4) — correct
- Player name input — correct
- Displays deck/kitty/round info per config — correct

**🟢 Gap 15 — No mode selection system toggle:**

PRD §9.2:
> Game Setup: Mode selection system (Fixed / Dealer Choice)

No toggle between Fixed Order and Dealer's Choice exists. This is tied to Gap 4 (engine not implemented).

---

### `src/ui/GameScreen.tsx`

**✅ Correct:**
- Shows mode name, round number, dealer name — matches PRD §9.2
- Shows trump indicator when `state.trumpSuit` is set — correct
- `getCurrentPlayer` correctly identifies whose turn it is
- `getValidCards` passed to `PlayerHand` — valid cards highlighted
- `PLAY_CARD` dispatched with correct player ID — correct

**No rules gaps found.**

---

### `src/ui/SelectTrumpScreen.tsx`

**✅ Correct:**
- Shows dealer name and round context
- Dispatches `SELECT_TRUMP` with the chosen suit — correct

**🟡 Gap 5 — "No Trump" option missing:**

PRD §5 Mode 7:
> Alternatively, the dealer may declare "No Trump" (a variant — see below).

The screen only offers 4 suit buttons. No "No Trump" option exists. The PRD explicitly includes it as a declared variant with same scoring rate by default.

---

### `src/ui/KittyExchangeScreen.tsx`

**✅ Correct:**
- Shows dealer's full 12-card hand (10 + 2 kitty)
- Multi-select capped at `kittySize` (2)
- Dispatches `EXCHANGE_KITTY` with selected discards — correct
- Confirm button disabled until exactly `kittySize` cards selected — correct
- Informs dealer they will then select trump — correct flow

**No gaps found.**

---

### `src/ui/TrickCompleteScreen.tsx`

**✅ Correct:**
- Shows trick winner name
- Shows all cards played in the trick with player names
- Correct trick count display (uses `tricks.length` which includes the resolved trick)
- Dispatches `NEXT_TRICK` on continue — correct

**No gaps found.**

---

### `src/ui/RoundScoringScreen.tsx`

**✅ Correct:**
- Shows mode name, round number, dealer
- Reveals kitty cards for 3-player negative modes — correct
- Notes dealer receives kitty penalties — correct
- Score table shows this-round score and running total — correct
- Dispatches `NEXT_ROUND` — correct
- Detects last round and shows appropriate button label — correct

**🟢 Gap 14 — Cards collected per player not shown:**

PRD §9.2:
> Round Summary: Per-player round score, **Cards collected**

The scoring screen shows point totals but not the actual cards each player collected (e.g., "Alice collected: Q♠ Q♥ J♦"). The PRD requires this detail.

---

### `src/ui/GameFinishedScreen.tsx`

**✅ Correct:**
- Ranks players by total score descending (higher is better) — matches PRD §6.3 rule 5
- Handles ties correctly (multiple winners at same top score) — matches PRD §6.3 rule 6
- Shows final totals with correct colour coding — correct
- Dispatches `RESET` → null state → SetupScreen — correct

**No gaps found.**

---

### `src/ui/components/` (CardView, PlayerHand, TrickArea, ScoreBoard)

**✅ All correct:**
- CardView: correct suit symbols (♠♥♦♣), red/black colouring, disabled/selected/dimmed states
- PlayerHand: sorts hand via `sortHand`, correctly marks valid/invalid cards, dimmed not clickable
- TrickArea: shows all plays with player names, empty state message
- ScoreBoard: shows total and optionally per-round scores with colour coding

**No gaps found in UI components.**

---

## Prioritised Fix List

### Must Fix (correctness):

1. **Gap 1** — `dealCards` in `deck.ts`: start dealing from `(dealerIdx + 1) % playerCount`, not always index 0
2. **Gap 2** — `startGame` in `gameEngine.ts`: pick a random first dealer index instead of hardcoding queue start at player 0
3. **Gap 3** — `deck.ts`: add `validateDeck(cards, expectedSize)` export and call it in `startRound` before dealing

### Should Fix (PRD-required features):

4. **Gap 5** — `SelectTrumpScreen.tsx`: add "No Trump" button option
5. **Gap 7** — `models/types.ts`: add `trumpSuit?: Suit | null` to `GameMode` and set it in `gameEngine.ts` after trump selection
6. **Gap 8** — `models/types.ts`: add `isDealer: boolean` to `Player`, keep it updated in `startRound`
7. **Gap 9** — `models/types.ts`: add `modes: GameMode[]` to `GameConfig`, populate from `ALL_MODES`
8. **Gap 14** — `RoundScoringScreen.tsx`: show collected cards per player in the round summary

### Nice to Have (PRD completeness):

9. **Gap 4** — Dealer's Choice mode: new action `CHOOSE_MODE`, new state `mode_selection`, usedModes tracking
10. **Gap 15** — `SetupScreen.tsx`: add mode selection toggle (requires Gap 4 first)
11. **Gap 16** — `deck.ts`: add optional `seed` parameter to `shuffleDeck`
12. **Gap 10** — `Score.roundScores`: change from `number[]` to `Record<number, number>` for PRD model alignment

---

## What Is Correctly Implemented

| Area | Status |
|------|--------|
| 32-card deck composition (7–A × 4 suits) | ✅ |
| 52-card deck composition (2–A × 4 suits) | ✅ |
| Rank values per PRD tables | ✅ |
| All scoring values (3P and 4P) | ✅ |
| Scoring config is data-driven, not hardcoded | ✅ |
| All 7 game modes defined with correct ids/types | ✅ |
| Mode queue: 21 rounds (3P), 28 rounds (4P) | ✅ |
| Mode queue order matches PRD §7.1 | ✅ |
| Each player deals for each mode exactly once | ✅ |
| Suit-follow validation | ✅ |
| Trick resolution: trump > led suit | ✅ |
| Kitty exchange flow (3-player trump) | ✅ |
| Kitty penalty calculation for 3P negative modes | ✅ |
| `no_tricks` scoring (per trick) | ✅ |
| `no_hearts` scoring (per heart card) | ✅ |
| `no_queens` scoring (per queen) | ✅ |
| `no_jacks` scoring (per jack) | ✅ |
| `king_of_hearts` scoring (flat K♥ penalty) | ✅ |
| `last_two_tricks` scoring (slice(-2) of tricks) | ✅ |
| `trump` scoring (per trick reward) | ✅ |
| K♥ in kitty → penalty to dealer | ✅ |
| Multiple kitty penalty cards → each counted | ✅ |
| State machine: playing → trick_complete → playing | ✅ |
| State machine: round_scoring → next round | ✅ |
| State machine: game_finished when queue empty | ✅ |
| State machine: kitty_exchange → select_trump → playing | ✅ |
| Score running totals updated each round | ✅ |
| Winner = highest total score | ✅ |
| Ties shared correctly | ✅ |
| Hand validation server-side in reducer | ✅ |
| Discard validation in kitty exchange | ✅ |
| Suit symbols and red/black display | ✅ |
| Valid cards highlighted, invalid disabled | ✅ |
| Round scoring screen with kitty reveal | ✅ |
| Final score screen with ranking | ✅ |
