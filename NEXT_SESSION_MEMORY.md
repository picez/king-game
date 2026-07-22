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
