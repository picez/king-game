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

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { pokerWallets, pokerLedger } from './schema';
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
 * commits all-or-nothing. Idempotent via `idempotencyKey`: if that key already
 * exists this is a no-op returning the current balance (applied:false). A debit that
 * would go negative throws InsufficientChipsError (caller rolls the batch back).
 *
 * NOTE: buy-in/payout/refund WIRING lands in a later Stage 37.7 increment; this is
 * the reviewed, tested primitive they build on.
 */
export async function adjustWalletTx(
  tx: PostgresJsDatabase,
  userId: string,
  delta: number,
  reason: Exclude<PokerLedgerReason, 'daily_claim'>,
  idempotencyKey: string,
  ref: { matchId?: string; roomCode?: string } = {},
): Promise<{ balance: number; applied: boolean }> {
  // Idempotency short-circuit — this logical operation already ran.
  const existing = await tx.select({ id: pokerLedger.id }).from(pokerLedger)
    .where(eq(pokerLedger.idempotencyKey, idempotencyKey)).limit(1);
  await tx.insert(pokerWallets).values({ userId, balance: 0 }).onConflictDoNothing();
  const [w] = await tx.select().from(pokerWallets).where(eq(pokerWallets.userId, userId)).for('update').limit(1);
  const cur = w?.balance ?? 0;
  if (existing.length > 0) return { balance: cur, applied: false };

  const next = cur + delta;
  if (next < 0) throw new InsufficientChipsError(userId, -delta, cur);
  await tx.update(pokerWallets).set({ balance: next, updatedAt: new Date() }).where(eq(pokerWallets.userId, userId));
  await tx.insert(pokerLedger).values({
    userId, reason, delta, balanceAfter: next, idempotencyKey,
    matchId: ref.matchId ?? null, roomCode: ref.roomCode ?? null,
  }).onConflictDoNothing({ target: pokerLedger.idempotencyKey });
  return { balance: next, applied: true };
}
