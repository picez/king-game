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
