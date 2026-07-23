// ---------------------------------------------------------------------------
// Poker bankroll BOOTSTRAP recovery (Stage 37.7.10 FAIL 1). Extracted from server/index.ts so the
// production restart-recovery classification is unit-testable WITHOUT booting the WS server.
//
// On restart a restored bankroll room that still carries a game state must be classified — a LIVE
// funded match, a payout still owed, a PAID finish whose stats need finalizing, a refunded/cancelled
// match, or a frozen one. The critical bug: a `settled` (PAID) escrow with a finished game must be a
// PAID finish (keep the finished state, finalize stats), NEVER mistaken for a refund/cancel.
// ---------------------------------------------------------------------------

import type { ServerRoom } from '../src/net/serverCore';
import type { PokerState } from '../src/games/poker/types';

export type BootstrapRecovery =
  | 'not_bankroll'   // not a bankroll room (or no game state) — nothing to classify
  | 'frozen'         // corrupt/invalid — kept for operator, no advance
  | 'live'           // funded/settling escrow + UNFINISHED game — a live match to advance
  | 'payout_pending' // funded/settling escrow + FINISHED game — payout not yet confirmed
  | 'paid_finish'    // settled escrow + FINISHED game — a PAID finish; finalize stats (never cancel)
  | 'cancelled';     // refunded/cancelled escrow — the old game can't continue for chips

/**
 * PURE classification of a RESTORED bankroll room that still has a game state, AFTER `reconcileEscrow`
 * has resolved any transient (pending/settling) escrow against the durable DB settlement. `isFinished`
 * is the poker finished-state predicate.
 */
export function classifyBootstrapRecovery(room: ServerRoom, isFinished: (s: PokerState) => boolean): BootstrapRecovery {
  if (room.gameType !== 'poker' || typeof room.pokerBuyIn !== 'number' || room.pokerBuyIn <= 0 || !room.gameState) return 'not_bankroll';
  if (room.pokerFrozen) return 'frozen';
  const esc = room.pokerEscrow;
  const finished = isFinished(room.gameState as PokerState);
  if (esc && (esc.status === 'funded' || esc.status === 'settling')) return finished ? 'payout_pending' : 'live';
  // (37.7.10 FAIL 1) A `settled` escrow is a durable PAID payout — a finished game here is a PAID
  // FINISH whose stats must be finalized (NEVER a refund/cancel). A settled escrow with an unfinished
  // game is incoherent (a paid match implies a finish) → treat conservatively as live (no cancel).
  if (esc && esc.status === 'settled') return finished ? 'paid_finish' : 'live';
  // A `cancelled` (or absent) escrow means the buy-ins were refunded → the old game can't continue.
  return 'cancelled';
}

/** Injected side effects for applying a bootstrap recovery classification. */
export interface BootstrapApplyDeps {
  /** Reschedule the server-driven advance for a live match. */
  rescheduleAdvance: (room: ServerRoom) => void;
  /** Persist the room. */
  persist: (room: ServerRoom) => void;
  /** Clear the room's server timers (on cancel). */
  clearTimers: (room: ServerRoom) => void;
}

/**
 * Apply a bootstrap recovery classification to a restored room (mutations + persistence via deps).
 * Returns the classification for logging/tests.
 */
export function applyBootstrapRecovery(room: ServerRoom, recovery: BootstrapRecovery, deps: BootstrapApplyDeps): BootstrapRecovery {
  switch (recovery) {
    case 'live':
      deps.rescheduleAdvance(room);
      break;
    case 'payout_pending':
      // Leave the finished state + funded escrow — the settlement sweep pays out then records stats.
      break;
    case 'cancelled':
      room.pokerMatchCancelled = true;
      room.gameState = null;
      room.started = false;
      deps.clearTimers(room);
      deps.persist(room);
      break;
    // 'paid_finish' handled after the fix; 'frozen' / 'not_bankroll' → no-op.
  }
  return recovery;
}
