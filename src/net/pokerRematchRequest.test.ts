import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ServerRoom, ServerMember } from './serverCore';
import { handleRematchRequest, type RematchRequestDeps, type RematchSession } from '../../server/pokerRematch';

// Stage 37.7.8 FAIL 3: the REAL request-level REMATCH_READY / REMATCH_DECLINE handler
// (`handleRematchRequest`, which server/index.ts routes to) — authorization, one-vs-all readiness,
// decline, recovery-blocked, the per-room lock, and the no-double-restart guard. Mostly spy-driven
// (no DB); one real-PostgreSQL case verifies READY actually starts a new paid match.

function member(over: Partial<ServerMember>): ServerMember {
  return { clientId: over.clientId ?? 'c', reconnectToken: 't', name: over.name ?? 'P', role: over.role ?? 'player', seatIndex: over.seatIndex ?? 0, isHost: false, connected: true, type: over.type ?? 'human', avatar: '🙂', userId: over.userId ?? null } as ServerMember;
}
function room(members: ServerMember[]): ServerRoom {
  return { code: 'REQ1', gameType: 'poker', members: new Map(members.map((m) => [m.clientId, m])) } as unknown as ServerRoom;
}
function session(room: ServerRoom, clientId: string): RematchSession { return { value: { room, clientId } }; }

// Base deps: finished, not recovery-blocked, bankroll, everyone ready. Override per test.
function deps(over: Partial<RematchRequestDeps> = {}): RematchRequestDeps & Record<string, ReturnType<typeof vi.fn>> {
  const base = {
    isRoomFinished: vi.fn(() => true),
    pokerRecoveryBlocked: vi.fn(() => false),
    isBankrollRoom: vi.fn(() => true),
    broadcastRoom: vi.fn(),
    broadcastRematch: vi.fn(),
    markReady: vi.fn(),
    removeReady: vi.fn(),
    allHumansReady: vi.fn(() => true),
    withRoomLock: vi.fn(async (_c: string, fn: () => Promise<void>) => fn()),
    runRematch: vi.fn(async () => {}),
    restartNonBankroll: vi.fn(),
  };
  return { ...base, ...over } as RematchRequestDeps & Record<string, ReturnType<typeof vi.fn>>;
}

const TWO_HUMANS = () => room([member({ clientId: 'host', seatIndex: 0 }), member({ clientId: 'p2', seatIndex: 1 })]);

describe('FAIL 3 — request-level REMATCH readiness routing', () => {
  it('first human Ready (not all ready yet) → progress broadcast only, no lifecycle', () => {
    const r = TWO_HUMANS();
    const d = deps({ allHumansReady: vi.fn(() => false) });
    const out = handleRematchRequest(session(r, 'host'), false, d);
    expect(out).toBe('progress');
    expect(d.markReady).toHaveBeenCalledWith(r, 'host');
    expect(d.broadcastRematch).toHaveBeenCalledOnce();
    expect(d.runRematch).not.toHaveBeenCalled();
  });

  it('last human Ready → exactly one runRematch under the room lock', () => {
    const r = TWO_HUMANS();
    const d = deps();
    const out = handleRematchRequest(session(r, 'p2'), false, d);
    expect(out).toBe('restart_scheduled');
    expect(d.withRoomLock).toHaveBeenCalledOnce();
    expect(d.runRematch).toHaveBeenCalledOnce();
    expect(d.runRematch).toHaveBeenCalledWith(r);
  });

  it('a duplicate Ready after the game already restarted (not finished) → no-op, no second lifecycle', () => {
    const r = TWO_HUMANS();
    const d = deps({ isRoomFinished: vi.fn(() => false) });
    const out = handleRematchRequest(session(r, 'host'), false, d);
    expect(out).toBe('ignored');
    expect(d.runRematch).not.toHaveBeenCalled();
    expect(d.markReady).not.toHaveBeenCalled();
  });

  it('the no-double-restart guard: withRoomLock re-checks isRoomFinished before runRematch', async () => {
    const r = TWO_HUMANS();
    let finished = true;
    const d = deps({
      isRoomFinished: vi.fn(() => finished),
      // The lock body runs AFTER the game already restarted (finished flips to false).
      withRoomLock: vi.fn(async (_c: string, fn: () => Promise<void>) => { finished = false; await fn(); }),
    });
    handleRematchRequest(session(r, 'p2'), false, d);
    await Promise.resolve();
    expect(d.runRematch).not.toHaveBeenCalled(); // guarded inside the lock
  });

  it('Decline → readiness removed + progress broadcast, no lifecycle', () => {
    const r = TWO_HUMANS();
    const d = deps();
    const out = handleRematchRequest(session(r, 'host'), true, d);
    expect(out).toBe('declined');
    expect(d.removeReady).toHaveBeenCalledWith(r, 'host');
    expect(d.broadcastRematch).toHaveBeenCalledOnce();
    expect(d.runRematch).not.toHaveBeenCalled();
  });
});

describe('FAIL 3 — only a seated human may rematch', () => {
  it.each([
    ['a spectator', member({ clientId: 'spec', role: 'spectator' })],
    ['a bot seat', member({ clientId: 'bot', type: 'ai' })],
  ])('%s Ready is a no-op', (_label, m) => {
    const r = room([member({ clientId: 'host', seatIndex: 0 }), m]);
    const d = deps();
    const out = handleRematchRequest(session(r, m.clientId), false, d);
    expect(out).toBe('ignored');
    expect(d.markReady).not.toHaveBeenCalled();
    expect(d.runRematch).not.toHaveBeenCalled();
  });

  it('an unknown (non-member) client Ready is a no-op', () => {
    const r = TWO_HUMANS();
    const d = deps();
    const out = handleRematchRequest(session(r, 'ghost'), false, d);
    expect(out).toBe('ignored');
    expect(d.markReady).not.toHaveBeenCalled();
  });
});

describe('FAIL 3 — a recovery-blocked room broadcasts honestly and starts nothing', () => {
  it('payout_pending / frozen / settlement_pending → recovery snapshot, no readiness, no lifecycle', () => {
    const r = TWO_HUMANS();
    const d = deps({ pokerRecoveryBlocked: vi.fn(() => true) });
    const out = handleRematchRequest(session(r, 'host'), false, d);
    expect(out).toBe('recovery_broadcast');
    expect(d.broadcastRoom).toHaveBeenCalledOnce();
    expect(d.markReady).not.toHaveBeenCalled();  // no false progress
    expect(d.runRematch).not.toHaveBeenCalled();
  });
});

// A DEFERRED lock: withRoomLock captures the callback but does NOT run it until release() is called.
// This deterministically opens the TOCTOU window between "last Ready" and the lock body running.
function deferredLock() {
  let body: (() => Promise<void>) | null = null;
  const withRoomLock = vi.fn((_c: string, fn: () => Promise<void>) => new Promise<void>((res) => { body = async () => { await fn(); res(); }; }));
  return { withRoomLock, release: async () => { if (body) await body(); } };
}

describe('FAIL 3 — queued rematch re-validates consent/recovery/readiness UNDER the lock (TOCTOU)', () => {
  it('a DECLINE after the lock is queued → runRematch never runs; honest REMATCH_STATE broadcast', async () => {
    const r = TWO_HUMANS();
    const lock = deferredLock();
    let ready = true;
    const d = deps({ withRoomLock: lock.withRoomLock, allHumansReady: vi.fn(() => ready), removeReady: vi.fn(() => { ready = false; }) });
    expect(handleRematchRequest(session(r, 'p2'), false, d)).toBe('restart_scheduled'); // queued behind the busy lock
    // A player declines while the callback is still queued.
    handleRematchRequest(session(r, 'host'), true, d);
    expect(ready).toBe(false);
    await lock.release();
    expect(d.runRematch).not.toHaveBeenCalled();      // stale consent is NOT acted on
    expect(d.broadcastRematch).toHaveBeenCalled();     // honest progress broadcast instead
  });

  it('a DISCONNECT dropping allHumansReady before release → no runRematch/debit', async () => {
    const r = TWO_HUMANS();
    const lock = deferredLock();
    let ready = true;
    const d = deps({ withRoomLock: lock.withRoomLock, allHumansReady: vi.fn(() => ready) });
    expect(handleRematchRequest(session(r, 'p2'), false, d)).toBe('restart_scheduled');
    ready = false; // a human disconnected → readiness no longer complete
    await lock.release();
    expect(d.runRematch).not.toHaveBeenCalled();
    expect(d.broadcastRematch).toHaveBeenCalled();
  });

  it('the room becomes recovery-blocked before the lock body runs → no runRematch, room snapshot', async () => {
    const r = TWO_HUMANS();
    const lock = deferredLock();
    let blocked = false;
    const d = deps({ withRoomLock: lock.withRoomLock, pokerRecoveryBlocked: vi.fn(() => blocked) });
    expect(handleRematchRequest(session(r, 'p2'), false, d)).toBe('restart_scheduled');
    blocked = true; // e.g. a payout/stats-pending recovery arose while queued
    await lock.release();
    expect(d.runRematch).not.toHaveBeenCalled();
    expect(d.broadcastRoom).toHaveBeenCalled();
  });

  it('two queued last-Ready tasks → runRematch runs at most once (no double debit)', async () => {
    const r = TWO_HUMANS();
    let finished = true;
    const bodies: Array<() => Promise<void>> = [];
    const withRoomLock = vi.fn((_c: string, fn: () => Promise<void>) => new Promise<void>((res) => { bodies.push(async () => { await fn(); res(); }); }));
    const runRematch = vi.fn(async () => { finished = false; }); // a successful restart ends the finished state
    const d = deps({ withRoomLock, isRoomFinished: vi.fn(() => finished), runRematch });
    handleRematchRequest(session(r, 'p2'), false, d);
    handleRematchRequest(session(r, 'p2'), false, d); // a duplicate last-Ready races in
    for (const b of bodies) await b();
    expect(runRematch).toHaveBeenCalledOnce();          // second task sees !finished → no double debit
  });
});

// --- Real PostgreSQL: READY routes to a genuine new PAID match ---------------
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
const FINISHED = { phase: 'game_finished', stacksBySeat: [10000, 0], playerCount: 2 } as unknown as import('../games/poker/types').PokerState;

afterEach(async () => {
  const escrow = await import('../../server/pokerEscrow');
  escrow.__setRefundFailure(false); escrow.__setPayoutFailure(false);
});

describe.skipIf(!TEST_DATABASE_URL)('FAIL 3 — READY routes to a real new paid match (integration)', () => {
  it('all humans Ready → a fresh matchId with one debit per seat', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { runBankrollRematch } = await import('../../server/pokerRematch');
    const { createRoom, addMember } = await import('./serverCore');
    const { getDb } = await import('./../../server/db/client');
    const conn = await getDb();
    const U1 = await users.createAccountUser({ email: null, name: 'ReqA', emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: 'ReqB', emailVerified: false });
    await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
    const r = createRoom({ code: 'REQPG', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'host', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(r, { clientId: 'p2', reconnectToken: 't', name: 'B', userId: U2 });
    await escrow.debitBuyIns(r);
    const M0 = r.pokerEscrow!.matchId;
    r.started = true; r.gameState = FINISHED as unknown as typeof r.gameState;
    await escrow.payoutStacks(r, FINISHED);            // settle the previous match
    const afterPayout = (await wallet.getWalletView(U1, DAY)).balance;

    let restarted = false;
    const runRematch = (room: ServerRoom) => runBankrollRematch(room, {
      debitRematch: escrow.debitRematch, refundBuyIns: escrow.refundBuyIns,
      restartGame: (rm) => { rm.started = true; rm.gameState = { phase: 'betting', stacksBySeat: [4950, 4950], playerCount: 2 } as unknown as typeof rm.gameState; restarted = true; return { ok: true }; },
      clearRematch: () => {}, broadcastRematch: () => {}, broadcastRoom: () => {}, advance: () => {}, persist: () => {}, forgetFinish: () => {}, logDeal: () => {},
    });
    const { withRoomLock } = escrow;
    handleRematchRequest({ value: { room: r, clientId: 'p2' } }, false, {
      isRoomFinished: () => !restarted, pokerRecoveryBlocked: escrow.pokerRecoveryBlocked, isBankrollRoom: escrow.isBankrollRoom,
      broadcastRoom: () => {}, broadcastRematch: () => {}, markReady: () => {}, removeReady: () => {},
      allHumansReady: () => true, withRoomLock, runRematch, restartNonBankroll: () => {},
    });
    // Let the async lock body run — wait until the fresh debit COMMITS (status funded), not merely
    // until the matchId is minted (which happens before the DB transaction commits).
    for (let i = 0; i < 100 && !(r.pokerEscrow!.matchId !== M0 && r.pokerEscrow!.status === 'funded'); i++) await new Promise((res) => setTimeout(res, 20));

    expect(r.pokerEscrow!.matchId).not.toBe(M0);         // a brand-new paid match
    expect(r.pokerEscrow!.status).toBe('funded');
    expect((await wallet.getWalletView(U1, DAY)).balance).toBe(afterPayout - 5000); // one fresh debit
    const M1 = r.pokerEscrow!.matchId;
    const n = await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M1} AND reason = 'table_buy_in'`;
    expect((n as Array<{ n: number }>)[0].n).toBe(2);
    await conn!.sql`DELETE FROM poker_matches WHERE match_id IN (${M0}, ${M1})`;
    await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });
});
