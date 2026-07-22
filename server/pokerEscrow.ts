// ---------------------------------------------------------------------------
// Poker bankroll ESCROW lifecycle (Stage 37.7 §16 F/G; hardened 37.7.1). Wires the
// wallet ledger + the DB settlement gate into the room lifecycle:
//   • an atomic all-or-nothing buy-in debit at START_GAME / REMATCH,
//   • a payout of final stacks at game_finished,
//   • a cancellation refund when a funded table is orphaned/torn down unfinished.
//
// Every step is IDEMPOTENT via per-(match,user) ledger keys, and payout ↔ refund are
// MUTUALLY EXCLUSIVE via a DB-authoritative per-match settlement row (settleMatchTx) —
// so a crash/restart can never make both mint chips. All lifecycle operations for a
// room run through `withRoomLock` (a per-room async mutex) so a debit can never race a
// leave/kick/settings/second-start. A committed debit whose start then fails is refunded
// immediately. On restore, a transient escrow is RECONCILED against the durable DB state.
//
// DB-gated: with no DATABASE_URL there is no economy (local free-play is unaffected).
// A bankroll room is an online poker room carrying a server-derived `pokerBuyIn`.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ServerRoom, PokerEscrow, PokerEscrowSeat } from '../src/net/serverCore';
import type { PokerState } from '../src/games/poker/types';
import { getDb, isDbEnabled } from './db/client';
import {
  adjustWalletTx, settleMatchTx, matchLedgerState,
  InsufficientChipsError, SettlementConflictError,
} from './db/pokerWallet';

/** A bankroll room = online poker with a server-derived buy-in (economy enabled). */
export function isBankrollRoom(room: ServerRoom): boolean {
  return room.gameType === 'poker' && typeof room.pokerBuyIn === 'number' && room.pokerBuyIn > 0;
}

// --- Per-room lifecycle serialization (FAIL 6) ------------------------------
// One start/debit/rematch/settlement/teardown flow per room at a time. A per-code
// promise chain runs each op after the room's current tail settles; a pending-op counter
// exposes `isRoomBusy` so the SYNCHRONOUS handlers (leave/kick/settings/add-bot) can
// refuse to mutate a bankroll table's composition while a debit/settlement is in flight.
const roomTails = new Map<string, Promise<unknown>>();
const pendingOps = new Map<string, number>();

/** Run `fn` serialized against every other lifecycle op for `code` (a per-room mutex). */
export function withRoomLock<T>(code: string, fn: () => Promise<T>): Promise<T> {
  pendingOps.set(code, (pendingOps.get(code) ?? 0) + 1);
  const prev = roomTails.get(code) ?? Promise.resolve();
  // Decrement in fn's own finally so `isRoomBusy` is correct SYNCHRONOUSLY after the
  // returned promise settles (a separate .then would decrement a microtask too late).
  const run = async (): Promise<T> => {
    try { return await fn(); }
    finally {
      const n = (pendingOps.get(code) ?? 1) - 1;
      if (n <= 0) pendingOps.delete(code); else pendingOps.set(code, n);
    }
  };
  const result = prev.then(run, run); // run regardless of the prior op's outcome
  roomTails.set(code, result.then(() => undefined, () => undefined));
  return result;
}

/** True while a lifecycle op (debit/settlement/rematch) is in flight for `code`. */
export function isRoomBusy(code: string): boolean {
  return (pendingOps.get(code) ?? 0) > 0;
}

/** Drop a deleted room's lock state (bounded memory). */
export function clearRoomLock(code: string): void {
  pendingOps.delete(code);
  roomTails.delete(code);
}

export interface SeatUserPair { seat: number; userId: string; }

/** Seated human players with a resolved userId, in DETERMINISTIC userId order (lock order). */
export function bankrollParticipants(room: ServerRoom): SeatUserPair[] {
  return [...room.members.values()]
    .filter((m) => m.role === 'player' && m.seatIndex != null && m.type !== 'ai' && typeof m.userId === 'string' && m.userId)
    .map((m) => ({ seat: m.seatIndex as number, userId: m.userId as string }))
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

export type SeatValidation =
  | { ok: true; seats: SeatUserPair[] }
  | { ok: false; error: string };

/** Validate a bankroll room's seats: ≥2 humans, all human+userId, no bot, no dup account. */
export function validateBankrollSeats(room: ServerRoom): SeatValidation {
  const players = [...room.members.values()].filter((m) => m.role === 'player' && m.seatIndex != null);
  if (players.some((m) => m.type === 'ai')) return { ok: false, error: 'Bankroll tables are human-only' };
  if (players.some((m) => !m.userId)) return { ok: false, error: 'Every seat must be signed in' };
  const ids = players.map((m) => m.userId as string);
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'One account cannot take two seats' };
  const seats = bankrollParticipants(room);
  if (seats.length < 2) return { ok: false, error: 'Need at least 2 signed-in players' };
  return { ok: true, seats };
}

export type DebitResult = { ok: true } | { ok: false; error: string };

async function db(): Promise<PostgresJsDatabase | null> {
  const conn = await getDb();
  return conn ? (conn.db as PostgresJsDatabase) : null;
}

/** Core atomic debit of `seats` for `matchId`; sets room.pokerEscrow funded on success. */
async function performDebit(room: ServerRoom, matchId: string, buyIn: number, seats: PokerEscrowSeat[]): Promise<DebitResult> {
  room.pokerEscrow = { matchId, buyIn, status: 'pending', seats };
  const d = await db();
  if (!d) { room.pokerEscrow = undefined; return { ok: false, error: 'Economy unavailable' }; }
  try {
    await d.transaction(async (tx) => {
      for (const s of seats) {
        await adjustWalletTx(tx, s.userId, -buyIn, 'table_buy_in', `buyin:${matchId}:${s.userId}`, { matchId, roomCode: room.code });
      }
    });
    room.pokerEscrow.status = 'funded';
    return { ok: true };
  } catch (err) {
    // The DB transaction rolled back atomically → nothing was debited; drop the marker.
    room.pokerEscrow = undefined;
    if (err instanceof InsufficientChipsError) return { ok: false, error: 'Not enough chips for the buy-in' };
    return { ok: false, error: 'Economy error — try again' };
  }
}

/**
 * Debit the buy-in for the INITIAL start of a bankroll match (all-or-nothing).
 * Idempotent: an already-`funded` escrow (duplicate START) is a no-op success; a
 * `settled`/`cancelled` escrow is a STALE previous match and is rejected (a new match
 * must go through `debitRematch`, never reuse an old resolved escrow). Call inside
 * `withRoomLock`.
 */
export async function debitBuyIns(room: ServerRoom): Promise<DebitResult> {
  if (!isBankrollRoom(room) || !isDbEnabled()) return { ok: false, error: 'Economy unavailable' };
  const esc = room.pokerEscrow;
  if (esc?.status === 'funded') return { ok: true };                 // idempotent duplicate START
  if (esc && esc.status !== 'pending') return { ok: false, error: 'This match is already settled' }; // stale settled/cancelled
  const valid = validateBankrollSeats(room);
  if (!valid.ok) return valid;
  const buyIn = room.pokerBuyIn!;
  const matchId = esc?.matchId ?? randomUUID();
  return performDebit(room, matchId, buyIn, valid.seats.map((s) => ({ seat: s.seat, userId: s.userId, amount: buyIn })));
}

/**
 * Debit a FRESH buy-in for a REMATCH (§16 rematch = a brand-new paid match). Requires the
 * previous escrow to be fully RESOLVED (settled/cancelled) first, then mints a NEW matchId
 * and a new escrow. Never reuses the old (settled) escrow as a "successful debit". Call
 * inside `withRoomLock`.
 */
export async function debitRematch(room: ServerRoom): Promise<DebitResult> {
  if (!isBankrollRoom(room) || !isDbEnabled()) return { ok: false, error: 'Economy unavailable' };
  const esc = room.pokerEscrow;
  if (esc && esc.status !== 'settled' && esc.status !== 'cancelled') {
    return { ok: false, error: 'Previous match is still settling — try again in a moment' };
  }
  const valid = validateBankrollSeats(room);
  if (!valid.ok) return valid;
  room.pokerEscrow = undefined;                      // clear the resolved escrow → mint a fresh match
  const buyIn = room.pokerBuyIn!;
  const matchId = randomUUID();
  return performDebit(room, matchId, buyIn, valid.seats.map((s) => ({ seat: s.seat, userId: s.userId, amount: buyIn })));
}

// --- Payout conservation (FAIL 7; pure, unit-testable) ----------------------

export type ConservationCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate that paying every escrow seat its FINAL stack conserves the escrow exactly,
 * before any wallet mutation. Every final stack must be a finite, non-negative safe
 * integer, and Σ(final stacks) must equal Σ(buy-ins). Any mismatch / overflow / bad
 * seat fails CLOSED (no wallet is touched).
 */
export function validatePayoutConservation(esc: PokerEscrow, state: PokerState): ConservationCheck {
  const stacks = state.stacksBySeat;
  if (!Array.isArray(stacks)) return { ok: false, error: 'no stacks' };
  let payoutTotal = 0;
  let escrowTotal = 0;
  const seen = new Set<number>();
  for (const s of esc.seats) {
    if (seen.has(s.seat)) return { ok: false, error: 'duplicate seat' };
    seen.add(s.seat);
    const stack = stacks[s.seat];
    if (typeof stack !== 'number' || !Number.isFinite(stack) || !Number.isSafeInteger(stack) || stack < 0) {
      return { ok: false, error: 'invalid final stack' };
    }
    payoutTotal += stack;
    escrowTotal += s.amount;
    if (payoutTotal > Number.MAX_SAFE_INTEGER || escrowTotal > Number.MAX_SAFE_INTEGER) return { ok: false, error: 'overflow' };
  }
  if (payoutTotal !== escrowTotal) return { ok: false, error: 'payout != escrow' };
  return { ok: true };
}

/**
 * Credit each participant's authoritative FINAL stack at game_finished. Conservation is
 * validated first (fail closed). The DB settlement gate makes this mutually exclusive
 * with a refund: if the match was already refunded, this becomes a no-op that just marks
 * the local escrow cancelled. Idempotent; a rebroadcast/reconnect/restart never double-pays.
 */
export async function payoutStacks(room: ServerRoom, state: PokerState): Promise<void> {
  const esc = room.pokerEscrow;
  if (!esc || esc.status !== 'funded' || !isDbEnabled()) return;
  const conserve = validatePayoutConservation(esc, state);
  if (!conserve.ok) {
    console.error(`[Poker] payout REFUSED for match ${esc.matchId} — ${conserve.error} (escrow left funded)`);
    return; // fail closed: leave funded, no wallet mutation
  }
  esc.status = 'settling'; // in-memory fast-path hint (the DB gate is authoritative)
  try {
    await settleMatchTx(esc.matchId, 'payout', async (tx) => {
      for (const s of esc.seats) {
        const finalStack = state.stacksBySeat[s.seat] ?? 0;
        if (finalStack > 0) {
          await adjustWalletTx(tx, s.userId, finalStack, 'table_payout', `payout:${esc.matchId}:${s.userId}`, { matchId: esc.matchId, roomCode: room.code });
        }
      }
    });
    esc.status = 'settled';
  } catch (err) {
    if (err instanceof SettlementConflictError) { esc.status = 'cancelled'; return; } // already refunded → do not pay
    esc.status = 'funded'; // transient DB error → retryable
  }
}

/**
 * Refund each participant's buy-in when a FUNDED table is orphaned/torn down unfinished.
 * The DB settlement gate makes this mutually exclusive with payout. Returns true when the
 * match is RESOLVED (refunded here, or already paid) so the caller may delete the room;
 * false leaves it retryable (caller KEEPS the room). Idempotent.
 */
export async function refundBuyIns(room: ServerRoom): Promise<boolean> {
  const esc = room.pokerEscrow;
  if (!esc) return true;                                              // nothing escrowed → safe to delete
  if (esc.status === 'settled' || esc.status === 'cancelled') return true; // already resolved
  if (esc.status === 'pending') return false;                        // debit in flight → keep for reconcile
  if (!isDbEnabled()) return false;                                  // economy off but funded → keep for retry
  esc.status = 'settling';
  try {
    await settleMatchTx(esc.matchId, 'cancel_refund', async (tx) => {
      for (const s of esc.seats) {
        await adjustWalletTx(tx, s.userId, s.amount, 'table_cancel_refund', `refund:${esc.matchId}:${s.userId}`, { matchId: esc.matchId, roomCode: room.code });
      }
    });
    esc.status = 'cancelled';
    return true;
  } catch (err) {
    if (err instanceof SettlementConflictError) { esc.status = 'settled'; return true; } // already paid → resolved
    esc.status = 'funded'; // transient DB error → retry on the next sweep
    return false;
  }
}

/** True when a room still holds unsettled escrow (a funded/in-flight bankroll match). */
export function hasUnsettledEscrow(room: ServerRoom): boolean {
  const esc = room.pokerEscrow;
  return !!esc && esc.status !== 'settled' && esc.status !== 'cancelled';
}

/**
 * Crash reconciliation (FAIL 3): reconcile a RESTORED transient escrow against the durable
 * DB state so a pending/settling escrow can never hang forever.
 *   • pending  → all buy-ins committed → funded; none → drop (nothing was charged);
 *                a partial (impossible under the atomic debit) fails closed (left pending).
 *   • settling → a committed settlement row → settled/cancelled; none → back to funded (retry).
 * An invalid/incoherent escrow is left as-is (no wallet mutation). Call inside withRoomLock.
 */
export async function reconcileEscrow(room: ServerRoom): Promise<void> {
  const esc = room.pokerEscrow;
  if (!esc || !isBankrollRoom(room) || !isDbEnabled()) return;
  if (esc.status !== 'pending' && esc.status !== 'settling') return; // funded/settled/cancelled are durable
  let state;
  try { state = await matchLedgerState(esc.matchId); } catch { return; } // transient DB error → retry later
  if (esc.status === 'pending') {
    if (state.buyInCount === esc.seats.length) esc.status = 'funded';   // debit committed
    else if (state.buyInCount === 0) room.pokerEscrow = undefined;      // debit never committed → nothing charged
    // else: partial (should be impossible) → leave pending, fail closed.
    return;
  }
  // settling
  if (state.settlement === 'payout') esc.status = 'settled';
  else if (state.settlement === 'cancel_refund') esc.status = 'cancelled';
  else esc.status = 'funded'; // settlement never committed → retryable
}
