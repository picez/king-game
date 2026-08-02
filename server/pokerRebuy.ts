// ---------------------------------------------------------------------------
// ONLINE bankroll between-hands REBUY — the ONE orchestration point (§17, Stage 38.0.3C).
//
// A rebuy adds real chips to a live paid match, so it is an economy operation with the
// same standards as the buy-in: derived entirely server-side, debited atomically through
// the ledger's idempotency gate, applied to the authoritative state only AFTER the debit
// commits, and reconciled exactly once if the process dies in between.
//
// LOCK ORDER (never inverted):  withRoomLock(code) → withEconomyBarrier → DB transaction.
// The room lock serializes a request against the window timeout and teardown; the economy
// barrier serializes it against the global orphan scan; the DB transaction's wallet-row
// lock + UNIQUE idempotency key make the debit itself atomic and idempotent.
//
// CRASH WINDOW: `ledger row committed → crash → pure REBUY not applied`. The ledger row is
// the source of truth, so `reconcileRebuys` re-applies it exactly once when the room is
// provably the same match/hand/seat, and FREEZES whenever the two sides cannot be
// reconciled — it never mints chips and never drops a paid rebuy.
// ---------------------------------------------------------------------------

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb, isDbEnabled } from './db/client';
import {
  adjustWalletTx, matchDurableEvidence, parseRebuyKey, rebuyIdempotencyKey,
  InsufficientChipsError, LedgerKeyReuseError,
} from './db/pokerWallet';
import { isBankrollRoom, withEconomyBarrier, withRoomLock, pokerRecoveryBlocked } from './pokerEscrow';
import { gameBoundToEscrow } from './pokerBinding';
import { canSeatRebuy, rebuyWindowOf } from '../src/games/poker/rules';
import { pokerReducer } from '../src/games/poker/engine';
import type { PokerState } from '../src/games/poker/types';
import type { ServerRoom } from '../src/net/serverCore';

/** The server-authoritative rebuy window length (§17). */
export const REBUY_WINDOW_MS = 20_000;

/** Why a rebuy request was refused, or that it succeeded. Never leaks economy internals. */
export type RebuyOutcome =
  | { ok: true; balance: number; alreadyApplied: boolean }
  | { ok: false; reason: 'not_allowed' | 'insufficient' | 'economy_unavailable' | 'retry' };

/** Everything the orchestrator needs from the server, injected so it is unit-testable. */
export interface RebuyDeps {
  /** Persist the room JSON immediately after the state changes. */
  persist: (room: ServerRoom) => void;
  /** Broadcast the (redacted) state to the room. */
  broadcast: (room: ServerRoom) => void;
  /** Permanently freeze a room for operator review (never partially settled). */
  freeze: (room: ServerRoom, reason: string) => void;
  /** Wall clock, injectable for deterministic tests. */
  now: () => number;
}

// --- Window lifecycle -------------------------------------------------------

/** The poker state of a room, or null. */
function stateOf(room: ServerRoom): PokerState | null {
  return (room.gameType === 'poker' ? (room.gameState as PokerState | null) : null) ?? null;
}

/** TRUE when this room is an online bankroll table paused on an open rebuy window. */
export function inOnlineRebuyWindow(room: ServerRoom): boolean {
  const state = stateOf(room);
  return !!state && isBankrollRoom(room) && rebuyWindowOf(state) !== null;
}

/**
 * Mint the window deadline ONCE per (matchId, handNumber). Re-entry (a rebroadcast, a
 * reconnect, another advance tick) finds the identity unchanged and leaves the ABSOLUTE
 * instant alone, so nothing a client does can extend it. Returns true when it minted.
 */
export function ensureRebuyDeadline(room: ServerRoom, deps: Pick<RebuyDeps, 'now'>): boolean {
  const state = stateOf(room);
  const win = state ? rebuyWindowOf(state) : null;
  if (!win || !isBankrollRoom(room)) return false;
  const matchId = room.pokerEscrow?.matchId;
  if (!matchId) return false;
  if (room.pokerRebuyMatchId === matchId && room.pokerRebuyHand === win.handNumber && room.pokerRebuyDeadlineAt) {
    return false;                                            // already minted for THIS window
  }
  room.pokerRebuyMatchId = matchId;
  room.pokerRebuyHand = win.handNumber;
  room.pokerRebuyDeadlineAt = deps.now() + REBUY_WINDOW_MS;
  room.pokerRebuyRevision = (room.pokerRebuyRevision ?? 0) + 1;
  return true;
}

/** Drop the window bookkeeping once the window is gone (or belongs to another hand). */
export function clearRebuyDeadline(room: ServerRoom): void {
  room.pokerRebuyDeadlineAt = undefined;
  room.pokerRebuyMatchId = undefined;
  room.pokerRebuyHand = undefined;
  room.pokerRebuyInFlight = undefined;
}

/** Seats with a debit in flight — a close must never run past one of them. */
export function hasRebuyInFlight(room: ServerRoom): boolean {
  return (room.pokerRebuyInFlight?.size ?? 0) > 0;
}

/**
 * Whether the window may close NOW: the deadline passed, or every eligible seat reached a
 * terminal decision. An in-flight debit always blocks the close (§17) — otherwise a
 * timeout could eliminate a seat whose chips were already taken.
 */
export function shouldCloseRebuyWindow(room: ServerRoom, now: number): boolean {
  const state = stateOf(room);
  const win = state ? rebuyWindowOf(state) : null;
  if (!win) return false;
  if (hasRebuyInFlight(room)) return false;
  const undecided = win.eligibleSeats.filter((s) => (win.decisionBySeat[s] ?? 'pending') === 'pending');
  if (undecided.length === 0) return true;                    // everyone answered → early close
  const deadline = room.pokerRebuyDeadlineAt;
  return typeof deadline === 'number' && now >= deadline;     // timeout → the rest decline
}

/** Apply CLOSE_REBUY_WINDOW to the authoritative state. Returns true when it changed. */
export function closeRebuyWindow(room: ServerRoom): boolean {
  const state = stateOf(room);
  if (!state) return false;
  const next = pokerReducer(state, { type: 'CLOSE_REBUY_WINDOW' });
  if (!next || next === state) return false;
  room.gameState = next;
  clearRebuyDeadline(room);
  return true;
}

// --- Authorization ----------------------------------------------------------

/** The authenticated seat this request may act for, or null. All derived server-side. */
export function resolveRebuySeat(room: ServerRoom, userId: string | null): number | null {
  if (!userId) return null;
  for (const m of room.members.values()) {
    if (m.role === 'player' && m.seatIndex != null && m.userId === userId) return m.seatIndex;
  }
  return null;
}

/** Every precondition a rebuy decision (buy or decline) must satisfy. Pure. */
export function rebuyRequestAllowed(room: ServerRoom, seat: number | null): boolean {
  if (seat == null) return false;
  if (!isBankrollRoom(room)) return false;
  if (room.pokerFrozen || pokerRecoveryBlocked(room)) return false;
  const esc = room.pokerEscrow;
  if (!esc || esc.status !== 'funded') return false;          // must be a live funded match
  if (!gameBoundToEscrow(room)) return false;                 // state must belong to THIS match
  const state = stateOf(room);
  if (!state) return false;
  if (!canSeatRebuy(state, seat)) return false;               // window open, seat busted, undecided
  // The pure amount and the table's buy-in must be the same number, or the economy and the
  // gameplay disagree about what a rebuy is worth — fail closed rather than pick one.
  if (state.options.startingStack !== room.pokerBuyIn) return false;
  return true;
}

// --- The debit --------------------------------------------------------------

/**
 * Buy `seat` back in. Serialized by the caller's room lock; takes the economy barrier and
 * then ONE transaction whose ledger insert is the idempotency gate — the balance moves
 * only when this call wins the key. The pure `REBUY` is applied AFTER the commit, then the
 * room is persisted immediately, so the crash window is bounded by `reconcileRebuys`.
 */
export async function performRebuy(
  room: ServerRoom, userId: string, seat: number, deps: RebuyDeps,
): Promise<RebuyOutcome> {
  if (!isDbEnabled()) return { ok: false, reason: 'economy_unavailable' };
  if (!rebuyRequestAllowed(room, seat)) return { ok: false, reason: 'not_allowed' };
  const state = stateOf(room)!;
  const esc = room.pokerEscrow!;
  const hand = rebuyWindowOf(state)!.handNumber;
  const amount = room.pokerBuyIn!;
  const key = rebuyIdempotencyKey(esc.matchId, hand, userId);

  const conn = await getDb();
  if (!conn) return { ok: false, reason: 'economy_unavailable' };
  const database = conn.db as unknown as PostgresJsDatabase;

  // Mark the seat in flight BEFORE the barrier so a timeout/scan that runs concurrently
  // already sees it and refuses to close the window over a debit that may commit.
  const inFlight = room.pokerRebuyInFlight ?? new Set<number>();
  inFlight.add(seat);
  room.pokerRebuyInFlight = inFlight;
  let balance = 0;
  try {
    await withEconomyBarrier(() => database.transaction(async (tx) => {
      const res = await adjustWalletTx(tx, userId, -amount, 'table_rebuy', key, { matchId: esc.matchId, roomCode: room.code });
      balance = res.balance;
    }));
  } catch (err) {
    inFlight.delete(seat);
    if (inFlight.size === 0) room.pokerRebuyInFlight = undefined;
    if (err instanceof InsufficientChipsError) return { ok: false, reason: 'insufficient' };
    // A key reused for a DIFFERENT logical op is a permanent structural conflict.
    if (err instanceof LedgerKeyReuseError) { deps.freeze(room, 'rebuy ledger key conflict'); return { ok: false, reason: 'not_allowed' }; }
    // Everything else (DB down, a CHECK failure because migration 0013 is missing) is
    // transient/operational from the caller's point of view: nothing was debited.
    return { ok: false, reason: 'retry' };
  }

  // The debit is DURABLE from here on. Apply the pure rebuy, persist, then release.
  const applied = applyDurableRebuy(room, seat);
  inFlight.delete(seat);
  if (inFlight.size === 0) room.pokerRebuyInFlight = undefined;
  deps.persist(room);
  deps.broadcast(room);
  return { ok: true, balance, alreadyApplied: !applied };
}

/** Apply the pure REBUY for `seat`; false when the state already had it (idempotent). */
function applyDurableRebuy(room: ServerRoom, seat: number): boolean {
  const state = stateOf(room);
  if (!state) return false;
  const next = pokerReducer(state, { type: 'REBUY', seat });
  if (!next || next === state) return false;
  room.gameState = next;
  return true;
}

/** Record a DECLINE for `seat`. No economy involvement — purely a decision. */
export function performDecline(room: ServerRoom, seat: number, deps: Pick<RebuyDeps, 'persist' | 'broadcast'>): boolean {
  const state = stateOf(room);
  if (!state) return false;
  const next = pokerReducer(state, { type: 'DECLINE_REBUY', seat });
  if (!next || next === state) return false;
  room.gameState = next;
  deps.persist(room);
  deps.broadcast(room);
  return true;
}

// --- Crash reconciliation ---------------------------------------------------

export type RebuyReconcileResult =
  /** Nothing to do (not a bankroll poker room / no evidence / already consistent). */
  | 'noop'
  /** A durable rebuy was missing from the state and has now been applied exactly once. */
  | 'applied'
  /** The DB could not be read — retry later; never decline, close, pay or purge. */
  | 'retry_pending'
  /** The two sides cannot be reconciled — the room is frozen for an operator. */
  | 'frozen';

/**
 * Reconcile the DURABLE rebuy ledger against the state's `appliedRebuys` (§17). Runs BEFORE
 * any expiry close, payout, stats write or bootstrap advance, so a committed debit can
 * never be lost and a claimed-but-unpaid rebuy can never be honoured.
 */
export async function reconcileRebuys(room: ServerRoom, deps: RebuyDeps): Promise<RebuyReconcileResult> {
  if (!isBankrollRoom(room) || !isDbEnabled()) return 'noop';
  const esc = room.pokerEscrow;
  const state = stateOf(room);
  if (!esc || !state) return 'noop';
  const applied = state.appliedRebuys ?? [];
  // Nothing durable can exist for a match whose state does not belong to it.
  if (!gameBoundToEscrow(room)) {
    if (applied.length > 0) { deps.freeze(room, 'rebuy on an unbound state'); return 'frozen'; }
    return 'noop';
  }

  let evidence;
  try {
    evidence = await matchDurableEvidence(esc.matchId);
  } catch {
    return 'retry_pending';                                   // transient: decide nothing
  }

  // Parse + validate every durable rebuy row against THIS match.
  const participants = new Map<string, number>();             // userId → seat
  for (const s of esc.seats) participants.set(s.userId, s.seat);
  const durable: { seat: number; hand: number }[] = [];
  const seen = new Set<string>();
  for (const row of evidence.rebuys ?? []) {
    const parsed = parseRebuyKey(row.idempotencyKey);
    if (!parsed || parsed.matchId !== esc.matchId || parsed.userId !== row.userId) {
      deps.freeze(room, 'malformed rebuy ledger key'); return 'frozen';
    }
    const seat = participants.get(row.userId);
    if (seat == null) { deps.freeze(room, 'rebuy for a non-participant'); return 'frozen'; }
    if (row.delta !== -esc.buyIn) { deps.freeze(room, 'rebuy delta mismatch'); return 'frozen'; }
    if (row.roomCode !== room.code) { deps.freeze(room, 'rebuy room mismatch'); return 'frozen'; }
    const dedupe = `${seat}:${parsed.handNumber}`;
    if (seen.has(dedupe)) { deps.freeze(room, 'duplicate rebuy evidence'); return 'frozen'; }
    seen.add(dedupe);
    durable.push({ seat, hand: parsed.handNumber });
  }

  // The state may never claim a rebuy the ledger does not have — that would be minting.
  const durableKeys = new Set(durable.map((d) => `${d.seat}:${d.hand}`));
  for (const a of applied) {
    if (!durableKeys.has(`${a.seat}:${a.handNumber}`)) {
      deps.freeze(room, 'state claims a rebuy with no durable debit');
      return 'frozen';
    }
  }

  // A durable rebuy missing from the state is the crash window: apply it EXACTLY once,
  // and only when it provably belongs to the hand the room is paused on right now.
  const appliedKeys = new Set(applied.map((a) => `${a.seat}:${a.handNumber}`));
  const missing = durable.filter((d) => !appliedKeys.has(`${d.seat}:${d.hand}`));
  if (missing.length === 0) return 'noop';

  const win = rebuyWindowOf(state);
  let changed = false;
  for (const m of missing) {
    if (!win || win.handNumber !== m.hand || !canSeatRebuy(stateOf(room)!, m.seat)) {
      deps.freeze(room, 'durable rebuy cannot be bound to the current hand');
      return 'frozen';
    }
    if (!applyDurableRebuy(room, m.seat)) {
      deps.freeze(room, 'durable rebuy could not be applied');
      return 'frozen';
    }
    changed = true;
  }
  if (changed) { deps.persist(room); deps.broadcast(room); return 'applied'; }
  return 'noop';
}
