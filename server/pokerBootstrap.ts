// ---------------------------------------------------------------------------
// Poker bankroll BOOTSTRAP recovery (Stage 37.7.10 FAIL 1; hardened 37.7.11). Extracted from
// server/index.ts so the production restart-recovery ORCHESTRATION is testable WITHOUT booting the
// WS server — `recoverRestoredBankrollRoom` is the exact function index.ts runs per restored room
// (reconcile → classify → apply → persist/advance decision), so a test can never drift from it.
//
// On restart a restored bankroll room that still carries a game state must be classified — a LIVE
// funded match, a payout still owed, a PAID finish whose stats need finalizing, a refunded/cancelled
// match, an INCOHERENT paid one, or a frozen one:
//   • a `settled` (PAID) escrow with a FINISHED game is a PAID finish (keep the state, finalize
//     stats), NEVER a refund/cancel (37.7.10 FAIL 1);
//   • a `settled` (PAID) escrow with an UNFINISHED game is INCOHERENT — money is out but the final
//     state was lost — and must FAIL CLOSED into a permanent frozen state, never resume as `live`
//     (37.7.11 FAIL 1).
// ---------------------------------------------------------------------------

import type { ServerRoom } from '../src/net/serverCore';
import type { PokerState } from '../src/games/poker/types';
import { isBankrollRoomShape } from './pokerParticipants';

export type BootstrapRecovery =
  | 'not_bankroll'    // not a bankroll room (or no game state) — nothing to classify
  | 'frozen'          // already frozen (corrupt/invalid) — kept for operator, no advance
  | 'incoherent_paid' // settled escrow + UNFINISHED game — a paid match with no final state → freeze
  | 'live'            // funded/settling escrow + UNFINISHED game — a live match to advance
  | 'payout_pending'  // funded/settling escrow + FINISHED game — payout not yet confirmed
  | 'paid_finish'     // settled escrow + FINISHED game — a PAID finish; finalize stats (never cancel)
  | 'cancelled';      // refunded/cancelled escrow — the old game can't continue for chips

/**
 * (37.7.11 FAIL 1) TRUE when the initial restore loop must NOT arm timers/advance for this room and
 * must leave that decision to the economy recovery classification.
 *
 * The old guard deferred only `hasUnsettledEscrow` rooms, so a room whose escrow was already
 * `settled`/`cancelled` (or that carried stats-pending/frozen state) was advanced BEFORE any
 * classification ran — an already-PAID match could take a timer, a bot step, or an ACTION_REQUEST
 * before recovery even looked at it. EVERY bankroll room now defers: only `recoverRestoredBankrollRoom`
 * (classification `live`) may re-arm the advance.
 */
export function shouldDeferBootstrapAdvance(room: ServerRoom): boolean {
  return isBankrollRoomShape(room);
}

/**
 * PURE classification of a RESTORED bankroll room that still has a game state, AFTER `reconcileEscrow`
 * has resolved any transient (pending/settling) escrow against the durable DB settlement. `isFinished`
 * is the poker finished-state predicate.
 */
export function classifyBootstrapRecovery(room: ServerRoom, isFinished: (s: PokerState) => boolean): BootstrapRecovery {
  if (!isBankrollRoomShape(room) || !room.gameState) return 'not_bankroll';
  if (room.pokerFrozen) return 'frozen';
  const esc = room.pokerEscrow;
  const finished = isFinished(room.gameState as PokerState);
  if (esc && (esc.status === 'funded' || esc.status === 'settling')) return finished ? 'payout_pending' : 'live';
  // (37.7.10 FAIL 1) A `settled` escrow is a durable PAID payout — a finished game here is a PAID
  // FINISH whose stats must be finalized (NEVER a refund/cancel).
  // (37.7.11 FAIL 1) A `settled` escrow with an UNFINISHED game is an INCOHERENT PAID state: the
  // durable payout committed, but the persisted room JSON still holds a pre-finish state, so the
  // authoritative final state is gone. Resuming it would run a match whose chips are already paid
  // out (and could pay/refund twice); it fails CLOSED into a frozen operator state instead.
  if (esc && esc.status === 'settled') return finished ? 'paid_finish' : 'incoherent_paid';
  // A `cancelled` (or absent) escrow means the buy-ins were refunded → the old game can't continue.
  return 'cancelled';
}

/** Injected side effects for applying a bootstrap recovery classification. */
export interface BootstrapApplyDeps {
  /** Reschedule the server-driven advance for a live match. */
  rescheduleAdvance: (room: ServerRoom) => void;
  /** Persist the room. */
  persist: (room: ServerRoom) => void;
  /** Clear the room's server timers (on cancel / freeze). */
  clearTimers: (room: ServerRoom) => void;
  /** PERMANENTLY freeze the room for operator review (logs the room code + a safe reason ONCE). */
  freeze: (room: ServerRoom, reason: string) => void;
}

/**
 * Apply a bootstrap recovery classification to a restored room (mutations + persistence via deps).
 * Returns the classification for logging/tests.
 *
 * ONLY `live` re-arms the advance. `paid_finish` keeps the finished state and marks the stats as
 * owed (the sweep records them idempotently — never re-paying); `incoherent_paid` freezes;
 * `cancelled` wipes the refunded match back to a clean lobby.
 */
export function applyBootstrapRecovery(room: ServerRoom, recovery: BootstrapRecovery, deps: BootstrapApplyDeps): BootstrapRecovery {
  switch (recovery) {
    case 'live':
      deps.rescheduleAdvance(room);
      break;
    case 'payout_pending':
      // Leave the finished state + funded escrow — the settlement sweep pays out then records stats.
      break;
    case 'paid_finish':
      // (37.7.10 FAIL 1) A durable PAID finish restored across a crash → keep the finished state and
      // finalize stats: mark stats-pending (idempotent via the durable game_key) so the sweep records
      // them EXACTLY once. NEVER cancel, never re-pay.
      room.pokerStatsPending = true;
      deps.persist(room);
      break;
    case 'incoherent_paid':
      // (37.7.11 FAIL 1) Fail CLOSED: no advance, no timers, no gameplay/rematch, no settlement —
      // and NOT `pokerMatchCancelled` (nothing was refunded). Frozen is persisted, so it survives a
      // further restart, blocks START/ACTION/REMATCH, keeps teardown from purging, and surfaces
      // publicly as the opaque `frozen` recovery status.
      deps.clearTimers(room);
      deps.freeze(room, 'paid match with no finished state');
      deps.persist(room);
      break;
    case 'cancelled':
      room.pokerMatchCancelled = true;
      room.gameState = null;
      room.started = false;
      deps.clearTimers(room);
      deps.persist(room);
      break;
    // 'frozen' / 'not_bankroll' → no-op.
  }
  return recovery;
}

/** Injected side effects for the full per-room bootstrap recovery orchestration. */
export interface BootstrapRecoveryDeps extends BootstrapApplyDeps {
  /** Reconcile a restored transient (pending/settling) escrow vs the durable DB settlement. */
  reconcileEscrow: (room: ServerRoom) => Promise<void>;
  /** True when `state` is a finished poker game. */
  isFinished: (state: PokerState) => boolean;
}

/**
 * PRODUCTION bootstrap recovery for ONE restored bankroll room — the whole sequence index.ts runs:
 * reconcile the durable escrow, classify, then apply (mutations + persist + the advance decision).
 * Call inside `withRoomLock(room.code, …)`.
 *
 * (37.7.11) This exists so the integration tests drive the REAL orchestration instead of re-creating
 * the branching locally — Stage 37.7.10's integration test mirrored these steps by hand, which is
 * why it never noticed that the restore loop had already armed the advance, nor that a `settled`
 * escrow with an unfinished state was classified `live`.
 */
export async function recoverRestoredBankrollRoom(room: ServerRoom, deps: BootstrapRecoveryDeps): Promise<BootstrapRecovery> {
  if (!isBankrollRoomShape(room) || !room.gameState) return 'not_bankroll';
  await deps.reconcileEscrow(room); // no-op unless the escrow is still pending/settling
  const recovery = classifyBootstrapRecovery(room, deps.isFinished);
  return applyBootstrapRecovery(room, recovery, deps);
}
