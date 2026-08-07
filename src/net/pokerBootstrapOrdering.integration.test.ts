import { describe, it, expect, afterEach, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';
import type { ClientMessage, ErrorCode } from './messages';
import { scopedOrphanScan, withPokerDbSuiteLock, withAntiDumpPolicyDisabled } from './pokerDbSuite.testutil';

// (38.0.8) A settlement/recovery suite: the anti-dumping policy is not what it tests,
// and its 15-minute pair cooldown would refuse the back-to-back paid matches it needs.
withAntiDumpPolicyDisabled(beforeEach, afterEach);

// Stage 37.7.13 (integration, real Postgres). These drive the WHOLE production startup economy
// pipeline — `runBootstrapEconomyRecovery`, the single function `server/index.ts` runs — so the
// GLOBAL orphan scan can no longer be skipped by a test that only exercises the per-room helper.
//
// FAIL 1: the scan used to run BEFORE any classification, against a set built from a room SHAPE
// test. A legacy room with an `unknown` binding fell outside that set, so its durable match was
// REFUNDED seconds before recovery froze it — the "an unknown binding freezes with no payout and no
// refund" guarantee stated in 37.7.12 did not actually hold in production.
// FAIL 2: a `pending` escrow that SURVIVED reconciliation was classified `cancelled`, even though a
// surviving `pending` means the durable outcome is UNKNOWN (transient read failure) or PARTIAL.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
const CLAIM = 1_000_000;
const BUY_IN = 5000;
const P = (seat: number): PokerPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' });
function tel2(): PokerTelemetry { return { handsPlayedBySeat: [8, 8], handsWonBySeat: [3, 5], showdownsWonBySeat: [1, 3], potsWonBySeat: [3, 6], biggestPotBySeat: [400, 900], allInsWonBySeat: [0, 1], royalFlushBySeat: [0, 0] }; }
function base2p(): PokerState {
  const f = () => [false, false];
  return {
    gameType: 'poker', phase: 'game_finished', playerCount: 2, players: [P(0), P(1)],
    options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 }, buttonSeat: 0, handNumber: 8, street: 'river',
    stacksBySeat: [0, 10000], holeCardsBySeat: [[], []], board: [], deck: [], burned: [],
    committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(), wasAllInBySeat: f(),
    actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: [true, false], currentBet: 0, minRaise: 50,
    toActSeat: 1, revealedBySeat: f(), lastHand: null, winnerSeat: 1, actionLog: [], telemetry: tel2(),
  } as unknown as PokerState;
}
const finished2p = () => base2p();
const live2p = () => ({ ...base2p(), phase: 'betting', street: 'flop', stacksBySeat: [4000, 6000], winnerSeat: null, eliminatedBySeat: [false, false] } as unknown as PokerState);
const isFin = (s: PokerState) => s.phase === 'game_finished';

afterEach(async () => {
  const escrow = await import('../../server/pokerEscrow');
  escrow.__setRefundFailure(false); escrow.__setPayoutFailure(false); escrow.__setReconcileFailure(false);
});


// Poker DB integration files share one Postgres and the orphan scan is cluster-wide —
// serialize them on the shared advisory lock (see pokerDbSuite.testutil).
withPokerDbSuiteLock(beforeAll, afterAll);

describe.skipIf(!TEST_DATABASE_URL)('production bootstrap economy pipeline — settlement ordering + ambiguous pending (Stage 37.7.13)', () => {
  async function ctx(prefix: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { bindGameToEscrow } = await import('../../server/pokerBinding');
    const { runBootstrapEconomyRecovery, shouldDeferBootstrapAdvance } = await import('../../server/pokerBootstrap');
    const { settleRoomForDeletion, settleAndRecordBankrollPokerFinish, recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const { createRoom, addMember, serializeRoom, deserializeRoom, snapshot } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const codes = new Set<string>();
    const timeline: string[] = [];
    const orphanSets: Array<Set<string>> = [];
    const advance = vi.fn((r: ServerRoom) => { timeline.push(`advance:${r.code}`); });
    const clearTimers = vi.fn();
    const persist = vi.fn();
    const frozenLog: string[] = [];
    const freeze = (r: ServerRoom, reason: string) => {
      if (r.pokerFrozen) return;                 // production freeze logs exactly once
      r.pokerFrozen = true; frozenLog.push(`${r.code} — ${reason}`); timeline.push(`freeze:${r.code}`);
    };

    /** The FULL production startup pipeline for a set of restored rooms (server/index.ts bootstrap). */
    async function productionBootstrap(restored: ServerRoom[]) {
      for (const r of restored) {
        // The restore loop's advance decision, verbatim.
        if (!shouldDeferBootstrapAdvance(r)) advance(r);
      }
      return runBootstrapEconomyRecovery(restored, {
        reconcileEscrow: escrow.reconcileEscrow, isFinished: isFin, refundBuyIns: escrow.refundBuyInsResult,
        rescheduleAdvance: advance, persist, clearTimers, freeze,
        isBankrollRoom: escrow.isBankrollRoom, hasUnsettledEscrow: escrow.hasUnsettledEscrow,
        reconcileCorruptRoom: escrow.reconcileCorruptRoom, withRoomLock: escrow.withRoomLock,
        roomExists: () => true, currentRooms: () => restored, log: () => {}, logError: () => {},
        // The REAL scan, scoped to this suite's rooms (see pokerOrphanScan.testutil). `orphanSets`
        // records the EXACT set the PIPELINE computed — that is what the ordering assertions check.
        reconcileOrphanedDebits: async (ids) => {
          timeline.push('orphan-scan');
          orphanSets.push(new Set(ids));
          return scopedOrphanScan((m) => codes.has(m.roomCode), ids);
        },
      });
    }

    const marker = new Map<string, string>();
    const statsDeps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); },
      record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });
    const teardown = (room: ServerRoom) => settleRoomForDeletion(room, {
      reconcileEscrow: escrow.resolveEscrowEvidence, hasUnsettledEscrow: escrow.hasUnsettledEscrow, isFinished: isFin,
      settleAndRecord: (r, s) => settleAndRecordBankrollPokerFinish(r, s, {
        payoutStacks: escrow.payoutStacks, persist, broadcast: () => {}, clearRematch: () => {}, freeze,
        recordStats: (rm, st) => recordConfirmedPokerStats(rm, st, statsDeps()),
      }),
      refundBuyIns: escrow.refundBuyInsResult, persist, freeze, clearTimers,
    });

    /** A real paid bankroll table: two funded accounts, a committed buy-in, a bound game state. */
    async function bankrollRoom(suffix: string, state: PokerState, opts: { bind?: boolean } = {}) {
      const code = `${prefix}${suffix}`;
      codes.add(code);
      const U1 = await users.createAccountUser({ email: null, name: `${code}A`, emailVerified: false });
      const U2 = await users.createAccountUser({ email: null, name: `${code}B`, emailVerified: false });
      await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
      const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: BUY_IN });
      addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
      room.started = true; room.gameState = state as unknown as typeof room.gameState;
      expect((await escrow.debitBuyIns(room)).ok).toBe(true);
      if (opts.bind !== false) bindGameToEscrow(room);
      return { room, code, U1, U2, M: room.pokerEscrow!.matchId };
    }

    const ledger = async (M: string, reason: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = ${reason}`) as Array<{ n: number }>)[0].n;
    const settlements = async (M: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_match_settlements WHERE match_id = ${M}`) as Array<{ n: number }>)[0].n;
    const gameRows = async (code: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${code}`) as Array<{ n: number }>)[0].n;
    const balance = async (u: string) => (await wallet.getWalletView(u, DAY)).balance;
    const cleanup = async (ids: string[]) => {
      const list = [...codes];
      for (const c of list) {
        await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${c})`;
        await conn!.sql`DELETE FROM games WHERE room_code = ${c}`;
        await conn!.sql`DELETE FROM poker_matches WHERE room_code = ${c}`;
      }
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN ${conn!.sql(ids)}`;
      await conn!.sql`DELETE FROM users WHERE id IN ${conn!.sql(ids)}`;
    };

    /** Drive the REAL WS handlers against a room and collect the rejection codes. */
    async function wsReject(room: ServerRoom, userId: string) {
      const { handleClientMessage } = await import('../../server/wsHandlers');
      const { RoomSocialStore } = await import('../../server/roomSocial');
      const { ConnectionLimiter, DEFAULT_RATE_LIMITS } = await import('./rateLimit');
      const errors: ErrorCode[] = [];
      const wsCtx = {
        rooms: new Map([[room.code, room]]), sockets: new Map(), social: new RoomSocialStore(),
        send: () => {}, sendError: (_s: never, code: ErrorCode) => { errors.push(code); },
        broadcastRoom: () => {}, broadcastToRoom: () => {}, broadcastAndAdvance: () => {},
        sendChatHistory: () => {}, persistRoom: () => {}, welcome: () => {}, handleLeave: () => {},
        makeRoomCode: () => 'X', logRoomEvent: () => {}, logLatestDeal: () => {},
      } as unknown as import('../../server/wsHandlers').WsContext;
      const sessionRef = { value: { room, clientId: 'a' } };
      const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
      const run = (msg: ClientMessage) => handleClientMessage(wsCtx, {} as never, sessionRef, () => {}, msg, limiter, () => userId, async () => userId);
      run({ t: 'START_GAME' } as ClientMessage);
      run({ t: 'ACTION_REQUEST', action: { type: 'POKER_FOLD', seat: 0 } } as unknown as ClientMessage);
      await new Promise((r) => setTimeout(r, 20));
      return errors;
    }

    return {
      escrow, wallet, conn, snapshot, serializeRoom, deserializeRoom, bankrollRoom, productionBootstrap,
      teardown, ledger, settlements, gameRows, balance, cleanup, wsReject,
      advance, clearTimers, frozenLog, timeline, orphanSets,
    };
  }

  it('A — an UNKNOWN binding is settlement-PROTECTED and frozen: zero refund, zero payout, zero stats', async () => {
    const t = await ctx('ORDA');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', live2p());
    // A save written BEFORE 37.7.12: a live, fully funded match with no generation marker.
    const json = JSON.parse(JSON.stringify(t.serializeRoom(room))) as Record<string, unknown>;
    delete json.pokerGameMatchId;
    const restored = t.deserializeRoom(json)!;

    const report = await t.productionBootstrap([restored]);
    expect(report.recoveries.get(code)).toBe('unknown_binding');
    // The scan was handed the match — it may NEVER settle it (this is the whole FAIL 1 fix).
    expect(report.protectedMatchIds.has(M)).toBe(true);
    expect(report.orphanRefunded).not.toContain(M);
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(await t.ledger(M, 'table_payout')).toBe(0);
    expect(await t.settlements(M)).toBe(0);               // no durable settlement of any kind
    expect(await t.gameRows(code)).toBe(0);
    expect(await t.balance(U1)).toBe(CLAIM - BUY_IN);     // the buy-ins stay debited
    expect(await t.balance(U2)).toBe(CLAIM - BUY_IN);
    // The room is frozen with its evidence intact, and never advances or acts.
    expect(restored.pokerFrozen).toBe(true);
    expect(restored.gameState).not.toBeNull();
    expect(restored.pokerEscrow!.status).toBe('funded');
    expect(restored.pokerMatchCancelled).toBeUndefined();
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.teardown(restored)).toBe('keep');      // never purged
    expect(await t.wsReject(restored, U1)).toEqual(['ILLEGAL_ACTION', 'ILLEGAL_ACTION']);

    // A repeated boot settles nothing new and does not re-log the freeze.
    const again = t.deserializeRoom(t.serializeRoom(restored))!;
    const second = await t.productionBootstrap([again]);
    expect(second.recoveries.get(code)).toBe('frozen');
    expect(second.protectedMatchIds.has(M)).toBe(true);
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(await t.ledger(M, 'table_payout')).toBe(0);
    expect(t.frozenLog).toHaveLength(1);

    // The public snapshot leaks no match id, account id, binding or escrow.
    const snap = JSON.stringify(t.snapshot(again));
    expect(JSON.parse(snap).pokerRecovery).toBe('frozen');
    for (const secret of [M, U1, U2, 'pokerGameMatchId', 'pokerEscrow']) expect(snap).not.toContain(secret);

    // Resolve the real debit so the suite leaves nothing unsettled.
    again.pokerFrozen = undefined;
    expect(await t.escrow.refundBuyInsResult(again)).toBe('confirmed_refund');
    await t.cleanup([U1, U2]);
  });

  it('B — an EXPLICITLY unbound generation is refunded exactly once, and never paid on the old state', async () => {
    const t = await ctx('ORDB');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', finished2p());
    // M0 is paid out and resolved — exactly what precedes a rematch debit.
    expect(await t.escrow.payoutStacks(room, finished2p())).toBe('paid');
    const balAfterM0 = { U1: await t.balance(U1), U2: await t.balance(U2) };
    // The rematch debit commits; the process dies before restartGame → M1 next to the M0 state.
    expect((await t.escrow.debitRematch(room)).ok).toBe(true);
    const M1 = room.pokerEscrow!.matchId;
    const restored = t.deserializeRoom(t.serializeRoom(room))!;

    const report = await t.productionBootstrap([restored]);
    expect(report.recoveries.get(code)).toBe('unbound_debit');
    // (37.7.20 FAIL 2) EVERY match a live room still claims is protected from the GLOBAL scan; the
    // unplayed generation is refunded by its own room lifecycle (`resolveUnboundEscrowGame`).
    expect(report.protectedMatchIds.has(M1)).toBe(true);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2); // refunded exactly once per seat
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    expect(await t.ledger(M, 'table_payout')).toBe(1);    // M0's payout untouched
    expect(await t.gameRows(code)).toBe(0);               // the old state never became a paid finish
    expect(restored.gameState).toBeNull();
    expect(restored.pokerGameMatchId).toBeUndefined();
    expect(await t.balance(U1)).toBe(balAfterM0.U1);
    expect(await t.balance(U2)).toBe(balAfterM0.U2);

    // Repeated boots stay idempotent.
    const again = t.deserializeRoom(t.serializeRoom(restored))!;
    await t.productionBootstrap([again]);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    await t.cleanup([U1, U2]);
  });

  it('C — a BOUND live match is protected from the orphan scan and resumes exactly once', async () => {
    const t = await ctx('ORDC');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', live2p());
    const restored = t.deserializeRoom(t.serializeRoom(room))!;

    const report = await t.productionBootstrap([restored]);
    expect(report.recoveries.get(code)).toBe('live');
    expect(report.protectedMatchIds.has(M)).toBe(true);
    expect(report.orphanRefunded).not.toContain(M);
    expect(t.advance).toHaveBeenCalledTimes(1);           // deferred by the restore loop, armed by recovery
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(await t.ledger(M, 'table_payout')).toBe(0);
    expect(restored.pokerEscrow!.status).toBe('funded');
    expect(restored.gameState).not.toBeNull();
    expect(await t.balance(U1)).toBe(CLAIM - BUY_IN);

    expect(await t.escrow.refundBuyInsResult(restored)).toBe('confirmed_refund'); // leave nothing unsettled
    await t.cleanup([U1, U2]);
  });

  it('D — a TRANSIENT reconciliation failure holds the room unresolved; the retry restores it live', async () => {
    const t = await ctx('ORDD');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', live2p());
    room.pokerEscrow!.status = 'pending';                 // persisted mid-debit, the debit DID commit
    const restored = t.deserializeRoom(t.serializeRoom(room))!;

    t.escrow.__setReconcileFailure(true);                 // the durable outcome cannot be read
    const report = await t.productionBootstrap([restored]);
    expect(report.reconciled.get(code)).toBe('retry_pending');
    expect(report.recoveries.get(code)).toBe('recovery_pending');
    // Nothing is cleared, nothing is declared, nothing is settled.
    expect(restored.gameState).not.toBeNull();
    expect(restored.pokerGameMatchId).toBe(M);
    expect(restored.pokerEscrow!.status).toBe('pending');
    expect(restored.pokerMatchCancelled).toBeUndefined();
    expect(restored.pokerFrozen).toBeUndefined();
    expect(report.protectedMatchIds.has(M)).toBe(true);   // the scan may not settle an unproven match
    expect(report.orphanRefunded).not.toContain(M);
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(await t.ledger(M, 'table_payout')).toBe(0);
    expect(await t.gameRows(code)).toBe(0);
    // …and it can neither advance, act, rematch nor be purged while unproven.
    expect(t.advance).not.toHaveBeenCalled();
    expect(t.escrow.escrowUnresolved(restored)).toBe(true);
    expect(t.escrow.pokerRecoveryBlocked(restored)).toBe(true);
    expect(await t.teardown(restored)).toBe('keep');
    // (START on an already-started table is a no-op by design, so only the action is answered.)
    expect(await t.wsReject(restored, U1)).toEqual(['SETTLEMENT_PENDING']);
    // The public status is the opaque "still settling", never a normal playable table.
    expect(JSON.parse(JSON.stringify(t.snapshot(restored))).pokerRecovery).toBe('settlement_pending');

    // The DB recovers → the next boot proves the FULL bound debit and restores the live match.
    t.escrow.__setReconcileFailure(false);
    const again = t.deserializeRoom(t.serializeRoom(restored))!;
    const second = await t.productionBootstrap([again]);
    expect(second.reconciled.get(code)).toBe('funded');
    expect(second.recoveries.get(code)).toBe('live');
    expect(again.pokerEscrow!.status).toBe('funded');
    expect(t.advance).toHaveBeenCalledTimes(1);
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(await t.balance(U1)).toBe(CLAIM - BUY_IN);

    expect(await t.escrow.refundBuyInsResult(again)).toBe('confirmed_refund');
    await t.cleanup([U1, U2]);
  });

  it('E — a PROVEN zero debit is the only thing that may become a clean cancelled lobby', async () => {
    const t = await ctx('ORDE');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', live2p());
    expect(await t.escrow.refundBuyInsResult(room)).toBe('confirmed_refund');  // resolve the real match first
    // A pending escrow whose transaction rolled back: no ledger row was ever written for it.
    const ghost = randomUUID();
    room.pokerEscrow = { matchId: ghost, buyIn: BUY_IN, status: 'pending', seats: [{ seat: 0, userId: U1, amount: BUY_IN }, { seat: 1, userId: U2, amount: BUY_IN }] };
    const restored = t.deserializeRoom(t.serializeRoom(room))!;

    const report = await t.productionBootstrap([restored]);
    expect(report.reconciled.get(code)).toBe('proven_uncommitted');
    expect(report.recoveries.get(code)).toBe('cancelled');
    expect(restored.pokerEscrow).toBeUndefined();          // the uncommitted claim is dropped
    expect(restored.gameState).toBeNull();
    expect(restored.pokerGameMatchId).toBeUndefined();
    expect(restored.pokerMatchCancelled).toBe(true);
    expect(restored.started).toBe(false);
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.ledger(ghost, 'table_buy_in')).toBe(0);
    expect(await t.ledger(ghost, 'table_cancel_refund')).toBe(0);
    expect(await t.ledger(ghost, 'table_payout')).toBe(0);
    expect(await t.gameRows(code)).toBe(0);
    expect(await t.balance(U1)).toBe(CLAIM);               // the real match's refund restored it
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(2);
    await t.cleanup([U1, U2]);
  });

  it('F — a PARTIAL durable debit is frozen for review: never refunded, never paid, never purged', async () => {
    const t = await ctx('ORDF');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', live2p());
    // Only ONE seat has a durable buy-in row → neither a refund nor a payout can be correct.
    await t.conn!.sql`DELETE FROM poker_ledger WHERE match_id = ${M} AND user_id = ${U2}`;
    room.pokerEscrow!.status = 'pending';
    const restored = t.deserializeRoom(t.serializeRoom(room))!;

    const report = await t.productionBootstrap([restored]);
    expect(report.reconciled.get(code)).toBe('corrupt_partial');
    expect(report.recoveries.get(code)).toBe('corrupt_debit');
    expect(report.protectedMatchIds.has(M)).toBe(true);
    expect(report.orphanRefunded).not.toContain(M);
    expect(restored.pokerFrozen).toBe(true);
    expect(restored.gameState).not.toBeNull();             // evidence kept
    expect(restored.pokerEscrow!.status).toBe('pending');
    expect(restored.pokerMatchCancelled).toBeUndefined();
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(await t.ledger(M, 'table_payout')).toBe(0);
    expect(await t.settlements(M)).toBe(0);
    expect(await t.gameRows(code)).toBe(0);
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.teardown(restored)).toBe('keep');

    // Repeated boots stay idempotent and never settle it.
    const again = t.deserializeRoom(t.serializeRoom(restored))!;
    const second = await t.productionBootstrap([again]);
    expect(second.recoveries.get(code)).toBe('frozen');
    expect(second.protectedMatchIds.has(M)).toBe(true);
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(t.frozenLog).toEqual([`${code} — durable match evidence does not match this table`]);

    // Restore the deleted seat row so the operator-owned match can be resolved for the suite.
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
    await t.cleanup([U1, U2]);
  });

  it('G — ordering: the orphan scan runs AFTER classification and settles only the unbound match', async () => {
    const t = await ctx('ORDG');
    const bound = await t.bankrollRoom('1', live2p());
    const unknown = await t.bankrollRoom('2', live2p());
    const unbound = await t.bankrollRoom('3', finished2p());
    const unproven = await t.bankrollRoom('4', live2p());

    // (2) legacy save with no generation marker.
    const unknownJson = JSON.parse(JSON.stringify(t.serializeRoom(unknown.room))) as Record<string, unknown>;
    delete unknownJson.pokerGameMatchId;
    // (3) M0 paid + resolved, then a fresh rematch debit whose game never started.
    expect(await t.escrow.payoutStacks(unbound.room, finished2p())).toBe('paid');
    expect((await t.escrow.debitRematch(unbound.room)).ok).toBe(true);
    const M1 = unbound.room.pokerEscrow!.matchId;
    // (4) a transient escrow whose durable outcome cannot be read.
    unproven.room.pokerEscrow!.status = 'pending';

    const restored = [
      t.deserializeRoom(t.serializeRoom(bound.room))!,
      t.deserializeRoom(unknownJson)!,
      t.deserializeRoom(t.serializeRoom(unbound.room))!,
      t.deserializeRoom(t.serializeRoom(unproven.room))!,
    ];
    t.escrow.__setReconcileFailure(true);
    const report = await t.productionBootstrap(restored);
    t.escrow.__setReconcileFailure(false);

    expect(report.recoveries.get(bound.code)).toBe('live');
    expect(report.recoveries.get(unknown.code)).toBe('unknown_binding');
    expect(report.recoveries.get(unbound.code)).toBe('unbound_debit');
    expect(report.recoveries.get(unproven.code)).toBe('recovery_pending');

    // The scan ran ONCE, with exactly the protected matches — the unbound generation excluded.
    expect(t.orphanSets).toHaveLength(1);
    // (37.7.20 FAIL 2) Every live room's match is protected — including the unbound generation,
    // which its own recovery refunds instead of the global scan.
    expect([...t.orphanSets[0]].sort()).toEqual([bound.M, unknown.M, unproven.M, M1].sort());
    expect(report.orphanRefunded).not.toContain(M1);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2); // refunded once, by the room path

    // …and it ran AFTER classification but BEFORE the recovery actions (freeze / advance).
    expect(t.timeline.indexOf('orphan-scan')).toBeGreaterThanOrEqual(0);
    expect(t.timeline.indexOf(`freeze:${unknown.code}`)).toBeGreaterThan(t.timeline.indexOf('orphan-scan'));
    expect(t.timeline.indexOf(`advance:${bound.code}`)).toBeGreaterThan(t.timeline.indexOf('orphan-scan'));
    // Only the classified live bound match ever advances.
    expect(t.timeline.filter((e) => e.startsWith('advance:'))).toEqual([`advance:${bound.code}`]);

    // Settlement effects: only the unbound match moved chips; every other match is untouched.
    for (const m of [bound.M, unknown.M, unproven.M]) {
      expect(await t.ledger(m, 'table_cancel_refund')).toBe(0);
      expect(await t.ledger(m, 'table_payout')).toBe(0);
    }
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    expect(await t.balance(bound.U1)).toBe(CLAIM - BUY_IN);
    expect(await t.balance(unknown.U1)).toBe(CLAIM - BUY_IN);
    expect(await t.balance(unproven.U1)).toBe(CLAIM - BUY_IN);

    // Leave nothing unsettled.
    restored[1].pokerFrozen = undefined;
    for (const r of [restored[0], restored[1]]) expect(await t.escrow.refundBuyInsResult(r)).toBe('confirmed_refund');
    restored[3].pokerEscrow!.status = 'funded';
    expect(await t.escrow.refundBuyInsResult(restored[3])).toBe('confirmed_refund');
    await t.cleanup([bound.U1, bound.U2, unknown.U1, unknown.U2, unbound.U1, unbound.U2, unproven.U1, unproven.U2]);
  });
});
