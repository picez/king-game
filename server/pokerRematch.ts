// ---------------------------------------------------------------------------
// Poker bankroll REMATCH lifecycle (Stage 37.7.7, FAIL 2). Extracted from server/index.ts
// so the real handler path — debit a fresh match → restart → refund-on-failure → broadcast —
// is unit-testable with injected deps (real escrow fns against Postgres, or fakes for the
// restart/refund failure branches) WITHOUT booting the whole WS server.
//
// A rematch is a BRAND-NEW paid match (§16): the previous match must already be resolved
// (its payout confirmed) before `debitRematch` will mint a fresh escrow. Guarantees:
//   • a debit that is rejected (previous match not settled yet, or insufficient chips) never
//     restarts and never silently drops readiness — the caller is told to broadcast WHY;
//   • a committed debit whose restart then fails is REFUNDED; the table is only marked a
//     resolved CANCELLED lobby when the refund is CONFIRMED — a failed refund leaves a funded
//     escrow (settlement-pending) that keeps retrying, NEVER a false "refunded/cancelled".
// ---------------------------------------------------------------------------

import type { ServerRoom } from '../src/net/serverCore';
import type { DebitResult } from './pokerEscrow';

/** Injected dependencies for the bankroll rematch lifecycle (all side effects are deps). */
export interface BankrollRematchDeps {
  /** Debit a FRESH buy-in for a new match id (rejects unless the previous escrow is resolved). */
  debitRematch: (room: ServerRoom) => Promise<DebitResult>;
  /** Refund the just-committed buy-in when the restart fails; true = CONFIRMED resolved. */
  refundBuyIns: (room: ServerRoom) => Promise<boolean>;
  /** Restart the same game in the same room (mutates room.gameState); { ok:false } on failure. */
  restartGame: (room: ServerRoom) => { ok: boolean };
  /** Drop the pending rematch readiness. */
  clearRematch: (room: ServerRoom) => void;
  /** Broadcast the rematch readiness progress (REMATCH_STATE). */
  broadcastRematch: (room: ServerRoom) => void;
  /** Broadcast the public room snapshot (carries the honest recovery status). */
  broadcastRoom: (room: ServerRoom) => void;
  /** Broadcast state + advance the turn (a fresh deal → a fresh deadline). */
  advance: (room: ServerRoom) => void;
  /** Persist the room. */
  persist: (room: ServerRoom) => void;
  /** Forget the recorded-finish signature so the fresh match records its own finish. */
  forgetFinish: (room: ServerRoom) => void;
  /** Log the latest deal for the fresh game (best-effort). */
  logDeal: (room: ServerRoom) => void;
}

export type RematchOutcome =
  | 'restarted'          // fresh paid match started
  | 'debit_rejected'     // debit refused (previous not settled / insufficient) — honest broadcast, no charge
  | 'cancelled'          // debit ok but restart failed → refund CONFIRMED → resolved cancelled lobby
  | 'settlement_pending';// debit ok but restart failed AND refund NOT confirmed → funded, retryable

/**
 * Run the bankroll rematch lifecycle for a FINISHED room whose humans are all ready. The
 * caller MUST already have: verified the game is finished, checked `pokerRecoveryBlocked` is
 * false, and acquired the room lock. Returns the outcome for logging/tests.
 */
export async function runBankrollRematch(room: ServerRoom, deps: BankrollRematchDeps): Promise<RematchOutcome> {
  const debit = await deps.debitRematch(room);
  if (!debit.ok) {
    // The previous match is not settled yet (payout pending) OR insufficient chips. Do NOT
    // silently reset — broadcast the honest recovery/readiness so the user sees WHY.
    deps.clearRematch(room);
    deps.broadcastRematch(room);
    deps.broadcastRoom(room);
    return 'debit_rejected';
  }
  deps.forgetFinish(room);
  deps.clearRematch(room);
  const res = deps.restartGame(room);
  if (!res.ok) {
    // The debit committed but the restart failed → attempt a refund. Mark CANCELLED only when
    // the refund is CONFIRMED; a failed refund leaves a funded escrow (settlement-pending) that
    // keeps retrying — never a false "refunded/cancelled".
    const refunded = await deps.refundBuyIns(room);
    room.started = false;
    room.gameState = null;
    if (refunded) room.pokerMatchCancelled = true;
    deps.clearRematch(room);
    deps.persist(room);
    deps.broadcastRoom(room); // honest public snapshot (cancelled OR settlement_pending)
    return refunded ? 'cancelled' : 'settlement_pending';
  }
  room.pokerMatchCancelled = undefined; // a fresh match never inherits a stale recovery flag
  deps.logDeal(room);
  deps.broadcastRoom(room);
  deps.advance(room);
  deps.persist(room);
  return 'restarted';
}
