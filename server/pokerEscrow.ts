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
  adjustWalletTx, settleMatchTx, matchLedgerState, recordMatchTx, listUnsettledMatches,
  InsufficientChipsError, SettlementConflictError, type DurableMatch,
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

export type DebitResult = { ok: true } | { ok: false; error: string; settlementPending?: boolean };

async function db(): Promise<PostgresJsDatabase | null> {
  const conn = await getDb();
  return conn ? (conn.db as PostgresJsDatabase) : null;
}

// Test-only seams (Stage 37.7.6 FAIL 4 / 37.7.7 FAIL 1): deterministically simulate a
// TRANSIENT settlement failure — a refund/payout that returns "not confirmed" and leaves the
// escrow FUNDED — without a broken DB, so the fail-closed retry paths are real, verified
// regressions instead of untested branches.
let injectedRefundFailure = false;
export function __setRefundFailure(v: boolean): void { injectedRefundFailure = v; }
let injectedPayoutFailure = false;
export function __setPayoutFailure(v: boolean): void { injectedPayoutFailure = v; }

/**
 * True when a bankroll room holds a FUNDED escrow but has NO live game — a debit whose
 * game never started and whose refund/settlement is not yet confirmed (§16, 37.7.6). Such a
 * room is SETTLEMENT-PENDING (refund/failed-start pending): it must not be treated as a
 * playable/cancelled table, must reject gameplay/rematch, and its escrow is retried until
 * refunded. Distinct from `payoutPending` (a FINISHED game whose payout is not yet confirmed).
 */
export function settlementPending(room: ServerRoom): boolean {
  // A FROZEN room (corrupt durable / invalid payout — 37.7.8) is a PERMANENT operator condition,
  // never an auto-retryable pending state.
  return !room.pokerFrozen && isBankrollRoom(room) && room.pokerEscrow?.status === 'funded' && !room.gameState;
}

/**
 * True when a bankroll room holds an unresolved escrow (`funded`/`settling`) for a FINISHED
 * poker game whose payout is not yet confirmed (§16, 37.7.7). Distinct from a LIVE match
 * (funded + UNFINISHED game) and from a refund/failed-start pending room (funded + NO game).
 * A payout-pending table must block rematch and be retried with the authoritative final state
 * until the payout settles.
 */
export function payoutPending(room: ServerRoom): boolean {
  // A FROZEN room (37.7.8: an `invalid` payout is a PERMANENT operator condition) must NEVER be
  // treated as an auto-retryable payout — the settlement sweep must skip it (no 45s log spam).
  if (room.pokerFrozen || !isBankrollRoom(room)) return false;
  const esc = room.pokerEscrow;
  if (!esc || (esc.status !== 'funded' && esc.status !== 'settling')) return false;
  const state = room.gameState as PokerState | null;
  return !!state && state.phase === 'game_finished';
}

/** Recovery states that block gameplay/rematch (frozen, settlement-/payout-pending, or no economy). */
export function pokerRecoveryBlocked(room: ServerRoom): boolean {
  return !!room.pokerFrozen || settlementPending(room) || payoutPending(room) || bankrollEconomyUnavailable(room);
}

/** Core atomic debit of `seats` for `matchId`; sets room.pokerEscrow funded on success. */
async function performDebit(room: ServerRoom, matchId: string, buyIn: number, seats: PokerEscrowSeat[]): Promise<DebitResult> {
  room.pokerEscrow = { matchId, buyIn, status: 'pending', seats };
  const d = await db();
  if (!d) { room.pokerEscrow = undefined; return { ok: false, error: 'Economy unavailable' }; }
  try {
    await d.transaction(async (tx) => {
      // (FAIL 1) Durable match record FIRST, in the SAME transaction as the debits, so a
      // crash after this commit can always recover the match (matchId/seats) even if the
      // room JSON never persisted the escrow.
      await recordMatchTx(tx, matchId, room.code, buyIn, seats);
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

/**
 * Debit the buy-in for a START_GAME (Stage 37.7.5, FAIL 1) — handles BOTH the initial start
 * (no escrow) AND a fresh paid start after a recovery/refund (the room carries a TERMINAL
 * escrow: settled or cancelled). A terminal escrow is NEVER reused: a brand-new matchId +
 * escrow is minted and a new atomic debit runs, so the old match's ledger/settlement stay
 * intact. Guarantees preserved:
 *   • a `funded` escrow (a duplicate START of the SAME match) → idempotent ok, no re-debit;
 *   • a `pending`/`settling` escrow (a debit/settlement in flight) → rejected, no double debit;
 *   • a FROZEN room (corrupt durable) → rejected (never bypassed via a fresh start);
 *   • the resolved/absent escrow is cleared ONLY once it is terminal (settlement confirmed).
 * Concurrency is handled by the caller (withRoomLock + a started/gameState guard).
 */
export async function debitFreshStart(room: ServerRoom): Promise<DebitResult> {
  if (!isBankrollRoom(room) || !isDbEnabled()) return { ok: false, error: 'Economy unavailable' };
  if (room.pokerFrozen) return { ok: false, error: 'This table is frozen for review' };
  const esc = room.pokerEscrow;
  if (esc?.status === 'pending' || esc?.status === 'settling') {
    return { ok: false, error: 'A previous action is still in progress — try again in a moment' };
  }
  // (37.7.6 FAIL 1) A FUNDED escrow reaching START is an ORPHAN — the caller only starts from a
  // clean lobby (its started/gameState guard already passed), so a funded escrow here belongs to
  // a prior match whose game never started (a failed start whose refund also failed). It must NOT
  // be reused as a "fresh" match. Resolve it first: refund the orphan. If that fails, fail CLOSED
  // as settlement-pending (never mint a new match while the old one is unresolved).
  if (esc?.status === 'funded') {
    const resolved = await refundBuyIns(room); // funded → attempt refund of the orphan
    if (!resolved) return { ok: false, error: 'Settlement pending — please try again in a moment', settlementPending: true };
    // resolved → escrow is now terminal (cancelled/settled); fall through to mint a fresh match.
  }
  // esc is undefined (initial) OR terminal (settled/cancelled, incl. the just-resolved orphan) →
  // a BRAND-NEW paid match.
  const valid = validateBankrollSeats(room);
  if (!valid.ok) return valid;
  room.pokerEscrow = undefined;                      // clear ONLY a resolved/absent escrow → mint fresh
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
  // (FAIL 5) The escrow itself must be structurally valid — not just the stacks.
  if (!esc || typeof esc.matchId !== 'string' || !esc.matchId) return { ok: false, error: 'bad escrow' };
  if (!Number.isSafeInteger(esc.buyIn) || esc.buyIn <= 0) return { ok: false, error: 'bad buyIn' };
  if (!Array.isArray(esc.seats) || esc.seats.length < 2 || esc.seats.length > 6) return { ok: false, error: 'bad seat count' };
  const playerCount = typeof state.playerCount === 'number' ? state.playerCount : stacks.length;
  const users = new Set<string>();
  let payoutTotal = 0;
  let escrowTotal = 0;
  const seen = new Set<number>();
  for (const s of esc.seats) {
    if (typeof s.userId !== 'string' || !s.userId || users.has(s.userId)) return { ok: false, error: 'bad/duplicate user' };
    users.add(s.userId);
    // (37.7.3) Seat must be a safe integer in range of the actual stacks/player set.
    if (!Number.isSafeInteger(s.seat) || s.seat < 0 || s.seat >= stacks.length || s.seat >= playerCount) return { ok: false, error: 'seat out of range' };
    if (!Number.isSafeInteger(s.amount) || s.amount <= 0 || s.amount !== esc.buyIn) return { ok: false, error: 'bad seat amount' };
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
  // (37.7.3) The escrow seat set must EXACTLY match the state's player seat set — every
  // player seat present, none extra/missing — so no unpaid/extra participant slips through.
  if (seen.size !== playerCount) return { ok: false, error: 'escrow seats != player seats' };
  if (payoutTotal !== escrowTotal) return { ok: false, error: 'payout != escrow' };
  return { ok: true };
}

/**
 * Explicit outcome of a payout attempt (§16, 37.7.7) so callers can drive the finished-table
 * recovery lifecycle instead of guessing from a void:
 *   • paid            — the payout committed this call (escrow → settled);
 *   • already_paid    — the escrow was already settled (idempotent no-op);
 *   • already_refunded— the DB gate says the match was REFUNDED (escrow → cancelled): never
 *                       show/continue it as a paid game (the caller cancels the finished table);
 *   • retry_pending   — a TRANSIENT failure (DB down / injected): escrow left FUNDED, retryable;
 *   • invalid         — conservation/economy check failed CLOSED (no wallet mutation, left funded).
 */
export type PayoutResult = 'paid' | 'already_paid' | 'already_refunded' | 'retry_pending' | 'invalid';

/**
 * Credit each participant's authoritative FINAL stack at game_finished. Conservation is
 * validated first (fail closed). The DB settlement gate makes this mutually exclusive with a
 * refund: if the match was already refunded, this pays nothing and reports `already_refunded`.
 * Idempotent; a rebroadcast/reconnect/restart/retry never double-pays. A transient DB failure
 * leaves the escrow FUNDED so the finished-table settlement sweep can retry it.
 */
export async function payoutStacks(room: ServerRoom, state: PokerState): Promise<PayoutResult> {
  const esc = room.pokerEscrow;
  if (!esc) return 'invalid';                                          // nothing escrowed
  if (esc.status === 'settled') return 'already_paid';                 // idempotent
  if (esc.status === 'cancelled') return 'already_refunded';           // already refunded (mutex)
  if (esc.status !== 'funded') return 'retry_pending';                 // pending/settling in flight → retry
  if (!isDbEnabled()) return 'retry_pending';                          // economy down → retry when DB is back
  const conserve = validatePayoutConservation(esc, state);
  if (!conserve.ok) {
    console.error(`[Poker] payout REFUSED for match ${esc.matchId} — ${conserve.error} (escrow left funded)`);
    return 'invalid'; // fail closed: leave funded, no wallet mutation
  }
  esc.status = 'settling'; // in-memory fast-path hint (the DB gate is authoritative)
  if (injectedPayoutFailure) { esc.status = 'funded'; return 'retry_pending'; } // test seam: transient payout failure
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
    return 'paid';
  } catch (err) {
    if (err instanceof SettlementConflictError) { esc.status = 'cancelled'; return 'already_refunded'; } // already refunded → do not pay
    esc.status = 'funded'; // transient DB error → retryable
    return 'retry_pending';
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
  if (injectedRefundFailure) { esc.status = 'funded'; return false; } // test seam: transient refund failure
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

/**
 * True when the room's CURRENT seated players exactly match the funded escrow's seat/user
 * composition (Stage 37.7.3, FAIL 1). Checked right before startGame so a seat that slipped
 * in after the escrow was formed (or one that left) can never start a game whose state seats
 * diverge from the funded/paid seats.
 */
export function escrowMatchesRoomSeats(room: ServerRoom): boolean {
  const esc = room.pokerEscrow;
  if (!esc) return false;
  const current = bankrollParticipants(room);
  if (current.length !== esc.seats.length) return false;
  const curKey = current.map((p) => `${p.seat}:${p.userId}`).sort().join('|');
  const escKey = esc.seats.map((s) => `${s.seat}:${s.userId}`).sort().join('|');
  return curKey === escKey;
}

/** True when a room still holds unsettled escrow — a funded/in-flight match OR a corrupt
 *  persisted escrow (§16, 37.7.2 FAIL 5): both block deletion until the DB says nothing is owed. */
export function hasUnsettledEscrow(room: ServerRoom): boolean {
  if (room.pokerEscrowCorrupt || room.pokerFrozen) return true; // corrupt/frozen → keep for operator
  const esc = room.pokerEscrow;
  return !!esc && esc.status !== 'settled' && esc.status !== 'cancelled';
}

/**
 * True when a bankroll room has unsettled escrow but the chip ECONOMY is unavailable
 * (Stage 37.7.4, FAIL 2). A persisted `funded` escrow means chips may really have been
 * debited in Postgres, so with no DB access the process must NOT continue the hand, run
 * timers/bots, accept actions, start/rematch, or pay/refund — it fails CLOSED (frozen in
 * effect) and keeps the room + escrow intact for a later DB-backed restart to reconcile.
 */
export function bankrollEconomyUnavailable(room: ServerRoom): boolean {
  return isBankrollRoom(room) && !isDbEnabled() && hasUnsettledEscrow(room);
}

/**
 * Reconcile a room whose PERSISTED escrow was malformed (FAIL 5): refund every unsettled
 * durable match for this room code from the DB (idempotent), then clear the corrupt flag so
 * the room can finally be swept. Returns false (keep the room) on any DB failure or a
 * malformed durable match — never loses chips. A room with no DB match resolves immediately.
 */
export async function reconcileCorruptRoom(room: ServerRoom): Promise<boolean> {
  if (!room.pokerEscrowCorrupt) return true;
  if (!isDbEnabled()) return false; // funded-but-corrupt, no economy → keep for retry
  let matches: { valid: DurableMatch[]; corrupt: { matchId: string; roomCode: string; reason: string }[] };
  try { matches = await listUnsettledMatches(); } catch { return false; }
  // A CORRUPT durable record for this room can't be safely refunded → freeze for operator.
  if (matches.corrupt.some((c) => c.roomCode === room.code)) {
    console.error(`[Poker] room ${room.code} has a CORRUPT durable match record — frozen for operator review (no partial settlement)`);
    return false; // fail closed
  }
  for (const m of matches.valid.filter((mm) => mm.roomCode === room.code)) {
    if (!(await refundDurableMatch(m))) return false;
  }
  room.pokerEscrowCorrupt = false; // every match for this room is resolved
  return true;
}

/** Refund a durable match's buy-ins straight from the DB record (no room JSON needed). */
async function refundDurableMatch(match: DurableMatch): Promise<boolean> {
  if (!isDbEnabled()) return false;
  try {
    await settleMatchTx(match.matchId, 'cancel_refund', async (tx) => {
      for (const s of match.seats) {
        await adjustWalletTx(tx, s.userId, s.amount, 'table_cancel_refund', `refund:${match.matchId}:${s.userId}`, { matchId: match.matchId, roomCode: match.roomCode });
      }
    });
    return true;
  } catch (err) {
    if (err instanceof SettlementConflictError) return true; // already paid → resolved
    return false;
  }
}

/**
 * Startup crash-recovery (FAIL 1), DB-authoritative and INDEPENDENT of room JSON. Scans all
 * committed-but-unresolved matches (a durable poker_matches row with no settlement row) and,
 * for any NOT owned by an `activeMatchIds` live started room, performs one atomic idempotent
 * refund from the durable seat data. This catches a match whose room JSON never recorded the
 * escrow (crashed between the debit commit and room persistence). Idempotent: a repeat boot
 * refunds nothing new (the settlement gate + ledger keys no-op). Malformed durable seats fail
 * closed (skipped + alerted for operator review) rather than silently losing chips.
 */
export async function reconcileOrphanedDebits(activeMatchIds: Set<string>): Promise<{ refunded: string[]; corrupt: string[] }> {
  if (!isDbEnabled()) return { refunded: [], corrupt: [] };
  let matches: { valid: DurableMatch[]; corrupt: { matchId: string; roomCode: string; reason: string }[] };
  try { matches = await listUnsettledMatches(); } catch { return { refunded: [], corrupt: [] }; }
  const refunded: string[] = [];
  // CORRUPT durable records are NEVER settled/refunded (all-or-nothing, FAIL 3) — left
  // unresolved with an operator alert. A partial refund could leave a debited user short.
  for (const c of matches.corrupt) {
    console.error(`[Poker] orphaned match ${c.matchId} (room ${c.roomCode}) is CORRUPT (${c.reason}) — LEFT UNRESOLVED for operator review`);
  }
  for (const m of matches.valid) {
    if (activeMatchIds.has(m.matchId)) continue; // an active started room owns this → keep funded
    if (await refundDurableMatch(m)) {
      refunded.push(m.matchId);
      console.log(`[Poker] crash-recovery refund for orphaned match ${m.matchId} (room ${m.roomCode})`);
    }
  }
  return { refunded, corrupt: matches.corrupt.map((c) => c.matchId) };
}

/** True when a room has a CORRUPT durable match record (unsafe to settle — operator review). */
export async function roomHasCorruptDurableMatch(roomCode: string): Promise<boolean> {
  if (!isDbEnabled()) return false;
  try {
    const { corrupt } = await listUnsettledMatches();
    return corrupt.some((c) => c.roomCode === roomCode);
  } catch { return false; }
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
