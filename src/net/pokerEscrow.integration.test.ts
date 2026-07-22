import { describe, it, expect } from 'vitest';
import type { ServerRoom, ServerMember } from './serverCore';

// Optional integration test for the Stage 37.7 / 37.7.1 bankroll escrow lifecycle.
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres (through 0011).
// Verifies the ATOMIC all-or-nothing buy-in debit, idempotent duplicate START, the
// payout-conservation credit, the cancellation refund, the DB-authoritative payout/refund
// mutual exclusion, rematch (new match), and crash reconciliation. Repos + escrow are
// imported DYNAMICALLY so normal runs never load pg.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));

function member(over: Partial<ServerMember>): ServerMember {
  return {
    clientId: over.clientId ?? 'c', reconnectToken: 't', name: over.name ?? 'P',
    role: 'player', seatIndex: over.seatIndex ?? 0, isHost: false, connected: true,
    type: over.type ?? 'human', avatar: '🙂', userId: over.userId ?? null,
  } as ServerMember;
}
function room(members: ServerMember[], buyIn = 5000): ServerRoom {
  return { code: 'ESC1', gameType: 'poker', pokerBuyIn: buyIn, members: new Map(members.map((m) => [m.clientId, m])) } as unknown as ServerRoom;
}

describe.skipIf(!TEST_DATABASE_URL)('poker bankroll escrow (integration)', () => {
  it('debits atomically, is duplicate-safe, pays out conserving the escrow', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const A = await users.createAccountUser({ email: null, name: 'EscA', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'EscB', emailVerified: false });
    await wallet.dailyClaim(A, DAY); // 1,000,000
    await wallet.dailyClaim(B, DAY);

    const r = room([member({ clientId: 'a', seatIndex: 0, userId: A }), member({ clientId: 'b', seatIndex: 1, userId: B })], 5000);

    // Atomic debit of both seats.
    expect(await escrow.debitBuyIns(r)).toEqual({ ok: true });
    expect(r.pokerEscrow?.status).toBe('funded');
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(995_000);
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(995_000);

    // Duplicate START is a no-op (no second debit).
    expect(await escrow.debitBuyIns(r)).toEqual({ ok: true });
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(995_000);

    // Payout the final stacks: A busts (0), B wins the whole escrow (10000). Conserves.
    const state = { stacksBySeat: [0, 10000] } as import('../../src/games/poker/types').PokerState;
    await escrow.payoutStacks(r, state);
    expect(r.pokerEscrow?.status).toBe('settled');
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(995_000);        // busted → no credit
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(1_005_000);      // +10000 (=2×buy-in)

    // A refund after a settled match is a no-op (mutual exclusion).
    expect(await escrow.refundBuyIns(r)).toBe(true);
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(995_000);

    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('refunds every buy-in when a funded match is cancelled (and is idempotent)', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const A = await users.createAccountUser({ email: null, name: 'RefA', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'RefB', emailVerified: false });
    await wallet.dailyClaim(A, DAY);
    await wallet.dailyClaim(B, DAY);
    const r = room([member({ clientId: 'a', seatIndex: 0, userId: A }), member({ clientId: 'b', seatIndex: 1, userId: B })], 5000);
    await escrow.debitBuyIns(r);

    // Cancellation refunds both buy-ins.
    expect(await escrow.refundBuyIns(r)).toBe(true);
    expect(r.pokerEscrow?.status).toBe('cancelled');
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(1_000_000);
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(1_000_000);

    // A payout after a cancelled match is a no-op (mutual exclusion).
    const state = { stacksBySeat: [0, 10000] } as import('../../src/games/poker/types').PokerState;
    await escrow.payoutStacks(r, state);
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(1_000_000); // NOT paid

    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('rejects an insufficient-balance table and debits NOBODY', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const A = await users.createAccountUser({ email: null, name: 'PoorA', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'RichB', emailVerified: false });
    await wallet.dailyClaim(B, DAY); // only B has chips; A has 0
    const r = room([member({ clientId: 'a', seatIndex: 0, userId: A }), member({ clientId: 'b', seatIndex: 1, userId: B })], 5000);

    const res = await escrow.debitBuyIns(r);
    expect(res.ok).toBe(false);
    // All-or-nothing: B (who had enough) was NOT debited because A failed.
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(1_000_000);
    expect(r.pokerEscrow).toBeUndefined();

    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });
});

describe.skipIf(!TEST_DATABASE_URL)('poker bankroll hardening (Stage 37.7.1, integration)', () => {
  async function twoFunded(name: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const A = await users.createAccountUser({ email: null, name: `${name}A`, emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: `${name}B`, emailVerified: false });
    await wallet.dailyClaim(A, DAY); await wallet.dailyClaim(B, DAY);
    const r = room([member({ clientId: 'a', seatIndex: 0, userId: A }), member({ clientId: 'b', seatIndex: 1, userId: B })], 5000);
    expect(await escrow.debitBuyIns(r)).toEqual({ ok: true });
    return { wallet, escrow, conn, A, B, r };
  }

  it('payout then refund attempt: refund is DB-gate blocked (no double credit)', async () => {
    const { wallet, escrow, conn, A, B, r } = await twoFunded('MutexP');
    await escrow.payoutStacks(r, { stacksBySeat: [0, 10000] } as import('../games/poker/types').PokerState);
    expect(r.pokerEscrow?.status).toBe('settled');
    // A refund AFTER payout resolves as "already paid" (returns true) and mutates nothing.
    expect(await escrow.refundBuyIns(r)).toBe(true);
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(995_000);      // busted, no refund
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(1_005_000);    // paid once only
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('refund then payout attempt: payout is DB-gate blocked (no minting)', async () => {
    const { wallet, escrow, conn, A, B, r } = await twoFunded('MutexR');
    expect(await escrow.refundBuyIns(r)).toBe(true);
    expect(r.pokerEscrow?.status).toBe('cancelled');
    await escrow.payoutStacks(r, { stacksBySeat: [0, 10000] } as import('../games/poker/types').PokerState);
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(1_000_000);    // refunded, not paid
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(1_000_000);    // refunded, not paid
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('rematch mints a NEW matchId and debits a fresh buy-in exactly once', async () => {
    const { wallet, escrow, conn, A, B, r } = await twoFunded('Rematch');
    const firstMatch = r.pokerEscrow!.matchId;
    await escrow.payoutStacks(r, { stacksBySeat: [10000, 0] } as import('../games/poker/types').PokerState);
    expect(r.pokerEscrow?.status).toBe('settled');
    // A stale (settled) escrow can NOT be reused by the initial-start path.
    expect((await escrow.debitBuyIns(r)).ok).toBe(false);
    // Rematch: fresh match id + one fresh debit.
    expect(await escrow.debitRematch(r)).toEqual({ ok: true });
    expect(r.pokerEscrow!.matchId).not.toBe(firstMatch);
    expect(r.pokerEscrow!.status).toBe('funded');
    // A: won 10000 (bal 1,005,000) then paid a new 5000 buy-in = 1,000,000.
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(1_000_000);
    // Duplicate debit of the new match → no second charge.
    expect(await escrow.debitBuyIns(r)).toEqual({ ok: true });
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(1_000_000);
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('rematch is refused when a participant cannot afford the new buy-in', async () => {
    const { wallet, escrow, conn, A, B, r } = await twoFunded('RematchPoor');
    // A wins nothing and busts; after settle A has 995,000. Drain A so a 5000 buy-in fails.
    await escrow.payoutStacks(r, { stacksBySeat: [0, 10000] } as import('../games/poker/types').PokerState);
    const { getDb } = await import('../../server/db/client');
    const db = (await getDb())!.db as import('drizzle-orm/postgres-js').PostgresJsDatabase;
    // Spend A down to 0 via a huge buy-in on a throwaway match.
    await db.transaction((tx) => wallet.adjustWalletTx(tx, A, -(995_000), 'table_buy_in', `buyin:drain:${A}`, {}));
    const before = (await wallet.getWalletView(B, DAY)).balance;
    expect((await escrow.debitRematch(r)).ok).toBe(false); // A can't afford
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(before); // B NOT charged
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('reconcileEscrow recovers a transient pending/settling escrow from the DB', async () => {
    const { escrow, conn, A, B, r } = await twoFunded('Reconcile');
    const matchId = r.pokerEscrow!.matchId;
    // A committed debit shown as 'pending' after a crash → reconciles to 'funded'.
    r.pokerEscrow!.status = 'pending';
    await escrow.reconcileEscrow(r);
    expect(r.pokerEscrow?.status).toBe('funded');
    // Now pay out, then simulate a crashed 'settling' → reconciles to 'settled' via settlement row.
    await escrow.payoutStacks(r, { stacksBySeat: [10000, 0] } as import('../games/poker/types').PokerState);
    r.pokerEscrow!.status = 'settling';
    await escrow.reconcileEscrow(r);
    expect(r.pokerEscrow?.status).toBe('settled');
    // A 'pending' escrow for a match with NO committed buy-ins → dropped (nothing charged).
    const r2 = room([member({ clientId: 'a', seatIndex: 0, userId: A }), member({ clientId: 'b', seatIndex: 1, userId: B })], 5000);
    r2.pokerEscrow = { matchId: 'never-debited', buyIn: 5000, status: 'pending', seats: [{ seat: 0, userId: A, amount: 5000 }, { seat: 1, userId: B, amount: 5000 }] };
    await escrow.reconcileEscrow(r2);
    expect(r2.pokerEscrow).toBeUndefined();
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('payout conservation mismatch fails closed (no wallet mutation, escrow stays funded)', async () => {
    const { wallet, escrow, conn, A, B, r } = await twoFunded('Conserve');
    // Σ final stacks (9999) != Σ buy-ins (10000) → refuse.
    await escrow.payoutStacks(r, { stacksBySeat: [9999, 0] } as import('../games/poker/types').PokerState);
    expect(r.pokerEscrow?.status).toBe('funded');                 // not settled
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(995_000); // unchanged (debited only)
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(995_000);
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });
});
