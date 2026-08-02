import { describe, it, expect, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';
import type { ClientMessage, ErrorCode } from './messages';

// Stage 37.7.10 FAIL 1 + Stage 37.7.11 FAIL 1 (integration, real Postgres). These drive the REAL
// production restart-recovery entry points — `shouldDeferBootstrapAdvance` (the restore loop's
// advance decision) and `recoverRestoredBankrollRoom` (reconcile → classify → apply) — the same
// functions `server/index.ts` calls. (37.7.10's version re-created that branching locally, which is
// exactly why it never noticed that the restore loop had ALREADY armed the advance for an
// already-settled room, nor that `settled` + UNFINISHED was classified `live`.)
//
// Guarantees under test: a restored PAID finish keeps its result and records stats exactly once
// without re-paying; a refunded match becomes a cancelled lobby with no stats; and an INCOHERENT
// paid state (money out, no finished state) fails CLOSED into a permanent frozen room that never
// advances, never pays/refunds again, and is never purged.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
function P(seat: number): PokerPlayer { return { id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' }; }
function tel2(): PokerTelemetry { return { handsPlayedBySeat: [8, 8], handsWonBySeat: [3, 5], showdownsWonBySeat: [1, 3], potsWonBySeat: [3, 6], biggestPotBySeat: [400, 900], allInsWonBySeat: [0, 1], royalFlushBySeat: [0, 0] }; }
function base2p(): PokerState {
  const f = () => [false, false];
  return { gameType: 'poker', phase: 'game_finished', playerCount: 2, players: [P(0), P(1)], options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 }, buttonSeat: 0, handNumber: 8, street: 'river', stacksBySeat: [0, 10000], holeCardsBySeat: [[], []], board: [], deck: [], burned: [], committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(), wasAllInBySeat: f(), actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: [true, false], currentBet: 0, minRaise: 50, toActSeat: 1, revealedBySeat: f(), lastHand: null, winnerSeat: 1, actionLog: [], telemetry: tel2() } as unknown as PokerState;
}
function finished2p(): PokerState { return base2p(); }
/** The SAME match mid-hand — what a room JSON persisted before the finish landed looks like. */
function unfinished2p(): PokerState {
  return { ...base2p(), phase: 'betting', street: 'flop', stacksBySeat: [4000, 6000], winnerSeat: null, eliminatedBySeat: [false, false] } as unknown as PokerState;
}

afterEach(async () => {
  const escrow = await import('../../server/pokerEscrow');
  escrow.__setRefundFailure(false); escrow.__setPayoutFailure(false);
});


// Poker DB integration files share one Postgres and the orphan scan is cluster-wide —
// serialize them on the shared advisory lock (see pokerDbSuite.testutil).
withPokerDbSuiteLock(beforeAll, afterAll);

describe.skipIf(!TEST_DATABASE_URL)('production bootstrap recovery of a restored bankroll room (Stage 37.7.10/37.7.11 FAIL 1)', () => {
  async function ctx() {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { recoverRestoredBankrollRoom, shouldDeferBootstrapAdvance } = await import('../../server/pokerBootstrap');
    const { bindGameToEscrow } = await import('../../server/pokerBinding');
    const { recordConfirmedPokerStats, settleRoomForDeletion, settleAndRecordBankrollPokerFinish } = await import('../../server/pokerFinish');
    const { createRoom, addMember, serializeRoom, deserializeRoom, snapshot } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const isFin = (s: PokerState) => s.phase === 'game_finished';

    // The production-shaped side effects, spied so the test can assert what recovery DID.
    const advance = vi.fn();
    const clearTimers = vi.fn();
    const persist = vi.fn();
    const frozenLog: string[] = [];
    const freeze = (r: ServerRoom, reason: string) => { if (!r.pokerFrozen) { r.pokerFrozen = true; frozenLog.push(`${r.code} — ${reason}`); } };

    /**
     * The production bootstrap sequence for ONE restored room: the restore loop's advance decision
     * followed by the recovery orchestration — both from server/pokerBootstrap.ts, unmodified.
     */
    async function bootstrapRestore(room: ServerRoom) {
      if (!shouldDeferBootstrapAdvance(room)) advance(room); // restore loop: `if (!shouldDefer…) rescheduleAdvance(room)`
      const recovery = await recoverRestoredBankrollRoom(room, {
        reconcileEscrow: escrow.reconcileEscrow, isFinished: isFin,
        rescheduleAdvance: advance, persist, clearTimers, freeze, refundBuyIns: escrow.refundBuyInsResult,
      });
      return recovery;
    }

    const marker = new Map<string, string>();
    const statsDeps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); },
      record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });
    /** The production stats-pending sweep branch (index.ts `retryPendingSettlements`). */
    async function sweepStats(room: ServerRoom) {
      if (!escrow.statsPending(room)) return null; // frozen / resolved rooms are skipped
      const s = await recordConfirmedPokerStats(room, room.gameState as PokerState, statsDeps());
      if (s === 'invalid') { freeze(room, 'paid match participants invalid'); return s; }
      if (s !== 'failed') room.pokerStatsPending = undefined;
      return s;
    }
    /** The production payout-pending sweep branch. */
    const sweepPayout = (room: ServerRoom) => settleAndRecordBankrollPokerFinish(room, room.gameState as PokerState, {
      payoutStacks: escrow.payoutStacks, persist, broadcast: () => {}, clearRematch: () => {}, freeze,
      recordStats: (r, s) => recordConfirmedPokerStats(r, s, statsDeps()),
    });
    const teardown = (room: ServerRoom) => settleRoomForDeletion(room, {
      reconcileEscrow: escrow.reconcileEscrow, hasUnsettledEscrow: escrow.hasUnsettledEscrow, isFinished: isFin,
      settleAndRecord: (r, s) => settleAndRecordBankrollPokerFinish(r, s, {
        payoutStacks: escrow.payoutStacks, persist, broadcast: () => {}, clearRematch: () => {}, freeze,
        recordStats: (rm, st) => recordConfirmedPokerStats(rm, st, statsDeps()),
      }),
      refundBuyIns: escrow.refundBuyInsResult, persist, freeze, clearTimers,
    });

    async function bankrollRoom(code: string, state: PokerState) {
      const U1 = await users.createAccountUser({ email: null, name: `${code}A`, emailVerified: false });
      const U2 = await users.createAccountUser({ email: null, name: `${code}B`, emailVerified: false });
      await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
      const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
      addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
      room.started = true; room.gameState = state as unknown as typeof room.gameState;
      await escrow.debitBuyIns(room);
      bindGameToEscrow(room); // (37.7.12) as a successful START does
      return { room, U1, U2, M: room.pokerEscrow!.matchId };
    }
    const gameRows = async (code: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${code}`) as Array<{ n: number }>)[0].n;
    const payoutRows = async (M: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = 'table_payout'`) as Array<{ n: number }>)[0].n;
    const refundRows = async (M: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = 'table_cancel_refund'`) as Array<{ n: number }>)[0].n;
    const cleanup = async (code: string, M: string, ids: string[]) => {
      await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${code})`;
      await conn!.sql`DELETE FROM games WHERE room_code = ${code}`;
      await conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN ${conn!.sql(ids)}`;
      await conn!.sql`DELETE FROM users WHERE id IN ${conn!.sql(ids)}`;
    };
    return { escrow, wallet, conn, snapshot, serializeRoom, deserializeRoom, bootstrapRestore, sweepStats, sweepPayout, teardown, bankrollRoom, gameRows, payoutRows, refundRows, cleanup, advance, clearTimers, frozenLog };
  }

  it('persisted SETTLED + finished → paid_finish (not cancelled); stats recorded once, no re-payout, no advance', async () => {
    const t = await ctx();
    const { room, U1, M } = await t.bankrollRoom('BOOT1', finished2p());
    expect(await t.escrow.payoutStacks(room, finished2p())).toBe('paid'); // durable payout, escrow settled
    room.pokerStatsPending = true; // the finish set it; crash before stats were recorded
    const paidBalU1 = (await t.wallet.getWalletView(U1, DAY)).balance;

    // RESTART: serialize → deserialize → the production restore/recovery path + the stats sweep.
    const restored = t.deserializeRoom(t.serializeRoom(room))!;
    expect(await t.bootstrapRestore(restored)).toBe('paid_finish');
    expect(t.advance).not.toHaveBeenCalled();          // no timer/advance for a paid finish
    expect(restored.gameState).not.toBeNull();          // finished state kept
    expect(restored.pokerMatchCancelled).toBeUndefined();
    expect(restored.pokerFrozen).toBeUndefined();
    expect(restored.pokerEscrow!.status).toBe('settled');
    expect(restored.pokerStatsPending).toBe(true);      // recovery marked the stats as owed
    expect(await t.sweepStats(restored)).toBe('recorded');
    expect(restored.pokerStatsPending).toBeUndefined(); // resolved → rematch available
    expect(t.escrow.pokerRecoveryBlocked(restored)).toBe(false);
    expect(await t.gameRows('BOOT1')).toBe(1);
    expect(await t.payoutRows(M)).toBe(1);
    expect((await t.wallet.getWalletView(U1, DAY)).balance).toBe(paidBalU1); // payout NOT repeated

    // Idempotent across a further restart (fresh in-memory marker → the durable game_key guards).
    restored.pokerStatsPending = true;
    expect(['recorded', 'already_exists']).toContain(await t.sweepStats(restored));
    expect(await t.gameRows('BOOT1')).toBe(1);
    await t.cleanup('BOOT1', M, [U1, room.pokerEscrow!.seats[1].userId]);
  });

  it('crash-window: persisted SETTLING + durable payout committed → reconcile→settled → paid_finish, stats once, no re-payout', async () => {
    const t = await ctx();
    const { room, U1, U2, M } = await t.bankrollRoom('BOOT2', finished2p());
    await t.escrow.payoutStacks(room, finished2p());
    const paidBalU1 = (await t.wallet.getWalletView(U1, DAY)).balance;
    const restored = t.deserializeRoom(t.serializeRoom(room))!;
    restored.pokerEscrow!.status = 'settling';  // room JSON persisted MID-SETTLE
    restored.pokerStatsPending = undefined;      // the flag was lost in the same crash window

    expect(await t.bootstrapRestore(restored)).toBe('paid_finish');
    expect(restored.pokerEscrow!.status).toBe('settled'); // reconciled from the durable settlement
    expect(t.advance).not.toHaveBeenCalled();
    expect(restored.gameState).not.toBeNull();
    expect(await t.sweepStats(restored)).toBe('recorded');
    expect(await t.gameRows('BOOT2')).toBe(1);
    expect(await t.payoutRows(M)).toBe(1);
    expect((await t.wallet.getWalletView(U1, DAY)).balance).toBe(paidBalU1);
    await t.cleanup('BOOT2', M, [U1, U2]);
  });

  it('stale FUNDED room JSON but the durable payout already committed (finished) → payout_pending → idempotent payout + stats once', async () => {
    const t = await ctx();
    const { room, U1, U2, M } = await t.bankrollRoom('BOOT4', finished2p());
    await t.escrow.payoutStacks(room, finished2p());     // durable payout committed
    const paidBalU1 = (await t.wallet.getWalletView(U1, DAY)).balance;
    const restored = t.deserializeRoom(t.serializeRoom(room))!;
    restored.pokerEscrow!.status = 'funded';             // stale room JSON (persisted pre-settle)

    expect(await t.bootstrapRestore(restored)).toBe('payout_pending');
    expect(t.advance).not.toHaveBeenCalled();            // a finished match never re-arms the advance
    expect(restored.gameState).not.toBeNull();
    // The payout-pending sweep re-runs the settlement: the DB gate makes it idempotent.
    const out = await t.sweepPayout(restored);
    expect(['paid', 'already_paid']).toContain(out.result);
    expect(out.stats).toBe('recorded');
    expect(await t.payoutRows(M)).toBe(1);               // NEVER paid twice
    expect(await t.gameRows('BOOT4')).toBe(1);
    expect((await t.wallet.getWalletView(U1, DAY)).balance).toBe(paidBalU1);
    await t.cleanup('BOOT4', M, [U1, U2]);
  });

  it('refunded/cancelled settlement → cancelled lobby, NEVER writes stats', async () => {
    const t = await ctx();
    const { room, U1, U2, M } = await t.bankrollRoom('BOOT3', finished2p());
    await t.escrow.refundBuyInsResult(room); // escrow → cancelled
    const restored = t.deserializeRoom(t.serializeRoom(room))!;
    expect(await t.bootstrapRestore(restored)).toBe('cancelled');
    expect(restored.gameState).toBeNull();
    expect(restored.pokerMatchCancelled).toBe(true);
    expect(restored.pokerStatsPending).toBeFalsy();
    expect(restored.pokerFrozen).toBeUndefined();
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.sweepStats(restored)).toBeNull();
    expect(await t.gameRows('BOOT3')).toBe(0);
    expect(await t.payoutRows(M)).toBe(0);
    await t.cleanup('BOOT3', M, [U1, U2]);
  });

  it('(37.7.11 FAIL 1) settled + UNFINISHED → permanently FROZEN: no advance, no re-settlement, no purge, no stats', async () => {
    const t = await ctx();
    // A real paid match: debit, then the durable payout commits… but the room JSON still holds the
    // pre-finish state and a `settling` escrow (the crash window).
    const { room, U1, U2, M } = await t.bankrollRoom('BOOT5', finished2p());
    expect(await t.escrow.payoutStacks(room, finished2p())).toBe('paid');
    const balU1 = (await t.wallet.getWalletView(U1, DAY)).balance;
    const balU2 = (await t.wallet.getWalletView(U2, DAY)).balance;
    room.gameState = unfinished2p() as unknown as typeof room.gameState; // stale persisted state
    const restored = t.deserializeRoom(t.serializeRoom(room))!;
    restored.pokerEscrow!.status = 'settling';
    expect(t.escrow.hasUnsettledEscrow(restored)).toBe(true); // before reconcile

    const recovery = await t.bootstrapRestore(restored);
    expect(recovery).toBe('incoherent_paid');
    expect(restored.pokerEscrow!.status).toBe('settled');  // reconciled to the durable payout
    // 1) Never resumed: no advance was armed anywhere in the bootstrap, and timers were cleared.
    expect(t.advance).not.toHaveBeenCalled();
    expect(t.clearTimers).toHaveBeenCalledOnce();
    // 2) Permanent operator state — frozen, NOT a cancelled lobby, evidence kept.
    expect(restored.pokerFrozen).toBe(true);
    expect(restored.pokerMatchCancelled).toBeUndefined();
    expect(restored.gameState).not.toBeNull();
    expect(t.frozenLog).toEqual([`BOOT5 — paid match with no finished state`]); // logged ONCE, safe reason
    // 3) Blocked everywhere: gameplay/rematch refused, sweeps skip it, deletion keeps it.
    expect(t.escrow.pokerRecoveryBlocked(restored)).toBe(true);
    expect(t.escrow.payoutPending(restored)).toBe(false);
    expect(t.escrow.settlementPending(restored)).toBe(false);
    expect(t.escrow.statsPending(restored)).toBe(false);   // the stats sweep never touches it
    expect(t.escrow.hasUnsettledEscrow(restored)).toBe(true); // blocks purge
    expect(await t.sweepStats(restored)).toBeNull();
    expect(await t.teardown(restored)).toBe('keep');       // teardown must NOT purge a paid room
    // 4) No money moved again, no stats written.
    expect(await t.payoutRows(M)).toBe(1);
    expect(await t.refundRows(M)).toBe(0);
    expect((await t.wallet.getWalletView(U1, DAY)).balance).toBe(balU1);
    expect((await t.wallet.getWalletView(U2, DAY)).balance).toBe(balU2);
    expect(await t.gameRows('BOOT5')).toBe(0);
    // 5) The freeze survives a further restart, and a re-run of recovery stays frozen (no re-log).
    const again = t.deserializeRoom(t.serializeRoom(restored))!;
    expect(again.pokerFrozen).toBe(true);
    expect(await t.bootstrapRestore(again)).toBe('frozen');
    expect(t.advance).not.toHaveBeenCalled();
    expect(t.frozenLog).toHaveLength(1);
    // 6) The public snapshot exposes ONLY `frozen` — no matchId, userId, seats or stacks.
    const snap = JSON.stringify(t.snapshot(again));
    expect(JSON.parse(snap).pokerRecovery).toBe('frozen');
    expect(snap).not.toContain(M);
    expect(snap).not.toContain(U1);
    expect(snap).not.toContain(U2);
    expect(snap).not.toContain('escrow');
    // 7) The real WS handlers refuse gameplay on it.
    const { handleClientMessage } = await import('../../server/wsHandlers');
    const { RoomSocialStore } = await import('../../server/roomSocial');
    const { ConnectionLimiter, DEFAULT_RATE_LIMITS } = await import('./rateLimit');
    const errors: ErrorCode[] = [];
    const wsCtx = {
      rooms: new Map([[again.code, again]]), sockets: new Map(), social: new RoomSocialStore(),
      send: () => {}, sendError: (_s: never, code: ErrorCode) => { errors.push(code); },
      broadcastRoom: () => {}, broadcastToRoom: () => {}, broadcastAndAdvance: () => {},
      sendChatHistory: () => {}, persistRoom: () => {}, welcome: () => {}, handleLeave: () => {},
      makeRoomCode: () => 'X', logRoomEvent: () => {}, logLatestDeal: () => {},
    } as unknown as import('../../server/wsHandlers').WsContext;
    const sessionRef = { value: { room: again, clientId: 'a' } };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
    const run = (msg: ClientMessage) => handleClientMessage(wsCtx, {} as never, sessionRef, () => {}, msg, limiter, () => U1, async () => U1);
    run({ t: 'START_GAME' } as ClientMessage);
    run({ t: 'ACTION_REQUEST', action: { type: 'POKER_FOLD', seat: 0 } } as unknown as ClientMessage);
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).toEqual(['ILLEGAL_ACTION', 'ILLEGAL_ACTION']);
    expect(await t.payoutRows(M)).toBe(1);
    expect(await t.refundRows(M)).toBe(0);

    await t.cleanup('BOOT5', M, [U1, U2]);
  });
});
