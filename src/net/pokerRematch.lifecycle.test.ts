import { describe, it, expect, vi } from 'vitest';
import type { ServerRoom, ServerMember } from './serverCore';
import type { PokerState } from '../games/poker/types';

// Stage 37.7.7 FAIL 2 (integration, real Postgres): the REAL bankroll rematch lifecycle helper
// `runBankrollRematch` — debit a fresh match → restart → refund-on-failure → broadcast — driven
// with the actual escrow functions (debitRematch / refundBuyIns) against Postgres and injected
// restart/broadcast deps, so the handler path is verified WITHOUT booting the WS server.
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres (through 0012).

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
const FINISHED = { phase: 'game_finished', stacksBySeat: [10000, 0], playerCount: 2 } as unknown as PokerState;
const LIVE = { phase: 'betting', stacksBySeat: [4950, 4950], playerCount: 2 } as unknown as PokerState;

function member(over: Partial<ServerMember>): ServerMember {
  return {
    clientId: over.clientId ?? 'c', reconnectToken: 't', name: over.name ?? 'P',
    role: 'player', seatIndex: over.seatIndex ?? 0, isHost: false, connected: true,
    type: over.type ?? 'human', avatar: '🙂', userId: over.userId ?? null,
  } as ServerMember;
}
function room(members: ServerMember[], buyIn = 5000): ServerRoom {
  return { code: 'RM1', gameType: 'poker', pokerBuyIn: buyIn, started: true, members: new Map(members.map((m) => [m.clientId, m])) } as unknown as ServerRoom;
}
function spyDeps(over: Partial<import('../../server/pokerRematch').BankrollRematchDeps> = {}) {
  return {
    clearRematch: vi.fn(), broadcastRematch: vi.fn(), broadcastRoom: vi.fn(),
    advance: vi.fn(), persist: vi.fn(), forgetFinish: vi.fn(), logDeal: vi.fn(),
    ...over,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('runBankrollRematch lifecycle (Stage 37.7.7, integration)', () => {
  it('success: previous match settled → fresh matchId, ONE new debit each, restart + broadcast/advance/persist', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { runBankrollRematch } = await import('../../server/pokerRematch');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const A = await users.createAccountUser({ email: null, name: 'RmokA', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'RmokB', emailVerified: false });
    await wallet.dailyClaim(A, DAY); await wallet.dailyClaim(B, DAY);
    const r = room([member({ clientId: 'a', seatIndex: 0, userId: A }), member({ clientId: 'b', seatIndex: 1, userId: B })], 5000);

    // Play + settle the previous match (escrow → settled).
    await escrow.debitBuyIns(r);
    const M0 = r.pokerEscrow!.matchId;
    r.gameState = FINISHED as unknown as typeof r.gameState;
    expect(await escrow.payoutStacks(r, FINISHED)).toBe('paid');
    const afterPayoutA = (await wallet.getWalletView(A, DAY)).balance; // 1,005,000

    // Restart stub: mints a fresh LIVE game and succeeds.
    const restartGame = vi.fn((rm: ServerRoom) => { rm.started = true; rm.gameState = LIVE as unknown as typeof rm.gameState; return { ok: true }; });
    const deps = spyDeps({ debitRematch: escrow.debitRematch, refundBuyIns: escrow.refundBuyIns, restartGame });
    const outcome = await runBankrollRematch(r, deps);

    expect(outcome).toBe('restarted');
    expect(r.pokerEscrow!.matchId).not.toBe(M0);          // brand-new match
    expect(r.pokerEscrow!.status).toBe('funded');
    expect(r.pokerMatchCancelled).toBeUndefined();
    // Exactly ONE fresh debit per player over the settled match.
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(afterPayoutA - 5000);
    expect(restartGame).toHaveBeenCalledOnce();
    expect(deps.forgetFinish).toHaveBeenCalledOnce();
    expect(deps.clearRematch).toHaveBeenCalled();
    expect(deps.logDeal).toHaveBeenCalledOnce();
    expect(deps.broadcastRoom).toHaveBeenCalledOnce();
    expect(deps.advance).toHaveBeenCalledOnce();
    expect(deps.persist).toHaveBeenCalledOnce();
    const M1 = r.pokerEscrow!.matchId;
    const buyins = await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M1} AND reason = 'table_buy_in'`;
    expect((buyins as Array<{ n: number }>)[0].n).toBe(2); // one per seat, no double

    // DEDUP: a duplicate rematch over the now-FUNDED (live) escrow is rejected — no second debit.
    const balAfter = (await wallet.getWalletView(A, DAY)).balance;
    const dup = await runBankrollRematch(r, spyDeps({ debitRematch: escrow.debitRematch, refundBuyIns: escrow.refundBuyIns, restartGame: vi.fn(() => ({ ok: true })) }));
    expect(dup).toBe('debit_rejected');
    expect(r.pokerEscrow!.matchId).toBe(M1);
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(balAfter);

    await conn!.sql`DELETE FROM poker_matches WHERE match_id IN (${M0}, ${M1})`;
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('debit rejected: previous match NOT settled → no restart, no charge, honest broadcast', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { runBankrollRematch } = await import('../../server/pokerRematch');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const A = await users.createAccountUser({ email: null, name: 'RmrjA', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'RmrjB', emailVerified: false });
    await wallet.dailyClaim(A, DAY); await wallet.dailyClaim(B, DAY);
    const r = room([member({ clientId: 'a', seatIndex: 0, userId: A }), member({ clientId: 'b', seatIndex: 1, userId: B })], 5000);

    // Previous match is FUNDED + finished (payout NOT yet done) → debitRematch must refuse.
    await escrow.debitBuyIns(r);
    const M0 = r.pokerEscrow!.matchId;
    r.gameState = FINISHED as unknown as typeof r.gameState;
    const restartGame = vi.fn(() => ({ ok: true }));
    const deps = spyDeps({ debitRematch: escrow.debitRematch, refundBuyIns: escrow.refundBuyIns, restartGame });
    const outcome = await runBankrollRematch(r, deps);

    expect(outcome).toBe('debit_rejected');
    expect(restartGame).not.toHaveBeenCalled();            // never restarts
    expect(r.pokerEscrow!.matchId).toBe(M0);               // no new match
    expect(r.pokerEscrow!.status).toBe('funded');
    expect(deps.clearRematch).toHaveBeenCalled();
    expect(deps.broadcastRematch).toHaveBeenCalledOnce();
    expect(deps.broadcastRoom).toHaveBeenCalledOnce();     // honest recovery snapshot, not a silent reset
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(995_000); // only the original buy-in

    await conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M0}`;
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });

  it('debit ok → restart FAILS → refund FAILS: settlement_pending (not falsely cancelled); retry allows a fresh start', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { runBankrollRematch } = await import('../../server/pokerRematch');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const A = await users.createAccountUser({ email: null, name: 'RmfailA', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'RmfailB', emailVerified: false });
    await wallet.dailyClaim(A, DAY); await wallet.dailyClaim(B, DAY);
    const r = room([member({ clientId: 'a', seatIndex: 0, userId: A }), member({ clientId: 'b', seatIndex: 1, userId: B })], 5000);

    // Settle the previous match so the rematch debit is allowed.
    await escrow.debitBuyIns(r);
    const M0 = r.pokerEscrow!.matchId;
    r.gameState = FINISHED as unknown as typeof r.gameState;
    await escrow.payoutStacks(r, FINISHED);

    // Rematch debit commits, but the restart fails AND the refund cannot be confirmed (injected).
    escrow.__setRefundFailure(true);
    const restartGame = vi.fn(() => ({ ok: false }));
    const deps = spyDeps({ debitRematch: escrow.debitRematch, refundBuyIns: escrow.refundBuyIns, restartGame });
    const outcome = await runBankrollRematch(r, deps);

    expect(outcome).toBe('settlement_pending');
    expect(r.pokerMatchCancelled).toBeFalsy();             // NOT a false cancelled/refunded
    expect(r.pokerEscrow!.status).toBe('funded');          // funded + retryable
    expect(r.gameState).toBeNull();
    const Mr = r.pokerEscrow!.matchId;
    expect(escrow.settlementPending(r)).toBe(true);        // funded + no game → refund-pending
    expect(deps.broadcastRoom).toHaveBeenCalledOnce();     // honest public snapshot

    // The transient failure clears → the refund resolves; a fresh START mints a DIFFERENT matchId.
    escrow.__setRefundFailure(false);
    expect(await escrow.refundBuyIns(r)).toBe(true);
    expect(r.pokerEscrow!.status).toBe('cancelled');
    const fresh = await escrow.debitFreshStart(r);
    expect(fresh).toEqual({ ok: true });
    expect(r.pokerEscrow!.matchId).not.toBe(Mr);

    escrow.__setRefundFailure(false);
    await conn!.sql`DELETE FROM poker_matches WHERE match_id IN (${M0}, ${Mr}, ${r.pokerEscrow!.matchId})`;
    await conn!.sql`DELETE FROM users WHERE id IN (${A}, ${B})`;
  });
});
