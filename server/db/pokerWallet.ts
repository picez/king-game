// ---------------------------------------------------------------------------
// Poker chip wallet repository (Stage 37.7). Backs the ONLINE bankroll economy:
// a per-user chip balance, the once-per-UTC-day 1,000,000-chip claim, and an
// append-only ledger. Requires Postgres (DATABASE_URL); imported DYNAMICALLY by
// the API/WS server only when a wallet operation is requested — with no
// DATABASE_URL the server behaves exactly as the file/memory MVP and there is no
// bankroll economy (local free-play Poker still works).
//
// EVERY mutation is:
//   • atomic       — one transaction with a `FOR UPDATE` row lock on the wallet,
//   • idempotent   — a UNIQUE ledger `idempotency_key` gates the LOGICAL operation,
//                    so a concurrent double-claim / duplicate START_GAME / replayed
//                    finish can never double-credit or double-debit,
//   • non-negative — enforced in code AND by the DB CHECK (balance >= 0).
//
// `now` is always the SERVER clock (Date) — the once-per-day rule uses the server's
// UTC date, so a client clock/timezone change cannot unlock an extra claim.
// ---------------------------------------------------------------------------

import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pokerWallets, pokerLedger, pokerMatchSettlements } from './schema';
import { getDb } from './client';
import {
  DAILY_CLAIM_CHIPS, utcDateString, nextUtcMidnightMs,
  type PokerWalletView, type PokerClaimResult, type PokerLedgerReason,
} from '../../src/net/pokerWallet';

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('Poker wallet repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.db as PostgresJsDatabase;
}

/** Thrown when a debit (buy-in) would take the balance below zero. Caller rolls back. */
export class InsufficientChipsError extends Error {
  constructor(public readonly userId: string, public readonly needed: number, public readonly balance: number) {
    super('insufficient_chips');
    this.name = 'InsufficientChipsError';
  }
}

/** Thrown when a caller passes a non-safe-integer / zero delta to adjustWalletTx. */
export class InvalidChipDeltaError extends Error {
  constructor(public readonly delta: unknown) {
    super('invalid_chip_delta');
    this.name = 'InvalidChipDeltaError';
  }
}

/** Thrown when a credit would push the balance above Number.MAX_SAFE_INTEGER. */
export class ChipOverflowError extends Error {
  constructor(public readonly userId: string, public readonly balance: number, public readonly delta: number) {
    super('chip_overflow');
    this.name = 'ChipOverflowError';
  }
}

/** Thrown when an idempotency key is reused for a DIFFERENT (user, reason, delta). */
export class LedgerKeyReuseError extends Error {
  constructor(public readonly idempotencyKey: string) {
    super('ledger_key_reuse');
    this.name = 'LedgerKeyReuseError';
  }
}

/** The terminal outcome of an economy match — mutually exclusive (§16, migration 0011). */
export type MatchOutcome = 'payout' | 'cancel_refund';

/** Thrown when a match was already resolved with the OPPOSITE outcome (no wallet change). */
export class SettlementConflictError extends Error {
  constructor(public readonly matchId: string, public readonly resolved: MatchOutcome, public readonly requested: MatchOutcome) {
    super('settlement_conflict');
    this.name = 'SettlementConflictError';
  }
}

/**
 * DB-authoritative settlement gate (§16 F/G). Atomically CLAIMS a match's terminal
 * outcome and runs the wallet mutations in the SAME transaction, so payout and refund
 * can NEVER both mint chips for one match — even across a crash/restart:
 *   • the first outcome to insert the settlement row wins → `mutate` runs;
 *   • a repeat of the SAME outcome is an idempotent no-op (the per-user ledger keys
 *     already exist, so `mutate`'s adjustWalletTx calls no-op) → returns the winner;
 *   • the OPPOSITE outcome after resolution throws SettlementConflictError → NO wallet
 *     mutation (the whole transaction rolls back).
 * `mutate` MUST use per-(match,user) ledger keys so its re-run under the same outcome is
 * safe. Returns the winning outcome.
 */
/**
 * Pure decision for the settlement gate (deterministically unit-testable). Given whether
 * THIS transaction freshly claimed the match row and the existing outcome on a conflict,
 * returns the winning outcome — or throws SettlementConflictError when the match was
 * already resolved with the OPPOSITE outcome.
 */
export function resolveSettlementOutcome(matchId: string, claimedFresh: boolean, existing: MatchOutcome | null, requested: MatchOutcome): MatchOutcome {
  if (claimedFresh) return requested;
  const winner = existing ?? requested;
  if (winner !== requested) throw new SettlementConflictError(matchId, winner, requested);
  return winner; // idempotent repeat of the same outcome
}

export async function settleMatchTx(
  matchId: string,
  outcome: MatchOutcome,
  mutate: (tx: PostgresJsDatabase) => Promise<void>,
): Promise<MatchOutcome> {
  const db = await database();
  return db.transaction(async (tx) => {
    const claimed = await tx.insert(pokerMatchSettlements).values({ matchId, outcome })
      .onConflictDoNothing({ target: pokerMatchSettlements.matchId })
      .returning({ outcome: pokerMatchSettlements.outcome });
    let existing: MatchOutcome | null = null;
    if (claimed.length === 0) {
      const [row] = await tx.select().from(pokerMatchSettlements).where(eq(pokerMatchSettlements.matchId, matchId)).limit(1);
      existing = (row?.outcome as MatchOutcome) ?? null;
    }
    const winner = resolveSettlementOutcome(matchId, claimed.length > 0, existing, outcome); // throws on opposite
    // Same outcome (fresh claim OR idempotent repeat) → apply the mutations.
    await mutate(tx);
    return winner;
  });
}

/** Durable ledger/settlement state for a match — used for crash reconciliation (§16, FAIL 3). */
export async function matchLedgerState(matchId: string): Promise<{ buyInCount: number; settlement: MatchOutcome | null }> {
  const conn = await getDb();
  if (!conn) return { buyInCount: 0, settlement: null };
  const db = conn.db as PostgresJsDatabase;
  const buyins = await db.select({ id: pokerLedger.id }).from(pokerLedger)
    .where(and(eq(pokerLedger.matchId, matchId), eq(pokerLedger.reason, 'table_buy_in' satisfies PokerLedgerReason)));
  const [s] = await db.select().from(pokerMatchSettlements).where(eq(pokerMatchSettlements.matchId, matchId)).limit(1);
  return { buyInCount: buyins.length, settlement: (s?.outcome as MatchOutcome) ?? null };
}

// --- Pure guards (deterministically unit-testable without a DB) -------------

/** Rejects a non-safe-integer or zero delta (a programming error). */
export function validateChipDelta(delta: number): void {
  if (typeof delta !== 'number' || !Number.isFinite(delta) || !Number.isSafeInteger(delta) || delta === 0) {
    throw new InvalidChipDeltaError(delta);
  }
}

/** Computes cur+delta, throwing before any DB write if it would go negative or overflow. */
export function computeNextBalance(userId: string, cur: number, delta: number): number {
  const next = cur + delta;
  if (next < 0) throw new InsufficientChipsError(userId, -delta, cur);
  if (next > Number.MAX_SAFE_INTEGER) throw new ChipOverflowError(userId, cur, delta);
  return next;
}

/** Throws if an idempotency key's existing row is a DIFFERENT (user, reason, delta). */
export function ensureSameLogicalOp(
  prior: { userId: string; reason: string; delta: number } | undefined,
  req: { userId: string; reason: string; delta: number; idempotencyKey: string },
): void {
  if (prior && (prior.userId !== req.userId || prior.reason !== req.reason || prior.delta !== req.delta)) {
    throw new LedgerKeyReuseError(req.idempotencyKey);
  }
}

/** Builds the public view from a wallet row + the server's current instant. Pure. */
function toView(balance: number, lastClaimDate: string | null, now: Date): PokerWalletView {
  const claimedToday = lastClaimDate === utcDateString(now);
  return {
    balance,
    canClaimToday: !claimedToday,
    nextClaimAt: claimedToday ? nextUtcMidnightMs(now) : null,
  };
}

/** Reads a user's wallet view (creates nothing). A user with no row reads as 0 / claimable. */
export async function getWalletView(userId: string, now: Date): Promise<PokerWalletView> {
  const db = await database();
  const [w] = await db.select().from(pokerWallets).where(eq(pokerWallets.userId, userId)).limit(1);
  return toView(w?.balance ?? 0, w?.lastClaimDate ?? null, now);
}

/**
 * Grants the fixed daily chip amount, at most once per UTC calendar day.
 *
 * Atomic + idempotent: inside one transaction we lock the wallet row (`FOR UPDATE`),
 * then attempt to INSERT the `daily:<user>:<utc-date>` ledger row. The UNIQUE
 * idempotency key is the authority — if it already exists, the day was already
 * claimed and we credit NOTHING (returns granted:false with the current balance +
 * next-eligibility). Two racing POSTs serialize on the lock: the first inserts and
 * credits; the second's insert conflicts and no-ops. Exactly one grant per day.
 */
export async function dailyClaim(userId: string, now: Date): Promise<PokerClaimResult> {
  const db = await database();
  const today = utcDateString(now);
  const key = `daily:${userId}:${today}`;
  return db.transaction(async (tx) => {
    // Ensure a lockable row exists, then take the row lock (serializes concurrent claims).
    await tx.insert(pokerWallets).values({ userId, balance: 0 }).onConflictDoNothing();
    const [w] = await tx.select().from(pokerWallets).where(eq(pokerWallets.userId, userId)).for('update').limit(1);
    const cur = w?.balance ?? 0;
    const next = cur + DAILY_CLAIM_CHIPS;

    // The ledger UNIQUE key is the single source of "already claimed this day".
    const inserted = await tx.insert(pokerLedger).values({
      userId, reason: 'daily_claim' satisfies PokerLedgerReason,
      delta: DAILY_CLAIM_CHIPS, balanceAfter: next, idempotencyKey: key,
    }).onConflictDoNothing({ target: pokerLedger.idempotencyKey }).returning({ id: pokerLedger.id });

    if (inserted.length === 0) {
      // Already claimed today → credit nothing.
      return { ...toView(cur, w?.lastClaimDate ?? today, now), granted: false };
    }
    await tx.update(pokerWallets)
      .set({ balance: next, lastClaimDate: today, updatedAt: now })
      .where(eq(pokerWallets.userId, userId));
    return { ...toView(next, today, now), granted: true };
  });
}

/**
 * Append-only ledger primitive used by the table economy (buy-in / payout / refund).
 * Runs INSIDE a caller-supplied transaction so a batch (e.g. buy-in for every seat)
 * commits all-or-nothing.
 *
 * ATOMICITY (Stage 37.7 race fix): the balance is mutated ONLY when THIS transaction
 * wins the ledger idempotency key. The safe order is:
 *   1. ensure + LOCK the wallet row (`FOR UPDATE`) — serializes concurrent ops on the user;
 *   2. read the current balance, compute + validate the next balance;
 *   3. INSERT the ledger row `ON CONFLICT DO NOTHING RETURNING id` — the gate;
 *   4. if the insert returned nothing → the key already exists → idempotent no-op,
 *      balance UNCHANGED (applied:false);
 *   5. only if the insert won the key → UPDATE the wallet balance.
 * Because BOTH the gate insert and the balance update happen under the row lock, two
 * concurrent calls with the same key serialize: the first applies once, the second's
 * insert conflicts and it never updates. (The earlier pre-check-then-update ordering
 * could double-apply — the pre-check SELECT saw no key, then both updated.)
 *
 * Idempotent via `idempotencyKey`; a debit that would go negative throws
 * InsufficientChipsError; a credit overflowing the safe-integer range throws
 * ChipOverflowError; a non-safe/zero delta throws InvalidChipDeltaError; reusing a
 * key for a DIFFERENT (user, reason, delta) throws LedgerKeyReuseError. Any throw
 * rolls the caller's batch back.
 */
export async function adjustWalletTx(
  tx: PostgresJsDatabase,
  userId: string,
  delta: number,
  reason: Exclude<PokerLedgerReason, 'daily_claim'>,
  idempotencyKey: string,
  ref: { matchId?: string; roomCode?: string } = {},
): Promise<{ balance: number; applied: boolean }> {
  // (2a) Validate the delta up front — a non-safe/zero delta is a programming error.
  validateChipDelta(delta);
  // (1) Ensure + LOCK the wallet row. This serialization is what makes the gate safe.
  await tx.insert(pokerWallets).values({ userId, balance: 0 }).onConflictDoNothing();
  const [w] = await tx.select().from(pokerWallets).where(eq(pokerWallets.userId, userId)).for('update').limit(1);
  const cur = w?.balance ?? 0;

  // (2b) Compute + validate the next balance BEFORE claiming the key.
  const next = computeNextBalance(userId, cur, delta);

  // (3) The GATE: claim the idempotency key by inserting the ledger row.
  const inserted = await tx.insert(pokerLedger).values({
    userId, reason, delta, balanceAfter: next, idempotencyKey,
    matchId: ref.matchId ?? null, roomCode: ref.roomCode ?? null,
  }).onConflictDoNothing({ target: pokerLedger.idempotencyKey }).returning({ id: pokerLedger.id });

  if (inserted.length === 0) {
    // (4) Key already used → idempotent no-op. Guard against accidental reuse of the
    // same key for a DIFFERENT logical operation (would silently swallow a real op).
    const [prior] = await tx.select().from(pokerLedger)
      .where(eq(pokerLedger.idempotencyKey, idempotencyKey)).limit(1);
    ensureSameLogicalOp(prior, { userId, reason, delta, idempotencyKey });
    return { balance: cur, applied: false };
  }

  // (5) We own the key → apply the balance change.
  await tx.update(pokerWallets).set({ balance: next, updatedAt: new Date() }).where(eq(pokerWallets.userId, userId));
  return { balance: next, applied: true };
}
