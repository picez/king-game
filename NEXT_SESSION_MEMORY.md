# Card Majlis next-session memory

Use this file as the first read after archiving this chat. It is intentionally short.

## Product state
- Repo: `C:\ClaudeCode\builder-agent\projects\king-game`, branch `main`, direct push workflow.
- Current release: `v0.4.8` (Stage 37.1), commit `3b67876`.
- Product: Card Majlis, **7 released games**: King, Durak, Deberc, Tarneeb, Preferans, Syrian 51, **Poker (No-Limit Texas Hold'em, Stage 37.4, Unreleased)**. Poker is 2–6 players (the shared room cap `MAX_PLAYERS` rose 5→6); local+online+bots+redaction+stats+leaderboard+favorite+4 achievements+tutorial+PNG emblem; achievements catalog 48→52; All-Rounder now needs all 7 games; no DB migration; `POKER_RULES.md`/`POKER_PLAN.md`.
- Latest DB migration: `0012_poker_matches` (Stage 37.7.2 — durable match record for crash recovery); `0011_poker_settlement` = payout/refund gate; `0010_poker_wallet` = wallet + ledger. Do not add migrations casually.
- Dependencies are intentionally stable; do not run `npm install` unless explicitly approved. `package-lock.json` must keep `"libc"` count `0`.

## Current feature baseline
- Achievements: **48 total** (34 released + 14 Unreleased Stage 37.3), grouped by Global + each game; **no `All` tab**; default group is Global; styled horizontal chip scroll. The Stage 37.3 pack is backed by real per-round/per-hand/per-game telemetry added to the JSONB stats (no DB migration); 51 telemetry lives on `FiftyOneState.telemetry`.
- Recent reconnect work: 5-minute orphan room TTL, same-user cross-device room discovery/reclaim via `FIND_MY_ROOMS -> MY_ROOMS -> RECLAIM_ROOM`.
- Syrian 51: released local+online+stats+achievement; configurable elimination score 210/310/410/510; Count cards calculator; discard-to-open; joker replacement; meld cards use uniform slots.
- Tutorials: scripted tutorials for all 6 games, not live practice.
- Android: TWA config/build path exists; debug APK was built and launched in emulator as Custom Tab. Fullscreen TWA still needs custom domain + Play App-Signing SHA-256 + real `assetlinks.json`.
- iOS: PWA-only for now; no native wrapper yet.

## Important rules / gotchas
- Always read the relevant `*_RULES.md` before changing game rules.
- King/Deberc/Tarneeb/51 rules have many owner corrections; do not infer from generic card-game rules.
- Deberc display term is `Paltina` / `Палтіна`; internal stats field may still be `platina`.
- Tarneeb scoring: exact bid doubles; overbid scores actual tricks; fail is negative bid. Target score is configurable.
- 51 deck: 2 players = 1 deck + 2 jokers; 3-4 players = 2 decks + 2 jokers. Opening 51 is once, then free meld/layoff. Joker in hand penalty = 25.
- Online state must remain server-authoritative and redacted; never leak hands, reconnect tokens, user ids, or private auth data in room lists.
- **Poker Host routing fixed (Stage 37.6):** picking Poker used to create a KING room — `StartMenu.host()` added `gameType` only via per-game conditional spreads and had no Poker branch, so `CREATE_ROOM` omitted `gameType` and the server defaulted to `?? 'king'`. Now `host()` builds the intent via a shared pure `buildCreateIntent()` (in `src/net/online.ts`) that ALWAYS carries the selected `gameType` for all 7 games; options stay per-game. Regression: `src/net/hostRouting.test.ts` (7-game matrix + full path to PokerState). No Poker rules/engine change.
- **Turn timer is authoritative (Stage 37.5):** the room owns `turnDeadlineAt` + `turnTimerRevision` (persisted); minted ONLY on a real gameplay transition (`beginTurnDeadline`), never on connection events. Every `STATE_UPDATE` carries `RoomTimerInfo {deadlineAt, revision, serverNow}`; the client derives remaining from the deadline vs `Date.now()` (skew-safe, no local per-second decrement). Server arms ONE absolute-deadline `setTimeout` with a revision guard (no stale double-move); `resolveHumanFireAt` handles the room-timer-vs-substitute precedence (substitute is server-only, starts on disconnect, cancels on reconnect, never extends the room timer). Reload/reconnect never resets/extends. `applyTimeoutAction` audited across all 7 games (no botAction null-gap; Durak defence got a `TAKE_CARDS` fallback).

## Stage 37.7 — Poker bankroll/economy + real table UI (COMPLETE, Unreleased)
- **Migration `0010_poker_wallet`**: `poker_wallets` (BIGINT balance CHECK≥0 + last_claim_date)
  + immutable `poker_ledger` (reason/delta/balance_after/unique idempotency_key/match+room refs).
- **Wallet + daily claim**: 1,000,000 chips once/UTC-day, atomic + idempotent (`FOR UPDATE`
  lock + ledger-insert-as-gate — the race fix; balance mutates ONLY when this tx wins the
  key). `GET/POST /api/me/poker-wallet[/daily-claim]` (non-guest). `PokerWalletPanel` on Profile.
- **Escrow** (`server/pokerEscrow.ts`): human-only/no-bot/no-dup/≥2 validation; atomic
  all-or-nothing buy-in debit at START_GAME (async, re-entrancy guarded); payout of final
  stacks at finish (conserves escrow); refund on orphan/teardown; payout/refund mutually
  exclusive via a `settling` transient; escrow persisted in room JSON (restart-safe). Wired
  in wsHandlers START_GAME + ADD_BOT reject, index.ts maybeRecordFinished (payout) +
  cleanupRooms/handleLeave (`deleteRoomWithSettlement`).
- **Config**: 8 stakes presets + buy-in=100×BB (`src/games/poker/stakes.ts`, server whitelist);
  blind growth every N (off-by-one in `currentBlinds`, hands 1..N base, N+1 ×2, 2N+1 ×4);
  threaded intent→CREATE_ROOM→ServerRoom→snapshot/summary→serialize→buildPokerStartAction.
  Local starting-stack selector (PokerSetup, mode local_free, NO wallet).
- **UI**: oval table `PokerGameScreen` (2–6 seats via pure `pokerSeatLayout`, viewer bottom,
  RTL-stable), `PokerShowdownReview` (exact-5 highlight from evaluator `HandScore.cards` →
  `winningFiveBySeat`; server-paced ~7s/2.5s), `PokerHandRankings` help, collapsible log,
  `PokerStakesPicker` host UX, Lobby stakes display. **Screenshots rendered + reviewed** (SSR
  harness `scripts/poker-shots.tsx` + headless Edge; seat-clip/width bugs fixed).
- Commits: `c6ba07c` (wallet race fix), `d7d6d78` (config/engine/escrow), `bac3d62` (UI),
  + wallet foundation `eeb47d5`/`f3f2b0a`. Game count **7**, achievements **52**, migration
  **0010**, no dep/version bump. Stage 37.5 timer + 37.6 routing intact.
- **DB integration tests NOT RUN** (no TEST_DATABASE_URL): wallet + escrow integration suites
  are SKIPPED; deterministic guard/fake-tx/unit coverage stands in. Manual prod smoke owed.

### Stage 37.7.1 — bankroll lifecycle hardening (COMPLETE, Unreleased)
- **Migration `0011_poker_settlement`** (`poker_match_settlements`): DB-authoritative payout↔refund
  mutual-exclusion gate (`settleMatchTx` claims the row in the SAME tx as the wallet mutation).
- **Online Poker is bankroll-only**: CREATE rejects no-DB / no-stakes / guest (async `getAccountUserId`
  awaits session resolution + non-guest). No free online table; local stays free.
- **Rematch = new paid match** (`debitRematch`): prev escrow must be resolved; mints new matchId;
  atomic fresh debit; stale settled escrow never reused; insufficient → no restart/charge.
- **Per-room serialization** (`withRoomLock`/`isRoomBusy`): start/debit/rematch/payout/refund/teardown
  serialized; leave/kick/set-timer refused for a bankroll table while busy; debit-then-start-fail → refund.
- **Crash reconciliation** (`reconcileEscrow` on restore): transient pending/settling reconciled vs
  ledger/settlement; committed debit→funded, uncommitted→dropped; committed settlement→settled/cancelled.
- **Payout conservation** (`validatePayoutConservation`): Σ final stacks == Σ buy-ins + safe-int/≥0, else fail closed.
- Tests: `pokerEscrowHardening.test.ts` (conservation/settlement-decision/lock), `wsHandlers.poker.test.ts`
  (CREATE gate), extended `pokerEscrow.integration.test.ts` (payout/refund mutex, rematch, reconcile).
  verify PASS 2795; libc 0; latest migration 0011; game count 7; achievements 52; no version bump.

### Stage 37.7.2 — crash durability + authenticated seat gate (COMPLETE, Unreleased)
- **Migration `0012_poker_matches`** (`match_id` PK, room_code, buy_in, seats jsonb): durable
  ACTIVE-match record written in the SAME tx as the buy-in debits (`recordMatchTx` in `performDebit`).
- **FAIL 1 crash durability:** `reconcileOrphanedDebits(activeMatchIds)` at bootstrap scans
  `poker_matches` LEFT JOIN settlements → refunds orphaned committed matches (no active room) once,
  independent of room JSON. `reconcileCorruptRoom` refunds by room_code.
- **FAIL 2 seat gate:** `addMember` takes `userId`; bankroll player seat requires non-guest account
  (stamped atomically), one seat per account, guest spectator allowed. JOIN awaits `getAccountUserId`.
- **FAIL 3 async cancel:** per-connection `lifecycle` (navSeq+socketOpen) → `beginNav`/`isCurrentNav`.
- **FAIL 4 nav lock:** `navWouldBreakBankroll` guards CREATE/JOIN/LEAVE while `isRoomBusy`.
- **FAIL 5 strict escrow:** `deserializePokerEscrow(v, playerCount)` → `{escrow|corrupt}`; malformed →
  `room.pokerEscrowCorrupt` (blocks deletion, alerts). `validatePayoutConservation` also validates escrow.
- **FAIL 6 idempotent repeat:** `adjustWalletTx` checks the ledger key BEFORE `computeNextBalance`.
- **Real PostgreSQL used** (Docker `postgres:16-alpine` :55432): ALL poker DB/integration/concurrency
  suites RAN GREEN (65 tests, incl. crash-sim + concurrent same-key). verify PASS 2820; libc 0; latest
  migration 0012; game count 7; achievements 52; no version bump. Re-run: `docker run -d --name kg-pg-test
  -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kingtest -p 55432:5432 postgres:16-alpine`, then
  `DATABASE_URL=postgres://postgres:test@localhost:55432/kingtest npm run db:migrate`, then
  `TEST_DATABASE_URL=... npx vitest run src/net/pokerWallet.integration.test.ts src/net/pokerEscrow.integration.test.ts`.

## Open / likely next work
- Owner may bring real bug reports from daily play; fix those before speculative polish.
- Manual smoke still most valuable: same-user phone reconnect, 5-minute bot reconnect, achievements mobile/RTL, 51 calculator/meld layout.
- The owner-requested achievement pack is now **fully implemented (Stage 37.3, catalog 34→48)** with real
  telemetry — King perfect-negatives/trump-sweep/trump-fewest, Durak win/lose-by-sixes, Deberc
  no-Бейт-win/negative-final/no-meld, Tarneeb clean-contract/bid-13-win, 51 first-move/never-opened/
  two-jokers/no-100. Durak "sixes" = final bout all-sixes taken by the fool (owner-confirmed, no rule
  existed). Deberc «Бейт» = об'яз under-score = internal `hvTeam` (labels swapped, DEBERC_RULES §7).
  Details in `ACHIEVEMENTS_PLAN.md §8`. No badges are deferred now.

## Workflow reminders
- User often asks for “prompt”; when they do, provide only a Claude prompt and do not edit files.
- If user asks to implement, act directly: read code, patch, test, commit, push.
- Use `rg` first. Use `apply_patch` for edits.
- Run `npm run verify` for runtime changes; `git diff --check`; confirm `libc=0`.
- Commit and push to `origin/main` unless user says otherwise.
- Do not bump version/tag unless doing an explicit release stage.

### Stage 37.7.3 — target-room JOIN serialization + durable fail-closed (COMPLETE, Unreleased)
- No new migration (poker_matches 0012 reused). All fixes verified on real PostgreSQL (Docker).
- **FAIL 1:** `finishJoin` re-checks `isRoomBusy(target)` before addMember (player seats);
  START_GAME verifies `escrowMatchesRoomSeats(room)` before startGame (refund+abort on divergence).
- **FAIL 2:** `finishJoin` checks `ctx.rooms.get(reqCode) === room` before+after addMember; rollback
  membership on a vanished room → no ghost member/session/welcome.
- **FAIL 3:** `parseDurableMatch` is all-or-nothing; `listUnsettledMatches` → `{ valid, corrupt }`;
  reconciliation never settles a corrupt record (operator alert).
- **FAIL 4:** `recordMatchTx` throws `DurableMatchConflictError` (rolls back tx) on matchId with
  different roomCode/buyIn/canonical-seats; exact repeat idempotent.
- **FAIL 5:** bootstrap cancels (gameState cleared → lobby) or FREEZES (corrupt durable) a bankroll
  room with a game state but no live funded escrow; `pokerMatchCancelled`/`pokerFrozen` flags block
  rescheduleAdvance + ACTION_REQUEST + START; `hasUnsettledEscrow` keeps frozen rooms.
- **FAIL 6:** `beginNav()` now also on RECONNECT/RECLAIM/LEAVE (+ socket close) → cancels pending async CREATE/JOIN.
- **FAIL 7:** `createRoom` host option takes `userId`; Poker CREATE stamps host account id atomically.
- `validatePayoutConservation` also validates seat range + exact escrow-seat==player-seat set.
- Real PostgreSQL: verify PASS 2844; DB-focused run 139 poker tests, 0 skipped. libc 0; latest
  migration 0012; game count 7; achievements 52; no version bump.

### Stage 37.7.4 — recovery-state reset + no-DB fail-closed (COMPLETE, Unreleased)
- No new migration. All fixes verified on real PostgreSQL (Docker; 164 poker DB tests, 0 skipped).
- **FAIL 1:** `pokerMatchCancelled` cleared ONLY after a successful debit+startGame (START_GAME) or
  restartGame (rematch); failed paid start → refund once + safe cancelled lobby. Integration test
  (`pokerRecovery.integration.test.ts`) proves the new match is debited once, flag cleared, action
  accepted, advance unblocked, and pays out.
- **FAIL 2:** `bankrollEconomyUnavailable(room)` (isBankrollRoom && !isDbEnabled && hasUnsettledEscrow)
  → fail closed: no rescheduleAdvance; ACTION_REQUEST/START/rematch → `ECONOMY_UNAVAILABLE`; bootstrap
  else-branch no longer advances (keeps escrow+state for a DB-backed restart).
- **FAIL 3:** `parseDurableMatch` seat range 0..5.
- **FAIL 4:** `recordMatchTx` validates fresh metadata → `InvalidDurableMatchError` + rollback.
- **FAIL 5:** async CREATE checks `isCurrentNav` before `sendError` (JOIN already did) → silent on cancel/close.
- **UX:** `RoomSnapshot.pokerRecovery` ('cancelled'|'frozen', public-only, no economy metadata); cleared on new start.
- verify PASS 2852; libc 0; latest migration 0012; game count 7; achievements 52; no version bump.

### Stage 37.7.5 — recovery retry + real recovery UI (COMPLETE, Unreleased)
- No new migration. Real PostgreSQL (Docker): 176 poker DB tests, 0 skipped.
- **FAIL 1:** ROOT CAUSE — START used `debitBuyIns` which rejects any non-pending/funded escrow
  ("already settled"), so a normal START after a refund (escrow cancelled) failed. FIX: new
  `debitFreshStart(room)` (used by START_GAME) mints a NEW matchId + escrow over a TERMINAL
  (settled/cancelled) or absent escrow, runs a fresh atomic debit; funded → idempotent; pending/
  settling → rejected; frozen → rejected; clears terminal escrow only when resolved. debitBuyIns kept
  (initial-only idempotency for tests). Integration: cancelled/settled escrow → fresh start new matchId,
  one new debit, old refund ledger intact, payout once; injected-failure retry; frozen fails closed;
  concurrent duplicate START → one match/one debit (withRoomLock + started/gameState guard).
- **FAIL 2:** rematch restart-failure → refund once + persisted broadcast CANCELLED lobby (pokerMatchCancelled,
  state cleared, rematch reset) → fresh START works.
- **FAIL 3:** `PokerRecoveryBanner` (src/ui/poker) rendered in Lobby + OnlineGame poker branch; reads
  `RoomSnapshot.pokerRecovery` ('cancelled'|'frozen'); frozen disables Start. Behavioral render test
  (renderToStaticMarkup) + 360/RTL screenshot verified. EN/UK/DE/AR keys `poker.recovery.*`.
- verify PASS 2858; libc 0; latest migration 0012; game count 7; achievements 52; no version bump.

### Stage 37.7.6 — refund-failure safety + read-only recovery table + Poker rematch (COMPLETE, Unreleased)
- Worked from HEAD `bc84723`. No new migration; no version bump. Real PostgreSQL (Docker): all 3 poker
  DB suites (29 tests) 0 skipped; verify PASS 2846.
- **FAIL 1 — refund result was ignored.** `refundBuyIns` returns boolean (`true`=confirmed/already-terminal,
  `false`=NOT committed, escrow stays `funded`). All start/rematch failure paths now BRANCH on it: only
  `true` sets `pokerMatchCancelled` + public "refunded"; `false` keeps funded, mints NO new matchId, refuses
  START/ACTION/REMATCH, persists+broadcasts an honest **settlement-pending** state. `debitFreshStart` no longer
  treats a `funded` escrow as idempotent-ok — a funded escrow at START is an **orphan**: it refunds first, or
  returns `{ok:false, settlementPending:true}` (START handler → `SETTLEMENT_PENDING`, fail closed). New
  `settlementPending(room)` = bankroll + funded escrow + no gameState; `pokerRecoveryBlocked(room)` = frozen ∨
  pending ∨ economy-unavailable. `retrySettlementPending()` in `cleanupRooms` sweeps + completes the refund once
  after DB recovery, then flips to cancelled lobby.
- **`settlement_pending` is DERIVED — no persisted field/migration.** `serverCore.snapshot()` derives
  `pokerRecovery: 'settlement_pending'`; `RoomSnapshot.pokerRecovery` union grew to include it; redactor still
  leaks no escrow/economy. New ErrorCode `SETTLEMENT_PENDING` + `poker.recovery.settlementPending` (EN/UK/DE/AR).
- **FAIL 2 — read-only recovery table.** `PokerGameScreen` gained `readOnly`; `PokerOnlineGame` sets
  `readOnly=(recovery==='frozen'||'settlement_pending')`, hiding ALL action controls + next-hand, showing a
  paused note. Behavioral render test proves the actor sees no controls + dispatch never fires.
- **FAIL 3 — Poker rematch wired.** `OnlineGame`→`PokerOnlineGame`→`PokerFinished` pass shared `rematchUi`;
  `PokerFinished` renders shared `RematchControls` (online) / local Play Again; suppressed under any recovery;
  new paid match only after prior settles. Behavioral render tests cover online/local/frozen.
- **FAIL 4 — testable seam.** `__setRefundFailure(v)` in `server/pokerEscrow.ts` injects a transient refund
  failure deterministically. Regression: `pokerEscrow.integration.test.ts` (orphan refund-fail→pending→retry→
  fresh, one net debit, old ledger intact, payout once) + `pokerRecovery.integration.test.ts` (START handler:
  SETTLEMENT_PENDING + honest snapshot, no new match; retry→fresh) + `pokerRecoveryUi.test.ts` (FAIL 2/3 UI).
- verify PASS 2846; libc 0; latest migration 0012; game count 7; achievements 52; version 0.4.8 (no bump).

### Stage 37.7.7 — payout-failure recovery + verified rematch lifecycle (COMPLETE, Unreleased)
- Worked from HEAD `e622989`. No new migration; no version bump. Real PostgreSQL (Docker): all poker DB
  suites 0 skipped; verify PASS (stable rerun, **0 worker crashes**).
- **FAIL 1 — payout had no recovery lifecycle.** `payoutStacks` now returns `PayoutResult`
  (`paid`|`already_paid`|`already_refunded`|`retry_pending`|`invalid`), not void. Transient failure →
  `retry_pending` (escrow left `funded`); `already_refunded` → honest cancelled table (never paid). New
  `payoutPending(room)` = bankroll + escrow funded/settling + FINISHED game; `pokerRecoveryBlocked` covers it;
  `snapshot()` derives `pokerRecovery:'payout_pending'` (checked before settlement_pending). Sweep unified into
  `retryPendingSettlements()` (refund for settlement-pending, PAYOUT for payout-pending, exactly once).
  `maybeRecordFinished` broadcasts the payout result; a Ready press while pending broadcasts the honest snapshot
  (no silent reset). Distinguish LIVE (funded+unfinished, untouched) / refund-pending (funded+no game) /
  payout-pending (funded/settling+finished). Test seam `__setPayoutFailure(v)`.
- **FAIL 2 — rematch lifecycle now testable + verified.** Extracted `server/pokerRematch.ts`
  `runBankrollRematch(room, deps)` (DI: debitRematch/refundBuyIns/restartGame + broadcast/persist/advance
  callbacks); `handleRematch` calls it. Real-PG tests: success (fresh matchId, one debit each, broadcast/advance/
  persist, dedup), debit_rejected (previous unsettled → no charge, honest broadcast), restart-fail+refund-fail
  → settlement_pending (not false cancelled) → retry → fresh start different matchId. NOTE: `REMATCH_READY` is
  routed in `server/index.ts` (NOT `wsHandlers.handleClientMessage`), so drive rematch via the helper, not that fn.
- **FAIL 3 — duplicate recovery banner removed.** Banner now owned by `PokerOnlineGame` (active table) +
  `PokerFinished` (finish screen); `OnlineGame` poker branch no longer renders its own. UI test counts exactly one.
- **FAIL 4 — test-count explained.** 37.7.6's `2846` was a flaky forks-pool run with 2 "worker exited
  unexpectedly" crashes (dropped ~17 tallies). Clean baseline at e622989 = **2863 passed | 54 skipped (2917)**;
  after 37.7.7 = **2870 passed | 59 skipped (2929)** (+7 UI passed, +5 DB-gated skipped). Never accept a
  worker-crash run — rerun until 0 crashes.
- New keys `poker.recovery.payoutPending` (EN/UK/DE/AR); `PokerRecoveryStatus`/`RoomSnapshot.pokerRecovery`
  gained `'payout_pending'`. verify PASS 2870/59; libc 0; migration 0012; games 7; achievements 52; v0.4.8.

### Stage 37.7.8 — settlement-before-stats + permanent invalid freeze + real rematch request handler (COMPLETE, Unreleased)
- Worked from HEAD `d100808`. No new migration; no version bump. Real PostgreSQL (Docker): all poker DB suites
  0 skipped (73 poker tests green); verify PASS **2885 passed | 64 skipped (2949)**, 0 worker crashes.
- **FAIL 1 — stats could beat payout.** Old `maybeRecordFinished` ran payout (fire-and-forget) + stats
  (fire-and-forget) in PARALLEL. Extracted `server/pokerFinish.ts`: `settleAndRecordBankrollPokerFinish(room,
  state, deps)` runs payout THEN stats as ONE serialized flow under `withRoomLock`; `recordConfirmedPokerStats`
  (human-only gate + `pokerFinishSignature` dedup + seatUsers) records ONLY on `paid`/`already_paid`.
  `retry_pending`→stats deferred to the sweep; `already_refunded`→cancel table, no stats; `invalid`→freeze, no
  stats. Bankroll poker returns BEFORE the generic pre-payout stats block (which stays for the other 6 games +
  non-bankroll poker; keeps `gt==='poker'`/`recordFinishedPokerGame`/`pokerFinishSignature` strings in index.ts
  so pokerStatsWiring test passes). `retryPendingSettlements` payout branch now also uses settle+record (a
  retry that finally pays out records stats).
- **FAIL 2 — `invalid` is PERMANENT, not transient.** `freezeRoomForOperator(room, reason)` sets `pokerFrozen`
  (logs room code + safe reason ONCE). `payoutPending`/`settlementPending` now return **false** when
  `room.pokerFrozen` → sweep never re-attempts the impossible payout (no 45s spam). `deleteRoomWithSettlement`
  keeps a frozen room (no auto pay/refund/purge). Frozen already blocks START/ACTION (wsHandlers) + REMATCH
  (`pokerRecoveryBlocked`); snapshot exposes only public `frozen`; survives serialize/restore.
- **FAIL 3 — real request handler extracted.** `server/pokerRematch.ts` `handleRematchRequest(session, decline,
  deps)`; `handleRematch` in index.ts just wires real deps. Spy tests: seated-human auth (spectator/AI/unknown
  no-op), first-ready progress, last-ready → one `runBankrollRematch` under lock, no-double-restart re-check,
  decline, recovery-blocked → honest broadcast. Real-PG: READY → genuine new paid match (one debit/seat).
- **FAIL 4 — seam reset.** `afterEach` resets `__setRefundFailure(false)`+`__setPayoutFailure(false)` in every
  suite using them (pokerEscrow/pokerRecovery/pokerRematch.lifecycle/pokerFinish/pokerRematchRequest).
- New files: `server/pokerFinish.ts`, tests `pokerFinish.integration.test.ts` (FAIL1, DB), `pokerFrozenInvalid.test.ts`
  (FAIL2, pure), `pokerRematchRequest.test.ts` (FAIL3, spies + 1 DB). No i18n/schema change. libc 0; migration 0012;
  games 7; achievements 52; v0.4.8.

### Stage 37.7.9 — finish/rematch correctness hardening (COMPLETE, Unreleased)
- Worked from HEAD `c19d823`. No new migration (pokerStatsPending is a persisted room-JSON field, not a schema
  change); no version bump. Real PostgreSQL (Docker): all poker suites 0 skipped (**220 poker tests green**);
  verify PASS **2894 passed | 67 skipped (2961)**, 0 worker crashes (rerun; first run had 5 flaky forks crashes).
  3 FAILs reproduced RED first, then fixed.
- **FAIL 1 — same-room same-outcome stats collision.** `games.game_key` was content-only (room+winner+hands+winners)
  → two identical-outcome paid matches/rematches collided, 2nd silently dropped. FIX: `gameKey(roomCode, summary,
  matchId?)` → `sha256('poker|match|<matchId>')` for bankroll (stable escrow matchId; hash only, never exposed);
  content fallback for non-bankroll. `recordFinishedPokerGame(...,matchId?)`; `recordConfirmedPokerStats` uses
  `room.pokerEscrow.matchId` for BOTH the durable key and the in-memory marker.
- **FAIL 2 — transient stats failure after paid lost forever.** Escrow already `settled` → payoutPending false →
  sweep never revisited. FIX: `recordConfirmedPokerStats`→ 4-way `StatsResult` (recorded/already_exists/skipped/
  failed); a `failed` write after paid sets **persisted `room.pokerStatsPending`** (serialize/restore). New
  `statsPending(room)` predicate feeds `pokerRecoveryBlocked` (blocks new paid rematch, NEVER re-pays) + derived
  public `pokerRecovery:'stats_pending'` (money out → not payout_pending; no leak). `retryPendingSettlements`
  stats-pending branch retries ONLY the stats write until resolved → clears flag; `deleteRoomWithSettlement`
  flushes owed stats before purge. Durable `game_key` = exactly-once even with a fresh marker. i18n key
  `poker.recovery.statsPending` ×4 + banner + PokerOnlineGame blocked + CSS.
- **FAIL 3 — queued-rematch TOCTOU.** `handleRematchRequest` checked readiness/recovery before `withRoomLock`,
  re-checked only `isRoomFinished` inside. FIX: re-validate UNDER the lock — finished + `!pokerRecoveryBlocked`
  + `allHumansReady`; a decline/disconnect/recovery-change while queued aborts `runRematch` (no new debit) with an
  honest broadcast; two queued last-Ready → lifecycle at most once.
- New files: `server/pokerFinish.ts` (StatsResult), tests `pokerStatsIdentity.integration.test.ts`,
  `pokerStatsPending.test.ts` (pure), `pokerStatsPending.integration.test.ts`, extended `pokerRematchRequest.test.ts`
  (deferred-lock TOCTOU). Updated `pokerFinish.integration.test.ts` to the `.stats` contract. libc 0; migration 0012;
  games 7; achievements 52; v0.4.8. HEAD after commit: see git log (Stage 37.7.9).

### Stage 37.7.10 — paid-finish recovery + teardown correctness (COMPLETE, Unreleased)
- Worked from HEAD `894ad6e`. No new migration; no version bump. Real PostgreSQL (Docker): all poker suites 0 skipped
  (**238 poker tests green**); verify PASS **2902 passed | 77 skipped** on the STABLE rerun (first run had 9 flaky
  forks worker-crashes — NOT a PASS; rerun 0 crashes, E2E PASS). All 3 FAILs reproduced RED first.
- **FAIL 1 — bootstrap wiped a restored PAID finish.** index.ts recovery pass (d) treated any non-funded/settling
  escrow (INCLUDING `settled`) as a refund → `pokerMatchCancelled`+gameState=null → stats lost; crash-window
  (persisted `settling` + durable payout) also mis-cancelled after reconcile→settled. FIX: new `server/pokerBootstrap.ts`
  `classifyBootstrapRecovery(room, isFinished)` (pure) + `applyBootstrapRecovery`; index.ts pass (d) uses them.
  `settled`+finished → `paid_finish` (keep state; index sets `pokerStatsPending` → sweep finalizes stats idempotently,
  NO re-payout); `cancelled` only for refunded/absent escrow. `payout_pending`/`live`/`frozen` distinguished.
- **FAIL 2 — teardown raw payout→purge bypass.** `deleteRoomWithSettlement` ran raw `payoutStacks`→purge (no stats).
  FIX: `server/pokerFinish.ts` `settleRoomForDeletion(room, deps)` runs the SAME `settleAndRecordBankrollPokerFinish`
  for a finished match; purges ONLY when escrow terminal + not frozen + no owed stats; transient `failed` → `keep`
  (persist, retry, payout never repeated). Delete guard now also enters the lock for any finished bankroll game.
- **FAIL 3 — stats attribution from current members lost after LEAVE.** `handleLeave` empties members BEFORE teardown
  → `recordConfirmedPokerStats` saw <2 humans → `skipped` (cleared owed flag). FIX: for a bankroll room it derives
  `seatUsers` + participant policy from IMMUTABLE `pokerEscrow.seats` (seat→userId, ≥2, no bots by construction) and
  identity from escrow `matchId`; missing/malformed escrow → `failed` (retryable), never silent `skipped`. Non-bankroll
  keeps the membership fallback. Also: paid branch computes stats + sets final recovery flag BEFORE the single
  broadcast (no rematch-enabled flicker).
- New files: `server/pokerBootstrap.ts`; tests `pokerBootstrap.test.ts` (pure), `pokerBootstrapRecovery.integration.test.ts`,
  `pokerTeardown.integration.test.ts`, `pokerStatsAttribution.integration.test.ts`. No i18n/schema change; `pokerStatsPending`
  already persisted (37.7.9). libc 0; migration 0012; games 7; achievements 52; v0.4.8.
- **CORRECTION (made in 37.7.11):** that stage's `pokerBootstrapRecovery.integration.test.ts` did NOT drive the production
  bootstrap path — it re-created the reconcile→classify→apply sequence inside a local `recover()` helper. That is why it
  missed the early `rescheduleAdvance` in the restore loop and the `settled`+unfinished misclassification.

### Stage 37.7.11 — fail-closed recovery of incoherent paid matches (COMPLETE, Unreleased)
- Worked from HEAD `d5af053`. No new migration; no version bump. Real PostgreSQL (Docker): all poker suites 0 skipped.
  Both FAILs reproduced RED first (9 failing probes against the unpatched code).
- **FAIL 1 — already-paid but UNFINISHED room resumed as `live`.** `classifyBootstrapRecovery` returned `live` for a
  `settled` escrow + unfinished state (crash window: finish → payout commits → room JSON still pre-finish → crash →
  `reconcileEscrow` promotes settling→settled). FIX: new classification **`incoherent_paid`** → clear timers + **permanent
  `pokerFrozen`** (logged once, safe reason), state kept as evidence, NOT `pokerMatchCancelled`. Blocks START/ACTION/REMATCH,
  excluded from every sweep predicate, `hasUnsettledEscrow` true (never purged), survives restore, public snapshot only
  `frozen`. Restore loop now defers the advance for **every** bankroll room via pure `shouldDeferBootstrapAdvance(room)`
  (previously only `hasUnsettledEscrow`), so nothing advances before classification. `settleRoomForDeletion` keeps a frozen
  room and freezes+keeps a settled-but-unfinished one; `deleteRoomWithSettlement`'s sync fast-path guard widened from
  "finished game" to **any carried game state**.
- **FAIL 2 — a settled payout skipped structural validation before stats.** `payoutStacks` short-circuited `settled` →
  `already_paid` with no checks, and the stats recorder only checked escrow-exists/≥2 seats/matchId/non-empty userIds.
  FIX: new **`server/pokerParticipants.ts` `validatePaidMatchParticipants(escrow, state)`** — the ONE strict validator
  (matchId, safe buyIn, 2–6 seats, in-range/unique seats, unique accounts, `amount===buyIn`, playerCount vs players vs
  stacks, exact escrow-seat == player-seat set, no `ai` seat, participant winner). `validatePayoutConservation` delegates
  its structural half to it; `recordConfirmedPokerStats` builds `seatUsers` from it; `payoutStacks` validates a `settled`
  escrow before returning `already_paid`. New **`StatsResult: 'invalid'`** = permanent (freeze, owed flag kept, no write,
  no retry), distinct from transient `failed` / durable `already_exists` / policy `skipped`; handled in
  `settleAndRecordBankrollPokerFinish` and the index stats sweep. NOTE: 37.7.10's malformed-escrow cases that returned
  `failed` now return `invalid` (still never `skipped`).
- **Production orchestration seam:** `server/pokerBootstrap.ts` **`recoverRestoredBankrollRoom(room, deps)`** (reconcile →
  classify → apply/persist/advance) is called by `server/index.ts` pass (d) under `withRoomLock` AND by the integration
  suite — tests can no longer re-implement the branching.
- Synthetic payout fixtures in older suites (`{stacksBySeat}` only) were given real player lists — the strict validator
  now checks the STATE side too. New file `server/pokerParticipants.ts`; new test `pokerParticipants.test.ts` (20-case
  malformed matrix); extended `pokerBootstrap.test.ts`, `pokerBootstrapRecovery.integration.test.ts` (production helper +
  incoherent-paid case), `pokerTeardown.integration.test.ts` (incoherent + structurally-invalid teardown).
  libc 0; migration 0012; games 7; achievements 52; v0.4.8.

### Stage 37.7.12 — durable gameState ↔ escrow-generation binding (COMPLETE, Unreleased)
- Worked from HEAD `1d6e21f`. No new migration (reuses the room JSON), no version bump, other 6 games untouched.
  Both FAILs reproduced RED first on the unpatched code.
- **RED proof (FAIL 1).** Real-PG probe: settle M0 → keep its finished state → durable debit M1 (as a rematch) →
  persist the crash snapshot (escrow M1 + M0's state) → production bootstrap/reconcile/sweep ⇒
  `recovery=payout_pending`, **`table_payout` rows for M1 = 1**, `refund` rows for M1 = 0, `games` = 2 (M0's result
  recorded a second time under M1's identity). Root cause: `performDebit` swaps `room.pokerEscrow` to M1 BEFORE the
  DB debit resolves and long before `restartGame`, and the socket close handler persists WITHOUT the room lock.
- **FIX.** Server-only persisted **`ServerRoom.pokerGameMatchId`** + new **`server/pokerBinding.ts`**
  (`escrowGameBinding` → `not_bankroll|no_game|no_escrow|bound|unbound|unknown`, `gameBoundToEscrow`,
  `bindGameToEscrow` — only for a **funded** escrow with a state, `clearGameBinding`, `resolveUnboundEscrowGame`).
  Bound at exactly 2 sites: `wsHandlers` START and `runBankrollRematch`, each AFTER a successful debit AND a
  successful start/restart. Cleared with the state everywhere. Serialized/restored (non-empty string only); NEVER in
  `RoomSnapshot`/`RoomSummary`/messages; never logged. **The room lock is not a substitute** — it serializes inside
  one process; the binding survives the crash boundary.
- **Gate `pokerGameMatchId === pokerEscrow.matchId` added to:** `payoutPending`, `settleAndRecordBankrollPokerFinish`
  (new `FinishResult` value **`unbound_state`**, no wallet touched), `recordConfirmedPokerStats` (→ `invalid`),
  `classifyBootstrapRecovery`, `settleRoomForDeletion`, and bootstrap **`activeMatchIds`** (an unbound durable debit is
  deliberately NOT active → the orphan scan refunds it once instead of protecting it).
- **Unbound lifecycle:** new `unboundEscrowGame(room)` (in `pokerRecoveryBlocked` → no timers/actions/rematch) +
  `resolveUnboundEscrowGame` (drop stale state+binding, clear timers, idempotent `refundBuyIns` → `refunded` ⇒
  `pokerMatchCancelled` honest lobby, or `settlement_pending` ⇒ funded escrow + no state, retried by the sweep, never
  purged). Callers: `recoverRestoredBankrollRoom` (classification **`unbound_debit`**), `retryPendingSettlements`,
  `settleRoomForDeletion` (`purge` only after a CONFIRMED refund).
- **Fail-closed:** **`unknown_binding`** (legacy save: state + live escrow, no marker) → **frozen**, generation never
  guessed; `settled` + `unbound` → frozen; a `pending` escrow surviving reconcile → `cancelled` (nothing charged).
- **Six crash windows all green** (`src/net/pokerRematchCrash.integration.test.ts`, real PG): pending-uncommitted →
  0/0/0; pending-committed → 1 refund, 0 payout, 0 stats; funded + old state → 1 refund, balances back to pre-rematch,
  then a fresh **M2 starts and finishes normally**; bound live state → `live`; bound finished state → payout+stats
  exactly once; missing binding → frozen, nothing written. M0's payout/stats never duplicated.
- **FAIL 2 — strict FINISHED paid-state validation.** `validatePaidMatchParticipants` tightened (`stacksBySeat.length`
  **exactly** `playerCount`; POSITIVE `type === 'human'` instead of `!== 'ai'`, which let `undefined`/`'bot'`/unknown
  through; unique non-empty player ids) and new **`validateFinishedPaidMatch`** adds the finished-only invariants
  (`phase === 'game_finished'`, exactly one participant `winnerSeat`, winner stack == Σ buy-ins, all other stacks 0).
  Both `validatePayoutConservation` and `recordConfirmedPokerStats` delegate to it → payout and stats can never
  disagree; the layer split keeps live gameplay validation untouched. Every malformed shape ⇒ `invalid`: no payout,
  no stats/games/game_players/user_stats row, permanent freeze, no repeat payout/refund, teardown `keep`.
- New files: `server/pokerBinding.ts`, `src/net/pokerBinding.test.ts` (pure binding/classification/privacy matrix),
  `src/net/pokerRematchCrash.integration.test.ts` (real-PG crash windows). Extended: `pokerBootstrap.test.ts`,
  `pokerDurableParse.test.ts`, `pokerEscrowHardening.test.ts`, `pokerFinish/Recovery/Teardown/StatsAttribution/
  StatsPending/Escrow*.integration` suites, `pokerRematch.lifecycle.test.ts`, `pokerRematchRequest.test.ts`.
- **Gates:** real Docker PostgreSQL — **29 poker suites / 267 tests, 0 skipped**; `npm run verify` run twice stably
  (**288 files / 3040 tests**, 0 worker crashes) + build + E2E PASS; `git diff --check` clean; libc 0; no package/lock
  drift; migration stays **0012**; v0.4.8; games 7; achievements 52.
- **CORRECTED by 37.7.13:** the claim "unknown binding freezes without payout/refund" did NOT hold in production —
  the startup orphan scan ran BEFORE classification and refunded such a room first.

### Stage 37.7.13 — bootstrap settlement ordering + ambiguous pending recovery (COMPLETE, Unreleased)
- Worked from HEAD `5c7b535`. No new migration (room JSON only), no version bump, other 6 games untouched.
  Both FAILs reproduced RED first (a temporary probe replaying the OLD index.ts ordering verbatim).
- **RED (FAIL 1).** Legacy room = live poker state + funded durable escrow + NO `pokerGameMatchId`. Old
  `server/index.ts` order: reconcile → `activeMatchIds` from a room SHAPE test (funded|settling + gameState +
  `gameBoundToEscrow`) → `reconcileOrphanedDebits` → classify/apply. `unknown` binding fails the shape test ⇒ NOT
  protected ⇒ the global scan refunded it (**`table_cancel_refund` = 2**) seconds before recovery froze it ⇒ room
  `funded` + `pokerFrozen` in memory while the DB says refunded. 37.7.12's test missed it (it drove only the per-room
  helper, never the global scan).
- **RED (FAIL 2).** A PARTIAL durable debit (one seat's ledger row deleted) survives reconcile as `pending`;
  `classifyBootstrapRecovery` mapped `pending` → **`cancelled`**, wiping gameState + binding and setting
  `pokerMatchCancelled` while the durable outcome was UNKNOWN.
- **FIX 1 — one shared pipeline.** `server/pokerBootstrap.ts` **`runBootstrapEconomyRecovery(rooms, deps)`**: reconcile
  (keeping the explicit outcome) → classify → **`settlementProtectedMatchId(room, recovery, reconcile)`** → orphan scan
  → corrupt-room pass → apply (`recoverRestoredBankrollRoom(room, deps, reconciled)` reuses the SAME reconciliation).
  `server/index.ts` and `pokerBootstrapOrdering.integration.test.ts` both call it — a test can no longer skip the scan.
  PROTECTED = live / payout_pending / paid_finish / incoherent_paid / unknown_binding / recovery_pending /
  corrupt_debit / frozen + any `pending`|`settling` escrow or `retry_pending`|`corrupt_partial` reconciliation (even
  with NO gameState). NOT protected = `unbound_debit` (explicitly stale → failed-start refund once), resolved escrow,
  plain funded orphan with no game.
- **FIX 2 — explicit reconciliation result.** `reconcileEscrow` now returns **`EscrowReconcileResult`** =
  `noop|funded|settled|cancelled|proven_uncommitted|retry_pending|corrupt_partial` (was `void`). New classifications
  **`recovery_pending`** (unproven → keep state+binding+escrow, clear timers only, NOT cancelled, NOT frozen, retried)
  and **`corrupt_debit`** (partial debit → permanent freeze). `cancelled` now needs durable proof (a `cancelled` escrow
  or `proven_uncommitted`). New predicate **`escrowUnresolved(room)`** → in `pokerRecoveryBlocked`, guards
  `rescheduleAdvance` + `ACTION_REQUEST` (`SETTLEMENT_PENDING`); teardown returns `keep` (never purge/settle) and
  freezes `corrupt_partial`; `snapshot` reports the opaque `settlement_pending`. Test seam `__setReconcileFailure`.
- **Regression matrix** (`src/net/pokerBootstrapOrdering.integration.test.ts`, real PG, full pipeline): A unknown
  binding → protected, frozen, 0 refund/payout/stats, balances still debited, no settlement row, teardown keep, WS
  START/ACTION rejected, repeat boot idempotent, freeze logged once, snapshot leak-free; B explicit unbound → refunded
  exactly once, old state never a paid finish, repeat boot idempotent; C bound live → protected, resumes once;
  D transient pending → nothing cleared/declared/settled, protected, no advance, actions rejected, teardown keep, then
  the retry restores it `live`; E proven zero debit → the ONLY path to `cancelled`; F partial debit → frozen,
  0 settlement, idempotent; G ordering spies → the scan runs ONCE, AFTER classification, with exactly
  {bound, unknown, unproven} and NOT the unbound match; only the classified live match advances.
- **Test-suite isolation (pre-existing flake, now fixed).** `reconcileOrphanedDebits` is cluster-wide, so one
  integration FILE's scan refunded another concurrently-running file's in-flight match — reproduced on the 37.7.12
  baseline (1 failure in 6 poker runs). New `src/net/pokerDbSuite.testutil.ts`: `withPokerDbSuiteLock(beforeAll,
  afterAll)` (Postgres ADVISORY lock on a RESERVED connection → serializes across vitest workers, self-releasing) added
  to all 13 poker DB files, + `scopedOrphanScan` (protects every match the suite doesn't own). `pokerRematchCrash`'s
  hand-rolled activeMatchIds rule replaced by the production `settlementProtectedMatchId`.
- **Gates:** real Docker PostgreSQL — **30 poker suites / 275 tests, 0 skipped, 8/8 clean consecutive runs**;
  `npm run verify` twice stably (**289 files / 3048 tests**, 0 worker crashes) + build + E2E PASS; `git diff --check`
  clean; libc 0; no package/lock drift; migration stays **0012**; v0.4.8; games 7; achievements 52.
- **CORRECTED by 37.7.14:** "retried on the next sweep/restart" was only true for RESTART — the periodic sweep never
  reconciled an unresolved escrow, so such a room stayed blocked for the life of the process.

### Stage 37.7.14 — runtime recovery sweep + settlement precedence + corrupt durable freeze (COMPLETE, Unreleased)
- Worked from HEAD `e87f27d`. No new migration, no version bump, other 6 games untouched. All 5 RED probes reproduced
  first by replaying the production sweep/bootstrap wiring verbatim.
- **RED evidence.** (1) bound `pending` after a transient boot failure: sweep branch = **`no_branch`**, escrow stays
  `pending`, room unplayable until restart. (2) `pending` + UNBOUND: sweep branch = `unbound` → `gameState = null`,
  `binding = undefined`, escrow STILL `pending` (refund refused) — evidence destroyed with nothing refunded.
  (3) `pending` + committed payout → `reconcileEscrow` returned **`funded`** (must be `settled`). (4) `pending` +
  committed `cancel_refund` → returned **`funded`** (must be `cancelled`). (5) bound funded room + malformed durable
  `poker_matches` row → `recovery = live`, `advanced = [room]`, `frozen = undefined`.
- **FIX 1 — `runRoomRecoverySweep(room, deps)`** in `server/pokerBootstrap.ts`, used by `server/index.ts` AND the tests.
  Under `withRoomLock`: frozen → no-op; escrow not transient → idle; else reconcile → `classifyBootstrapRecovery` →
  shared apply. Returns `{reconciled, recovery, changed}`; `changed=false` while unproven (no mutation, no 45s log
  spam). Entry guard is `escrowUnresolved(room)`, tested FIRST in `retryPendingSettlements` — reconciliation has
  PRECEDENCE over unbound/refund/payout/stats routing. `unboundEscrowGame` and `payoutPending` narrowed to **`funded`
  only**. A revived room stops matching once resolved ⇒ `rescheduleAdvance` fires exactly once.
- **FIX 2 — settlement precedence in `reconcileEscrow`.** A durable settlement row now wins for EVERY transient status:
  `payout` → `settled`, `cancel_refund` → `cancelled`; only with no row does the buy-in ledger decide (full → funded,
  zero → proven_uncommitted, partial → corrupt_partial; settling+no row → funded).
- **FIX 3 — corrupt DURABLE match freezes its room.** `reconcileOrphanedDebits` gained **`corruptRoomCodes`** (room
  codes only) and `runBootstrapEconomyRecovery` step (e2) freezes those rooms BEFORE apply (classification then
  short-circuits to `frozen`). Distinct from `pokerEscrowCorrupt` (malformed room JSON) — this is a VALID room escrow
  with a malformed `poker_matches` row. No advance/refund/payout/stats/purge; all evidence kept; log once; snapshot
  `frozen`. `BootstrapEconomyReport.corruptDurableRooms` exposes it to tests only.
- **New tests:** `src/net/pokerRuntimeSweep.integration.test.ts` (10 real-PG cases through BOTH production entry
  points — incl. non-regression for live/payout_pending/stats_pending/unbound and for non-poker + LOCAL poker) and a
  pure `runRoomRecoverySweep` precedence/guard matrix in `pokerBootstrap.test.ts`. The suite lock now covers **14**
  poker DB files.
- **Gates:** real Docker PostgreSQL — **31 poker suites / 291 tests, 0 skipped** (6/6 clean consecutive runs measured
  at 285, before the 6 pure `runRoomRecoverySweep` guard tests were added; re-confirmed green at 291);
  `npm run verify` twice stably (**290 files / 3064 tests**, 0 worker crashes) + build + E2E PASS; `git diff --check`
  clean; libc 0; no package/lock drift; migration stays **0012**; v0.4.8; games 7; achievements 52.
- **CORRECTED by 37.7.15:** corrupt-durable association was roomCode-only (froze healthy rooms that reused a 4-char
  code); bootstrap checked only that a durable row PARSED, not that it OWNED the escrow; and "operator log never
  contains a matchId" was false for five economy log lines.

### Stage 37.7.15 — exact durable ownership + collision-safe corrupt handling + secret-free logs (COMPLETE, Unreleased)
- Worked from HEAD `5bcbde6`/`ec1f539`. No new migration, no version bump, other 6 games untouched. All 3 FAILs
  reproduced RED first against the production pipeline.
- **RED.** (1) stale corrupt record for code `RQ1A` + a brand-new healthy table reusing it → `recovery = frozen`,
  `advanced = []` (permanent false-positive DoS). (2) deleted `poker_matches` row → `live`; row with another buyIn +
  swapped accounts → `live`; `pending` room whose buy-in ledger COUNT was right but one row moved to another account →
  `reconciled = funded` → `live`. (3) captured `[Poker] orphaned match corr-… is CORRUPT` and
  `[Poker] crash-recovery refund for orphaned match 2a1d0137-…`.
- **FIX 2 (ownership).** New `matchDurableEvidence(matchId)` (parsed durable row + EVERY `table_buy_in` row with
  userId/delta/idempotencyKey/roomCode + settlement) and PURE `server/pokerDurableOwnership.ts`
  `validateDurableOwnership` → `settled_payout|settled_refund|exact_funded|proven_uncommitted|missing_durable|
  corrupt_durable|metadata_mismatch|ledger_partial|ledger_mismatch`. Requires the row to exist/parse/match
  roomCode+buyIn+canonical seats AND exactly one correct buy-in row per participant (delta, roomCode, shared
  `buyInIdempotencyKey`, no extras). New `resolveEscrowEvidence(room)` covers pending/settling **and funded** and is
  injected by `bootstrapRecoveryDeps`; `reconcileEscrow` keeps the transient-only scope for teardown.
  `EscrowReconcileResult` +4 values, `isCorruptEvidence()` → the ONE `corrupt_debit` classification. `proven_uncommitted`
  drops only a PENDING escrow; a funded one with no trace is `missing_durable`.
- **FIX 1 (collision).** `reconcileOrphanedDebits` → `corruptRefs: {matchId, roomCode, reasonCode}[]` (internal only);
  step (e2) freezes by **matchId**, roomCode is audit context. `pokerEscrowCorrupt` keeps its roomCode path.
- **FIX 3 (logs).** All five poker economy logs → `room <code>: <bounded reason>`; regression test spies on the REAL
  console across scan/refund/invalid-payout/repeat-bootstrap.
- **New tests:** `pokerDurableOwnership.integration.test.ts` (10 real-PG cases incl. the full 12-point matrix) and
  `pokerDurableOwnership.test.ts` (7 pure contract cases). Suite lock now covers **15** poker DB files.
- **Gates:** real Docker PostgreSQL — **32 poker suites / 308 tests, 0 skipped, 6/6 clean consecutive runs**;
  `npm run verify` twice stably (**292 files / 3081 tests**, 0 worker crashes) + build + E2E PASS; `git diff --check`
  clean; libc 0; no package/lock drift; migration stays **0012**; v0.4.8; games 7; achievements 52.
- **CORRECTED by 37.7.16:** the settlement row was checked FIRST and RETURNED, so it bypassed structural ownership
  entirely; `settled`/`cancelled` escrows were never validated at bootstrap; the proof ran at recovery but NOT
  atomically inside the payout/refund transaction; and the evidence loader composed three READ COMMITTED snapshots.

### Stage 37.7.16 — terminal settlement integrity + settlement-time guard + consistent snapshot (COMPLETE, Unreleased)
- Worked from HEAD `e2a03e8`. No new migration, no version bump, other 6 games untouched. All 4 FAILs reproduced RED.
- **RED.** (1) `settled` + payout row + finished state + DELETED `poker_matches` → `paid_finish` AND
  `recordConfirmedPokerStats` = **`recorded`** (a real games row attributed from the room escrow alone); `cancelled` +
  refund row + corrupt row → `cancelled` with the game state CLEARED. (2) room says `settled` with NO DB settlement →
  `paid_finish`; room says `cancelled` while the DB says PAYOUT → `cancelled` + state cleared. (3) deleting
  `poker_matches` after START then finishing → `paid`, 1 payout row, 1 settlement row. (4) replaying the loader's three
  statements around an atomic debit observed `{matchRowExists:false, buyIns:2}` → would be `missing_durable`.
- **FIX 1 — combined model.** `validateDurableOwnership` → `{ financial, structure }`, computed INDEPENDENTLY;
  `resolveEscrowEvidence` requires BOTH (`exact`+payout→settled, `exact`+refund→cancelled, `exact`→funded; anything
  else → the matching permanent value; `proven_uncommitted` WITH a settlement row → `corrupt_durable`).
  `recordConfirmedPokerStats` also refuses outright for a FROZEN bankroll room.
- **FIX 2 — terminal claims.** Bootstrap evidence filter → **`claimsEconomyMatch`** (escrow of ANY status / gameState /
  binding / owed stats); `resolveEscrowEvidence` covers terminal escrows; new **`terminal_unconfirmed`** and
  **`terminal_conflict`** (both in `isCorruptEvidence`); `settlementProtectedMatchId` protects corrupt-evidence rooms
  BEFORE its terminal early-return so an unconfirmed `settled` room isn't orphan-refunded before being frozen.
- **FIX 3 — atomic guard.** New `settleMatchWithOwnershipTx` (lock `poker_matches` FOR UPDATE → read ledger from the
  same snapshot → require `exact` → claim the settlement gate → mutate wallets); typed `DurableOwnershipError` rolls
  the whole transaction back. `payoutStacks` uses it (and re-proves before `already_paid`); `refundBuyIns` split into
  **`refundBuyInsResult`** (`resolved|retry_pending|invalid`) + a boolean wrapper; `settleRoomForDeletion` freezes on
  `invalid`.
- **FIX 4 — one snapshot.** `matchDurableEvidence` reads all three relations in ONE `REPEATABLE READ` read-only
  transaction (shared `readEvidence` with the guard). Test seam **`__setEvidenceReadGap`** awaited BETWEEN reads.
- **New tests:** `pokerSettlementIntegrity.integration.test.ts` (11 real-PG cases: A–H, guard 1–6, replays 7–10, the
  deterministic snapshot test, transient + non-poker/local non-regression); `pokerDurableOwnership.test.ts` rewritten
  for the two-axis contract (its old "settlement outranks everything" case had pinned the DEFECT). Suite lock covers
  **16** poker DB files.
- **Gates:** real Docker PostgreSQL — **34 poker suites / 319 tests, 0 skipped, 6/6 clean consecutive runs**;
  `npm run verify` twice stably (**293 files / 3092 tests**, 0 worker crashes) + build + E2E PASS; `git diff --check`
  clean; libc 0; no package/lock drift; migration stays **0012**; v0.4.8; games 7; achievements 52.
- **CORRECTED by 37.7.17:** the atomic guard covered only the ROOM payout/refund — the GLOBAL orphan refund and
  `reconcileCorruptRoom` still used the unguarded `settleMatchTx`; escrowless claims were cancelled unconditionally;
  and the terminal `settled`/`cancelled` refund fast path answered `resolved` with no DB proof.

### Stage 37.7.17 — guarded orphan settlement + escrowless recovery claims (COMPLETE, Unreleased)
- Worked from HEAD `adf4cce`. No new migration, no version bump, other 6 games untouched. All 3 FAILs reproduced RED.
- **RED.** (1) an orphan missing ONE seat's buy-in row → `refunded: true`, 2 refund rows, the never-debited account back
  at **1,000,000 (minted chips)**, settlement = 1; same for an empty ledger and a wrong-account debit. (2) escrowless
  room + live state + binding → `cancelled` with state AND binding CLEARED, under a transient scan failure, under a
  durable PAYOUT, and with no binding at all. (3) `refundBuyInsResult` = `resolved` with 0 DB settlements.
- **FIX 1 — one guarded contract.** `refundDurableMatch` → `settleMatchWithOwnershipTx` (parsed record = EXPECTED
  metadata) returning `RefundResult`; `reconcileOrphanedDebits` counts only `resolved`, routes `invalid` to
  `corruptRefs` and adds a **`retryable`** array; `reconcileCorruptRoom` requires `resolved`. **`settleMatchTx` deleted**
  — no poker settlement API exists without an ownership proof.
- **FIX 2 — escrowless state machine.** `resolveEscrowlessClaim` (validates the durable record against ITSELF) →
  `cancelled` | `proven_uncommitted` | **`escrowless_unknown`** (no binding, or durable PAYOUT → frozen) |
  **`escrowless_unresolved`** (exact+unsettled → inert) | corrupt values | `retry_pending`. `classifyBootstrapRecovery`
  no longer maps `!esc` to `cancelled`. New predicate **`escrowlessClaim`** → `pokerRecoveryBlocked`, advance guard,
  ACTION guard, public `settlement_pending`, and `settleRoomForDeletion` keeps (never purges) such a room.
  Bootstrap step **(e3)** cancels an escrowless claim ONLY if its matchId is in the scan's confirmed `orphanRefunded`;
  step **(e4)** freezes an unprovable claim with no game state (owed stats without escrow).
- **FIX 3 — terminal fast path.** `refundBuyInsResult`'s terminal branch routes through `resolveEscrowEvidence`:
  transient → `retry_pending`, corrupt → `invalid` (teardown freezes + keeps), only DB-confirmed → `resolved`.
- **New tests:** `pokerGuardedSettlement.integration.test.ts` (8 real-PG tests). Updated: the pure `cancelled`-needs-
  proof matrix in `pokerBootstrap.test.ts` and 37.7.16's replay case 10 (a terminal claim over corrupt evidence is now
  `invalid`, not `resolved`). Suite lock covers **17** poker DB files.
- **Gates:** real Docker PostgreSQL — **35 poker suites / 327 tests, 0 skipped, 6/6 clean consecutive runs**;
  `npm run verify` twice stably (**294 files / 3100 tests**, 0 worker crashes) + build + E2E PASS; `git diff --check`
  clean; libc 0; no package/lock drift; migration stays **0012**; v0.4.8; games 7; achievements 52.
- NOTE: the shared test Postgres accumulates rows when a run fails mid-test; truncate the poker/games/users tables
  before trusting a count-based assertion.

### Stage 37.7.18 — settlement outcome integrity + runtime orphan recovery (COMPLETE, Unreleased)
- Worked from HEAD `21d6d06`. No new migration, no version bump, other 6 games untouched. All 3 FAILs reproduced RED.
- **CORRECTS 37.7.17:** `resolved` mixed a real refund with `already_paid`; `reconcileCorruptRoom` auto-refunded by
  reusable roomCode; the global orphan scan ran only at bootstrap (transient failures needed a RESTART).
- **RED.** (1) a durably PAID match answered `resolved`, and the deterministic scan race put its matchId in
  `scan.refunded` while the settlement row said `payout` with 0 refund rows. (2) `reconcileCorruptRoom` = `true` with a
  `cancel_refund` settlement + 2 refund rows for a match it could not own. (3) after a transient guarded-refund failure
  the orphan stayed debited (995 000) and no runtime coordinator existed.
- **FIX 1.** `RefundResult` = `confirmed_refund | already_paid | nothing_to_refund | retry_pending | invalid` (both
  `refundBuyInsResult` and `refundDurableMatch`); scan reports `refunded` / `alreadyPaid` / `corrupt`+`corruptRefs` /
  `retryable`. Boolean `refundBuyIns` DELETED; `resolveUnboundEscrowGame` gained `paid_conflict` → freeze; the
  settlementPending sweep, `debitFreshStart`, rematch/failed-start and teardown all require `confirmed_refund`.
- **FIX 2.** `reconcileCorruptRoom` never settles by roomCode (freeze if any unsettled match names it; the flag clears
  only when none does), and `reconcileOrphanedDebits(protectedMatchIds, protectedRoomCodes)` fail-closed protects those
  codes in BOTH passes before the scan.
- **FIX 3.** `runRuntimeEconomyRecovery` + `runtimeEconomyRecovery()` on the cleanup interval, SINGLE-FLIGHT (shared with
  bootstrap). Protection-only classification for healthy rooms → no timer/advance re-arm on a tick.
- **New tests:** `pokerSettlementOutcomes.integration.test.ts` (6 real-PG tests). Migrated older suites to the precise
  outcomes; replaced 37.7.17's unsafe "exact orphan refunds via reconcileCorruptRoom" expectation. Suite lock: **18**
  poker DB files.
- **Gates:** real Docker PostgreSQL — **36 poker suites / 333 tests, 0 skipped, 6/6 clean consecutive runs**;
  `npm run verify` twice stably (**295 files / 3106 tests**, 0 worker crashes) + build + E2E PASS; `git diff --check`
  clean; libc 0; no package/lock drift; migration stays **0012**; v0.4.8; games 7; achievements 52.
- **CORRECTED by 37.7.19:** "all production callers distinguish the outcome" was false — the failed-start,
  seat-divergence, rematch and runtime-unbound paths still collapsed `RefundResult` into a boolean and lost
  `already_paid`/`invalid`.

### Stage 37.7.19 — paid-conflict closure + terminal proof + debit/scan serialization (COMPLETE, Unreleased)
- Worked from HEAD `3adb9dc`. No new migration, no version bump, other 6 games untouched. All 3 FAILs reproduced RED.
- **RED.** (1) a funded room whose match was durably PAID answered `settlement_pending` while the escrow had already
  become `settled`; the retried START minted a NEW `poker_matches` row + buy-in. (2) a room claiming `cancelled` with
  NO settlement row — and one claiming `cancelled` while the DB said `payout` — both minted a fresh paid match.
  (3) a START committing inside the scan window had its LIVE match refunded (`cancel_refund` + refund ledger) while the
  room stayed funded+live.
- **FIX 1.** `applyRefundOutcome` → `cancelled | settlement_pending | frozen`, shared by both START cleanups, the
  settlement-pending sweep, `runBankrollRematch` (new **`paid_conflict`** outcome + `freeze` dep) and the runtime
  unbound branch. `WsContext.freezeRoom`, `DebitResult.paidConflict`, `debitRematch` refuses a frozen table, dead
  `refundTerminallyResolved` deleted.
- **FIX 2.** `proveTerminalBeforeReuse` runs `resolveEscrowEvidence` before either debit path clears a terminal escrow
  (outcome must match the claim, structure exact, a paid escrow needs no owed stats + any carried state BOUND).
- **FIX 3.** `withEconomyBarrier` (FIFO, in-process) wraps every `performDebit` transaction and every global scan; both
  coordinators rebuild protection INSIDE the barrier and fail-closed protect `pending`/`settling` escrows.
  **LOCK ORDER: `withRoomLock` → `withEconomyBarrier`** (never inverted; the scan takes no room lock while holding it).
  **DEPLOYMENT INVARIANT: single authoritative Node instance — the barrier is in-process, NOT cluster-wide.**
- **New tests:** `pokerPaidConflict.integration.test.ts` (8 real-PG tests incl. 2 concurrency/race cases). Rematch
  fixtures now bind their finished state (production does); the mid-debit crash snapshot waits for the `pending`
  marker. Suite lock: **19** poker DB files.
- **Gates:** real Docker PostgreSQL — **37 poker suites / 341 tests, 0 skipped, 6/6 clean consecutive runs**;
  `npm run verify` twice stably (**296 files / 3114 tests**, 0 worker crashes) + build + E2E PASS; `git diff --check`
  clean; libc 0; no package/lock drift; migration stays **0012**; v0.4.8; games 7; achievements 52.
- **CORRECTED by 37.7.20:** the barrier did not yet protect funded-before-start or rooms outside the stale snapshot;
  the terminal proof did not cover `settled` + no state; and a failed debit did not restore the previous escrow.

### Stage 37.7.20 — reversible debit + complete scan protection + terminal no-state (COMPLETE, Unreleased)
- Worked from HEAD `ab6d7bf`. No new migration, no version bump, other 6 games untouched. All 3 FAILs reproduced RED.
- **RED.** (1) a rematch refused for insufficient chips left `pokerEscrow === undefined` beside the finished state +
  binding (an escrowless claim). (2) a match whose debit had committed but whose start had not bound yet (escrow
  `funded`, NO state) was refunded by the global scan; a room created after the coordinator snapshot was invisible.
  (3) `settled` + no state passed the terminal proof, classified `not_bankroll`, and was purged by the synchronous
  teardown fast path.
- **FIX 1.** `performDebit` deep-snapshots the previous escrow and restores it verbatim on every non-commit path;
  callers no longer pre-clear. Initial START → clean lobby; post-refund START → exact cancelled escrow restored.
- **FIX 2.** New `currentRooms()` dep; inside the barrier `protectLiveRoomMatches` protects EVERY live room's
  `pokerEscrow.matchId` (any status) + corrupt room codes. The global scan owns only roomless orphans and escrowless
  claims; funded/unbound/failed-start are settled by their per-room lifecycle. Lock order unchanged.
- **FIX 3.** `proveTerminalBeforeReuse` requires a FINISHED BOUND state for `settled`; `debitFreshStart` refuses a
  `settled` escrow outright; `classifyBootstrapRecovery` → `incoherent_paid` for `settled` + no state (applied by the
  stateless (e4) pass); `deleteRoomWithSettlement` routes EVERY economy claim through `resolveEscrowEvidence` and
  `settleRoomForDeletion` freezes-and-keeps any unconfirmed/contradicted terminal claim.
- **New tests:** `pokerDebitRollback.integration.test.ts` (6 real-PG tests incl. 2 concurrency cases). Older fixtures
  now bind their finished state while FUNDED (as a real START does) and use the production all-status teardown
  resolver. Suite lock: **20** poker DB files.
- **Gates:** real Docker PostgreSQL — **38 poker suites / 347 tests, 0 skipped, 6/6 clean consecutive runs**;
  `npm run verify` twice stably (**297 files / 3120 tests**, 0 worker crashes) + build + E2E PASS; `git diff --check`
  clean; libc 0; no package/lock drift; migration stays **0012**; v0.4.8; games 7; achievements 52.

### Stage 38.0.2 — Poker owner UX corrections (COMPLETE, Unreleased)
- Worked from HEAD `7b508be`. **UI/UX only**: no engine/evaluator/blind/wallet-amount/escrow/
  payout/refund/recovery/stats/server-timer/DB change, no migration (stays **0012**), no new
  dependency, no version bump (**0.4.8**), other 6 games untouched.
- **1 — wallet moved out of Profile.** `PokerWalletPanel` DELETED; new `src/ui/poker/PokerWalletCard.tsx`
  (presentational) + `src/ui/poker/usePokerWallet.ts` (the ONE store). `StartMenu` owns a single
  `usePokerWallet(account.base, account.signedIn, pane==='host' && gameType==='poker')` and passes it to
  BOTH the card and `PokerStakesPicker` — the picker no longer fetches (`fetchPokerWallet` removed from it),
  so a claim updates balance AND buy-in affordability (and the Create gate) in the same render. Card renders
  above the picker in the Poker host branch. `no_economy` still only from a real 503.
- **2 — lighter felt.** Poker-scoped tokens `--poker-felt-lit/-felt/-felt-edge/-rail/-rail-edge` on
  `.poker-screen` (shared `--felt-*` and the other games untouched; the old `var(--felt, #0b5d3b)` fallback
  was never a real global). Radial lit-centre gradient + 7px rail + softened inset; dark pill behind
  pot/street; clearer empty board slots; stronger `--acting`/`--me`. **Measured with Chrome device
  emulation** (2/4/6 + showdown × 360/390/1280 × LTR/RTL): 0 clipped pods, 0 overflow, geometry identical
  to HEAD. Also FIXED a pre-existing 360 overlap of the pot row with the mid-side pods (`@media
  (max-width:400px)` shrinks the plate). **Harness fix:** `scripts/poker-shots.tsx` now emits a
  `<meta viewport>` — without it Chrome emulation silently laid out at 980px, so earlier mobile captures
  were cropped/untruthful. Also emits 2/4/6-seat RTL pages.
- **3 — manual bet amount.** Pure `src/ui/poker/betAmount.ts` (`parseAmountInput` strict finite SAFE-INTEGER,
  decimals REFUSED; `clampAmount` incl. degenerate `max<=min` → all-in; `commitAmount` falls back to the last
  valid amount; `syncAmountToRange`; `wagerKindFor`). `PokerActions` holds one `amount` + a `draft` string;
  slider/presets/input all write through the helpers; blank allowed mid-edit; blur/Enter/button commit;
  Enter === button; `maxTo` → ALL_IN; a range change re-clamps. Reducer/server validation untouched.
- **4 — history next to chat.** New `src/ui/poker/PokerActionLog.tsx` + pure `src/ui/poker/actionLog.ts`
  (last 30, stable keys, unread rule). `PokerGameScreen` no longer renders any log. Online:
  `OnlineGame.renderSocial` gained a 4th `utilitySlot` arg; the poker branch passes `<PokerActionLog/>` →
  RoomSocial's EXISTING generic slot (RoomSocial keeps zero poker imports). Local: same component,
  `variant="standalone"` in a `.poker-local-utility` fixed cluster. Panel is absolutely anchored (never
  widens the row, never covers cards/actions, RTL via `inset-inline-end`).
- **5 — handover policy REWRITTEN (owner-confirmed).** The per-turn reset (`prevActor` ref +
  `setViewerSeat(null)` effect) is GONE. `passAndPlay.ts` gained `humanSeats`/`soloHumanSeat`;
  `needsHandover`/`viewerFor` take the LAST CONFIRMED seat: **1 human + bots → no handover ever, that human
  is the stable viewer (own cards visible through bot turns and between hands)**; **≥2 humans → the
  confirmation sticks to its seat** so A→bots→A never re-prompts while A→bots→B and A→B do, nothing is shown
  during a bot turn, and identity is by SEAT (duplicate names safe). Cleared on start/playAgain.
  **The old "bot → human ALWAYS re-prompts" tests were rewritten — that is no longer the requirement.**
- **Docs:** `POKER_RULES.md` §14 rewritten + new §16 I (action history) + §16 wallet location;
  `CHANGELOG.md` [Unreleased] → Changed; `QA_CHECKLIST.md` new "Poker UX corrections (Stage 38.0.2)"
  manual smoke block (7 owner items) + a note superseding the 37.7 "Profile → wallet" line.
- **New i18n key** `poker.amountRange` ×4 (EN/UK/DE/AR). No other key/API/protocol change.
- **New tests (all `.ts`, no DOM lib — vitest is `environment: 'node'`, `include: src/**/*.test.ts`):**
  `betAmount.test.ts` (23), `actionLog.test.ts` (14), `pokerWalletPlacement.test.ts` (11),
  `pokerTableTheme.test.ts` (12) + `passAndPlay.test.ts` rewritten (18). Interaction is covered by testing
  the PURE helpers + `renderToStaticMarkup` + source-wiring assertions (the repo's existing pattern).

### Stage 38.0.3 — Poker mobile layout FAILs fixed; rebuy NOT implemented (PARTIAL)
- Worked from HEAD `41a0f08`. **Layout half is COMPLETE; the between-hands REBUY feature
  (owner item 3) was NOT implemented — see the handoff below.** No version bump, no
  migration (stays **0012**), no dependency change, other 6 games untouched.
- **RED first, measured (not screenshots).** New `scripts/poker-layout-qa.mjs` +
  `scripts/layout-harness/` (dev-only, never bundled — the app build has a single
  `index.html` entry) mount the REAL PokerGameScreen + RoomSocial + timer/voice/chat/
  history + live action controls in a REAL browser and assert pairwise rectangle
  non-intersection. Baseline 41a0f08: **1484 violations / 186 checks** — 214 pod-over-board,
  12 pod-over-pot, 19 cluster-over-actions, 47 cluster-over-control, 44 panel-over-actions,
  50 panel-over-control, 4 sub-44px targets. After the fix: **186/186 ok, 0 violations**.
  Run it with `npm run layout:poker`.
- **FIX 1 (owner FAIL 1) — docked social cluster.** `RoomSocial` gained `variant='docked'`
  (a LAYOUT mode, still game-agnostic) + a CONTROLLED `openPanel`/`onPanelChange`
  (`none|reactions|chat|utility`) + `utilityPanelSlot`. Poker renders the whole cluster as
  an in-flow horizontal toolbar via the new `PokerGameScreen.socialSlot`, BETWEEN the table
  and the action row; open panels are normal-flow siblings that push the controls down;
  exactly one panel open at a time. `PokerActionLog` split into `PokerActionLogButton` +
  `PokerActionLogPanel` (+ `useLogUnread`) so the button and the panel can live in different
  slots. Local poker uses the same dock (the fixed `.poker-local-utility` is gone).
- **FIX 2 (owner FAIL 2) — centre safe zone.** `pokerSeatLayout.ts` now exports
  `CENTER_BAND {top:32,bottom:52}` + `POD_HALF_HEIGHT 11` + `clearsCenterBand()`, and every
  seat coordinate was moved OUT of that band (side seats separate from the board VERTICALLY,
  which is width-independent — the old side seats at top 47% shared the felt's middle with a
  board wider than the space beside them). Mobile `@media (max-width:400px)` shrinks pods,
  hole cards and board cards. POD_HALF_HEIGHT was 9 until a 4-player Arabic table with all
  four badges still clipped the board by 6px — measured, then raised to 11.
- **Tests:** `pokerSocialDock.test.ts` (18: dock ordering, docked vs floating, mutual
  exclusion matrix, wiring, CSS ergonomics), `pokerSeatLayout.test.ts` +14 (safe-zone +
  pairwise-overlap + felt bounds for 2..6). `pokerTableTheme.test.ts` bounds widened.
  Two Stage 38.0.2 tests updated: poker no longer mounts via `renderSocial` (6→5 timer
  mounts) and the local-utility assertions.
- **NOT DONE — between-hands rebuy (owner item 3, sections D–G).** Deliberately not
  started rather than half-shipped: it is a durable-economy change (chips in play, payout
  conservation, crash recovery), and a partial implementation can LOSE wallet chips.
  Verified prerequisite finding for the next session: **migration 0013 IS required** —
  `poker_ledger.reason` has a CHECK constraint `IN ('daily_claim','table_buy_in',
  'table_payout','table_cancel_refund')`, so a `table_rebuy` row cannot be written today;
  and reusing `table_buy_in` would break `validateDurableOwnership`, which requires exactly
  one buy-in row per participant and treats any extra as `ledger_mismatch` → corrupt
  evidence → freeze. The rest of the durable evidence can come from `poker_ledger` rows
  (immutable, UNIQUE `idempotency_key`, carries `match_id`/`user_id`/`delta`) read inside
  the existing REPEATABLE READ snapshot in `matchDurableEvidence`, so 0013 should be a
  one-line idempotent CHECK widening and nothing else. Design sketch: core amount is
  ALWAYS `state.options.startingStack` (local = chosen stack, online = buy-in), so the
  reducer never takes an amount from a client; the server must additionally assert it
  equals `room.pokerBuyIn` and fail closed on mismatch.

### Stage 38.0.3B — between-hands rebuy: ENGINE + LOCAL shipped, ONLINE still open (PARTIAL)
- Worked from HEAD `4aab82d`. **Migration 0013 + the pure rebuy state machine + the LOCAL
  free rebuy are COMPLETE.** The ONLINE wallet-backed rebuy (protocol, 20s window, durable
  evidence, recovery, PG suite, online UI) is **NOT implemented** — see the handoff below.
  No version bump; games 7; achievements 52; latest migration now **0013**.
- **RED (recorded, probe file deleted):** at 4aab82d a busted seat was eliminated inside
  `finishHand`; the reducer had no rebuy action; `src/net/messages.ts` had no POKER_REBUY
  intent; `poker_ledger.reason` CHECK listed only 4 values; `pokerDurableOwnership.ts`,
  `pokerParticipants.ts`, `pokerEscrow.ts` and `pokerBootstrap.ts` contained no "rebuy"
  at all. 7/7 probes green against the baseline.
- **Migration `0013_poker_rebuy.sql`** — widens the `poker_ledger.reason` CHECK with
  `table_rebuy`. Locates the constraint through `pg_constraint` (never a guessed name),
  drops every reason-CHECK it finds and re-adds a canonical one, so re-running converges.
  Verified on real PG: 0000–0013 apply, 0013 re-applies, all four legacy reasons still
  insert, `table_rebuy` inserts, an unknown reason is rejected (SQLSTATE 23514).
  **`table_buy_in` must NOT be reused** — `validateDurableOwnership` requires exactly one
  initial buy-in row per participant and reads any extra as `ledger_mismatch` → freeze.
- **Pure core (§17).** New phase **`rebuy_window`**; `PokerState.rebuyWindow`
  (`handNumber`, `eligibleSeats`, `decisionBySeat`) + `appliedRebuys[{handNumber,seat}]` —
  PUBLIC evidence only (no userId/matchId/balance/ledger key). Actions `REBUY {seat}`,
  `DECLINE_REBUY {seat}`, `CLOSE_REBUY_WINDOW`; the amount is ALWAYS
  `options.startingStack`, never from the action. `finishHand` no longer eliminates —
  `closeRebuyWindow` does, and only then does the match finish / the button move.
  `START_NEXT_HAND` is a no-op while a window is open. Every illegal/duplicate action
  returns the SAME state reference. `totalChips` = `startingStack × (playerCount +
  appliedRebuys.length)`; invariants also check window/`appliedRebuys` structure.
  All three rebuy actions are `isPokerLifecycleAction` → a seated ACTION_REQUEST can
  never drive them.
- **ONLINE IS SAFE MEANWHILE:** `serverCore.autoAdvance` closes a `rebuy_window`
  immediately for online rooms, which reproduces the pre-§17 behaviour byte-for-byte
  (busted seat eliminated). No wallet can be touched by this stage.
- **Local UI:** `PokerRebuyPanel` (presentational; derives nothing) + `PokerGameScreen.rebuySlot`
  rendered UNDER the hand review; `PokerLocalGame` makes EVERY busted seat actionable
  (human and bot) and closes with an explicit Continue. i18n `poker.rebuy.*` ×4 (14 keys,
  online strings included). Layout gate extended with 6 rebuy scenarios (+ a `--only`
  filter): **42/42 rebuy checks clean**, and the panel never overlaps table/toolbar/controls.
- **Tests:** `src/games/poker/rebuy.test.ts` (25) + `src/ui/poker/pokerRebuyLocal.test.ts` (12).
  Updated for the new phase: `ai.test.ts` soak + `engine.test.ts` finish + `pokerServerCore.test.ts`
  drive loop (all now close the window) and `pokerStatsWiring` migration list.
  verify PASS 3097/157; real-PG poker suites **38 files / 347 tests, 0 skipped**.

#### HANDOFF — what the ONLINE rebuy still needs (nothing of it is started)
1. **Protocol:** `POKER_REBUY_REQUEST` / `POKER_REBUY_DECLINE` in `src/net/messages.ts`,
   payload EMPTY (no amount/seat/userId/matchId/balance/roomCode). Server derives room from
   the session, userId from the non-guest account, seat from membership, matchId from the
   BOUND escrow (`room.pokerGameMatchId`), amount from `room.pokerBuyIn`, hand from the
   authoritative state; assert `state.options.startingStack === room.pokerBuyIn` and fail
   closed otherwise.
2. **Window:** 20s ABSOLUTE server deadline + revision keyed to (matchId, handNumber),
   persisted in room JSON; reconnect/reload must not extend; restore keeps the same
   deadline and closes an expired one; early close when every eligible human answered;
   timeout = decline. Keep it SEPARATE from the Stage 37.5 turn timer.
3. **Durable evidence:** key `rebuy:<matchId>:<handNumber>:<userId>`, reason `table_rebuy`,
   delta `-buyIn`. Extend `MatchDurableEvidence` with `rebuys` read in the SAME
   REPEATABLE READ snapshot in `readEvidence`; extend `validateDurableOwnership` with
   strict rebuy rules (key matches match/hand/user, user ∈ initial durable seats, delta
   exactly `-buyIn`, ≤1 per user per hand, exact roomCode; anything else → a new corrupt
   structure value). Funded total = initial buy-ins + confirmed rebuys; update
   `validateFinishedPaidMatch`/`validatePayoutConservation` (winner holds the FUNDED
   TOTAL), `payoutStacks` and `refundBuyInsResult` (refund = initial + that user's rebuys).
4. **Orchestration (ONE helper, e.g. `server/pokerRebuy.ts`):** room lock →
   `withEconomyBarrier` (lock order `withRoomLock` → `withEconomyBarrier`, never inverted)
   → tx {wallet row lock, balance check, insert ledger as the gate, debit} → after commit
   apply the pure `REBUY` → persist immediately → broadcast → only then let the window close.
5. **Crash recovery:** durable rebuy rows vs `state.appliedRebuys`; a durable row missing
   from the room state is applied EXACTLY once when the room is exact+bound and still in
   the same hand's window, else freeze; a room claiming a rebuy with no durable row →
   freeze; wrong seat/user/amount/hand/key → freeze; DB down → `retry_pending`, never
   decline/close. Protect an in-flight rebuy from the orphan scan, teardown, timeout close,
   payout, refund, rematch and purge.
6. **PG matrix (20 scenarios)** listed in the Stage 38.0.3B prompt section J, plus the
   online UI (own seat only, wallet balance, countdown, disabled/loading, insufficient
   message, aria-live) and the public-snapshot leak test.

### Stage 38.0.3C — ONLINE bankroll rebuy COMPLETE (Unreleased)
- Worked from HEAD `a23b78d`. The §17 handoff from 38.0.3B is now **fully implemented**;
  the temporary "online auto-closes the window" fallback is GONE for bankroll tables.
  No new migration (0013 already existed), version 0.4.8, games 7, achievements 52.
- **Protocol:** `POKER_REBUY_REQUEST` / `POKER_REBUY_DECLINE`, EMPTY payload. Server derives
  room/user/seat/match/hand/amount; refuses if `state.options.startingStack !== room.pokerBuyIn`.
  New ErrorCode `REBUY_NOT_ALLOWED`; `INSUFFICIENT_CHIPS` reused. Private reply
  `POKER_REBUY_RESULT {balance, applied}` goes ONLY to the requester.
- **Window:** `server/pokerRebuy.ts` owns it. `pokerRebuyDeadlineAt/Revision/MatchId/Hand`
  persisted; minted once per (match, hand); early close when all answered; timeout =
  decline; `pokerRebuyInFlight` (never persisted) blocks any close. Public snapshot exposes
  ONLY `pokerRebuyDeadlineAt`. `serverCore.autoAdvance` closes a rebuy window only for a
  NON-bankroll poker room; bankroll windows belong to index.ts (`syncRebuyWindow` /
  `resolveRebuyWindow`, both under `withRoomLock`).
- **Durable evidence:** `rebuyIdempotencyKey`/`parseRebuyKey` (FULL 4-segment parse),
  `MatchDurableEvidence.rebuys` read in the same REPEATABLE READ snapshot,
  `validateRebuyContributions` + new structure `rebuy_mismatch`, plus
  `fundedTotalFor`/`contributionForUser`. `settleMatchWithOwnershipTx` now passes the proven
  evidence into its mutator.
- **Conservation:** `fundedTotalOf(esc, state)` in pokerParticipants; the winner must hold
  the funded total; `payoutStacks` also cross-checks durable rebuy COUNT vs
  `state.appliedRebuys`; `refundBuyInsResult` credits `initial + that user's rebuys`.
- **Recovery:** `reconcileRebuys` — applies a committed-but-unapplied debit exactly once
  (exact + bound + same hand + seat still eligible), freezes on a claim without a row / any
  malformed/foreign/wrong-delta row, `retry_pending` on DB failure. Runs before every expiry
  close and for every restored room at bootstrap.
- **UI:** `PokerRebuyPanel` reused online via `PokerGameScreen.rebuySlot`; own seat only,
  countdown from the server deadline, private balance from `POKER_REBUY_RESULT`,
  disabled-while-pending, insufficient/refused states, aria-live.
- **Tests:** `src/net/pokerRebuy.integration.test.ts` (17 real-PG tests covering the
  20-scenario matrix) + `src/net/pokerRebuyProtocol.test.ts` (20 pure). Real PG: **62 poker
  files / 650 tests, 0 skipped**.

### Stage 38.0.4 — Fifty-One mobile meld layout + docked social (COMPLETE, Unreleased)
- Worked from HEAD `a8b9bbc`. UI/CSS only: no Poker/wallet/escrow/rebuy/payout/migration
  change, no new migration (latest stays 0013), version 0.4.8, games 7, achievements 52.
- **RED (measured, reproducible):** new `scripts/fiftyone-layout-qa.mjs` +
  `scripts/layout-harness/fiftyone.{html,tsx}` render the REAL FiftyOneGameScreen in a real
  browser. `--legacy` re-applies the pre-fix CSS, so the RED is reproducible on demand:
  **249 violations / 18 checks** — 42 card-clipped, 29 meld-inner-scroll, 12 touch-target,
  1 social-over-content. Concrete: at 360 a 4-card meld's last card spanned `278..350`
  inside a row ending at `318`, and its `scrollWidth 307 > 275` visible.
- **Root cause:** `.fiftyone-meld { max-width: min(100%, 18rem) }` (288px) versus four
  fixed 72px cards + three 6.4px gaps + 12.8px padding = ~320px, with
  `.fiftyone-meld__cards { flex-wrap: nowrap; overflow-x: auto }` hiding the remainder.
- **FIX 1 (melds):** the 18rem cap is gone (`flex: 1 1 16rem; max-width: 100%`), the row
  WRAPS (`flex-wrap: wrap`, no `overflow-x`), the card width is
  `clamp(52px, 17vw, 72px)` and the height is `calc(var(--f51-meld-card-w) * 1.5946)` so
  the 74×118 face aspect is exact. `direction: ltr` still protects run order under RTL;
  `.fiftyone-meld__ctrls button` gained 44px tap targets.
- **FIX 2 (social):** `FiftyOneGameScreen.socialSlot` (generic ReactNode) renders
  `.fiftyone-social-dock` between the melds and the prompt; `OnlineGame`'s fifty-one branch
  builds the SAME docked `RoomSocial` Poker uses (`variant="docked"` + controlled
  `openPanel`) and passes it through `FiftyOneOnlineGame`. It no longer calls
  `renderSocial` — four games still do (durak/deberc/tarneeb/preferans). Local 51 passes
  nothing. RoomSocial still has zero game imports.
- **Tests:** `src/ui/fiftyOne/fiftyOneMobileLayout.test.ts` (17). Updated for the new
  contract: the 30.14 CSS guard in `fiftyOneLocalWiring.test.ts` (inner scroll → wrap,
  fixed 72px → clamp), the three renderSocial mount counters (5 → 4), and the 51 UI
  isolation guard now ignores the `react-dom/server` SSR renderer (a rendering library,
  not transport). verify PASS 3134/174; `npm run layout:fiftyone` 24/24 clean.

### Stage 38.0.5 — permanent "Quit for good" for the six online non-Poker games (COMPLETE, Unreleased)
- Worked from HEAD `0995f2d`. New **migration 0014** (latest is now 0014); version stays 0.4.8;
  games 7; achievements 52. **Poker and all local play are untouched** (the only poker-path diff is a
  test FILTER refinement in `pokerStatsWiring.test.ts`: it now matches the `poker_` table prefix
  instead of the loose word "poker", because 0014 mentions Poker only to say it is out of scope).
- **The three exits are now genuinely three.** `LEAVE_ROOM` is LOBBY-ONLY: during a started game
  `wsHandlers` routes it to the new `ctx.detachSession` (keeps the member, marks it disconnected)
  instead of `handleLeave`. Before this, an active-game leave ran `removeMember` → `assignSeats`,
  which repointed every remaining player at a different `player-<n>` than the live `gameState` used.
  King's in-game ✕ used to send `LEAVE_ROOM` (`exitToMenu = net.leave()`); it now uses
  `leaveGameToMenu` like the other five games.
- **Protocol:** `LEAVE_GAME_PERMANENTLY` (client→server) / `PERMANENT_LEAVE_ACCEPTED` (server→client),
  BOTH payload-free; new retryable `ErrorCode 'PERMANENT_LEAVE_UNAVAILABLE'`. Routed in
  `server/index.ts` (NOT the wsHandlers switch — it is async and needs the socket + resolvedUserId),
  the same way `REMATCH_READY` and the rebuy intents are.
- **Frozen match metadata** — `src/net/onlineMatch.ts` + `ServerRoom.onlineMatch`, created once by
  `freezeOnlineMatch(room, randomUUID(), now)` at START (`ctx.beginOnlineMatch` from wsHandlers) and
  again for a rematch (`restartNonBankroll`). Holds matchId/gameType/roomCode/**category**
  (`human_only|with_bots`)/playerCount/startedAt/roster/forfeits/durable. The category is NEVER
  recomputed. Persisted in room JSON, strictly re-validated on restore, and absent from
  RoomSnapshot/RoomSummary/messages/logs (asserted).
- **Orchestration** — `server/permanentLeave.ts` `runPermanentLeave(code, clientId, userId, deps)`,
  called under `withRoomLock`. ORDER: validate → **commit the durable forfeit FIRST** → takeover (or
  close the room) → persist → broadcast → ACK. Transient DB failure or no DB for an ACCOUNT ⇒
  `retryable` with nothing changed; a durable record for a DIFFERENT match, a wrong account/seat, or
  a row already carrying another outcome ⇒ `refused`. A GUEST (no resolved userId) needs no account
  row — its durable write is best effort and the takeover stays authoritative.
- **`takeoverSeatWithAi`** (serverCore) replaces the member entry IN PLACE (same map position, same
  `seatIndex`) — it never calls `removeMember`/`assignSeats` and never touches `gameState`. Fresh
  clientId + token hash, `userId: null`, obviously-AI name/avatar, rematch consent dropped, host badge
  moved to a remaining HUMAN. The departed member is gone ⇒ RECONNECT / RECLAIM_ROOM / FIND_MY_ROOMS
  all stop working for it. The re-evaluation uses the CONNECTION-EVENT `broadcastAndAdvance(room)`
  (no `turnAdvanced`), so the turn deadline is untouched and exactly one bot action is armed.
  `planPermanentLeave` also refuses a FINISHED match (`already_finished`).
- **Migration 0014** — `online_matches` + `online_match_participants` (PK `(match_id, seat_index)`,
  CHECKs: category/status/player_count/finished-shape/seat range/member type/outcome, forfeit is
  ALWAYS a timestamped loss, a bot seat can hold no account and never forfeits; partial UNIQUE
  `(match_id, user_id)` = exactly-once account attribution; indexes for the 38.0.6 tracker). Additive,
  idempotent (constraints located via `pg_constraint`), touches NO existing table and no `poker_*`.
- **OWNERSHIP SPLIT (read this before Stage 38.0.6).** `online_match_participants.outcome` is the ONE
  canonical per-participant ONLINE result — written once per seat, at forfeit time for the leaver and
  at finish for everyone else, for BOTH categories. The legacy `games`/`game_players`/`rounds`/
  `user_stats` path keeps its own unchanged ownership of the RATING aggregate; the forfeit writes
  NOTHING there (deliberate: `user_stats` is a rebuildable cache — `rebuildUserStats` recomputes it
  from `games`, so a loss written only there would be erased). `maybeRecordFinished` now gates on
  `ratedByFrozenCategory(meta)` (live-membership rule survives only as the no-metadata fallback) and
  builds `seatUsers` via `finishSeatUsers(meta, liveUserBySeat)` — forfeited seats dropped.
- **Tests (195, 0 skipped):** `onlineMatch.test.ts` (28 pure), `permanentLeaveCore.test.ts` (66 —
  the six-game takeover matrix), `permanentLeaveOrchestration.test.ts` (22 — fake-dep ordering /
  failure matrix), `permanentLeaveConcurrency.test.ts` (11 — timeout / substitute / auto-advance /
  finish / duplicate / lost-ACK races), `permanentLeaveWiring.test.ts` (26 — protocol + LEAVE_ROOM
  scope + ownership + Poker/local audit), `permanentLeaveUi.test.ts` (24), and on REAL Postgres
  `onlineMatches.integration.test.ts` (8) + `permanentLeaveFlow.integration.test.ts` (10).
  Real PG: `docker run -d --name kg-pg-3805 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kingtest
  -p 55433:5432 postgres:16-alpine`, `DATABASE_URL=… npm run db:migrate`, `TEST_DATABASE_URL=… npx
  vitest run …`. 0014 verified to apply AND re-apply on a clean DB.
- **Known limitation (documented, owner's call):** the replacement AI's bot name/avatar appear in the
  ROOM snapshot, but the authoritative `gameState` is deliberately not mutated, so screens that read
  the player NAME from the game state still show the departed player's name at that seat. This follows
  the stage requirement "no game state or playerId change". Changing it would need a separate,
  explicit decision.
- **Next (Stage 38.0.6 profile tracker):** read `server/db/onlineMatches.ts`
  `getOnlineParticipationCounters(userId)` → `{gameType, category, matches, wins, losses, forfeits}`
  grouped rows. Overall + per-game, `human_only` vs `with_bots`, ONLINE only (local play never creates
  a match row). Do NOT derive it from `user_stats`.

### Stage 38.0.5.1 / 38.0.4.1 — permanent-leave race fix + Fifty-One table/menu redesign (COMPLETE, Unreleased)
- Worked from HEAD `d82dbde`. **No migration (latest stays 0014), no version bump (0.4.8), games 7,
  achievements 52, libc 0.** Poker source: **zero files touched** (the only "poker" lines in the diff
  are new assertions proving it is unchanged); `npm run layout:poker` still 228/228 OK.

#### A. Permanent-leave FINISH-DURING-DB-AWAIT race (code-review FAIL)
- **RED (probe replaying the 38.0.5 post-commit block verbatim, then deleted):**
  `result = {ok:true, kind:'already_left'}`, `member c1 alive = true`, `RECONNECT t1 → c1`,
  `RECLAIM u1 → c1`, `replacement AI = 0`. The ACK was sent, the client cleared its session, and the
  seat + reconnect token + account claim all survived.
- **ROOT CAUSE:** `runPermanentLeave` re-ran the FULL pre-commit contract (`planPermanentLeave`) after
  the DB await. A timer/auto-advance finishing the match in that window made the recheck answer
  `already_finished` → the code returned `already_left` and did NO teardown.
- **FIX — the validation is SPLIT at the commit.** Before the write: `planPermanentLeave` unchanged
  (match must be ACTIVE). After the write: new pure `planPermanentLeaveTakeover(room, clientId,
  {seatIndex, userId})` — IDENTITY ONLY (same clientId, human, seated, same seat, same account).
  New `takeoverSeatAfterForfeit()` shares `applySeatTakeover()` with `takeoverSeatWithAi()` (no
  `removeMember`/`assignSeats`, `gameState` untouched). Post-commit outcomes: room gone /
  `not_a_member` → `already_left` (identity already annulled); `seat_changed`/`account_changed`/
  `not_human`/`not_seated` → **`refused`, fail closed** (never tear down an innocent member; the DB
  gate makes a retry a no-op → no second loss); identity intact → takeover, or `closeRoom` when no
  human remains. `isRoomFinished(live)` is read ONCE, only to SKIP `deps.advance` — a finished match
  is never re-driven (no new deadline, no bot move after terminal); `broadcastRoom` still runs.
  `recordOnlineMatchFinish` already refuses to touch a `forfeited` row, so the finish cannot rewrite it.
- **CLIENT single-flight.** New pure `src/net/permanentLeaveClient.ts` (`planLeaveIntent` /
  `applyLeaveAccepted` / `applyLeaveRefusal`) + a SYNCHRONOUS `permanentLeaveRef` in `useNetworkGame`
  (React state is async — two presses before the next render both sent). The ACK is **absorbing**: a
  later `PERMANENT_LEAVE_UNAVAILABLE` is ignored once `accepted`. Server: `permanentlyLeftSockets`
  `WeakSet<WebSocket>` in index.ts — a duplicate `LEAVE_GAME_PERMANENTLY` **re-ACKs**, never `ERROR`.
- **Tests:** `src/net/permanentLeaveFinishRace.test.ts` (14 — finish/timeout/room-deleted/identity-
  replaced/seat-moved/member-vanished during the await, no-second-loss, room close, post-commit plan
  matrix), `src/net/permanentLeaveClient.test.ts` (12), + 2 new real-PG cases in
  `permanentLeaveFlow.integration.test.ts` (finish inside the real gated transition; serialize/restore).
  Real PG (Docker `kg-pg-38051`, port **55434**, migrations 0000–0014): `permanentLeaveFlow` +
  `onlineMatches` = **20 tests, 0 skipped**.

#### B. Fifty-One — honest RED first, then the redesign (owner FAILs 1–4)
- **The old harness was the reason 38.0.4 was green while the phone was not.** It mounted a PARTIAL
  table: no `dangerSlot`, no chat history, no open panel, no confirmation dialog, no card-face theme,
  no text scaling, ONE paint, and it measured only the `.fiftyone-meldcard` wrappers — never the inner
  `.card`, `.card__art`, the joker badge or the controls.
- **Rebuilt gate** (`scripts/fiftyone-layout-qa.mjs` + `scripts/layout-harness/fiftyone.tsx`): the
  PRODUCTION online branch (real `RoomSocial variant="sheet"` + real `PermanentLeaveControl` + timer +
  voice + seeded chat + unread badge), **54 checks** = 3 viewports (360/390/desktop) × 18 scenarios
  (2/3/4p, LTR + AR RTL, classic + clean faces, `fontScale=21`, collapsed / chat / reactions /
  confirmation-dialog-by-real-click, longest legal 13-run, jokers at start/middle/end, duplicate deck
  cards, 4 melds for one owner, add-to-meld update, empty table). Settles on `document.fonts.ready`
  + `decode()` of every visible image + 2 rAF + the harness's own `window.__f51ready`.
  `--legacy` reproduces the RED: **1078 violations** (369 card-clipped, 369 card-outside-meld,
  171 inner-scroll-x, 47 card-overlap, 47 no-gap, 33 touch-target, 31 social-over-content,
  2 screen-overflow-x). After the fix: **0 / 54**.
- **Real defects the new gate found (not just the old ones):** sheet controls at 39×35 / 64×35 / 42×30
  (fixed: `.social-sheet button { min-width/height: 44px }`); the top bar overflowing at browser text
  scaling and being silently swallowed by `.fiftyone-screen { overflow-x: hidden }` (fixed: the top bar
  WRAPS, its ghost buttons are square 44×44, the round label is the only flexible item); and — from the
  SCREENSHOTS, not the rectangles — `.social-sheet` and `.permleave-dialog` used the translucent
  `--surface`, so the table read straight through both (now opaque `--panel`).
- **Melds are GROUPED BY OWNER** (`.fiftyone-meldgroup` → header with the name ONCE + that owner's
  total → one `.fiftyone-meld` row per combination with a compact `Run · v` / `Set · v` label). Card
  width `clamp(46px, 15vw, 66px)` so 5 cards + gaps fit ONE row at 360; `flex: 1 1 100%` per group on a
  phone, `1 1 22rem` from 760px. Add/Replace are 44×44 ICON buttons in the combination's label row and
  render only while the action is legal. **`meld.cards` order is never re-sorted** (51_RULES §5/§6/§8).
- **Social is ONE launcher + a modal sheet.** New GENERIC `RoomSocial variant="sheet"` (launcher with
  the unread badge, backdrop, tabs Chat/Reactions, `social-sheet__body` with its own scroll, footer with
  voice + utility + `dangerSlot`); Escape/backdrop/✕ close it and focus returns to the launcher.
  `FiftyOneGameScreen` lost `socialSlot` and gained top-bar `menuSlot` + `timerSlot`; `.fiftyone-social-dock`
  is gone. **RoomSocial still has zero game imports** (a test strips comments and greps for any game name).
  Poker keeps `variant="docked"`; the other four keep `renderSocial(true, …)`.
- **New i18n ×4:** `social.menu`, `fiftyOne.typeRun`, `fiftyOne.typeSet`, `fiftyOne.meldTable`.
- **Tests:** `src/ui/online/roomSocialSheet.test.ts` (15) + rewritten `fiftyOneMobileLayout.test.ts` (24).
- **Screenshots reviewed** (360 collapsed / 360 chat / 360 confirm / 390 same-owner / 390 long-run after
  add-to-meld / 390 AR RTL / desktop): grouped melds read as cards on a table, one owner heading each,
  the 14-card run wraps 5+5+4 in order, RTL mirrors the chrome but not the run or the artwork, and the
  desktop lays three owner groups side by side because they genuinely fit.

#### Gotchas for next time
- Both layout gates leave their CDP sockets open; the 51 gate now calls `cdp.close()` + `process.exit()`.
  **`npm run layout:poker` still hangs after printing `LAYOUT OK` — read its output, don't wait for exit.**
- `--surface` is a TRANSLUCENT white wash; any modal must use `--panel` (opaque).
- The vitest env is `node` (no jsdom), so interaction behaviour is proved by the browser gate, not by
  unit tests; SSR (`renderToStaticMarkup`) + source contracts cover the structure.

### Stage 38.0.6 — ONLINE participation tracker (COMPLETE, Unreleased)
- Worked from HEAD `1d32de3`. **NO new migration (latest stays 0014)**, no version bump (0.4.8),
  games 7, achievements 52, libc 0. Read-only projection of the 0014 model — no write path, and
  `games`/`game_players`/`rounds`/`user_stats` are never touched.
- **RED (real PostgreSQL, probe deleted after use):** the 38.0.5
  `getOnlineParticipationCounters` used a bare `count(*)`, so ONE **active** match with nobody
  holding a result returned `[{gameType:'king', category:'human_only', matches:1, wins:0,
  losses:0, forfeits:0}]` — a match that had not been played, counted as played. It also had
  **no `draws` column** (`matches` could never equal `wins+losses+draws`), returned only the
  rows that happened to exist (no zero-filled matrix), and there was no aggregation module,
  API route, client adapter or UI (`src/net/onlineTracker.ts`, `online-tracker`,
  `fetchOnlineTracker`, `tracker` in ProfileMenu — all absent).
- **Semantics.** Tracked games = the SIX online non-Poker ones; Poker is excluded THREE times
  over (0014 never records it, the SQL filters `game_type IN (six)`, and `buildOnlineTracker`
  drops unknown games). Only TERMINAL participant outcomes count (`win|loss|draw`); `pending`
  is not a played match. A permanent leave is already terminal while the match runs, so it
  counts immediately. `human_only` / `with_bots` come from the FROZEN category and are never
  summed together.
- **Formulas (`src/net/onlineTracker.ts`, ONE module shared by server + client + tests):**
  `matches` is **RECOMPUTED** as `wins+losses+draws` (never trusted from the row),
  `forfeits = min(forfeits, losses)`, `winRate = matches>0 ? round(wins/matches*100) : null`
  (null → the UI shows `—`, never NaN/Infinity). All values are finite non-negative safe
  integers; unknown gameType/category is dropped FAIL CLOSED. `buildOnlineTracker` always
  returns the full matrix (overall + 6 games × 2 categories, zero-filled) and derives
  `overall` as the exact sum of the six games.
- **DB:** `getOnlineParticipationCounters` gained `draws`, `WHERE outcome IN ('win','loss',
  'draw')`, `member_type='human'` and `game_type IN TRACKED_ONLINE_GAMES`. Exactly-once is the
  schema's job (PK `(match_id, seat_index)` + partial UNIQUE `(match_id, user_id)`), so a
  retry/reconnect/restart replay cannot inflate anything.
- **API:** `GET /api/me/online-tracker`, `requireUser` (session cookie ONLY — no query/body
  parameter exists). Body is `{tracker:{overall, byGame}}` and nothing else; a key-allowlist
  test walks the payload. No DB → the API-wide 503 `db_disabled` (deliberately NOT a
  route-local code); a transient failure → the shared catch's 503 `db_error`. An empty matrix
  is never sent in place of a failure.
- **Client/UI:** `fetchOnlineTracker` + `parseTrackerPayload` (reads only known keys, zero-fills,
  re-derives `overall` locally). `OnlineTrackerPanel` = chip strip (Overall + 6 games, opens on
  Overall, no Poker) + TWO category cards (matches, win rate, wins, losses, draws, quit-for-good)
  + the online-only/local-excluded note. Mounted in ProfileMenu's `stats` tab ABOVE the game
  selector; fetched only when that tab is open (`trackerOnce` ref) with an extra
  `trackerInFlight` ref so a rerender cannot start a second parallel request; ↻ Refresh reloads
  the tracker AND the visible detailed panel. i18n `tracker.*` ×4 (11 keys).
- **New gate `npm run layout:tracker`** (`scripts/profile-tracker-qa.mjs` +
  `scripts/layout-harness/tracker.{html,tsx}`) mounts the REAL panel inside the REAL
  Profile→Statistics containers: **39 checks** = 360/390/desktop × 13 scenarios (overall,
  per-game, big numbers, empty, unauth, unavailable, fontScale 21, RTL ×3, de, uk). It found a
  real defect: short chips ("51" 38×44, Arabic "كينج" 43×44) → `min-width: 44px` added. Now 39/39.
- **Tests:** `onlineTracker.test.ts` (24 pure), `onlineTracker.api.test.ts` (12 auth/privacy/503),
  `onlineTracker.integration.test.ts` (**12 real-PG**, the exact 12-scenario matrix from the
  prompt), `onlineTrackerPanel.test.ts` (26 UI/a11y/CSS). Real PG (Docker `kg-pg-3806`, port
  **55435**, migrations 0000–0014): tracker + onlineMatches + permanentLeaveFlow = **32 tests,
  0 skipped**. verify PASS (287 files / 3424 tests).
- **Gotcha:** `--surface` is translucent (see 38.0.5.1); the tracker cards use `--surface-2`
  inside the already-opaque profile panel, so they are fine.

### Stage 38.0.8 — Poker anti-dumping A0+A1 (COMPLETE, Unreleased)
- Worked from HEAD `7532e7e`. Owner-selected model **A0+A1** from the 38.0.7 audit.
  **NO new migration (latest stays 0014)**, version 0.4.8, games 7, achievements 52, libc 0.
  It is a **MITIGATION, not a guarantee** — the docs say so explicitly and so does the code.
- **RED (real PG, probe deleted):** one seat took **5+** rebuys in one match (`appliedRebuys`
  5 long, no cap anywhere); the same pair could press rematch AND open a brand-new paid room
  immediately (both `{ok:true}`, and `DebitResult` had only the key `ok` — no shape could even
  express a refusal); six repeat matches of one pair all returned `recorded` and pushed B to
  `gamesWon 6`; `START_GAME` was payload-free with no unranked handshake; and local free Poker
  had no economy policy at all (recorded as the invariant to preserve).
- **New `server/pokerAntiDump.ts`** — pure decision + tx-scoped reads. Constants:
  `MAX_BANKROLL_REBUYS_PER_SEAT = 2` (re-exported from `src/games/poker/stakes.ts`, the
  ONLINE-bankroll config — deliberately NOT the shared pure engine, so local stays uncapped),
  `BANKROLL_PAIR_COOLDOWN_MS = 15 min`, `MAX_RANKED_BANKROLL_MATCHES_PER_PAIR_UTC_DAY = 3`.
- **NO TOCTOU:** `performDebit` calls `evaluatePairPolicyTx` INSIDE the same transaction that
  writes `poker_matches` + the buy-in debits, under the existing `withEconomyBarrier`. Lock
  order unchanged (`withRoomLock` → barrier → tx). A refusal THROWS in the transaction →
  atomic rollback: no ledger row, no matchId, previous escrow restored verbatim. Two
  concurrent fresh rooms of one pair (different room locks!) are proven blocked by a real-PG
  test.
- **Identity** = unordered pair of account ids from `poker_matches.seats` ⋈
  `poker_match_settlements.outcome = 'payout'`. Never a room code, never client history.
  `cancel_refund` + unsettled matches count for nothing.
- **Rebuy cap** enforced in `rebuyRequestAllowed` (fast refusal, pre-debit) AND by
  `countDurableRebuysTx` inside the rebuy transaction (authoritative: only COMMITTED ledger
  rows spend an allowance, so insufficient/transient/replay cost nothing and a concurrent race
  yields exactly one debit). A state claiming more rebuys than the ledger → refuse
  (`cap_reached`), never guess; `reconcileRebuys` still owns that disagreement.
- **Grandfathering:** SERVER-ONLY `PokerEscrow.antiDumpPolicy {version:1, statsEligible,
  decidedAt, rosterDigest}`, stamped by every post-deploy debit. No marker = legacy = uncapped
  + ranked. `parseAntiDumpPolicy` (in serverCore, next to the other deserializers) is strict but
  degrades to legacy — a policy field must never make an ESCROW look corrupt.
- **Stats:** new terminal `StatsResult` value **`unranked_skipped`**, returned AFTER
  `validateFinishedPaidMatch` (a malformed match is still `invalid` → frozen). It is SUCCESS:
  no retry, no freeze, clears `pokerStatsPending`, idempotent; both callers already used
  `!== 'failed' / !== 'invalid'` so they resolve it correctly. Unranked pays out in full and
  writes NO `games`/`game_players`/`rounds`/`user_stats` row.
- **Protocol:** `START_GAME { pokerUnrankedConfirmed?: boolean }` (acknowledgement only — the
  server recomputes under its lock), `ERROR { retryAfterSeconds? }`, codes
  `POKER_PAIR_COOLDOWN` / `POKER_UNRANKED_CONFIRM_REQUIRED`, and the ONE public boolean
  `RoomSnapshot.pokerStatsEligible`. No userId / pair / threshold / history ever leaves the server.
- **UI:** Ranked/Unranked badge + "Rebuys left: N" in the poker top bar (online only — local
  renders nothing), `PokerUnrankedDialog` (opaque `--panel`, 44px targets, focus trap + return,
  Escape/backdrop cancel only pre-debit, `startPending` ref → one START on a double-click), and
  an inert cooldown note in the lobby. i18n `poker.ranked/unranked/rebuysLeft/unranked*/cooldown*`
  ×4 (10 keys).
- **TEST SEAM `__setAntiDumpPolicyDisabled`** (same convention as `__setRefundFailure`) +
  `withAntiDumpPolicyDisabled(beforeEach, afterEach)` in `pokerDbSuite.testutil`. **NINE**
  settlement/recovery suites use it (pokerBootstrapOrdering / pokerDebitRollback /
  pokerDurableOwnership / pokerEscrow / pokerPaidConflict / pokerRematch.lifecycle /
  pokerRematchCrash / pokerRematchRequest / pokerRuntimeSweep): they drive back-to-back paid
  matches for ONE pair to exercise crash windows, which the cooldown would otherwise refuse.
  Default is ENABLED; the policy's own suites never touch it.
- **Gates:** real Docker PostgreSQL on a CLEAN DB — `src/net/poker* + src/games/poker +
  src/ui/poker` = **65 files / 724 tests, 0 skipped, 0 failed**; `npm run verify` PASS
  (**289 files / 3480 tests** + build + E2E); `npm run layout:poker` **228 checks, LAYOUT OK**
  (it still hangs after printing — read the output file, do not wait for exit);
  `git diff --check` clean; libc 0; no package/lock drift.
- **Gotcha:** the test DB persists between runs, so a suite that counts rows by a 4-character
  room code can see a PREVIOUS run's rows. `pokerAntiDump.integration.test.ts` salts its codes
  per run and asserts attribution via `game_players.user_id` instead.
- **NOT done (owner's call, from the 38.0.7 audit):** the rolling pairwise NET-FLOW limit (A2,
  would need migration 0015) and any operator review surface. Model **C** (removing
  player-to-player transfer entirely) remains a separate, explicit decision.

### Stage 38.0.8.1 — corrective anti-dumping hardening (COMPLETE, Unreleased)
- Worked from HEAD `0ba01a6`. Two REAL FAILs from review of 38.0.8. **No migration** (latest
  stays 0014), version 0.4.8, games 7, achievements 52, libc 0. **No threshold changed**
  (2 rebuys/seat/match, 15-min pair cooldown, 3 ranked settled matches/pair/UTC-day).
- **RED 1 (real PG, probe deleted):** two FRESH rooms of one pair with a genuinely EMPTY
  history → `[{ok:true},{ok:true}]`, **2 unresolved `poker_matches`**, **2 `table_buy_in`
  rows per account**, balance −2×buy-in. The 38.0.8 "concurrency" test had created a settled
  match FIRST, so it only proved the ordinary cooldown — it never exercised the race.
- **RED 2:** every malformed marker (`null`, `version 999`, `statsEligible:'yes'`, bad
  `decidedAt`, bad `rosterDigest`) restored as LEGACY → `rebuysLeft=null`,
  `statsEligible=true`, no corrupt marker. Fail-OPEN.
- **FIX 1 — active reservation + advisory pair locks.** `decidePairPolicy` now takes
  `PairEvidence {active, settled}`. An **ACTIVE reservation** = a `poker_matches` row with NO
  settlement sharing a pair with the candidate roster; no fixed expiry, converts to the
  15-min cooldown on payout, released by `cancel_refund`. Refusal carries a bounded generic
  `ACTIVE_RESERVATION_RETRY_SECONDS = 60` (never a predicted end time).
  `evaluatePairPolicyTx` takes `pg_advisory_xact_lock` for every unordered pair FIRST, in
  sorted key order (no deadlock), key derived **in SQL from md5** (stable; never a JS hash);
  auto-released on COMMIT/ROLLBACK. Final lock order: `withRoomLock` → economy barrier → DB
  tx → sorted pair advisory locks → policy read → wallet debit.
- **FIX 2 — tri-state policy read.** `parseAntiDumpPolicy` is GONE; `readAntiDumpPolicy(container)`
  returns `absent | valid | malformed` (present-but-invalid, incl. `null` and any unexpected
  extra key). `deserializePokerEscrow` reports `policyCorrupt` separately from `corrupt` — the
  escrow is MONEY and is never declared corrupt over a policy field. New SERVER-ONLY
  `ServerRoom.pokerAntiDumpCorrupt`: refuses further rebuys (`rebuysLeftForSeat → 0`), makes
  stats `unranked_skipped` via the new `statsEligibleForRoom(room)` (checked AFTER
  `validateFinishedPaidMatch`), publishes `pokerStatsEligible:false`, and refuses a NEW paid
  match until the old escrow is proven terminal — but **never** blocks payout/refund, never
  freezes, never confiscates. Persisted as a CANONICAL flag (never the malformed value), so a
  serialize→restore round trip cannot launder it into legacy. Retired only by a committed
  fresh debit (exactly one `room.pokerAntiDumpCorrupt = undefined` in the codebase).
- **Tests:** `pokerAntiDump.test.ts` 39→**56** (active-reservation matrix, advisory-key
  determinism, tri-state matrix incl. extra-key rejection, corrupt fail-closed + privacy);
  `pokerAntiDump.integration.test.ts` 18→**27** — fresh concurrent START (exactly one funds,
  one debit each, no settlement for the winner), reservation → refund-release / payout-cooldown,
  ROLLBACK leaves no phantom row, **advisory-lock proof on two INDEPENDENT DB transactions**
  (reversed account order → same lock; unrelated pair not blocked), and the 15-case restore
  matrix. Existing test 25 updated: an ACTIVE match now legitimately reserves the pair.
- **Gates:** clean Docker PostgreSQL — `src/net/poker* + src/games/poker + src/ui/poker` =
  **65 files / 750 tests, 0 skipped, 0 failed**; `npm run verify` PASS (**289 files / 3497
  tests** + build + E2E); `npm run layout:poker` **228 checks LAYOUT OK** (still hangs after
  printing — read the output file); `git diff --check` clean; libc 0; no package/lock drift.
- **Gotcha:** a payout fixture must NOT fabricate `appliedRebuys` — `payoutStacks` cross-checks
  the durable rebuy COUNT and returns `invalid` when the ledger has no matching rows.

### Stage 38.0.9 — 51 corrective UX/rules (COMPLETE, Unreleased)
- Worked from HEAD `87f00f3`. SIX owner FAILs, all reproduced first. **No migration** (0014),
  version 0.4.8, games 7, achievements 52, libc 0. **Poker economy/anti-dump source: ZERO
  diff**; the other five engines: ZERO diff.
- **RED (measured, then moved into permanent tests):**
  A `4p-react-click`/`4p-sticker-click` → "the sheet CLOSED after the click" at EVERY viewport.
  B at 360 a sticker cell was 81px tall with a **37px** visible image (`sticker-img-squashed`,
  426 hits); lazy off-screen ones measured `0/81`.
  C `group-empty-bottom: g2 145px` and `group-stretched: 0|2 equal h=308 but content differs
  by 139`.
  D `[6♠,7♠,🃏=8♠] + 5♠` → reducer returned the SAME reference; `[5,6,7,J]` is obviously valid.
  E `🃏 + [4♠,5♠,6♠]` legal at both ends (`3♠` / `7♠`) and the action had no side field.
  F the pure engine already accepted all six permutations of `6♠ 🃏 8♠` (6-J-8 = 21) — a
  `REPLACE_JOKER` probe proved the hand keeps its LENGTH while its ids change, so the
  length-keyed reset effect never fired and stale ids were silently dropped.
- **FIX A:** `react()`/`sendMedia()` close the picker only when `!sheet`. Exactly 2
  `closeSheet()` call sites + Escape + the launcher toggle; one `setPanel('none')` in total.
- **FIX B:** `.chat-media-thumb` keeps `aspect-ratio: 1/1` + `min 44px` and its `img` is now
  `width/height: 100%` + `object-fit: contain` (was `max-*: 100%`, i.e. intrinsic sizing);
  the grid is `repeat(auto-fill, minmax(60px, 1fr))` + `grid-auto-rows: min-content` +
  `align-items: start` + `overflow-x: hidden`. Emoji buttons got 44×44.
- **FIX C:** `.fiftyone-meldgroup { flex: 0 1 auto; align-self: flex-start }` (was
  `flex: 1 1 100%`), `.fiftyone-melds { align-items/align-content: flex-start }`, the old
  desktop `flex: 1 1 22rem; max-width: 50%` rule deleted, and a phone-only
  `@media (max-width: 559px) { flex: 1 1 100% }` because the cards genuinely need the row.
- **FIX D/E — ONE owner RULE clarification (51_RULES §9).** `ADD_TO_MELD` now REQUIRES
  `placement: 'start' | 'end'`. New shared pure helpers in `melds.ts`: `LayoffPlacement`,
  `isLayoffPlacement`, `layoffCandidate`, `legalLayoffPlacements` (+ `LayoffOption`). The
  helper DEDUPES by resolved signature, so two options appear ONLY when the sides produce
  genuinely different melds (in practice: a joker) — a joker-free card sorts into the same
  canonical run either way and asks nothing. Sets normalise to one `end` option. UI:
  `FiftyOneLayoffDialog` (opaque `--panel`, 44px, focus trap+return, Escape/backdrop cancel,
  single-flight pick) shown only for 2 options; 1 acts immediately, 0 hides the control. The
  bot uses the same helper and always sends a placement. i18n `fiftyOne.layoff*` ×4.
- **FIX F:** the reset effect is now `[currentSeat, turnStep, phase, roundNumber]` only; an
  ordinary update RECONCILES `selected`/`staged` against a `poolKey` (the sorted CONTENT
  identity of the pool), dropping only ids that really vanished and returning the SAME array
  reference when nothing changed.
- **Gate `npm run layout:fiftyone` extended to 144 checks**: viewports 360/390/768/1366/1920/
  2560 × 24 scenarios, including REAL clicks (`stillOpen` assertion + the active tab), sticker
  geometry (square cell, image fills it, no strip/overlap/x-scroll) and meld-group compactness
  (`group-empty-bottom` ≤26px, `group-empty-right` ≤48px, `group-stretched`, `group-too-wide`
  judged by the widest CARD ROW so a 13-card run is exempt). `--legacy` still reproduces the
  RED (2337 violations).
- **Gates:** `npm run verify` PASS (**291 files / 3536 tests** + build + E2E); layout:fiftyone
  144/144; layout:poker 228 LAYOUT OK; git diff --check clean; libc 0; no package/lock drift.
- **Gotchas:** (1) `resolveRunInternal` is ORDER-INDEPENDENT for joker-free cards, so both
  placements often resolve identically — dedupe by signature or the chooser appears for every
  lay-off. (2) A JS template literal in the QA probe cannot contain backticks — a
  `object-fit: contain` comment broke the script.

### Stage 38.0.11 — incremental GIF import (COMPLETE, Unreleased)
- Worked from HEAD `30a11e6`. Assets + importer + guards only: **no migration** (0014),
  version 0.4.8, games 7, achievements 52, libc 0, no rules/protocol/UI-behaviour change.
- **`scripts/gen-chat-media.mjs` is now INCREMENTAL/ADDITIVE by default.** It used to
  `rmSync` `public/chat-media` and regenerate everything — that would have renamed/reordered
  the shipped stickers (a chat message references a sticker by ID alone). It now reads the
  existing catalog back (JSON slice after the `= ` marker — NOT `indexOf('[')`, the
  `ChatMediaItem[]` annotation has one too), keeps every item verbatim, and APPENDS. A source
  file is imported only when its **sha256 is new**, so a renamed copy of an already-imported
  asset is skipped and one picture can never sit under two ids. New flags: `--only=gif`
  (extension filter), `--rebuild` (the old destructive path, deliberate use only),
  `--dry-run`. Caps `MAX_FILE_BYTES = 100 KB` / `MAX_TOTAL_BYTES = 10 MB` (mirrored in the
  test) — over-limit files are reported as skipped, never silently optimised.
- **Import result** (`D:\myfiles\gifs`, 446 files / 209 GIF / 237 non-GIF): 49 already
  present, 0 content duplicates, 0 over-limit, **160 genuinely new GIFs**. Catalog 93 → 253
  items, folder 2.11 → 7.66 MB. Catalog diff is **960 insertions / 0 deletions**.
- **`src/net/chatMediaCatalog.test.ts` guards** (new `chat-media assets on disk` block +
  a legacy-prefix test): catalog ⇄ folder is a bijection, filename == id + ext, no duplicate
  content hash, per-file/total size budget, every gif is a real GIF87a/89a with **≥2 Graphic
  Control Extensions (still animated)**, every image entry a real PNG, and the 93 pre-38.0.11
  ids still head the catalog in their original order.
- **`scripts/fiftyone-layout-qa.mjs` settle fix (found by this stage, real).** `SETTLE`
  awaited `decode()` on EVERY laid-out image; the picker mounts the whole catalog with
  `loading="lazy"`, and decode() on an off-screen sticker the browser never fetches does not
  settle → the CDP call hit its 20 s cap and 18 checks reported "harness never signalled
  ready". It now decodes only images intersecting the viewport, each raced against 2 s.
- **Gates:** `npm run verify` PASS; `npm run layout:fiftyone` **144 checks, LAYOUT OK** with
  all 253 stickers live (360/390/768/1366/1920/2560, `dir=rtl&lang=ar`, real sticker/reaction
  clicks asserting the sheet stays open); screenshot evidence at 360 re-checked by eye;
  `git diff --check` clean; libc 0; no package/lock drift.
- **Gotcha:** the source folder also holds 237 PNGs — this stage imported GIFs ONLY
  (`--only=gif`). Importing them later is a separate, explicit decision.

### Stage 38.0.12 — room sheet: one scroller + reactions as their own section (COMPLETE, Unreleased)
- Worked from HEAD `ec56060`. Two owner FAILs from a phone screenshot of the 51 room sheet.
  UI only: **no migration** (0014), version 0.4.8, games 7, achievements 52, libc 0. Poker
  (`variant='docked'`) and the historical `floating` cluster are behaviourally untouched —
  every CSS override is scoped to `.social-sheet…`.
- **FAIL 1 "два скрола" — THREE nested scrollers, not two.** `.social-sheet__body` scrolls,
  and inside it `.reaction-bar__stickers` (`max-height: 38vh; overflow-y: auto`),
  `.chat-media-picker` (`42vh`) and `.chat-drawer__list` all kept their own. The list one was
  only found by the NEW measured probe — the screenshot showed the sticker pair. FIX: the body
  is the single scroller; the three descendants get `max-height: none; overflow: visible`
  inside the sheet. The chat auto-scroll now targets `list.closest('.social-sheet__body') ??
  list`, so it still lands on the real scroller in every variant.
- **FAIL 2 "реакції поверх чату" — owner chose a SEPARATE PANEL** (asked, not assumed): the
  `Чат | Реакції` tab strip is gone; `.social-menu` renders one launcher per section (😀
  reactions, 💬 chat with the unread badge, ☰ only when the caller passes `utilitySlot`), each
  toggling its own panel. The head shows `.social-sheet__title` (`😀 Reactions` / `💬 Chat`);
  `closeSheet` returns focus via `launcherFor(panel)` to the launcher that opened it.
  `setPanel('none')` still exists exactly once (inside `closeSheet`).
- **Composer pinned OUTSIDE the scroller** (`{chatOpen && chatCompose}` after the body,
  `.social-sheet > .chat-drawer__compose`): with 253 stickers expanded it used to scroll far
  out of reach. Opening it also scrolls the picker into view (`mediaOpen` effect).
- **Gate `npm run layout:fiftyone` 144 → 150 checks**: new scenario `4p-chat-media` (opens the
  in-composer picker) and two new measured violations — `sheet-nested-scroll` (ANY descendant
  of the body with a real `overflow-y: auto/scroll` overflow) and `compose-hidden`/
  `compose-out-of-sheet`. The `stillOpen` assertion reads `.social-sheet__title` now (the tab
  it used to read no longer exists). The nested-scroll probe **reproduced RED**: 24 hits for
  `chat-drawer__list` across all 6 viewports before the fix.
- **Tests:** new `src/ui/online/roomSocialSheetSections.test.ts` (10 SSR/source/CSS contracts);
  updated `roomSocialSheet.test.ts` (2 launchers, heading instead of tabs, new `closeSheet`)
  and `fiftyOneStage3809.test.ts` FAIL A (per-section launchers; `closeSheet()` count 2 → 4).
- **Gates:** `npm run verify` PASS (**292 files / 3553 tests** + build + E2E); layout:fiftyone
  **150 LAYOUT OK**; layout:poker OK; screenshots at 360/390 re-checked by eye; `git diff
  --check` clean; libc 0; no package/lock drift.
- **Gotcha:** `.chat-drawer__list` is `flex: 1 1 auto` in the drawer; inside the sheet it must
  be `flex: 0 0 auto` + `overflow: visible`, otherwise it keeps a scrollbar of its own.

### Stage 38.0.12.1 — corrective: the picker belongs INSIDE the chat (COMPLETE, Unreleased)
- Worked from HEAD `3455081`. 38.0.12 read "окремою кнопкою" as a second top-level launcher;
  the owner meant a MESSENGER-style picker: an emoji button in the message row that opens an
  extra panel, so you can chat and send emoji **at the same time**. Both follow-up choices
  were ASKED, not assumed: emoji **insert into the input**, and the standalone 😀 launcher is
  **removed** ("все в чаті"). No migration (0014), 0.4.8, games 7, achievements 52, libc 0.
- **Shape now:** `.social-menu` = ONE 💬 launcher (+ ☰ only with a `utilitySlot`); the sheet is
  the chat; the composer carries `chat-emoji-btn` 😀 and the existing 🖼️, both toggling the same
  `mediaOpen` picker; `.chat-picker` is a PINNED SIBLING under the composer (emoji row, then the
  sticker grid). `sheetTitle` is chat/utility only; the sheet's `reactions` branch is gone.
- **Emoji are TEXT in the chat:** `insertEmoji` appends to `text` (clamped by `MAX_CHAT_LEN`) and
  refocuses `inputRef`. `react()` (a floating table reaction) survives ONLY in the
  floating/docked clusters, which the other six games use — 51's sheet no longer has a direct
  reaction sender, which is the owner's explicit call.
- `sendMedia` no longer closes the picker in the sheet (`if (!sheet) { setMediaOpen(false);
  setReactOpen(false); }`) so several stickers can be fired in a row.
- **Scrolling:** two INDEPENDENT bounded regions, neither nested — `.social-sheet__body` (the
  conversation) and `.chat-picker` (`max-height: 34vh`), each the only scroller of its region.
  `.chat-picker .reaction-bar__stickers` must stay `max-height: none; overflow: visible`.
- **Gate `layout:fiftyone` still 150 checks**, rewired: `4p-picker` / `4p-emoji-click` /
  `4p-sticker-click` / `4p-chat-media` all drive `panel=chat` + a real click on
  `.chat-emoji-btn`; new flags `pickerOpen` (`.chat-picker` present) and `typed`
  (`.chat-input` value non-empty after tapping an emoji — proves the insert). `stillOpen` now
  matches the CHAT title. The nested-scroll probe checks BOTH regions.
- Tests: `roomSocialSheetSections.test.ts` rewritten (11), `roomSocialSheet.test.ts` back to one
  launcher + no reaction surface, `fiftyOneStage3809.test.ts` FAIL A updated (`closeSheet()`
  count 4 → 3).

### Stage 38.0.15 — the emoji destination is EXPLICIT, not derived (COMPLETE, Unreleased)
- Worked from HEAD `8ea0cb8`. **CORRECTS Stage 38.0.13's focus heuristic.** UI only: no
  migration (latest still 0014), version 0.4.8, games 7, achievements 52, libc 0, no
  `package.json` change.
- **Owner report:** typing in the chat and then adding an emoji sent it instead of appending
  it — "треба щоб клієнт написав привіт і додав в кінці емоджі".
- **Investigation (do not re-run blind):** the focused branch was NOT broken. Measured on the
  REAL branches (`social-games.html`, real CDP mouse + `Input.insertText`, 390×844, with and
  without `__pushState()`): King/Durak/51/Poker all turned `привіт` into `привіт👍`, sent
  nothing and kept focus. The defect is the CONTRACT: the destination came from
  `document.activeElement`, which the player cannot see. Blur the field any ordinary way —
  scroll/tap the history, dismiss the phone keyboard, tap the table — and the same tap sends
  the emoji away with the draft left unsent. The inert hint changed, but nobody reads a hint
  mid-sentence.
- **The fix (owner-chosen):** the picker holds TWO labelled sections built by ONE `emojiRow`
  factory — `emojiRow('message', …, insertEmoji)` and `emojiRow('table', …, react)` — plus
  the sticker grid. `inputFocused` / `focusedRef` / `setFocused` / `emojiAction` and the
  input's `onFocus`/`onBlur` are DELETED. `insertEmoji` honours the caret when the field is
  active and APPENDS otherwise (a never-focused input reports `selectionStart === 0`, which
  would silently PREPEND). `react` still only calls `onReact`. `closePicker` returns focus to
  the 😀 button unless the input holds it. `keepFocus` stays (3 uses: picker button, the row
  factory, sticker thumb) — the caret must survive a tap.
- i18n ×4: `chat.emojiHintMessage`/`chat.emojiHintTable` → `chat.emojiToMessage` (`У
  повідомлення`) / `chat.emojiToTable` (`На стіл (реакція)`). CSS: `.chat-picker__section`
  (+ divider between sections); `.chat-picker__hint` is now the section heading, still inert.
- **Gate `layout:social` = 203 checks.** New PROBE §3b: exactly 2 emoji rows, equal button
  counts, every section labelled, labels `pointer-events: none`, 44px emoji targets. Four
  behaviours replace the focus pair, each row proved in BOTH focus states: `msg-caret`,
  `msg-blurred` (the owner's case: append, send nothing), `table-focused` (reachable while
  typing — impossible under 38.0.13), `table-blurred`.
  **Gotcha fixed in the harness:** `CDP.click` also had to centre the target inside its own
  scrollable ancestor. `scrollIntoView` alone scrolled the PAGE at 1366 and left the first
  sticker clipped below the picker (thumb top 839 vs picker bottom 828, `scrollTop` 0), so
  the click landed on the button underneath — `sticker fired 0x`. Two emoji rows push the
  sticker grid past the 210px cap, which is what exposed it.
- Tests: `roomSocialUnified.test.ts` focus block replaced by the 38.0.15 contract (+ `fnBody`
  helper — scope source regexes to a function body, `[^]*?` spans the whole file);
  `roomSocialWiring.test.ts` hint assertion updated; `fiftyone-layout-qa.mjs` `4p-emoji-click`
  now clicks `.reaction-bar__emojis--message .reaction-bar__btn`.
- **Known stale, untouched:** `scripts/social-shots.mjs` still drives `.chat-dialog` /
  `.chat-media-btn` / `.social-controls--raised`, all deleted back in 38.0.13/38.0.14. It is a
  screenshot helper, not a gate; it was already broken before this stage.

### Stage 38.0.14 — the chat is NON-MODAL, in normal flow (COMPLETE, Unreleased)
- Worked from HEAD `8523361`. **CORRECTS Stage 38.0.13**: making the one canonical chat a
  MODAL broke the live game. UI only: no migration (latest still 0014), version 0.4.8,
  games 7, achievements 52, libc 0, no `package.json` change.
- **RED (383 violations, 7 real online branches × 4 viewports).** `chat-backdrop` 28×
  (`390x844 rgba(0,0,0,.62)`), `chat-aria-modal` 28×, `scroll-locked: html overflow=hidden`
  28×, `chat-in-viewport-overlay` 28×, `chat-over-gameplay` 63× (390 Durak `.durak-board
  371x205`, `.durak-controls 371x42`, `.hand-reorder-wrap 371x233`; 51 `.fiftyone-melds
  374x216`, `.fiftyone-actions 374x48`), `tap-swallowed` 146×, and the decisive one:
  **clicking a legal card/action with the chat open reached the game 0x (expected 1)** in
  Durak/51/Poker at every viewport, while the timer kept running; the click hit the
  backdrop, which CLOSED the chat.
- **Root cause:** fixed full-viewport backdrop (dims + intercepts) + `aria-modal` +
  `documentElement{overflow:hidden}` (added in 38.0.13 to equalise geometry).
- **The fix:** ONE `room-social` column in NORMAL FLOW — `room-social__bar` (timer,
  utilitySlot, voice, 💬, leave, dangerSlot) + utilityPanelSlot + `chat-panel` section
  (`aria-label`, NOT `role=dialog`). No backdrop / aria-modal / focus trap / scroll lock /
  fixed positioning. Panel capped `min(46vh,24rem)`, `34rem` from 900px, safe-area padding.
  `scrollIntoView({block:'nearest'})` once on open (scrolls the PAGE, never freezes it).
- **`variant` DELETED** (`floating|docked|sheet`), and with it `.social-controls*`,
  `.social-menu*`, `.social-sheet*`, `.chat-drawer*`, `.chat-dialog*`. Voice / utility /
  quit are ordinary members of the one row, so 51 needs no modal sheet.
- **Generic slot in all 7 screens:** `GameScreen` (King), Durak, Deberc, Tarneeb,
  Preferans, FiftyOne (was `menuSlot`), Poker — each takes `socialSlot?: ReactNode` and
  renders it after the public table, before the hand/actions. No screen imports RoomSocial.
  King travels via **`GameContext.socialSlot`** (GameRouter → `<GameScreen socialSlot/>`;
  the six short review screens get it appended in flow). `LocalGame` gets nothing.
- **Trade-off, deliberate:** on a tall board the hand ends up below the fold with the chat
  open — reachable by scrolling, which the owner's spec explicitly allows. A desktop grid
  sidecar was rejected (no proven free column in any of the seven screens; per-game
  sidecars would recreate the 38.0.13 divergence).
- **Gate `layout:social` = 195 checks**: PHASE A the isolated harness (now one in-flow
  layout, no variant matrix), PHASE B all SEVEN real branches. Per game it asserts no
  backdrop / no aria-modal / no scroll lock / no out-of-flow position / no intersection
  with any gameplay zone / no swallowed `elementFromPoint` / no page overflow, at
  360/390/768/1366 LTR+RTL; for Durak/51/Poker it scrolls a LEGAL control into view, clicks
  it with real mouse input and asserts the game callback fired exactly once, the chat
  survived the move AND a simulated STATE_UPDATE, and the timer advanced.
  **Gotcha:** `CDP.click` must `scrollIntoView` first — with an in-flow cluster a control
  can sit below the fold and a click at off-screen coordinates silently misses (this is
  what made Deberc's picker look "not open").
- Tests: `roomSocialUnified.test.ts` rewritten for 38.0.14 (25); `roomSocialSheet.test.ts`
  DELETED (the variant is gone); `pokerSocialDock.test.ts`, `permanentLeaveUi.test.ts`,
  `mobileSafeArea.test.ts`, `stage297Fixes.test.ts`, `roomSocialWiring.test.ts`,
  `actionLog.test.ts`, `fiftyOneMobileLayout.test.ts`, `fiftyOneStage3809.test.ts` updated.

### Stage 38.0.13 — ONE chat dialog + focus-based emoji (COMPLETE, Unreleased)
> **Corrected by Stage 38.0.14 (above):** one canonical chat was right; making it a modal
> was not — it blocked the live game.
- Worked from HEAD `75a3b6d`. **CORRECTS Stage 38.0.12's claim that identical chat FUNCTION
  meant an identical chat.** It did not: 38.0.12 shared the chat's inner parts (`chatPanel`)
  but left `variant` choosing the whole SHELL, so the seven games still opened visibly and
  geometrically different chats. UI only: no migration (latest still 0014), version 0.4.8,
  games 7, achievements 52, libc 0, no `package.json` change.
- **RED (measured in a real browser at `75a3b6d`, 467 violations).** The gate now mounts the
  REAL online branches (`scripts/layout-harness/social-games.{html,tsx}`): Durak +
  `DurakGameScreen`, 51 + `FiftyOneGameScreen`, Poker + `PokerGameScreen`. At 390:
  `durak .chat-drawer 320x844@70,0 r=0 no-backdrop` | `fiftyone .social-sheet 390x544@0,300
  r=16/16/0/0 backdrop` | `poker .chat-drawer 371x400@10,617 r=11.2px no-backdrop`; different
  child DOM too. Plus `picker-mode-switch: chat-picker__mode|data-mode="message"|"table"` and
  **`the picker button STOLE focus (active=… chat-picker-btn)`** — which is exactly why a
  naive `document.activeElement` check could not have implemented the new rule.
- **Root cause:** `variant` conflated *where the launcher lives* with *what the chat looks
  like*. Fix: ONE `chatDialog` declared once and rendered by every variant; `variant` now
  positions launchers only.
- **The dialog:** `chat-dialog-backdrop` (fixed, inset 0, rgba(0,0,0,.62)) → `chat-dialog`
  (`min(100%,32rem)` × `min(80vh,34rem)`, safe-area padding, bottom sheet on a phone, centred
  card from `700px`) → head (`💬 Chat` + ✕) → `chat-dialog__list` (6.5rem floor) →
  `chat-dialog__compose` → bounded `chat-picker`. `.chat-drawer*` is gone from TSX and CSS.
  AFTER, identical for all three games at every viewport LTR+RTL: **360×544@0,256 (360),
  390×544@0,300 (390), 512×544@128,240 (768), 512×544@427,178 (1366)**.
- **Scroll lock:** while chat is open `documentElement` gets `overflow:hidden` + matching
  `padding-inline-end`. It is modal correctness AND the last 7px of geometry: a fixed dialog
  centres on the ICB, which excludes a classic scrollbar, so Poker (its screen overflows at
  1366) drew the dialog at l=420 vs Durak/51's 427 until the lock removed the scrollbar.
- **`sheet` variant now has TWO launchers:** 💬 (the shared dialog) and ☰ (voice /
  `utilityPanelSlot` / `dangerSlot`). Without the second one 51 would lose voice + "Quit for
  good", which used to live in the chat sheet's footer. Poker's utility panel keeps its own
  docked shell — only the CHAT is unified.
- **`PickerMode` DELETED** (type, state, both buttons, CSS, and `chat.emojiMode/emojiToMessage/
  emojiToTable` ×4 languages). Replaced by focus: `onFocus/onBlur` → `focusedRef` (read live at
  click time) + `inputFocused` (drives the inert `chat-picker__hint`, `pointer-events:none`).
  Focused → splice at `selectionStart/End`, caret follows, nothing sent, focus kept. Blurred →
  `onReact` once, seat-anchored, draft untouched. **`text.length` decides nothing.**
  `keepFocus` cancels `mousedown` on the picker button, every emoji and every sticker cell
  (blocks the focus change on desktop AND touch, click still fires); `closePicker` only pulls
  focus back to its button when the field does not hold it.
- **Gate `npm run layout:social` rebuilt: 155 checks.** PHASE A = the isolated variant harness;
  PHASE B = the three real branches, compared field by field (cls/position/radius/backdrop/
  child DOM/w/h/l/t) and replayed through focused-caret, blurred-empty, blurred-draft,
  focus-switch and sticker scenarios. Behaviour is driven with REAL `Input.dispatchMouseEvent`
  + `Input.insertText`, because `el.click()` cannot move focus.
  **Gotcha:** a headless page has no system focus, so `el.focus()` sets `activeElement` WITHOUT
  firing the event React listens to — both this gate and `layout:fiftyone` now enable
  `Emulation.setFocusEmulationEnabled`. 51's gate also gained a `focus:<sel>` click step and
  moved `4p-confirm` to `panel=utility` (permleave lives in the ☰ menu now).
- Tests: `roomSocialUnified.test.ts` rewritten for 38.0.13 (30, incl. byte-identical dialog
  markup across variants); `roomSocialSheet.test.ts` (two launchers, chat = shared dialog, menu
  = sheet); `pokerSocialDock.test.ts`, `fiftyOneStage3809.test.ts`, `roomSocialWiring.test.ts`,
  `fiftyOneMobileLayout.test.ts` updated.
- **Gates:** `npm run verify` PASS; `layout:social` **155 OK**; `layout:fiftyone` **156 OK**;
  `layout:poker` **228 OK**; after-screenshots reviewed at 360/390/1366 for Durak, 51 and Poker
  incl. Arabic RTL; `git diff --check` clean; libc 0; no dependency/lockfile drift.

### Stage 38.0.12 (unification) — ONE social contract for all 7 games (COMPLETE, Unreleased)
> **Superseded in part by Stage 38.0.13 (above).** What follows unified the chat's INSIDE
> only. The wrapper it calls "the only difference" was in fact the owner-visible defect, and
> the two explicit emoji modes described below have been deleted in favour of focus.
- Worked from HEAD `d44171b`. **CORRECTS that stage's claim that 51 deliberately differs from
  the other games** — it was an owner FAIL, not a decision. UI only: no migration (0014),
  version 0.4.8, games 7, achievements 52, libc 0. `package.json` gained ONE script
  (`layout:social`); no dependency change.
- **RED (measured, kept as permanent tests).** (a) `src/ui/online/roomSocialUnified.test.ts`
  failed **11 contracts** on d44171b: `floating still has a standalone reactions button`,
  `floating picker button: expected 0 to be 1` (the six games' chat had NO emoji at all), no
  mode switch anywhere ⇒ **51's chat picker could not send a table reaction**. (b) the new
  browser gate reported `outer-reactions-control: 1` + `picker-button-missing` for
  floating/docked at every viewport. (c) 51's own gate, once it measured the VISIBLE band
  instead of the element box, showed the conversation collapsing to **80px (15%) at 360,
  65px (12%) at 390, 4px at 768 and 0px at 1920/2560** with the picker open.
- **Root cause of (c):** `.chat-picker { max-height: 34vh }` is a VIEWPORT fraction while the
  sheet is capped at `min(80vh, 34rem)`; on a tall screen the picker ate the whole fixed-height
  panel. Plus the list was `flex: 0 0 auto` with no floor.
- **The contract now (identical in floating/docked/sheet):** one outer 💬 control (+ the
  caller's `utilitySlot`); `SocialPanel` = `none|chat|utility`; ONE `chatPanel` (list →
  composer → picker) defined once and rendered by all three wrappers; the picker is a bounded
  SIBLING (`max-height: min(30vh, 210px)`, `flex: 0 1 auto; min-height: 0`) and the list holds
  a `6.5rem` floor, so a short panel shrinks the PICKER. Docked cap raised
  `min(42vh,20rem)` → `min(56vh,25rem)`. AFTER: history **142px (sheet) / 104px (docked) /
  467–691px (floating)** with the picker open.
- **Two EXPLICIT emoji actions** via `chat-picker__mode` (`aria-pressed`, `data-mode`):
  `insertEmoji` splices at `selectionStart/End` + restores the caret; `react` = the existing
  Stage 7 `onReact` (seat-anchored via `reactionAnchorForSender`, duplicate names safe, no new
  transport). No send path closes anything; Escape peels lightbox → picker → chat.
- **New generic gate `npm run layout:social`** (`scripts/social-layout-qa.mjs` +
  `scripts/layout-harness/social.{html,tsx}`): 3 variants × 9 scenarios × 4 viewports =
  **108 checks**, LTR + Arabic RTL, with REAL clicks against recorded callbacks (emoji→message
  inserts at the caret and sends nothing; emoji→table fires `onReact` exactly once and leaves
  the text alone; sticker fires once; none closes anything).
  **Gotcha:** the floating drawer and the modal sheet are overlays BY DESIGN — only the DOCKED
  panel may never intersect the action row; the first version of the probe flagged all three.
- Removed: `roomSocialSheetSections.test.ts` (superseded), the `reaction-bar` panels,
  `chat-media-picker`, `chat-emoji-btn`/`chat-media-btn`, `social-sheet__body` as the chat
  scroller. i18n +3 keys ×4 (`chat.emojiMode/emojiToMessage/emojiToTable`).
- **Gates:** `npm run verify` PASS (**292 files / 3559 tests** + build + E2E); `layout:social`
  108 OK; `layout:fiftyone` 150 OK; `layout:poker` 228 OK; screenshots reviewed at 360/390 for
  floating (King/Durak/…), docked (Poker), sheet (51) and Arabic RTL; `git diff --check` clean;
  libc 0; no dependency drift.
