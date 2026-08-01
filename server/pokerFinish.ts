// ---------------------------------------------------------------------------
// Poker bankroll FINISH processing (Stage 37.7.8). Extracted from server/index.ts so the
// SETTLEMENT-BEFORE-STATS ordering and the permanent invalid→frozen transition are unit-testable
// with injected deps (real escrow/stats against Postgres, or spies) WITHOUT booting the WS server.
//
// The previous code ran payout (fire-and-forget) and stats (fire-and-forget) in PARALLEL, so a
// bankroll match's stats/rating/achievements could be written BEFORE — or even without — a
// confirmed payout. Now payout and stats are ONE serialized flow (the caller holds withRoomLock):
//   • paid / already_paid → record stats (idempotent, exactly once);
//   • retry_pending       → NO stats now (the settlement sweep records them after a later paid);
//   • already_refunded    → NEVER record stats; turn the finished table into a cancelled lobby;
//   • invalid             → NEVER record stats; PERMANENTLY freeze for operator review (no retry).
// ---------------------------------------------------------------------------

import type { ServerRoom } from '../src/net/serverCore';
import type { PokerState } from '../src/games/poker/types';
import type { PayoutResult } from './pokerEscrow';
import type { SeatUsers, RecordResult } from './db/stats';
import { pokerFinishSignature } from '../src/net/pokerStats';
import { validateFinishedPaidMatch, isBankrollRoomShape } from './pokerParticipants';
import { gameBoundToEscrow, clearGameBinding, resolveUnboundEscrowGame, escrowGameBinding } from './pokerBinding';

/**
 * The distinguishable outcomes of a confirmed-stats write (§16, 37.7.9 FAIL 2; `invalid` added in
 * 37.7.11 FAIL 2) — a boolean could not tell duplicate / skip / transient-failure apart, so a
 * failure was silently lost:
 *   • recorded       — a durable row was written by THIS call;
 *   • already_exists — the durable row already existed (idempotent) → RESOLVED, no retry;
 *   • skipped        — no stats owed by policy (bot table / <2 humans / no identified seats);
 *   • failed         — a TRANSIENT DB error → the write is still owed (retry pending);
 *   • invalid        — the paid match's escrow ↔ state participant identity is STRUCTURALLY
 *                      incoherent (duplicate/out-of-range seat, wrong amount, seat set mismatch,
 *                      a bot seat, an impossible winner…). A retry can never fix it, so this is a
 *                      PERMANENT operator condition: freeze, never write stats, never clear the
 *                      owed state, never re-pay.
 */
export type StatsResult = 'recorded' | 'already_exists' | 'skipped' | 'failed' | 'invalid';

/** Injected side effects for recording confirmed bankroll poker stats (idempotent). */
export interface ConfirmedStatsDeps {
  /** True when this room already recorded a finish with this stable match identity (dedup). */
  alreadyRecorded: (roomCode: string, identity: string) => boolean;
  /** Mark this room's stable match identity as recorded (only just before the async write). */
  markRecorded: (roomCode: string, identity: string) => void;
  /** Undo the mark on a failed write so a later retry can record. */
  unmarkRecorded: (roomCode: string) => void;
  /** The actual per-game recorder (idempotent via games.game_key, keyed by the stable matchId). */
  record: (roomCode: string, state: PokerState, seatUsers: SeatUsers, matchId?: string | null) => Promise<RecordResult>;
}

/**
 * Record stats for a CONFIRMED-paid bankroll poker finish. Only ever called AFTER a confirmed
 * payout. The dedup marker uses the STABLE escrow matchId (37.7.9 FAIL 1) — never a content
 * signature that could collide across identical-outcome matches. The marker is set ONLY just
 * before the write (after every early-return gate), and is undone on a transient failure so a
 * retry can complete. Returns a 4-way `StatsResult` so the caller can tell a transient failure
 * (retry owed) from a duplicate/skip (already resolved).
 */
export async function recordConfirmedPokerStats(room: ServerRoom, state: PokerState, deps: ConfirmedStatsDeps): Promise<StatsResult> {
  const esc = room.pokerEscrow;
  const isBankroll = room.gameType === 'poker' && typeof room.pokerBuyIn === 'number' && room.pokerBuyIn > 0;

  const seatUsers: SeatUsers = new Map<number, string | null>();
  let matchId: string | null = null;

  if (isBankroll) {
    // (37.7.12 FAIL 1) The state must belong to THIS escrow generation. A stale state from the
    // previous match (a crashed rematch) must NEVER be recorded under the new match's identity —
    // that is how M0's result got a second, wrong stats row keyed on M1.
    if (!gameBoundToEscrow(room)) return 'invalid';
    // (37.7.10 FAIL 3) A finished PAID match's participants are IMMUTABLE — take the seat→userId
    // snapshot from the persisted escrow.seats, NOT the current room membership (which is emptied by
    // handleLeave BEFORE teardown). The escrow IS the historical participant set.
    // (37.7.11/37.7.12 FAIL 2) That snapshot goes through the SHARED STRICT finished-match validator —
    // the same one the payout uses — so a malformed escrow/state can never collapse duplicate seats
    // into a Map and write a partial attribution. A structural failure is `invalid` (permanent,
    // freeze, owed state kept), NEVER a policy `skipped` and never an endless transient retry.
    const identity = validateFinishedPaidMatch(esc, state);
    if (!identity.ok) return 'invalid';
    for (const [seat, userId] of identity.participants.seatUsers) seatUsers.set(seat, userId);
    matchId = identity.participants.matchId;
  } else {
    // Non-bankroll poker: no escrow → the owner rule (human-only, ≥2) is checked against membership,
    // and identity falls back to the content signature. (Bankroll is the only confirmed-stats caller
    // in practice; this keeps a safe fallback.)
    const players = [...room.members.values()].filter((m) => m.role === 'player');
    const humanPlayers = players.filter((m) => m.type === 'human').length;
    const botPlayers = players.filter((m) => m.type === 'ai').length;
    if (botPlayers > 0 || humanPlayers < 2) return 'skipped';
    for (const m of room.members.values()) {
      if (m.role === 'player' && m.type === 'human' && m.seatIndex != null && m.userId) seatUsers.set(m.seatIndex, m.userId);
    }
    if (seatUsers.size === 0) return 'skipped';
  }

  // STABLE identity: the escrow matchId for a bankroll match (unique per paid match), or a content
  // signature fallback for a non-bankroll table. The marker + the durable games.game_key both key on it.
  const identity = matchId ?? pokerFinishSignature(state);
  if (deps.alreadyRecorded(room.code, identity)) return 'already_exists'; // in-memory dedup (same process)

  deps.markRecorded(room.code, identity); // set the marker ONLY now — after every gate above
  try {
    const res = await deps.record(room.code, state, seatUsers, matchId);
    return res.recorded ? 'recorded' : 'already_exists'; // false = the durable row already existed
  } catch {
    deps.unmarkRecorded(room.code); // transient DB error → allow a later retry
    return 'failed';
  }
}

/** Injected side effects for the room-deletion settlement flow (37.7.10 FAIL 2). */
export interface TeardownDeps {
  /** Reconcile a restored transient (pending/settling) escrow vs the durable DB settlement. */
  reconcileEscrow: (room: ServerRoom) => Promise<void>;
  /** True when the room still holds unsettled escrow (chips owed). */
  hasUnsettledEscrow: (room: ServerRoom) => boolean;
  /** True when `state` is a finished poker game. */
  isFinished: (state: PokerState) => boolean;
  /** The FULL settle-then-record finish flow (payout → stats), same as the finish/sweep path. */
  settleAndRecord: (room: ServerRoom, state: PokerState) => Promise<BankrollFinishOutcome>;
  /** Refund an unfinished funded match. */
  refundBuyIns: (room: ServerRoom) => Promise<boolean>;
  /** Persist the room (when kept for a retry). */
  persist: (room: ServerRoom) => void;
  /** PERMANENTLY freeze the room for operator review (logs the room code + a safe reason ONCE). */
  freeze: (room: ServerRoom, reason: string) => void;
  /** Clear the room's server timers (used by the unbound-debit resolution). */
  clearTimers: (room: ServerRoom) => void;
}

/**
 * Decide the fate of a bankroll room being torn down. A FINISHED match runs the SAME
 * settle-then-record lifecycle as the normal finish/sweep (payout → stats) — never a raw
 * `payoutStacks`→purge that would lose the owed stats (the pre-37.7.10 bug). An UNFINISHED funded
 * match is refunded. Returns `'purge'` ONLY when fully resolved (escrow terminal, not frozen, and no
 * owed stats); otherwise `'keep'` (kept + persisted for the next sweep). Call inside `withRoomLock`.
 *
 * HARD INVARIANT: a paid finished match is NEVER purged while its stats outcome is a transient
 * `failed`; and the stats retry NEVER re-runs the payout.
 */
export async function settleRoomForDeletion(room: ServerRoom, deps: TeardownDeps): Promise<'purge' | 'keep'> {
  // (37.7.8/37.7.11) A FROZEN room is a PERMANENT operator condition — never auto-settle or purge it.
  if (room.pokerFrozen) { deps.persist(room); return 'keep'; }
  await deps.reconcileEscrow(room);
  const state = room.gameState as PokerState | null;
  const finished = !!state && deps.isFinished(state);

  if (isBankrollRoomShape(room) && state) {
    const binding = escrowGameBinding(room);
    const escStatus = room.pokerEscrow?.status;
    // (37.7.12 FAIL 1) The current escrow did NOT produce this state (a crashed rematch: fresh debit
    // + the previous match's state). Never settle from it — drop the stale state and REFUND the
    // fresh buy-in; purge only once the refund is CONFIRMED.
    if (binding === 'unbound' && escStatus !== 'settled' && escStatus !== 'cancelled') {
      const res = await resolveUnboundEscrowGame(room, { refundBuyIns: deps.refundBuyIns, persist: deps.persist, clearTimers: deps.clearTimers });
      return res === 'refunded' ? 'purge' : 'keep';
    }
    // (37.7.12) A legacy save with NO binding, or a PAID escrow whose state is from another
    // generation, cannot be settled safely → freeze for operator review (never purged, never paid).
    if (binding === 'unknown' || (binding === 'unbound' && escStatus === 'settled')) {
      deps.freeze(room, 'unknown match generation for the persisted game');
      deps.persist(room);
      return 'keep';
    }
  }

  // (37.7.11 FAIL 1) A PAID (settled) escrow with an UNFINISHED state is INCOHERENT: the money is
  // already out, but the room JSON carries a pre-finish state, so the true final state was lost. It
  // must never be purged (that destroys the only evidence of a paid match), never refunded, and never
  // re-paid — freeze it permanently for operator review. Note `hasUnsettledEscrow` is FALSE here,
  // which is exactly why the old code fell through to `purge`.
  if (!finished && isBankrollRoomShape(room) && room.pokerEscrow?.status === 'settled') {
    deps.freeze(room, 'paid match with no finished state');
    deps.persist(room);
    return 'keep';
  }

  if (finished && state) {
    // Pay out (idempotent) + record stats + set the recovery flags (stats-pending / cancelled / frozen).
    await deps.settleAndRecord(room, state);
    if (room.pokerFrozen) { deps.persist(room); return 'keep'; }            // invalid payout → operator review
    const esc = room.pokerEscrow;
    const escTerminal = !esc || esc.status === 'settled' || esc.status === 'cancelled';
    if (escTerminal && !room.pokerStatsPending) return 'purge';             // fully resolved
    deps.persist(room);
    return 'keep';                                                          // transient payout/stats failure → retry
  }

  // Unfinished: nothing owed → purge; otherwise refund the funded match.
  if (!deps.hasUnsettledEscrow(room)) return 'purge';
  await deps.refundBuyIns(room);
  const st = room.pokerEscrow?.status;
  if (st === 'settled' || st === 'cancelled') return 'purge';
  deps.persist(room);
  return 'keep';
}

/** Injected side effects for the settle-then-record finish flow. */
export interface BankrollFinishDeps {
  /** Pay out the finished match's final stacks (DB-authoritative; idempotent). */
  payoutStacks: (room: ServerRoom, state: PokerState) => Promise<PayoutResult>;
  /** Record confirmed stats (only called after paid/already_paid). */
  recordStats: (room: ServerRoom, state: PokerState) => Promise<StatsResult>;
  /** Persist the room. */
  persist: (room: ServerRoom) => void;
  /** Broadcast the public room snapshot (recovery status). */
  broadcast: (room: ServerRoom) => void;
  /** Drop any pending rematch readiness. */
  clearRematch: (room: ServerRoom) => void;
  /** PERMANENTLY freeze the room for operator review (invalid payout). Logs once, no auto-retry. */
  freeze: (room: ServerRoom, reason: string) => void;
}

/**
 * (37.7.12 FAIL 1) `unbound_state` — the room's game state was produced by a DIFFERENT escrow
 * generation than the current escrow, so this flow refuses to pay OR record anything. It is not a
 * payout outcome at all: the caller resolves it through the unbound refund lifecycle.
 */
export type FinishResult = PayoutResult | 'unbound_state';

export interface BankrollFinishOutcome {
  result: FinishResult;
  stats: StatsResult | null; // null when payout did not confirm (no stats attempted)
}

/**
 * Settle a FINISHED bankroll poker match, THEN record stats — never the reverse, and never in
 * parallel. Call inside `withRoomLock(room.code, …)`. Stats are recorded ONLY on a confirmed
 * payout; `already_refunded` cancels the finished table; `invalid` freezes it permanently.
 *
 * STATS-PENDING (§16, 37.7.9 FAIL 2): the payout is already `settled` (money is out), so if the
 * stats write then fails TRANSIENTLY the escrow can't carry the retry (it is no longer funded). The
 * room is marked `pokerStatsPending` — a PERSISTED, restart-surviving state that blocks a new paid
 * rematch (but NEVER re-pays) and is retried by the settlement sweep until the stats are written
 * (or the durable row already exists). Any resolved outcome clears the flag.
 */
export async function settleAndRecordBankrollPokerFinish(room: ServerRoom, state: PokerState, deps: BankrollFinishDeps): Promise<BankrollFinishOutcome> {
  // (37.7.12 FAIL 1) HARD GATE: only the escrow generation that actually produced this state may be
  // settled from it. An unbound pair (a fresh rematch debit + the previous match's state) leaves the
  // wallet untouched here — the caller runs the unbound refund lifecycle instead.
  if (isBankrollRoomShape(room) && !gameBoundToEscrow(room)) return { result: 'unbound_state', stats: null };
  const result = await deps.payoutStacks(room, state);
  switch (result) {
    case 'paid':
    case 'already_paid': {
      // (37.7.10 ordering) Determine the stats outcome and set the FINAL recovery flag BEFORE any
      // broadcast — otherwise a broadcast between "paid" and "stats-pending" would briefly show the
      // table as rematch-enabled. Payout is already settled in the DB; a single persist+broadcast at
      // the end reflects the true post-finish state (clear → rematch enabled, or stats_pending).
      const stats = await deps.recordStats(room, state);
      if (stats === 'failed') {
        // Money is out but stats aren't durably recorded → STATS-PENDING (retryable, blocks rematch).
        room.pokerStatsPending = true;
      } else if (stats === 'invalid') {
        // (37.7.11 FAIL 2) The paid match's participant identity is structurally incoherent — a retry
        // can never fix it. Keep the owed-stats fact (evidence, blocks purge) and freeze PERMANENTLY:
        // `statsPending` excludes frozen rooms, so the sweep stops retrying (no log spam) and no
        // partial attribution is ever written.
        room.pokerStatsPending = true;
        deps.freeze(room, 'paid match participants invalid');
      } else if (room.pokerStatsPending) {
        // recorded / already_exists / skipped → resolved: clear any prior stats-pending, re-enable rematch.
        room.pokerStatsPending = undefined;
      }
      deps.persist(room);
      deps.broadcast(room);
      return { result, stats };
    }
    case 'already_refunded':
      // The DB gate says this match was refunded → NEVER pay/continue it as paid, and NEVER record
      // stats. Turn the finished table into an honest cancelled lobby.
      room.started = false;
      room.gameState = null;
      clearGameBinding(room); // (37.7.12) the binding always dies with the state it described
      room.pokerMatchCancelled = true;
      deps.clearRematch(room);
      deps.persist(room);
      deps.broadcast(room);
      return { result, stats: null };
    case 'retry_pending':
      // Transient failure → escrow left funded (payout_pending). Stats are DEFERRED to the sweep
      // that eventually pays out (so they can never precede a payout that later proves refunded).
      deps.persist(room);
      deps.broadcast(room);
      return { result, stats: null };
    case 'invalid':
      // PERMANENT fail-closed/operator condition (bad conservation/escrow) — NOT a transient DB
      // failure. Freeze the room so no sweep retries the impossible payout and no stats are written.
      deps.freeze(room, 'payout conservation invalid');
      deps.persist(room);
      deps.broadcast(room);
      return { result, stats: null };
  }
}
