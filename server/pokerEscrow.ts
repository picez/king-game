// ---------------------------------------------------------------------------
// Poker bankroll ESCROW lifecycle (Stage 37.7 §16 F/G). Wires the wallet ledger
// primitive (adjustWalletTx) into the room lifecycle: an atomic all-or-nothing buy-in
// debit at START_GAME, a payout of final stacks at game_finished, and a cancellation
// refund when a funded table is orphaned/torn down before finishing. Every step is
// idempotent via per-(match, user) ledger keys, so a duplicate START, a rebroadcast
// finish, a reconnect, or a server restart can never double-debit/-credit. Payout and
// refund are MUTUALLY EXCLUSIVE (a single `settling` transient guards the race).
//
// DB-gated: with no DATABASE_URL there is no economy and none of this runs (free MVP
// poker + local play are unaffected). A bankroll room is an online poker room that
// carries a server-derived `pokerBuyIn` (set only when Postgres is on + approved stakes).
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ServerRoom, PokerEscrowSeat } from '../src/net/serverCore';
import type { PokerState } from '../src/games/poker/types';
import { getDb, isDbEnabled } from './db/client';
import { adjustWalletTx, InsufficientChipsError } from './db/pokerWallet';

/** A bankroll room = online poker with a server-derived buy-in (economy enabled). */
export function isBankrollRoom(room: ServerRoom): boolean {
  return room.gameType === 'poker' && typeof room.pokerBuyIn === 'number' && room.pokerBuyIn > 0;
}

// Re-entrancy guard: room codes whose debit transaction is in flight (a second
// START_GAME during the await must be a no-op, not a second debit pipeline).
const debitInFlight = new Set<string>();

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

/**
 * Atomically debit the buy-in from every seated human (all-or-nothing) at START_GAME.
 * Mints the match id on first call and records the seat→user→amount map on the room so
 * payout/refund can reproduce the idempotency keys after a restart. Returns ok:false
 * (room NOT started) on insufficient chips / validation failure / DB error, leaving the
 * room intact. Idempotent: a re-run with an already-funded escrow is a no-op.
 */
export async function debitBuyIns(room: ServerRoom): Promise<DebitResult> {
  if (!isBankrollRoom(room) || !isDbEnabled()) return { ok: false, error: 'Economy unavailable' };
  if (room.pokerEscrow && room.pokerEscrow.status !== 'pending') return { ok: true }; // already funded/settled
  if (debitInFlight.has(room.code)) return { ok: false, error: 'Start already in progress' };

  const valid = validateBankrollSeats(room);
  if (!valid.ok) return valid;

  const buyIn = room.pokerBuyIn!;
  const matchId = room.pokerEscrow?.matchId ?? randomUUID();
  const seats: PokerEscrowSeat[] = valid.seats.map((s) => ({ seat: s.seat, userId: s.userId, amount: buyIn }));
  debitInFlight.add(room.code);
  // Mark pending BEFORE the await so a concurrent START sees it (belt with the Set guard).
  room.pokerEscrow = { matchId, buyIn, status: 'pending', seats };
  try {
    const d = await db();
    if (!d) { room.pokerEscrow = undefined; return { ok: false, error: 'Economy unavailable' }; }
    await d.transaction(async (tx) => {
      for (const s of valid.seats) {
        await adjustWalletTx(tx, s.userId, -buyIn, 'table_buy_in', `buyin:${matchId}:${s.userId}`, { matchId, roomCode: room.code });
      }
    });
    room.pokerEscrow.status = 'funded';
    return { ok: true };
  } catch (err) {
    // The DB transaction rolled back atomically; drop the escrow marker so a retry can
    // mint a fresh match (nothing was debited).
    room.pokerEscrow = undefined;
    if (err instanceof InsufficientChipsError) return { ok: false, error: 'Not enough chips for the buy-in' };
    return { ok: false, error: 'Economy error — try again' };
  } finally {
    debitInFlight.delete(room.code);
  }
}

/**
 * Credit each participant's authoritative FINAL stack to their wallet at game_finished.
 * Total paid == escrow (chip conservation). Atomic + idempotent; mutually exclusive with
 * a refund via the `settling` transient. Best-effort: a DB failure leaves the escrow
 * `funded` (retryable) and never reports a false "paid".
 */
export async function payoutStacks(room: ServerRoom, state: PokerState): Promise<void> {
  const esc = room.pokerEscrow;
  if (!esc || esc.status !== 'funded' || !isDbEnabled()) return;
  esc.status = 'settling'; // synchronous claim — a concurrent refund now bails
  try {
    const d = await db();
    if (!d) { esc.status = 'funded'; return; }
    await d.transaction(async (tx) => {
      for (const s of esc.seats) {
        const finalStack = state.stacksBySeat[s.seat] ?? 0;
        if (finalStack > 0) {
          await adjustWalletTx(tx, s.userId, finalStack, 'table_payout', `payout:${esc.matchId}:${s.userId}`, { matchId: esc.matchId, roomCode: room.code });
        }
      }
    });
    esc.status = 'settled';
  } catch {
    esc.status = 'funded'; // retryable
  }
}

/**
 * Refund each participant's buy-in when a FUNDED table is orphaned/torn down before it
 * finished (§16 G). Atomic + idempotent; mutually exclusive with payout. Returns true
 * only when the refund is confirmed settled (so the caller may then delete the room);
 * false leaves the escrow retryable (caller must KEEP the room).
 */
export async function refundBuyIns(room: ServerRoom): Promise<boolean> {
  const esc = room.pokerEscrow;
  if (!esc) return true;                        // nothing escrowed → safe to delete
  if (esc.status === 'settled' || esc.status === 'cancelled') return true; // already resolved
  if (esc.status !== 'funded') return false;    // pending/settling in flight → keep the room
  if (!isDbEnabled()) return false;             // economy off but funded → keep for retry
  esc.status = 'settling';                       // synchronous claim vs payout
  try {
    const d = await db();
    if (!d) { esc.status = 'funded'; return false; }
    await d.transaction(async (tx) => {
      for (const s of esc.seats) {
        await adjustWalletTx(tx, s.userId, s.amount, 'table_cancel_refund', `refund:${esc.matchId}:${s.userId}`, { matchId: esc.matchId, roomCode: room.code });
      }
    });
    esc.status = 'cancelled';
    return true;
  } catch {
    esc.status = 'funded'; // retryable on the next sweep
    return false;
  }
}

/** True when a room still holds unsettled escrow (a funded/in-flight bankroll match). */
export function hasUnsettledEscrow(room: ServerRoom): boolean {
  const esc = room.pokerEscrow;
  return !!esc && esc.status !== 'settled' && esc.status !== 'cancelled';
}
