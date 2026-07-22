import { describe, it, expect } from 'vitest';

// Optional integration test for the Stage 37.7 Poker wallet repository.
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres (through 0010):
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// Repos are imported DYNAMICALLY so normal runs never load the pg driver. Verifies:
// the daily claim grants exactly once per UTC day, a CONCURRENT double-claim yields a
// single grant, the ledger is append-only + idempotent, buy-in debits are atomic and
// never go negative, and adjustWalletTx is idempotent per key.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12, 0, 0));       // 2026-07-21 (fixed UTC date)
const NEXT_DAY = new Date(Date.UTC(2026, 6, 22, 12, 0, 0));  // 2026-07-22

describe.skipIf(!TEST_DATABASE_URL)('poker wallet repository (integration)', () => {
  it('claims once per UTC day; concurrent double-claim → one grant; ledger idempotent', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const A = await users.createAccountUser({ email: null, name: 'WalletA', emailVerified: false });

    // Fresh wallet reads as 0 / claimable.
    const v0 = await wallet.getWalletView(A, DAY);
    expect(v0).toEqual({ balance: 0, canClaimToday: true, nextClaimAt: null });

    // First claim grants exactly 1,000,000 and locks out the same day.
    const c1 = await wallet.dailyClaim(A, DAY);
    expect(c1.granted).toBe(true);
    expect(c1.balance).toBe(1_000_000);
    expect(c1.canClaimToday).toBe(false);
    expect(c1.nextClaimAt).toBe(Date.UTC(2026, 6, 22));

    // Repeat same day → no credit.
    const c2 = await wallet.dailyClaim(A, DAY);
    expect(c2.granted).toBe(false);
    expect(c2.balance).toBe(1_000_000);

    // Next UTC day → claimable again, stacks on top.
    const c3 = await wallet.dailyClaim(A, NEXT_DAY);
    expect(c3.granted).toBe(true);
    expect(c3.balance).toBe(2_000_000);

    // Exactly two daily_claim ledger rows for A.
    const rows = await conn!.sql`SELECT reason, delta FROM poker_ledger WHERE user_id = ${A} AND reason = 'daily_claim'`;
    expect((rows as unknown[]).length).toBe(2);

    // CONCURRENT double-claim on a fresh user → a single grant, balance exactly 1M.
    const B = await users.createAccountUser({ email: null, name: 'WalletB', emailVerified: false });
    const [r1, r2] = await Promise.all([wallet.dailyClaim(B, DAY), wallet.dailyClaim(B, DAY)]);
    expect([r1.granted, r2.granted].filter(Boolean).length).toBe(1);
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(1_000_000);

    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('adjustWalletTx debits atomically, never goes negative, and is idempotent per key', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const db = conn!.db as import('drizzle-orm/postgres-js').PostgresJsDatabase;

    const U = await users.createAccountUser({ email: null, name: 'WalletC', emailVerified: false });
    await wallet.dailyClaim(U, DAY); // 1,000,000

    // A buy-in debit of 5000 (one stakes preset) inside a transaction.
    const r = await db.transaction((tx) => wallet.adjustWalletTx(tx, U, -5000, 'table_buy_in', `buyin:m1:${U}`, { matchId: 'm1', roomCode: 'ROOM1' }));
    expect(r).toEqual({ balance: 995_000, applied: true });

    // Same idempotency key again → no-op (no double debit).
    const again = await db.transaction((tx) => wallet.adjustWalletTx(tx, U, -5000, 'table_buy_in', `buyin:m1:${U}`));
    expect(again).toEqual({ balance: 995_000, applied: false });

    // A debit larger than the balance throws and rolls back (balance unchanged, never < 0).
    await expect(db.transaction((tx) => wallet.adjustWalletTx(tx, U, -10_000_000, 'table_buy_in', `buyin:big:${U}`)))
      .rejects.toBeInstanceOf(wallet.InsufficientChipsError);
    expect((await wallet.getWalletView(U, DAY)).balance).toBe(995_000);

    // A payout credit is applied once.
    const pay = await db.transaction((tx) => wallet.adjustWalletTx(tx, U, 8000, 'table_payout', `payout:m1:${U}`, { matchId: 'm1' }));
    expect(pay).toEqual({ balance: 1_003_000, applied: true });

    await conn!.sql`DELETE FROM users WHERE id = ${U}`;
  });
});
