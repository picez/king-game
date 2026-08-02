// ---------------------------------------------------------------------------
// Poker bankroll ESCROW lifecycle (Stage 37.7 §16 F/G; hardened 37.7.1). Wires the
// wallet ledger + the DB settlement gate into the room lifecycle:
//   • an atomic all-or-nothing buy-in debit at START_GAME / REMATCH,
//   • a payout of final stacks at game_finished,
//   • a cancellation refund when a funded table is orphaned/torn down unfinished.
//
// Every step is IDEMPOTENT via per-(match,user) ledger keys, and payout ↔ refund are
// MUTUALLY EXCLUSIVE via a DB-authoritative per-match settlement row (settleMatchWithOwnershipTx) —
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
import { validateFinishedPaidMatch } from './pokerParticipants';
import { gameBoundToEscrow, escrowGameBinding } from './pokerBinding';
import {
  adjustWalletTx, settleMatchWithOwnershipTx, matchDurableEvidence, recordMatchTx,
  listUnsettledMatches, buyInIdempotencyKey, InsufficientChipsError, SettlementConflictError,
  DurableOwnershipError, type DurableMatch,
} from './db/pokerWallet';
import { validateDurableOwnership } from './pokerDurableOwnership';

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

// --- Global economy barrier (37.7.19 FAIL 3) ---------------------------------
// The global orphan scan builds its protection set from the CURRENT rooms and then reads
// `poker_matches`. Without a barrier a concurrent START could commit a brand-new durable match in
// that window: the scan would see an unprotected unsettled row and refund a LIVE table's buy-ins
// while the room object stayed funded+live. Every DURABLE DEBIT and every GLOBAL SCAN therefore
// runs through this FIFO barrier, and the scan REBUILDS its protection INSIDE it.
//
// LOCK ORDER (never inverted): `withRoomLock(code)` then `withEconomyBarrier`. A debit already holds
// its room lock and then takes the barrier; a scan takes ONLY the barrier and never acquires a room
// lock while holding it, so the two can never deadlock.
//
// SINGLE PROCESS: this is an in-process mutex, correct for the deployed topology (ONE authoritative
// Node instance). It is NOT cluster-wide; horizontal multi-instance would need a DB-authoritative
// lease instead.
let economyBarrier: Promise<unknown> = Promise.resolve();

/** Run `fn` serialized against every other durable debit and global settlement scan. */
export function withEconomyBarrier<T>(fn: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> => fn();
  const result = economyBarrier.then(run, run);
  economyBarrier = result.then(() => undefined, () => undefined);
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

export type DebitResult = { ok: true } | { ok: false; error: string; settlementPending?: boolean; paidConflict?: boolean };

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
// (37.7.13 FAIL 2) Simulate a TRANSIENT reconciliation read failure — the durable outcome of a
// restored `pending`/`settling` escrow cannot be read, so it must stay UNRESOLVED (never guessed).
let injectedReconcileFailure = false;
export function __setReconcileFailure(v: boolean): void { injectedReconcileFailure = v; }

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
  // (37.7.14 FAIL 1) FUNDED only. A `settling` escrow is UNRESOLVED — its durable outcome may already
  // be a committed payout or refund — so it must be RECONCILED first (`escrowUnresolved` has
  // precedence in the sweep); `payoutStacks` would only answer `retry_pending` for it anyway.
  if (!esc || esc.status !== 'funded') return false;
  // (37.7.12 FAIL 1) The finished state must belong to THIS escrow generation. A fresh rematch debit
  // sitting next to the PREVIOUS match's finished state is NOT a payout-pending match — paying it
  // would hand the new buy-ins out on a hand that was never dealt. It is an unbound debit instead.
  if (!gameBoundToEscrow(room)) return false;
  const state = room.gameState as PokerState | null;
  return !!state && state.phase === 'game_finished';
}

/**
 * (37.7.12 FAIL 1) True when a bankroll room holds a LIVE (pending/funded/settling) escrow whose
 * match did NOT produce the room's current game state — the crashed-rematch shape: a fresh buy-in
 * was debited, the process died before `restartGame`, and the persisted room still carries the
 * previous match's state. Such a match never started: it must be REFUNDED (never paid, never
 * recorded), and its stale state dropped. Distinct from a live match, a payout-pending finish, and
 * a refund-pending room (funded + NO game). A `unknown` binding (a legacy save with no marker) is
 * NOT included here — it cannot be proven either way and is frozen for review instead.
 */
export function unboundEscrowGame(room: ServerRoom): boolean {
  if (room.pokerFrozen || !isBankrollRoom(room)) return false;
  const esc = room.pokerEscrow;
  // (37.7.14 FAIL 1) FUNDED only. A `pending`/`settling` escrow is UNRESOLVED: refunding it is
  // impossible (`refundBuyIns` refuses a pending debit) and `resolveUnboundEscrowGame` would DROP the
  // game state + binding first — destroying the only evidence of which match produced it, before the
  // durable outcome had been proven (and, for `settling`, possibly after a payout already committed).
  // Reconciliation has precedence: only a PROVEN funded escrow can be an unplayed stale generation.
  if (!esc || esc.status !== 'funded') return false;
  return escrowGameBinding(room) === 'unbound';
}

/**
 * (37.7.13 FAIL 2) True when a bankroll room carries a TRANSIENT escrow (`pending`/`settling`)
 * whose durable outcome is NOT yet known — reconciliation has not run, failed transiently, or found
 * a partial/corrupt debit. "Pending" is NOT proof that nothing was charged: such a room must never
 * advance, accept actions, start a timer, rematch, settle or be purged; it stays inert (with its
 * state + escrow evidence intact) until a later reconciliation proves the outcome.
 */
export function escrowUnresolved(room: ServerRoom): boolean {
  if (room.pokerFrozen || !isBankrollRoom(room)) return false;
  const st = room.pokerEscrow?.status;
  return st === 'pending' || st === 'settling';
}

/**
 * (37.7.17 FAIL 2) True when a bankroll room CLAIMS an economy match — a carried game state, a
 * generation binding, or owed stats — while holding NO escrow at all. The missing escrow proves
 * nothing (the match may be unsettled, paid, or unprovable), so such a table must not advance, act,
 * rematch or be purged until recovery resolves the claim durably. A clean lobby has none of these.
 */
export function escrowlessClaim(room: ServerRoom): boolean {
  if (room.pokerFrozen || !isBankrollRoom(room) || room.pokerEscrow) return false;
  return !!room.gameState || !!room.pokerGameMatchId || !!room.pokerStatsPending;
}

/**
 * True when a bankroll match was PAID (money is out, escrow settled) but its stats write is still
 * owed (§16, 37.7.9 FAIL 2). Persisted + restart-surviving. It must BLOCK a new paid rematch (a
 * fresh match would overwrite the finished state whose stats are unresolved) but must NEVER re-run
 * the payout — the sweep retries only the STATS write. Distinct from `payoutPending` (money not yet
 * out) and never treated as frozen (frozen is a permanent operator condition).
 */
export function statsPending(room: ServerRoom): boolean {
  return !room.pokerFrozen && isBankrollRoom(room) && !!room.pokerStatsPending;
}

/** Recovery states that block a new paid rematch (frozen, settlement-/payout-/stats-pending, an
 *  unbound fresh debit awaiting its refund, an UNRESOLVED transient escrow, or no economy). */
export function pokerRecoveryBlocked(room: ServerRoom): boolean {
  return !!room.pokerFrozen || settlementPending(room) || payoutPending(room) || statsPending(room)
    || unboundEscrowGame(room) || escrowUnresolved(room) || escrowlessClaim(room)
    || bankrollEconomyUnavailable(room);
}

/** Core atomic debit of `seats` for `matchId`; sets room.pokerEscrow funded on success. */
async function performDebit(room: ServerRoom, matchId: string, buyIn: number, seats: PokerEscrowSeat[]): Promise<DebitResult> {
  // (37.7.20 FAIL 1) The fresh-debit transition is REVERSIBLE. The callers used to clear the previous
  // TERMINAL escrow before calling in, so a rolled-back debit (insufficient chips, transient DB
  // error) left the room with NO escrow beside the old finished state + binding — an escrowless
  // claim that recovery could freeze, turning "someone is short of chips" into a permanent operator
  // condition. The previous escrow is snapshotted (a DEEP copy, so the stored value can never be
  // mutated by the in-flight one) and restored verbatim whenever the transaction does not commit.
  const previous: PokerEscrow | undefined = room.pokerEscrow
    ? { ...room.pokerEscrow, seats: room.pokerEscrow.seats.map((s) => ({ ...s })) }
    : undefined;
  const rollback = (): void => { room.pokerEscrow = previous; };
  // The PENDING marker is set BEFORE the barrier so a scan that rebuilds protection inside the
  // barrier already sees (and protects) this in-flight match (37.7.19 FAIL 3).
  room.pokerEscrow = { matchId, buyIn, status: 'pending', seats };
  const d = await db();
  if (!d) { rollback(); return { ok: false, error: 'Economy unavailable' }; }
  try {
    await withEconomyBarrier(() => d.transaction(async (tx) => {
      // (FAIL 1) Durable match record FIRST, in the SAME transaction as the debits, so a
      // crash after this commit can always recover the match (matchId/seats) even if the
      // room JSON never persisted the escrow.
      await recordMatchTx(tx, matchId, room.code, buyIn, seats);
      for (const s of seats) {
        await adjustWalletTx(tx, s.userId, -buyIn, 'table_buy_in', buyInIdempotencyKey(matchId, s.userId), { matchId, roomCode: room.code });
      }
    }));
    room.pokerEscrow.status = 'funded';
    return { ok: true };
  } catch (err) {
    // The DB transaction rolled back atomically → nothing was debited. Restore EXACTLY what the room
    // held before, so a refused rematch leaves the finished paid table untouched and retryable.
    rollback();
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
/**
 * (37.7.19 FAIL 2) Re-prove a TERMINAL escrow before its generation is replaced by a new debit.
 * A terminal status in room JSON is a CLAIM (37.7.16); bootstrap/teardown verify it, but the runtime
 * START/rematch transitions trusted it and cleared the escrow — so an unconfirmed/contradicted or
 * structurally broken terminal claim could be overwritten by a fresh paid match.
 */
async function proveTerminalBeforeReuse(room: ServerRoom, expected: 'settled' | 'cancelled'): Promise<DebitResult | null> {
  const evidence = await resolveEscrowEvidence(room);
  if (evidence === 'retry_pending') {
    return { ok: false, error: 'Settlement is still being confirmed — try again in a moment', settlementPending: true };
  }
  if (evidence !== expected) {
    // terminal_unconfirmed / terminal_conflict / missing / corrupt / mismatch -> operator condition.
    return { ok: false, error: 'This table is frozen for review', paidConflict: true };
  }
  if (expected === 'settled') {
    // A PAID previous match may only be reused once its lifecycle is COMPLETE: no owed stats, and a
    // FINISHED state still BOUND to it. (37.7.20 FAIL 3) A settled escrow with NO state at all is the
    // INCOHERENT PAID shape of 37.7.11 — the money is out and the final state is gone — never a
    // reusable lobby; the old check only looked at a state that was present.
    if (room.pokerStatsPending) return { ok: false, error: 'This table is frozen for review', paidConflict: true };
    if (!room.gameState || !gameBoundToEscrow(room)) return { ok: false, error: 'This table is frozen for review', paidConflict: true };
  }
  return null;
}

export async function debitRematch(room: ServerRoom): Promise<DebitResult> {
  if (!isBankrollRoom(room) || !isDbEnabled()) return { ok: false, error: 'Economy unavailable' };
  // (37.7.19 FAIL 1) A FROZEN table is a permanent operator condition — it may never mint a new paid
  // match (`debitFreshStart` already refused; the rematch path did not).
  if (room.pokerFrozen) return { ok: false, error: 'This table is frozen for review' };
  const esc = room.pokerEscrow;
  if (esc && esc.status !== 'settled' && esc.status !== 'cancelled') {
    return { ok: false, error: 'Previous match is still settling — try again in a moment' };
  }
  if (esc) {
    const blocked = await proveTerminalBeforeReuse(room, esc.status as 'settled' | 'cancelled');
    if (blocked) return blocked;
  }
  const valid = validateBankrollSeats(room);
  if (!valid.ok) return valid;
  // (37.7.20 FAIL 1) The PROVEN-resolved escrow is replaced by `performDebit`, which restores it on
  // rollback — it is never cleared up-front any more.
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
    // (37.7.18 FAIL 1) ONLY a CONFIRMED refund frees the table for a new paid match. `already_paid`
    // means the orphan's chips went OUT — an incoherent paid match with no game, which must never
    // silently become a fresh start.
    const res = await refundBuyInsResult(room); // funded → attempt refund of the orphan
    // (37.7.19 FAIL 1) A paid/structurally-broken orphan is a PERMANENT condition, not a retry.
    if (res === 'already_paid' || res === 'invalid') return { ok: false, error: 'This table is frozen for review', paidConflict: true };
    if (res !== 'confirmed_refund') return { ok: false, error: 'Settlement pending — please try again in a moment', settlementPending: true };
    // resolved → escrow is now terminal (cancelled/settled); fall through to mint a fresh match.
  }
  // esc is undefined (initial) OR terminal (cancelled, incl. the just-resolved orphan) → a
  // BRAND-NEW paid match, but ONLY after the terminal claim is re-proved (37.7.19 FAIL 2).
  const terminal = room.pokerEscrow;
  if (terminal) {
    // (37.7.20 FAIL 3) A fresh START never reuses a PAID escrow: a settled match belongs to the
    // paid-finish / incoherent-paid lifecycle, not to a clean lobby. Only an exact durable
    // `cancel_refund` frees the table for a new buy-in.
    if (terminal.status === 'settled') return { ok: false, error: 'This table is frozen for review', paidConflict: true };
    const blocked = await proveTerminalBeforeReuse(room, 'cancelled');
    if (blocked) return blocked;
  }
  const valid = validateBankrollSeats(room);
  if (!valid.ok) return valid;
  // (37.7.20 FAIL 1) Replaced by `performDebit` (restored verbatim if the transaction rolls back).
  const buyIn = room.pokerBuyIn!;
  const matchId = randomUUID();
  return performDebit(room, matchId, buyIn, valid.seats.map((s) => ({ seat: s.seat, userId: s.userId, amount: buyIn })));
}

// --- Payout conservation (FAIL 7; pure, unit-testable) ----------------------

export type ConservationCheck = { ok: true } | { ok: false; error: string };

/**
 * Validate that paying every escrow seat its FINAL stack conserves the escrow exactly, before any
 * wallet mutation. Delegates to the ONE SHARED strict validator (37.7.11 FAIL 2, strengthened in
 * 37.7.12 FAIL 2): canonical matchId/seat/user/buy-in metadata, exact correspondence with the
 * state's player seats, explicitly human seats with unique ids, `phase === 'game_finished'`, and
 * the finished-match invariant that ONE winner holds the whole conserved escrow while every other
 * seat holds exactly 0. Any mismatch fails CLOSED (no wallet is touched).
 */
export function validatePayoutConservation(esc: PokerEscrow, state: PokerState): ConservationCheck {
  const check = validateFinishedPaidMatch(esc, state);
  return check.ok ? { ok: true } : { ok: false, error: check.error };
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
  if (esc.status === 'settled') {
    // (37.7.11 FAIL 2) An already-PAID escrow used to short-circuit to `already_paid` WITHOUT any
    // structural check — so a restored/malformed settled escrow reached the stats recorder and could
    // write a partial attribution. `already_paid` is the caller's green light to record stats, so it
    // must satisfy the SAME strict participant validation as a fresh payout. A structurally
    // incoherent paid match fails CLOSED as `invalid` (permanent freeze, never stats, never re-paid).
    const conserve = validatePayoutConservation(esc, state);
    if (!conserve.ok) {
      // (37.7.15 FAIL 3) Room code + a bounded reason ONLY — never a matchId/userId/seats/balances.
      console.error(`[Poker] room ${room.code}: settled match FAILED validation — ${conserve.error} (no stats, frozen for review)`);
      return 'invalid';
    }
    // (37.7.16 FAIL 3) `already_paid` is the caller's green light to RECORD STATS, so a replayed
    // payout must ALSO prove EXACT durable ownership — the money moving proves nothing about WHOSE
    // match it was. A transient read failure is retried; a structural failure freezes (never stats).
    const proof = await proveOwnership(room);
    if (proof === 'retry') return 'retry_pending';
    if (proof === 'invalid') {
      console.error(`[Poker] room ${room.code}: settled match has UNPROVEN durable ownership (no stats, frozen for review)`);
      return 'invalid';
    }
    return 'already_paid';                                             // idempotent
  }
  if (esc.status === 'cancelled') return 'already_refunded';           // already refunded (mutex)
  if (esc.status !== 'funded') return 'retry_pending';                 // pending/settling in flight → retry
  if (!isDbEnabled()) return 'retry_pending';                          // economy down → retry when DB is back
  const conserve = validatePayoutConservation(esc, state);
  if (!conserve.ok) {
    console.error(`[Poker] room ${room.code}: payout REFUSED — ${conserve.error} (escrow left funded)`);
    return 'invalid'; // fail closed: leave funded, no wallet mutation
  }
  esc.status = 'settling'; // in-memory fast-path hint (the DB gate is authoritative)
  if (injectedPayoutFailure) { esc.status = 'funded'; return 'retry_pending'; } // test seam: transient payout failure
  try {
    // (37.7.16 FAIL 3) The ownership proof happens INSIDE the settlement transaction (a preflight
    // SELECT would be TOCTOU): the durable row is locked, the buy-in ledger is read from the SAME
    // snapshot, and the settlement row is only claimed once the evidence is EXACT.
    await settleMatchWithOwnershipTx(room.code, esc, 'payout', async (tx) => {
      for (const s of esc.seats) {
        const finalStack = state.stacksBySeat[s.seat] ?? 0;
        if (finalStack > 0) {
          await adjustWalletTx(tx, s.userId, finalStack, 'table_payout', `payout:${esc.matchId}:${s.userId}`, { matchId: esc.matchId, roomCode: room.code });
        }
      }
    }, validateDurableOwnership);
    esc.status = 'settled';
    return 'paid';
  } catch (err) {
    if (err instanceof SettlementConflictError) { esc.status = 'cancelled'; return 'already_refunded'; } // already refunded → do not pay
    if (err instanceof DurableOwnershipError) {
      esc.status = 'funded'; // NOTHING was written (the transaction rolled back) — permanent condition
      console.error(`[Poker] room ${room.code}: payout REFUSED — durable ownership unproven (${err.structure})`);
      return 'invalid';
    }
    esc.status = 'funded'; // transient DB error → retryable
    return 'retry_pending';
  }
}

/**
 * Refund each participant's buy-in when a FUNDED table is orphaned/torn down unfinished.
 * The DB settlement gate makes this mutually exclusive with payout, and the ownership proof runs
 * INSIDE that same transaction (37.7.16 FAIL 3). Idempotent.
 *
 * (37.7.18 FAIL 1) The outcome names the DURABLE FINANCIAL RESULT — never a vague "resolved".
 * Stage 37.7.17 collapsed "refunded" and "the payout won the race" into one `resolved`, so a
 * SettlementConflictError (durable outcome = payout) was reported as a successful refund: the match
 * entered the scan's `refunded` list and callers cancelled the table / wiped its state as if the
 * chips had come back.
 *   • confirmed_refund   — the durable outcome IS `cancel_refund` (fresh or an idempotent repeat);
 *   • already_paid       — the durable outcome is `payout`. NEVER a refund: never cancel, never wipe
 *                          state/binding, never purge as cancelled, never start a new paid match;
 *   • nothing_to_refund  — the room holds no escrow at all;
 *   • retry_pending      — TRANSIENT (debit in flight / DB down / injected) → keep, retry;
 *   • invalid            — the durable evidence does NOT prove this match: nothing was written and
 *                          nothing ever will be. A PERMANENT operator condition → freeze.
 */
export type RefundResult = 'confirmed_refund' | 'already_paid' | 'nothing_to_refund' | 'retry_pending' | 'invalid';
export async function refundBuyInsResult(room: ServerRoom): Promise<RefundResult> {
  const esc = room.pokerEscrow;
  if (!esc) return 'nothing_to_refund';                                   // no escrow → nothing owed
  if (esc.status === 'settled' || esc.status === 'cancelled') {
    // (37.7.17 FAIL 3) A TERMINAL escrow status is a room-JSON CLAIM, never durable proof. This fast
    // path used to answer `resolved` outright, so a teardown could purge a table whose settlement the
    // DB never recorded (or recorded with the OPPOSITE outcome, or whose ownership no longer holds).
    // It now goes through the SHARED evidence resolver — the same one bootstrap uses.
    const evidence = await resolveEscrowEvidence(room);
    if (evidence === 'retry_pending') return 'retry_pending';
    if (isCorruptEvidence(evidence)) return 'invalid';
    // (37.7.18 FAIL 1) Report WHICH terminal outcome the DB actually holds.
    return evidence === 'settled' ? 'already_paid' : 'confirmed_refund';
  }
  if (esc.status === 'pending') return 'retry_pending';                   // debit in flight → keep for reconcile
  if (!isDbEnabled()) return 'retry_pending';                             // economy off but funded → keep for retry
  if (injectedRefundFailure) { esc.status = 'funded'; return 'retry_pending'; } // test seam: transient failure
  esc.status = 'settling';
  try {
    // (37.7.16 FAIL 3) Same atomic ownership proof as the payout: a match whose durable record or
    // buy-in ledger was destroyed/altered after the start can never credit unproven accounts.
    await settleMatchWithOwnershipTx(room.code, esc, 'cancel_refund', async (tx) => {
      for (const s of esc.seats) {
        await adjustWalletTx(tx, s.userId, s.amount, 'table_cancel_refund', `refund:${esc.matchId}:${s.userId}`, { matchId: esc.matchId, roomCode: room.code });
      }
    }, validateDurableOwnership);
    esc.status = 'cancelled';
    return 'confirmed_refund';
  } catch (err) {
    // (37.7.18 FAIL 1) The payout WON the settlement gate — the money went out, it did NOT come back.
    if (err instanceof SettlementConflictError) { esc.status = 'settled'; return 'already_paid'; }
    if (err instanceof DurableOwnershipError) {
      esc.status = 'funded'; // NOTHING was written — permanent operator condition, never retried
      console.error(`[Poker] room ${room.code}: refund REFUSED — durable ownership unproven (${err.structure})`);
      return 'invalid';
    }
    esc.status = 'funded'; // transient DB error → retry on the next sweep
    return 'retry_pending';
  }
}

/**
 * (37.7.19 FAIL 1) The ONE policy every lifecycle caller applies to a `RefundResult`. Stage 37.7.18
 * introduced the precise outcomes but several callers still collapsed them back into a boolean
 * (a `=== confirmed_refund` test with ONE else branch), so `already_paid` and `invalid` were
 * answered as a transient "settlement pending" — while `refundBuyInsResult` had ALREADY moved the
 * escrow to `settled`. The room then matched no pending predicate, unblocked, and a later START
 * could debit a brand-new buy-in over a paid conflict.
 *
 *   - confirmed_refund  -> `cancelled` (the ONLY disposition that may set `pokerMatchCancelled`);
 *   - nothing_to_refund -> `cancelled`, but ONLY where no escrow was expected; a path that just
 *                          created one treats it as a structural failure;
 *   - retry_pending     -> `settlement_pending` (escrow kept, evidence kept, retried);
 *   - already_paid /
 *     invalid           -> `frozen` — a PERMANENT operator condition: timers cleared, never
 *                          cancelled, never purged, never a new debit/rematch.
 */
export type RefundDisposition = 'cancelled' | 'settlement_pending' | 'frozen';

export interface RefundApplyDeps {
  freeze: (room: ServerRoom, reason: string) => void;
  persist: (room: ServerRoom) => void;
  clearTimers?: (room: ServerRoom) => void;
}

export function applyRefundOutcome(
  room: ServerRoom, result: RefundResult, deps: RefundApplyDeps, opts: { escrowExpected?: boolean } = {},
): RefundDisposition {
  if (result === 'confirmed_refund' || (result === 'nothing_to_refund' && !opts.escrowExpected)) {
    room.pokerMatchCancelled = true;
    deps.persist(room);
    return 'cancelled';
  }
  if (result === 'retry_pending') { deps.persist(room); return 'settlement_pending'; }
  deps.clearTimers?.(room);
  deps.freeze(room, result === 'already_paid' ? 'paid match cannot be refunded' : 'durable match evidence does not match this table');
  deps.persist(room);
  return 'frozen';
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
  // (37.7.18 FAIL 2) A ROOM CODE IS NOT OWNERSHIP PROOF. Codes are 4 chars and are reused once a
  // room is gone, while an unresolved durable match outlives it — and a MALFORMED persisted escrow
  // carries no trustworthy matchId to compare against. This path used to refund every unsettled
  // match sharing the code, so a corrupt room could settle a DIFFERENT generation's healthy match.
  // If ANY unsettled durable match names this code, the room is frozen for operator review and the
  // records, settlements and wallets are all left untouched.
  const owned = [...matches.valid, ...matches.corrupt].filter((m) => m.roomCode === room.code);
  if (owned.length > 0) {
    console.error(`[Poker] room ${room.code} has a corrupt persisted escrow and ${owned.length} unsettled durable match(es) — frozen for operator review (a room code is not ownership proof)`);
    return false; // fail closed — NEVER auto-settle by room code
  }
  room.pokerEscrowCorrupt = false; // nothing durable references this code → nothing is owed
  return true;
}

/**
 * (37.7.17 FAIL 1) Refund a durable match's buy-ins straight from the DB record — through the SAME
 * atomic ownership guard the room paths use.
 *
 * This path used to call the unguarded `settleMatchTx`, trusting a `poker_matches` row merely because
 * it PARSED. A parse-valid row whose `table_buy_in` ledger was missing/partial/for the wrong account
 * therefore credited EVERY durable seat and closed the match with a `cancel_refund` settlement —
 * MINTING chips for a user who was never debited. The row is now only the EXPECTED metadata: the
 * guard re-locks it, reads the ledger from the same snapshot, and refuses unless the evidence is
 * exact.
 */
async function refundDurableMatch(match: DurableMatch): Promise<RefundResult> {
  if (!isDbEnabled()) return 'retry_pending';
  try {
    await settleMatchWithOwnershipTx(match.roomCode, match, 'cancel_refund', async (tx) => {
      for (const s of match.seats) {
        await adjustWalletTx(tx, s.userId, s.amount, 'table_cancel_refund', `refund:${match.matchId}:${s.userId}`, { matchId: match.matchId, roomCode: match.roomCode });
      }
    }, validateDurableOwnership);
    return 'confirmed_refund';
  } catch (err) {
    // (37.7.18 FAIL 1) A payout that won the race is NOT a refund — it must never enter `refunded`.
    if (err instanceof SettlementConflictError) return 'already_paid';
    if (err instanceof DurableOwnershipError) return 'invalid';    // PERMANENT: operator-owned
    return 'retry_pending';                                        // transient → the next scan retries
  }
}

const EMPTY_SCAN = (): OrphanScanResult => ({ refunded: [], alreadyPaid: [], corrupt: [], corruptRefs: [], retryable: [] });

/** An INTERNAL-ONLY reference to a corrupt durable match (37.7.15 FAIL 1). Never logged, never sent
 *  to a client — the orchestration needs the matchId to associate it with the CURRENT room exactly. */
export interface CorruptMatchRef { matchId: string; roomCode: string; reasonCode: string }

/** The result of the DB-authoritative orphan/durable scan (37.7.14 FAIL 3 added the room association). */
export interface OrphanScanResult {
  /** Match ids this scan refunded (idempotent; a repeat boot refunds nothing new). */
  refunded: string[];
  /** Match ids whose durable record is MALFORMED, or whose ledger does not back it — never settled. */
  corrupt: string[];
  /** (37.7.17) Match ids this scan could NOT resolve TRANSIENTLY — nothing was proven about them. */
  retryable: string[];
  /** (37.7.18) Match ids whose durable outcome turned out to be a PAYOUT — never a refund. */
  alreadyPaid: string[];
  /**
   * (37.7.15 FAIL 1) Structured internal refs for those corrupt records. A 4-char room code is
   * REUSED (`makeRoomCode` only checks the live in-memory rooms) while an unresolved corrupt
   * `poker_matches` row can outlive its room indefinitely, so associating corruption by roomCode
   * alone permanently froze a brand-new, perfectly healthy table that happened to reuse the code.
   * The caller matches on `matchId` instead; `roomCode` is audit context only.
   */
  corruptRefs: CorruptMatchRef[];
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
export async function reconcileOrphanedDebits(
  activeMatchIds: Set<string>,
  protectedRoomCodes: ReadonlySet<string> = new Set(),
): Promise<OrphanScanResult> {
  if (!isDbEnabled()) return EMPTY_SCAN();
  let matches: { valid: DurableMatch[]; corrupt: { matchId: string; roomCode: string; reason: string }[] };
  try { matches = await listUnsettledMatches(); } catch { return EMPTY_SCAN(); }
  const refunded: string[] = [];
  const alreadyPaid: string[] = [];
  const retryable: string[] = [];
  const invalidRefs: CorruptMatchRef[] = [];
  // CORRUPT durable records are NEVER settled/refunded (all-or-nothing, FAIL 3) — left
  // unresolved with an operator alert. A partial refund could leave a debited user short.
  for (const c of matches.corrupt) {
    // (37.7.15 FAIL 3) The match id stays INTERNAL (it is returned in `corruptRefs` for the
    // orchestration); the log carries only the room code + a bounded reason.
    console.error(`[Poker] room ${c.roomCode}: an orphaned durable match is CORRUPT (${c.reason}) — LEFT UNRESOLVED for operator review`);
  }
  for (const m of matches.valid) {
    if (activeMatchIds.has(m.matchId)) continue; // an active started room owns this → keep funded
    // (37.7.17 FAIL 1) The guarded refund distinguishes the three outcomes: only `resolved` counts as
    // refunded. A structural failure is PERMANENT operator evidence (never retried, never settled);
    // a transient one is reported so the caller knows this boot proved nothing about that match.
    // (37.7.18 FAIL 2) A room whose PERSISTED escrow is corrupt has no provable matchId, so every
    // durable match naming its code is fail-closed protected — the code alone can never authorise a
    // settlement (it may belong to an entirely different generation that reused it).
    if (protectedRoomCodes.has(m.roomCode)) continue;
    const res = await refundDurableMatch(m);
    if (res === 'confirmed_refund') {
      refunded.push(m.matchId);
      console.log(`[Poker] room ${m.roomCode}: crash-recovery refund for an orphaned durable match`);
    } else if (res === 'already_paid') {
      // (37.7.18 FAIL 1) The payout won the settlement race. The money went OUT, not back — this
      // match must never be reported as refunded (callers cancel/wipe tables on that).
      alreadyPaid.push(m.matchId);
    } else if (res === 'invalid') {
      invalidRefs.push({ matchId: m.matchId, roomCode: m.roomCode, reasonCode: 'ledger does not back the durable record' });
      console.error(`[Poker] room ${m.roomCode}: an orphaned durable match has UNPROVEN buy-in evidence — LEFT UNRESOLVED for operator review`);
    } else {
      retryable.push(m.matchId);
    }
  }
  return {
    refunded,
    alreadyPaid,
    retryable,
    corrupt: [...matches.corrupt.map((c) => c.matchId), ...invalidRefs.map((c) => c.matchId)],
    // (37.7.14 FAIL 3 / 37.7.15 FAIL 1) The association for every corrupt durable match. The scan
    // used to report ids only, so the caller could not tell WHICH restored room owned an unsafe
    // record; 37.7.14 then associated by ROOM CODE, which collides after a 4-char code is reused.
    // These refs are INTERNAL to the server orchestration — never logged, never sent to a client.
    corruptRefs: [...matches.corrupt.map((c) => ({ matchId: c.matchId, roomCode: c.roomCode, reasonCode: c.reason })), ...invalidRefs],
  };
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
 * (37.7.13 FAIL 2) The EXPLICIT outcome of a reconciliation attempt. `reconcileEscrow` used to
 * return `void`, so every caller had to infer the outcome from the resulting escrow status — and a
 * surviving `pending` was read as "nothing was charged" even when it really meant "the durable
 * outcome could not be read". These values make the difference impossible to miss:
 *   • noop               — nothing to reconcile (no escrow / not bankroll / already durable);
 *   • funded             — the debit is durably committed (or a settlement never committed → retry);
 *   • settled            — a durable PAYOUT settlement row exists;
 *   • cancelled          — a durable REFUND settlement row exists;
 *   • proven_uncommitted — the DB PROVED zero committed buy-ins → the escrow was dropped;
 *   • retry_pending      — TRANSIENT: the durable outcome is UNKNOWN (DB read failed / no economy);
 *   • corrupt_partial    — only SOME seats have a durable buy-in → unsafe to settle either way.
 */
/**
 * (37.7.15 FAIL 2) The four `*_durable` / `*_mismatch` values are PERMANENT structural failures of
 * the EXACT ownership proof (durable row missing / unparseable / describing another match / a buy-in
 * ledger that does not back this escrow). `corrupt_partial` is the half-charged ledger. All five are
 * classified alike — fail closed, frozen for the operator — but stay distinguishable for diagnosis.
 */
export type EscrowReconcileResult =
  | 'noop' | 'funded' | 'settled' | 'cancelled' | 'proven_uncommitted' | 'retry_pending'
  | 'corrupt_partial' | 'missing_durable' | 'corrupt_durable' | 'metadata_mismatch' | 'ledger_mismatch'
  // (37.7.16 FAIL 1/2) The room JSON's TERMINAL claim is not confirmed by the DB: either there is no
  // settlement row at all, or the DB recorded the OPPOSITE outcome. A terminal status in room JSON is
  // a CLAIM, never proof — both are permanent operator evidence.
  | 'terminal_unconfirmed' | 'terminal_conflict'
  // (37.7.17 FAIL 2) The room has NO escrow but still CLAIMS an economy match (a game state, a
  // generation binding, or owed stats). Absence of an escrow is not proof of a refund:
  //   • escrowless_unknown    — no binding at all, or the durable match is PAID and the participant
  //                             mapping cannot be safely reconstructed → PERMANENT operator evidence;
  //   • escrowless_unresolved — the binding's durable match exists, is exact and is UNSETTLED. Inert
  //                             and retryable; it becomes `cancelled` ONLY once a refund for THAT
  //                             exact matchId is CONFIRMED in this boot.
  | 'escrowless_unknown' | 'escrowless_unresolved';

/** TRUE for a PERMANENT structural failure of the durable ownership proof (37.7.15/37.7.16). */
export function isCorruptEvidence(result: EscrowReconcileResult): boolean {
  return result === 'corrupt_partial' || result === 'missing_durable'
    || result === 'corrupt_durable' || result === 'metadata_mismatch' || result === 'ledger_mismatch'
    || result === 'terminal_unconfirmed' || result === 'terminal_conflict'
    || result === 'escrowless_unknown';
}

/**
 * Crash reconciliation (FAIL 3): reconcile a RESTORED transient escrow against the durable
 * DB state so a pending/settling escrow can never hang forever.
 *   • pending  → all buy-ins committed → funded; PROVEN none → drop (nothing was charged);
 *                a partial fails closed (`corrupt_partial`, escrow left pending).
 *   • settling → a committed settlement row → settled/cancelled; none → back to funded (retry).
 * An invalid/incoherent escrow is left as-is (no wallet mutation). Call inside withRoomLock.
 *
 * (37.7.13) Returns the EXPLICIT outcome above — a caller must never re-derive it from the escrow
 * status, because a surviving `pending` can mean either "unknown" or "corrupt", never "cancelled".
 */
export async function reconcileEscrow(room: ServerRoom): Promise<EscrowReconcileResult> {
  const esc = room.pokerEscrow;
  if (!esc || esc.status !== 'pending' && esc.status !== 'settling') return 'noop'; // durable statuses
  return resolveEscrowEvidence(room);
}

/**
 * (37.7.15 FAIL 2) Resolve a room's escrow against its EXACT durable evidence — the single DB read
 * every recovery path uses. Covers `pending`/`settling` (the transient reconciliation above) AND
 * `funded`, because a funded escrow that never had a matching durable record must not be resumed
 * either. A terminal (`settled`/`cancelled`) escrow is already resolved → `noop`.
 *
 * Ownership is proven by `validateDurableOwnership` (pure), never by a row COUNT. A transient DB
 * failure is `retry_pending` (nothing is proven, nothing changes); a structural failure is permanent
 * evidence the caller freezes on. Call inside `withRoomLock`.
 */
/**
 * (37.7.17 FAIL 2) Resolve a room that CLAIMS an economy match but carries NO escrow — a carried game
 * state, a generation binding, or owed stats. The missing escrow proves nothing, so the binding's
 * matchId (server-only; never logged, never public) is looked up durably and the record is validated
 * AGAINST ITSELF: the buy-in ledger must exactly back the durable row. Only a durable `cancel_refund`
 * (or a provably uncommitted debit) may become a clean cancelled lobby.
 */
async function resolveEscrowlessClaim(room: ServerRoom): Promise<EscrowReconcileResult> {
  const matchId = room.pokerGameMatchId;
  // A claim with no binding cannot be tied to any match — ownership is unknowable → fail closed.
  if (typeof matchId !== 'string' || !matchId) return 'escrowless_unknown';
  if (!isDbEnabled() || injectedReconcileFailure) return 'retry_pending';
  let evidence;
  try { evidence = await matchDurableEvidence(matchId); } catch { return 'retry_pending'; }
  // No durable row and no debit at all: the debit transaction rolled back → nothing was ever charged.
  if (!evidence.matchRowExists && evidence.buyIns.length === 0) return 'proven_uncommitted';
  if (evidence.matchRowCorrupt) return 'corrupt_durable';
  if (!evidence.match) return 'missing_durable';
  const durable = evidence.match;
  const { financial, structure } = validateDurableOwnership(durable.roomCode, durable, evidence);
  if (structure !== 'exact') {
    return structure === 'metadata_mismatch' ? 'metadata_mismatch'
      : structure === 'ledger_partial' ? 'corrupt_partial'
      : structure === 'proven_uncommitted' ? 'missing_durable' : 'ledger_mismatch';
  }
  if (financial === 'cancel_refund') return 'cancelled';   // durably refunded → a clean lobby
  // A PAID match with no escrow: the money is out but the seat→account mapping cannot be rebuilt from
  // the room, so no stats may be attributed and no evidence may be cleaned up.
  if (financial === 'payout') return 'escrowless_unknown';
  return 'escrowless_unresolved';                          // exact + unsettled → inert, scan-eligible
}

export async function resolveEscrowEvidence(room: ServerRoom): Promise<EscrowReconcileResult> {
  const esc = room.pokerEscrow;
  if (!isBankrollRoom(room)) return 'noop';
  if (!esc) return resolveEscrowlessClaim(room);
  if (!isDbEnabled()) return 'retry_pending';                               // no economy → outcome UNKNOWN
  if (injectedReconcileFailure) return 'retry_pending';                     // test seam: transient read failure
  let evidence;
  try { evidence = await matchDurableEvidence(esc.matchId); } catch { return 'retry_pending'; } // transient
  const { financial, structure } = validateDurableOwnership(room.code, esc, evidence);

  // (37.7.16 FAIL 2) A TERMINAL status in the room JSON is a CLAIM, not DB proof. Stage 37.7.15
  // skipped `settled`/`cancelled` escrows entirely, so a room could carry a terminal status the DB
  // never recorded — or the OPPOSITE one — and still reach `paid_finish` / a `cancelled` cleanup.
  if (esc.status === 'settled' || esc.status === 'cancelled') {
    const claimed = esc.status === 'settled' ? 'payout' : 'cancel_refund';
    if (financial === 'unresolved') return 'terminal_unconfirmed';
    if (financial !== claimed) return 'terminal_conflict';
  }

  // (37.7.16 FAIL 1) The financial outcome NEVER excuses a structural failure. A committed payout on
  // a match whose durable record is missing/mismatched proves the money moved — not WHOSE match it
  // was — so it can never become a `paid_finish` whose stats are attributed from the room escrow.
  if (structure !== 'exact') {
    if (structure === 'proven_uncommitted') {
      // Nothing charged and no durable claim. With NO settlement that is a rolled-back `pending`
      // debit; anything else (a funded/terminal claim, or a settlement with zero evidence) is
      // corruption, not a rollback.
      if (financial !== 'unresolved') return 'corrupt_durable';
      if (esc.status === 'pending') { room.pokerEscrow = undefined; return 'proven_uncommitted'; }
      return 'missing_durable';
    }
    return structure === 'missing' ? 'missing_durable'
      : structure === 'corrupt' ? 'corrupt_durable'
      : structure === 'metadata_mismatch' ? 'metadata_mismatch'
      : structure === 'ledger_partial' ? 'corrupt_partial'
      : 'ledger_mismatch';
  }

  // EXACT ownership → the financial axis decides, with settlement precedence over any transient
  // status the restored room JSON carries (37.7.14).
  if (financial === 'payout') { esc.status = 'settled'; return 'settled'; }
  if (financial === 'cancel_refund') { esc.status = 'cancelled'; return 'cancelled'; }
  esc.status = 'funded';
  return 'funded';
}

/**
 * (37.7.16 FAIL 3) Prove EXACT durable ownership for a room whose escrow is already terminal, before
 * any stats/`already_paid` decision is taken from it. Returns `'exact'`, `'retry'` (transient — try
 * again later) or `'invalid'` (permanent structural failure → freeze).
 */
async function proveOwnership(room: ServerRoom): Promise<'exact' | 'retry' | 'invalid'> {
  const esc = room.pokerEscrow;
  if (!esc) return 'invalid';
  if (!isDbEnabled() || injectedReconcileFailure) return 'retry';
  let evidence;
  try { evidence = await matchDurableEvidence(esc.matchId); } catch { return 'retry'; }
  return validateDurableOwnership(room.code, esc, evidence).structure === 'exact' ? 'exact' : 'invalid';
}
