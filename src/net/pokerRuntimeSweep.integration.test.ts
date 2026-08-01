import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { scopedOrphanScan, withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';
import type { ClientMessage, ErrorCode } from './messages';

// Stage 37.7.14 (integration, real Postgres). Drives BOTH production entry points —
// `runBootstrapEconomyRecovery` (startup) and `runRoomRecoverySweep` (the periodic 45s sweep, the
// exact helper `server/index.ts` calls) — so the runtime half can no longer drift from the boot half.
//
// FAIL 1: 37.7.13 promised an unresolved (`pending`/`settling`) escrow would be "retried on the next
// sweep". It was not: `retryPendingSettlements` never reconciled, and its predicates need a FUNDED
// escrow — so such a room stayed blocked for the life of the process. Worse, its FIRST branch
// (`unboundEscrowGame`) DID match a pending/settling unbound room and dropped the game state +
// binding before any durable proof (and `refundBuyIns` then refused, so nothing was even refunded).
// FAIL 2: `reconcileEscrow` consulted the durable settlement row only for a `settling` escrow, so a
// `pending` escrow whose payout/refund had already committed was promoted to `funded` — letting an
// already-PAID match resume as `live`.
// FAIL 3: the orphan scan's corrupt match ids were discarded, so a room with a structurally VALID
// escrow but a MALFORMED durable `poker_matches` row was classified `live` and re-armed.

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

withPokerDbSuiteLock(beforeAll, afterAll);

describe.skipIf(!TEST_DATABASE_URL)('runtime recovery sweep + settlement precedence + corrupt durable freeze (Stage 37.7.14)', () => {
  async function ctx(prefix: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { bindGameToEscrow } = await import('../../server/pokerBinding');
    const { runBootstrapEconomyRecovery, runRoomRecoverySweep, shouldDeferBootstrapAdvance } = await import('../../server/pokerBootstrap');
    const { settleRoomForDeletion, settleAndRecordBankrollPokerFinish, recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const { createRoom, addMember, serializeRoom, deserializeRoom, snapshot } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const codes = new Set<string>();
    const advance = vi.fn();
    const clearTimers = vi.fn();
    const persist = vi.fn();
    const frozenLog: string[] = [];
    const freeze = (r: ServerRoom, reason: string) => { if (!r.pokerFrozen) { r.pokerFrozen = true; frozenLog.push(`${r.code} — ${reason}`); } };
    const recoveryDeps = () => ({
      reconcileEscrow: escrow.reconcileEscrow, isFinished: isFin, refundBuyIns: escrow.refundBuyIns,
      rescheduleAdvance: advance, persist, clearTimers, freeze,
    });

    /** The FULL production startup pipeline (server/index.ts bootstrap), scoped to this suite. */
    async function productionBootstrap(restored: ServerRoom[]) {
      for (const r of restored) if (!shouldDeferBootstrapAdvance(r)) advance(r);
      return runBootstrapEconomyRecovery(restored, {
        ...recoveryDeps(),
        isBankrollRoom: escrow.isBankrollRoom, hasUnsettledEscrow: escrow.hasUnsettledEscrow,
        reconcileCorruptRoom: escrow.reconcileCorruptRoom, withRoomLock: escrow.withRoomLock,
        roomExists: () => true, log: () => {}, logError: () => {},
        reconcileOrphanedDebits: (ids) => scopedOrphanScan((m) => codes.has(m.roomCode), ids),
      });
    }

    /** The PRODUCTION periodic sweep branch for one room (server/index.ts retryPendingSettlements). */
    async function productionSweep(room: ServerRoom) {
      return escrow.withRoomLock(room.code, async () => {
        if (!escrow.escrowUnresolved(room)) return null;      // the exact production entry guard
        return runRoomRecoverySweep(room, recoveryDeps());
      });
    }

    const marker = new Map<string, string>();
    const statsDeps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); },
      record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });
    const sweepFinish = (r: ServerRoom) => settleAndRecordBankrollPokerFinish(r, r.gameState as PokerState, {
      payoutStacks: escrow.payoutStacks, persist, broadcast: () => {}, clearRematch: () => {}, freeze,
      recordStats: (rm, st) => recordConfirmedPokerStats(rm, st, statsDeps()),
    });
    const teardown = (r: ServerRoom) => settleRoomForDeletion(r, {
      reconcileEscrow: escrow.reconcileEscrow, hasUnsettledEscrow: escrow.hasUnsettledEscrow, isFinished: isFin,
      settleAndRecord: sweepFinish, refundBuyIns: escrow.refundBuyIns, persist, freeze, clearTimers,
    });

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
      for (const c of codes) {
        await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${c})`;
        await conn!.sql`DELETE FROM games WHERE room_code = ${c}`;
        await conn!.sql`DELETE FROM poker_matches WHERE room_code = ${c}`;
      }
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN ${conn!.sql(ids)}`;
      await conn!.sql`DELETE FROM users WHERE id IN ${conn!.sql(ids)}`;
    };

    /** Drive the REAL WS handlers and collect the rejection codes. */
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
      productionSweep, sweepFinish, teardown, ledger, settlements, gameRows, balance, cleanup, wsReject,
      recoveryDeps, runRoomRecoverySweep, advance, clearTimers, frozenLog, bindGameToEscrow,
    };
  }

  // ── FAIL 1 — the runtime sweep really retries reconciliation ────────────────────────────────────

  it('FAIL 1 — a BOUND pending room stuck by a transient boot failure is revived by the runtime sweep', async () => {
    const t = await ctx('RSA');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', live2p());
    room.pokerEscrow!.status = 'pending';                       // persisted mid-debit; the debit committed
    const r = t.deserializeRoom(t.serializeRoom(room))!;

    t.escrow.__setReconcileFailure(true);                       // the boot's DB read fails
    expect((await t.productionBootstrap([r])).recoveries.get(code)).toBe('recovery_pending');
    expect(t.advance).not.toHaveBeenCalled();
    // A sweep while the DB is still down proves nothing and changes nothing (and does not log-spam).
    const blocked = await t.productionSweep(r);
    expect(blocked).toEqual({ reconciled: 'retry_pending', recovery: 'recovery_pending', changed: false });
    expect(r.gameState).not.toBeNull();
    expect(r.pokerGameMatchId).toBe(M);
    expect(r.pokerEscrow!.status).toBe('pending');
    expect(await t.teardown(r)).toBe('keep');
    expect(await t.wsReject(r, U1)).toEqual(['SETTLEMENT_PENDING']);

    // The DB recovers → the very next sweep reconciles IN-PROCESS and brings the table back to life.
    t.escrow.__setReconcileFailure(false);
    const out = await t.productionSweep(r);
    expect(out).toEqual({ reconciled: 'funded', recovery: 'live', changed: true });
    expect(r.pokerEscrow!.status).toBe('funded');
    expect(t.advance).toHaveBeenCalledTimes(1);                 // re-armed exactly ONCE
    expect(t.escrow.escrowUnresolved(r)).toBe(false);
    expect(t.escrow.pokerRecoveryBlocked(r)).toBe(false);
    // Later ticks are a no-op — no second advance, no repeated settlement.
    expect(await t.productionSweep(r)).toBeNull();
    expect(t.advance).toHaveBeenCalledTimes(1);
    expect(await t.ledger(M, 'table_payout')).toBe(0);
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(await t.balance(U1)).toBe(CLAIM - BUY_IN);

    expect(await t.escrow.refundBuyIns(r)).toBe(true);
    await t.cleanup([U1, U2]);
  });

  it('FAIL 1 — a PENDING escrow with NO game state is reconciled by the sweep instead of hanging', async () => {
    const t = await ctx('RSB');
    const { room, U1, U2, M } = await t.bankrollRoom('1', live2p());
    room.gameState = null; room.started = false;                // a failed start: debit committed, no hand
    room.pokerEscrow!.status = 'pending';
    const r = t.deserializeRoom(t.serializeRoom(room))!;
    expect(t.escrow.settlementPending(r)).toBe(false);           // the old sweep matched NO branch at all
    expect(t.escrow.escrowUnresolved(r)).toBe(true);

    const out = await t.productionSweep(r);
    expect(out).toEqual({ reconciled: 'funded', recovery: null, changed: true });
    expect(r.pokerEscrow!.status).toBe('funded');
    expect(t.escrow.settlementPending(r)).toBe(true);            // now the normal refund retry owns it
    expect(await t.escrow.refundBuyIns(r)).toBe(true);
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(U1)).toBe(CLAIM);
    await t.cleanup([U1, U2]);
  });

  it('FAIL 1 — a PENDING unbound escrow keeps its evidence until proven, then is refunded exactly once', async () => {
    const t = await ctx('RSC');
    const { room, U1, U2, M } = await t.bankrollRoom('1', finished2p());
    expect(await t.escrow.payoutStacks(room, finished2p())).toBe('paid');
    const balAfterM0 = { U1: await t.balance(U1), U2: await t.balance(U2) };
    expect((await t.escrow.debitRematch(room)).ok).toBe(true);
    const M1 = room.pokerEscrow!.matchId;
    room.pokerEscrow!.status = 'pending';                        // persisted mid-debit, still unbound
    const r = t.deserializeRoom(t.serializeRoom(room))!;

    // The unbound route must NOT fire while the outcome is unproven (that used to wipe the evidence).
    expect(t.escrow.unboundEscrowGame(r)).toBe(false);
    expect(t.escrow.escrowUnresolved(r)).toBe(true);
    t.escrow.__setReconcileFailure(true);
    expect((await t.productionSweep(r))!.changed).toBe(false);
    expect(r.gameState).not.toBeNull();                          // evidence intact
    expect(r.pokerGameMatchId).toBeDefined();
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(0);

    // Proven funded → NOW it is an unplayed stale generation: state dropped, refunded exactly once.
    t.escrow.__setReconcileFailure(false);
    const out = await t.productionSweep(r);
    expect(out).toEqual({ reconciled: 'funded', recovery: 'unbound_debit', changed: true });
    expect(r.gameState).toBeNull();
    expect(r.pokerGameMatchId).toBeUndefined();
    expect(r.pokerMatchCancelled).toBe(true);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    expect(await t.ledger(M, 'table_payout')).toBe(1);           // M0's payout untouched
    expect(await t.gameRows(r.code)).toBe(0);
    expect(await t.balance(U1)).toBe(balAfterM0.U1);
    expect(await t.balance(U2)).toBe(balAfterM0.U2);
    expect(t.advance).not.toHaveBeenCalled();
    await t.cleanup([U1, U2]);
  });

  // ── FAIL 2 — a committed settlement outranks any transient room status ──────────────────────────

  it('FAIL 2 A — pending + durable PAYOUT + unfinished bound state → settled → incoherent_paid, frozen', async () => {
    const t = await ctx('RSD');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', finished2p());
    expect(await t.escrow.payoutStacks(room, finished2p())).toBe('paid');
    const paid = { U1: await t.balance(U1), U2: await t.balance(U2) };
    // The room JSON lagged behind the DB: a PRE-finish state next to a `pending` escrow.
    room.gameState = live2p() as unknown as typeof room.gameState;
    room.pokerEscrow!.status = 'pending';
    const r = t.deserializeRoom(t.serializeRoom(room))!;

    const report = await t.productionBootstrap([r]);
    expect(report.reconciled.get(code)).toBe('settled');         // the payout row wins over `pending`
    expect(report.recoveries.get(code)).toBe('incoherent_paid'); // …and 37.7.11 fails closed
    expect(r.pokerFrozen).toBe(true);
    expect(r.gameState).not.toBeNull();                          // evidence kept
    expect(t.advance).not.toHaveBeenCalled();
    expect(t.escrow.pokerRecoveryBlocked(r)).toBe(true);
    expect(await t.ledger(M, 'table_payout')).toBe(1);           // never repeated
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(await t.gameRows(code)).toBe(0);
    expect(await t.balance(U1)).toBe(paid.U1);
    expect(await t.balance(U2)).toBe(paid.U2);
    expect(await t.teardown(r)).toBe('keep');
    expect(await t.wsReject(r, U1)).toEqual(['ILLEGAL_ACTION', 'ILLEGAL_ACTION']);
    expect(JSON.parse(JSON.stringify(t.snapshot(r))).pokerRecovery).toBe('frozen');
    // A repeated boot changes nothing and does not re-log.
    await t.productionBootstrap([t.deserializeRoom(t.serializeRoom(r))!]);
    expect(await t.ledger(M, 'table_payout')).toBe(1);
    expect(t.frozenLog).toHaveLength(1);
    await t.cleanup([U1, U2]);
  });

  it('FAIL 2 B — pending + durable PAYOUT + FINISHED bound state → settled → paid_finish, stats once', async () => {
    const t = await ctx('RSE');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', finished2p());
    expect(await t.escrow.payoutStacks(room, finished2p())).toBe('paid');
    const paid = { U1: await t.balance(U1), U2: await t.balance(U2) };
    room.pokerEscrow!.status = 'pending';                        // room JSON lagged behind
    const r = t.deserializeRoom(t.serializeRoom(room))!;

    const report = await t.productionBootstrap([r]);
    expect(report.reconciled.get(code)).toBe('settled');
    expect(report.recoveries.get(code)).toBe('paid_finish');
    expect(r.pokerStatsPending).toBe(true);
    expect(r.pokerFrozen).toBeUndefined();
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.ledger(M, 'table_payout')).toBe(1);           // payout NOT repeated
    expect(await t.balance(U1)).toBe(paid.U1);
    // Only the stats are finalized — exactly once, even across a repeat.
    const { recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const marker = new Map<string, string>();
    const pokerStats = await import('../../server/db/pokerStats');
    const deps = { alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); }, record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid) };
    expect(await recordConfirmedPokerStats(r, r.gameState as PokerState, deps)).toBe('recorded');
    expect(await t.gameRows(code)).toBe(1);
    expect(await recordConfirmedPokerStats(r, r.gameState as PokerState, deps)).toBe('already_exists');
    expect(await t.gameRows(code)).toBe(1);
    expect(await t.ledger(M, 'table_payout')).toBe(1);
    await t.cleanup([U1, U2]);
  });

  it('FAIL 2 C — pending + durable CANCEL_REFUND → cancelled only on that proof; no resume, no re-refund', async () => {
    const t = await ctx('RSF');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', live2p());
    expect(await t.escrow.refundBuyIns(room)).toBe(true);         // durable refund row
    room.pokerEscrow!.status = 'pending';                         // room JSON lagged behind
    const r = t.deserializeRoom(t.serializeRoom(room))!;

    const report = await t.productionBootstrap([r]);
    expect(report.reconciled.get(code)).toBe('cancelled');
    expect(report.recoveries.get(code)).toBe('cancelled');
    expect(r.gameState).toBeNull();                               // cleared only AFTER durable proof
    expect(r.pokerGameMatchId).toBeUndefined();
    expect(r.pokerMatchCancelled).toBe(true);
    expect(r.started).toBe(false);
    expect(t.advance).not.toHaveBeenCalled();                     // never resumes a refunded match
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(2);     // refund NOT repeated
    expect(await t.ledger(M, 'table_payout')).toBe(0);
    expect(await t.settlements(M)).toBe(1);
    expect(await t.gameRows(code)).toBe(0);
    expect(await t.balance(U1)).toBe(CLAIM);
    await t.cleanup([U1, U2]);
  });

  it('FAIL 2 D — a SETTLING escrow gets the same authoritative outcome as a pending one', async () => {
    const t = await ctx('RSG');
    const a = await t.bankrollRoom('1', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    a.room.pokerEscrow!.status = 'settling';
    expect(await t.escrow.reconcileEscrow(a.room)).toBe('settled');
    expect(a.room.pokerEscrow!.status).toBe('settled');

    const b = await t.bankrollRoom('2', live2p());
    expect(await t.escrow.refundBuyIns(b.room)).toBe(true);
    b.room.pokerEscrow!.status = 'settling';
    expect(await t.escrow.reconcileEscrow(b.room)).toBe('cancelled');
    expect(b.room.pokerEscrow!.status).toBe('cancelled');

    // A settling escrow with NO settlement row stays a retryable funded payout.
    const c = await t.bankrollRoom('3', finished2p());
    c.room.pokerEscrow!.status = 'settling';
    expect(await t.escrow.reconcileEscrow(c.room)).toBe('funded');
    expect(t.escrow.payoutPending(c.room)).toBe(true);
    expect(await t.escrow.refundBuyIns(c.room)).toBe(true);

    expect(await t.ledger(a.M, 'table_payout')).toBe(1);
    expect(await t.ledger(b.M, 'table_cancel_refund')).toBe(2);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2, c.U1, c.U2]);
  });

  // ── FAIL 3 — a corrupt DURABLE record freezes its room ──────────────────────────────────────────

  it('FAIL 3 — a bound funded room whose DURABLE match is malformed is frozen, never resumed', async () => {
    const t = await ctx('RSH');
    const { room, code, U1, U2, M } = await t.bankrollRoom('1', live2p());
    // The room escrow is structurally VALID (so `pokerEscrowCorrupt` is false) — the DURABLE row is not.
    const bad = JSON.stringify([{ seat: 0, userId: U1, amount: BUY_IN }, { seat: 1, userId: U2, amount: BUY_IN - 1 }]);
    await t.conn!.sql`UPDATE poker_matches SET seats = ${bad}::jsonb WHERE match_id = ${M}`;
    const r = t.deserializeRoom(t.serializeRoom(room))!;
    expect(r.pokerEscrowCorrupt).toBeUndefined();

    const report = await t.productionBootstrap([r]);
    expect(report.corruptDurableRooms).toContain(code);
    expect(report.recoveries.get(code)).toBe('frozen');
    expect(r.pokerFrozen).toBe(true);
    expect(t.advance).not.toHaveBeenCalled();                     // never playable
    expect(r.gameState).not.toBeNull();                           // state, binding + escrow all kept
    expect(r.pokerGameMatchId).toBe(M);
    expect(r.pokerEscrow!.status).toBe('funded');
    expect(r.pokerMatchCancelled).toBeUndefined();
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);     // no auto-refund…
    expect(await t.ledger(M, 'table_payout')).toBe(0);            // …no payout…
    expect(await t.settlements(M)).toBe(0);
    expect(await t.gameRows(code)).toBe(0);                       // …and no stats
    expect(await t.balance(U1)).toBe(CLAIM - BUY_IN);
    expect(await t.teardown(r)).toBe('keep');                     // never purged
    expect(await t.wsReject(r, U1)).toEqual(['ILLEGAL_ACTION', 'ILLEGAL_ACTION']);
    // Public snapshot is opaque; the operator log carries the room code + a safe reason only.
    const snap = JSON.stringify(t.snapshot(r));
    expect(JSON.parse(snap).pokerRecovery).toBe('frozen');
    for (const secret of [M, U1, U2, 'pokerGameMatchId', 'pokerEscrow']) expect(snap).not.toContain(secret);
    expect(t.frozenLog).toEqual([`${code} — corrupt durable match record`]);
    // Repeated bootstrap + sweep are idempotent and do not re-log.
    const again = t.deserializeRoom(t.serializeRoom(r))!;
    expect((await t.productionBootstrap([again])).recoveries.get(code)).toBe('frozen');
    expect(await t.productionSweep(again)).toBeNull();
    expect(t.frozenLog).toHaveLength(1);
    expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    expect(await t.settlements(M)).toBe(0);

    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
    await t.cleanup([U1, U2]);
  });

  // ── Non-regression: the healthy flows and the untouched game types ──────────────────────────────

  it('the healthy live / payout_pending / stats_pending / unbound flows are unchanged', async () => {
    const t = await ctx('RSI');
    // live: a funded bound unfinished match resumes once and the sweep never touches it.
    const live = await t.bankrollRoom('1', live2p());
    const lr = t.deserializeRoom(t.serializeRoom(live.room))!;
    expect((await t.productionBootstrap([lr])).recoveries.get(live.code)).toBe('live');
    expect(t.advance).toHaveBeenCalledTimes(1);
    expect(await t.productionSweep(lr)).toBeNull();               // durable escrow → not a sweep case
    expect(t.advance).toHaveBeenCalledTimes(1);
    expect(await t.escrow.refundBuyIns(lr)).toBe(true);

    // payout_pending: a funded bound FINISHED match still pays out then records, exactly once.
    const fin = await t.bankrollRoom('2', finished2p());
    const fr = t.deserializeRoom(t.serializeRoom(fin.room))!;
    expect((await t.productionBootstrap([fr])).recoveries.get(fin.code)).toBe('payout_pending');
    expect(t.escrow.payoutPending(fr)).toBe(true);
    const out = await t.sweepFinish(fr);
    expect(out.result).toBe('paid');
    expect(out.stats).toBe('recorded');
    expect(await t.ledger(fin.M, 'table_payout')).toBe(1);
    expect(await t.gameRows(fin.code)).toBe(1);
    // stats_pending resolves without ever re-paying.
    fr.pokerStatsPending = true;
    expect(t.escrow.statsPending(fr)).toBe(true);
    expect(t.escrow.payoutPending(fr)).toBe(false);
    expect(await t.ledger(fin.M, 'table_payout')).toBe(1);

    // explicit unbound (FUNDED) still refunds once through the sweep.
    const ub = await t.bankrollRoom('3', finished2p());
    expect(await t.escrow.payoutStacks(ub.room, finished2p())).toBe('paid');
    expect((await t.escrow.debitRematch(ub.room)).ok).toBe(true);
    const M1 = ub.room.pokerEscrow!.matchId;
    const ur = t.deserializeRoom(t.serializeRoom(ub.room))!;
    expect(t.escrow.unboundEscrowGame(ur)).toBe(true);
    expect((await t.productionBootstrap([ur])).recoveries.get(ub.code)).toBe('unbound_debit');
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    await t.cleanup([live.U1, live.U2, fin.U1, fin.U2, ub.U1, ub.U2]);
  });

  it('non-poker rooms and LOCAL (free) poker are never touched by the sweep or the pipeline', async () => {
    const t = await ctx('RSJ');
    const { createRoom } = await import('./serverCore');
    const king = createRoom({ code: 'RSJK', playerCount: 4, modeSelectionType: 'fixed', gameType: 'king', host: { clientId: 'a', reconnectToken: 't', name: 'A' } });
    king.started = true; king.gameState = { phase: 'playing' } as unknown as typeof king.gameState;
    const localPoker = createRoom({ code: 'RSJP', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A' } });
    localPoker.started = true; localPoker.gameState = live2p() as unknown as typeof localPoker.gameState;

    for (const r of [king, localPoker]) {
      expect(t.escrow.isBankrollRoom(r)).toBe(false);
      expect(t.escrow.escrowUnresolved(r)).toBe(false);
      expect(t.escrow.pokerRecoveryBlocked(r)).toBe(false);
      expect(await t.productionSweep(r)).toBeNull();
      expect(await t.runRoomRecoverySweep(r, t.recoveryDeps())).toEqual({ reconciled: null, recovery: null, changed: false });
    }
    const report = await t.productionBootstrap([king, localPoker]);
    expect(report.recoveries.size).toBe(0);          // neither is a bankroll room
    expect(king.gameState).not.toBeNull();
    expect(localPoker.gameState).not.toBeNull();
    expect(king.pokerFrozen).toBeUndefined();
    expect(localPoker.pokerFrozen).toBeUndefined();
    expect(t.frozenLog).toEqual([]);
  });
});
