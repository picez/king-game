import { describe, it, expect } from 'vitest';
import type { ServerRoom, ServerMember } from './serverCore';

// Optional integration test for the Stage 37.7 bankroll escrow lifecycle.
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres (through 0010).
// Verifies the ATOMIC all-or-nothing buy-in debit, idempotent duplicate START, the
// payout-conservation credit, the cancellation refund, and payout/refund mutual
// exclusion. Repos + escrow are imported DYNAMICALLY so normal runs never load pg.

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
