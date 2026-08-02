// ---------------------------------------------------------------------------
// Durable gameState ↔ escrow GENERATION binding (Stage 37.7.12 FAIL 1).
//
// A paid rematch mints a NEW escrow (M1) BEFORE the new hand exists: `debitRematch` replaces
// `room.pokerEscrow` and awaits the DB debit, and only then does `restartGame` replace the game
// state. In that window the room holds escrow M1 together with the PREVIOUS match's (M0) finished
// state — and a socket close can persist exactly that pair (the close handler does not wait for the
// room lock). If the process dies there, the restored room looks like "funded escrow + finished
// game" and the old recovery code paid M1 out from M0's final stacks and re-recorded M0's result
// under M1's identity: a fresh buy-in redistributed by a hand that was never dealt.
//
// The fix is a persisted, server-only marker of WHICH escrow produced the current state:
//   • `room.pokerGameMatchId` is set ONLY after a successful debit AND a successful start/restart;
//   • it is cleared whenever the game state is dropped (cancel / refund / failed start);
//   • every economy finish path requires `pokerGameMatchId === pokerEscrow.matchId`.
//
// A room lock does NOT replace this: the lock serializes operations inside ONE process, while the
// binding survives the crash/restore boundary where the damage actually happens.
// ---------------------------------------------------------------------------

import type { ServerRoom } from '../src/net/serverCore';
import { isBankrollRoomShape } from './pokerParticipants';

export type EscrowGameBinding =
  | 'not_bankroll' // not a paid table — no binding is required
  | 'no_game'      // no game state to bind
  | 'no_escrow'    // a game state but no escrow (a resolved/dropped match)
  | 'bound'        // the CURRENT escrow generation produced the CURRENT state
  | 'unbound'      // the state belongs to a DIFFERENT (previous) escrow generation
  | 'unknown';     // a game state + escrow but NO binding (a legacy save) → must fail closed

/** Classify the relationship between a room's current game state and its current escrow. PURE. */
export function escrowGameBinding(room: ServerRoom): EscrowGameBinding {
  if (!isBankrollRoomShape(room)) return 'not_bankroll';
  if (!room.gameState) return 'no_game';
  const esc = room.pokerEscrow;
  if (!esc || typeof esc.matchId !== 'string' || !esc.matchId) return 'no_escrow';
  const bound = room.pokerGameMatchId;
  if (typeof bound !== 'string' || !bound) return 'unknown';
  return bound === esc.matchId ? 'bound' : 'unbound';
}

/** True ONLY when the current escrow generation is the one that produced the current game state. */
export function gameBoundToEscrow(room: ServerRoom): boolean {
  return escrowGameBinding(room) === 'bound';
}

/**
 * Bind the CURRENT game state to the CURRENT escrow generation. Call ONLY after a successful
 * buy-in debit AND a successful `startGame`/`restartGame` — i.e. once this funded escrow really
 * did produce this state. A no-op for a non-bankroll room, a room with no state, or an escrow that
 * is not `funded` (a pending/settling/terminal escrow never "owns" a live hand).
 */
export function bindGameToEscrow(room: ServerRoom): void {
  if (!isBankrollRoomShape(room) || !room.gameState) return;
  const esc = room.pokerEscrow;
  if (!esc || esc.status !== 'funded' || !esc.matchId) return;
  room.pokerGameMatchId = esc.matchId;
}

/** Drop the binding (always together with the game state it described). */
export function clearGameBinding(room: ServerRoom): void {
  room.pokerGameMatchId = undefined;
}

/** Injected side effects for resolving an UNBOUND escrow/state pair. */
export interface UnboundResolveDeps {
  /** Refund the fresh (unplayed) buy-in; the EXPLICIT durable outcome (37.7.18 FAIL 1). */
  refundBuyIns: (room: ServerRoom) => Promise<import('./pokerEscrow').RefundResult>;
  /** Persist the room. */
  persist: (room: ServerRoom) => void;
  /** Clear the room's server timers. */
  clearTimers: (room: ServerRoom) => void;
}

export type UnboundResolution = 'refunded' | 'settlement_pending' | 'paid_conflict';

/**
 * Resolve a room whose CURRENT escrow did NOT produce its CURRENT state (the crashed-rematch shape:
 * a fresh debit whose game never started, sitting next to the previous match's state).
 *
 * The stale state belongs to a PREVIOUS, already-resolved generation (a rematch debit is only
 * allowed once the prior match is settled/cancelled and its stats are no longer owed), so it is
 * dropped — it must never be paid out or recorded against the new escrow. The new escrow is then
 * refunded IDEMPOTENTLY: `refunded` → an honest cancelled lobby a fresh START can reuse;
 * `settlement_pending` (transient DB failure) → the escrow stays funded with no game state, which
 * is exactly the settlement-pending shape the sweep keeps retrying (and which blocks deletion).
 * Call inside `withRoomLock`.
 */
export async function resolveUnboundEscrowGame(room: ServerRoom, deps: UnboundResolveDeps): Promise<UnboundResolution> {
  room.started = false;
  room.gameState = null;      // never pay/record a previous generation's state against this escrow
  clearGameBinding(room);
  deps.clearTimers(room);
  const res = await deps.refundBuyIns(room);
  // (37.7.18 FAIL 1) ONLY a confirmed refund makes this an honest cancelled lobby. `already_paid`
  // (the payout won the settlement race) and `invalid` are operator conditions — the caller freezes.
  if (res === 'confirmed_refund' || res === 'nothing_to_refund') room.pokerMatchCancelled = true;
  deps.persist(room);
  if (res === 'confirmed_refund' || res === 'nothing_to_refund') return 'refunded';
  return res === 'retry_pending' ? 'settlement_pending' : 'paid_conflict';
}
