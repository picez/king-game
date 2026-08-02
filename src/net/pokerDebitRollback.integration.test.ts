import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { scopedOrphanScan, withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 37.7.20 (integration, real Postgres).
//
// FAIL 1: the fresh-debit transition cleared the previous TERMINAL escrow before `performDebit`, and
// a rolled-back transaction left `pokerEscrow = undefined` beside the old finished state + binding —
// an escrowless claim. An ordinary "not enough chips for a rematch" therefore corrupted the
// lifecycle and recovery could freeze a perfectly finished paid table.
// FAIL 2: the economy barrier only fail-closed protected `pending`/`settling` escrows, and only
// re-read the room array captured BEFORE the barrier — so a match whose debit had committed but
// whose `startGame`/`bindGameToEscrow` had not run (escrow `funded`, no game state), and any room
// created after the snapshot, could be refunded by the global scan while going live.
// FAIL 3: a `settled` escrow with NO state passed the terminal proof, was classified `not_bankroll`
// by bootstrap, and was purged synchronously by teardown — bypassing the incoherent-paid invariant.

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
  const wallet = await import('../../server/db/pokerWallet');
  escrow.__setRefundFailure(false); escrow.__setPayoutFailure(false); escrow.__setReconcileFailure(false);
  wallet.__setEvidenceReadGap(null);
});

withPokerDbSuiteLock(beforeAll, afterAll);

describe.skipIf(!TEST_DATABASE_URL)('reversible debit + complete scan protection + terminal no-state (Stage 37.7.20)', () => {
  async function ctx(prefix: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { bindGameToEscrow } = await import('../../server/pokerBinding');
    const { runRuntimeEconomyRecovery, runBootstrapEconomyRecovery } = await import('../../server/pokerBootstrap');
    const { settleRoomForDeletion, settleAndRecordBankrollPokerFinish, recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const { createRoom, addMember, serializeRoom, deserializeRoom, snapshot } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const codes = new Set<string>();
    const registry: ServerRoom[] = [];
    const advance = vi.fn();
    const clearTimers = vi.fn();
    const persist = vi.fn();
    const frozenLog: string[] = [];
    const freeze = (r: ServerRoom, reason: string) => { if (!r.pokerFrozen) { r.pokerFrozen = true; frozenLog.push(`${r.code} — ${reason}`); } };
    const recoveryDeps = () => ({
      reconcileEscrow: escrow.resolveEscrowEvidence, isFinished: isFin, refundBuyIns: escrow.refundBuyInsResult,
      rescheduleAdvance: advance, persist, clearTimers, freeze,
    });
    /** The PRODUCTION runtime pass — `currentRooms` is the LIVE registry, as server/index.ts passes. */
    const runtimePass = (rooms: ServerRoom[], scan?: (ids: Set<string>, rc?: ReadonlySet<string>) => Promise<{ refunded: string[]; corrupt: string[] }>) =>
      runRuntimeEconomyRecovery(rooms, {
        ...recoveryDeps(),
        isBankrollRoom: escrow.isBankrollRoom, withRoomLock: escrow.withRoomLock,
        roomExists: () => true, currentRooms: () => registry, log: () => {}, logError: () => {},
        reconcileOrphanedDebits: scan ?? ((ids, rc) => scopedOrphanScan((m) => codes.has(m.roomCode), ids, rc)),
      });
    const bootstrapPass = (rooms: ServerRoom[]) =>
      runBootstrapEconomyRecovery(rooms, {
        ...recoveryDeps(),
        isBankrollRoom: escrow.isBankrollRoom, hasUnsettledEscrow: escrow.hasUnsettledEscrow,
        reconcileCorruptRoom: escrow.reconcileCorruptRoom, withRoomLock: escrow.withRoomLock,
        roomExists: () => true, currentRooms: () => rooms, log: () => {}, logError: () => {},
        reconcileOrphanedDebits: (ids, rc) => scopedOrphanScan((m) => codes.has(m.roomCode), ids, rc),
      });
    const marker = new Map<string, string>();
    const statsDeps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); },
      record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });
    const teardown = (r: ServerRoom) => settleRoomForDeletion(r, {
      reconcileEscrow: escrow.resolveEscrowEvidence, hasUnsettledEscrow: escrow.hasUnsettledEscrow, isFinished: isFin,
      settleAndRecord: (rm, st) => settleAndRecordBankrollPokerFinish(rm, st, {
        payoutStacks: escrow.payoutStacks, persist, broadcast: () => {}, clearRematch: () => {}, freeze,
        recordStats: (r2, s2) => recordConfirmedPokerStats(r2, s2, statsDeps()),
      }),
      refundBuyIns: escrow.refundBuyInsResult, persist, freeze, clearTimers,
    });

    async function bankrollRoom(code: string, state: PokerState = live2p(), opts: { bind?: boolean } = {}) {
      codes.add(code);
      const U1 = await users.createAccountUser({ email: null, name: `${code}A`, emailVerified: false });
      const U2 = await users.createAccountUser({ email: null, name: `${code}B`, emailVerified: false });
      await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
      const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: BUY_IN });
      addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
      room.started = true; room.gameState = state as unknown as typeof room.gameState;
      expect((await escrow.debitBuyIns(room)).ok).toBe(true);
      if (opts.bind !== false) bindGameToEscrow(room);
      registry.push(room);
      return { room, code, U1, U2, M: room.pokerEscrow!.matchId };
    }

    const ledger = async (M: string, reason: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = ${reason}`) as Array<{ n: number }>)[0].n;
    const settlementOutcome = async (M: string) => ((await conn!.sql`SELECT outcome FROM poker_match_settlements WHERE match_id = ${M}`) as Array<{ outcome: string }>)[0]?.outcome ?? null;
    const matchCount = async (code: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_matches WHERE room_code = ${code}`) as Array<{ n: number }>)[0].n;
    const gameRows = async (c: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${c}`) as Array<{ n: number }>)[0].n;
    const balance = async (u: string) => (await wallet.getWalletView(u, DAY)).balance;
    const restore = (r: ServerRoom) => deserializeRoom(serializeRoom(r))!;
    const drain = async (u: string, keep: number) => { await conn!.sql`UPDATE poker_wallets SET balance = ${keep} WHERE user_id = ${u}`; };
    const cleanup = async (ids: string[]) => {
      for (const c of codes) {
        await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${c})`;
        await conn!.sql`DELETE FROM games WHERE room_code = ${c}`;
        await conn!.sql`DELETE FROM poker_matches WHERE room_code = ${c}`;
      }
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN ${conn!.sql(ids)}`;
      await conn!.sql`DELETE FROM users WHERE id IN ${conn!.sql(ids)}`;
    };
    return {
      escrow, wallet, conn, snapshot, restore, drain, bankrollRoom, runtimePass, bootstrapPass, teardown,
      bindGameToEscrow, registry, ledger, settlementOutcome, matchCount, gameRows, balance, cleanup,
      advance, frozenLog, codes,
    };
  }

  // ── FAIL 1 — the fresh-debit transition is reversible ──────────────────────────────────────────

  it('a REFUSED rematch leaves the paid finished table exactly as it was, and a retry then works', async () => {
    const t = await ctx('DR1');
    const a = await t.bankrollRoom('DR1A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    const paidBal = { U1: await t.balance(a.U1), U2: await t.balance(a.U2) };
    await t.drain(a.U2, 10);                                  // one participant cannot afford it

    const refused = await t.escrow.debitRematch(a.room);
    expect(refused.ok).toBe(false);
    // EVERYTHING about the finished paid match survives — no escrowless claim, no freeze.
    expect(a.room.pokerEscrow!.matchId).toBe(a.M);
    expect(a.room.pokerEscrow!.status).toBe('settled');
    expect(a.room.gameState).not.toBeNull();
    expect(a.room.pokerGameMatchId).toBe(a.M);
    expect(a.room.pokerFrozen).toBeUndefined();
    expect(a.room.pokerMatchCancelled).toBeUndefined();
    expect(t.escrow.escrowlessClaim(a.room)).toBe(false);
    expect(await t.matchCount('DR1A')).toBe(1);               // no M1 durable row
    expect(await t.balance(a.U1)).toBe(paidBal.U1);
    // Recovery still sees a healthy PAID FINISH, not a frozen room.
    const rep = await t.bootstrapPass([t.restore(a.room)]);
    expect(rep.recoveries.get('DR1A')).toBe('paid_finish');
    expect(t.frozenLog).toEqual([]);

    // Top the account back up → the rematch now mints EXACTLY one new match.
    await t.conn!.sql`UPDATE poker_wallets SET balance = ${CLAIM} WHERE user_id = ${a.U2}`;
    expect((await t.escrow.debitRematch(a.room)).ok).toBe(true);
    expect(a.room.pokerEscrow!.matchId).not.toBe(a.M);
    expect(await t.matchCount('DR1A')).toBe(2);
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('confirmed_refund');
    await t.cleanup([a.U1, a.U2]);
  });

  it('a TRANSIENT debit failure restores the previous escrow; an initial START rollback keeps a clean lobby', async () => {
    const t = await ctx('DR2');
    // A transient failure on a fresh START after a CONFIRMED refund keeps the honest cancelled state.
    const a = await t.bankrollRoom('DR2A');
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('confirmed_refund');
    a.room.started = false; a.room.gameState = null; a.room.pokerMatchCancelled = true;
    await t.drain(a.U1, 10);
    expect((await t.escrow.debitFreshStart(a.room)).ok).toBe(false);
    expect(a.room.pokerEscrow!.matchId).toBe(a.M);            // the cancelled escrow is restored
    expect(a.room.pokerEscrow!.status).toBe('cancelled');
    expect(a.room.pokerMatchCancelled).toBe(true);
    expect(a.room.pokerFrozen).toBeUndefined();
    expect(t.escrow.escrowlessClaim(a.room)).toBe(false);
    expect(await t.matchCount('DR2A')).toBe(1);

    // An INITIAL start (no previous escrow) rolls back to a clean lobby.
    const b = await t.bankrollRoom('DR2B');
    expect(await t.escrow.refundBuyInsResult(b.room)).toBe('confirmed_refund');
    b.room.pokerEscrow = undefined; b.room.started = false; b.room.gameState = null;
    b.room.pokerGameMatchId = undefined;
    await t.drain(b.U1, 10);
    expect((await t.escrow.debitBuyIns(b.room)).ok).toBe(false);
    expect(b.room.pokerEscrow).toBeUndefined();
    expect(t.escrow.escrowlessClaim(b.room)).toBe(false);      // a clean lobby, not a claim
    await t.cleanup([a.U1, a.U2, b.U1, b.U2]);
  });

  // ── FAIL 2 — the scan protects every match a live room claims ──────────────────────────────────

  it('a FUNDED match whose start has not bound yet is protected from the global scan', async () => {
    const t = await ctx('DR3');
    const a = await t.bankrollRoom('DR3A');
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('confirmed_refund');
    a.room.started = false; a.room.gameState = null; a.room.pokerGameMatchId = undefined;
    a.room.pokerMatchCancelled = true;
    // The debit commits; startGame/bindGameToEscrow have NOT run yet — escrow funded, NO game state.
    expect((await t.escrow.debitFreshStart(a.room)).ok).toBe(true);
    const M1 = a.room.pokerEscrow!.matchId;
    expect(a.room.gameState).toBeNull();

    const report = await t.runtimePass([a.room]);
    expect(report.protectedMatchIds.has(M1)).toBe(true);
    expect(report.orphanRefunded).not.toContain(M1);
    expect(await t.settlementOutcome(M1)).toBeNull();
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(0);
    expect(await t.balance(a.U1)).toBe(CLAIM - BUY_IN);
    // …and the start then completes normally onto a still-funded match.
    a.room.started = true;
    a.room.gameState = live2p() as unknown as typeof a.room.gameState;
    t.bindGameToEscrow(a.room);
    expect(a.room.pokerEscrow!.status).toBe('funded');
    expect(a.room.pokerGameMatchId).toBe(M1);
    // The per-room lifecycle (not the global scan) settles it.
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('confirmed_refund');
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    await t.cleanup([a.U1, a.U2]);
  });

  it('a room created AFTER the coordinator snapshot is still protected, while a roomless orphan is refunded', async () => {
    const t = await ctx('DR4');
    const orphan = await t.bankrollRoom('DR4A');
    t.registry.pop();                                        // a genuinely ROOMLESS durable orphan
    // A second table whose debit is already committed but which the coordinator's snapshot cannot
    // see: it only joins the LIVE registry once the pass is already running.
    const lateRoom = await t.bankrollRoom('DR4B');
    t.registry.pop();

    // The coordinator is called with an EMPTY snapshot; the room joins the LIVE registry while the
    // pass is already running, i.e. AFTER the snapshot but BEFORE the barrier re-reads protection.
    const pass = t.runtimePass([]);
    t.registry.push(lateRoom.room);
    const report = await pass;
    // The stale snapshot never saw DR4B, but the barrier re-read the live registry.
    expect(report.protectedMatchIds.has(lateRoom.M)).toBe(true);
    expect(report.orphanRefunded).not.toContain(lateRoom.M);
    expect(await t.settlementOutcome(lateRoom.M)).toBeNull();
    // The truly roomless orphan is still refunded exactly once.
    expect(report.orphanRefunded).toContain(orphan.M);
    expect(await t.ledger(orphan.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(orphan.U1)).toBe(CLAIM);
    expect(t.advance).not.toHaveBeenCalled();
    await t.cleanup([orphan.U1, orphan.U2, lateRoom.U1, lateRoom.U2]);
  });

  // ── FAIL 3 — a terminal escrow with no state ───────────────────────────────────────────────────

  it('an exact PAID escrow with NO state is incoherent: frozen, no START, no rematch, no purge', async () => {
    const t = await ctx('DR5');
    const a = await t.bankrollRoom('DR5A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    const paid = await t.balance(a.U2);
    a.room.gameState = null; a.room.started = false;          // the final state was lost
    a.room.pokerGameMatchId = undefined;

    const rep = await t.bootstrapPass([t.restore(a.room)]);
    expect(rep.recoveries.get('DR5A')).toBe('incoherent_paid');
    // The live room object is frozen by the same classification.
    const rep2 = await t.bootstrapPass([a.room]);
    expect(rep2.recoveries.get('DR5A')).toBe('incoherent_paid');
    expect(a.room.pokerFrozen).toBe(true);
    expect(await t.escrow.debitFreshStart(a.room)).toMatchObject({ ok: false });
    expect(await t.escrow.debitRematch(a.room)).toMatchObject({ ok: false });
    expect(await t.matchCount('DR5A')).toBe(1);
    expect(await t.teardown(a.room)).toBe('keep');
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);
    expect(await t.ledger(a.M, 'table_payout')).toBe(1);
    expect(await t.gameRows('DR5A')).toBe(0);
    expect(await t.balance(a.U2)).toBe(paid);
    expect(JSON.parse(JSON.stringify(t.snapshot(a.room))).pokerRecovery).toBe('frozen');
    await t.cleanup([a.U1, a.U2]);
  });

  it('a TERMINAL claim with no state is only purged on durable proof; otherwise frozen and kept', async () => {
    const t = await ctx('DR6');
    // (1) claims cancelled, the DB has NO settlement row.
    const a = await t.bankrollRoom('DR6A');
    a.room.pokerEscrow!.status = 'cancelled';
    a.room.gameState = null; a.room.started = false; a.room.pokerGameMatchId = undefined;
    expect(await t.teardown(a.room)).toBe('keep');
    expect(a.room.pokerFrozen).toBe(true);
    expect(await t.settlementOutcome(a.M)).toBeNull();

    // (2) claims cancelled, the DB says PAYOUT.
    const b = await t.bankrollRoom('DR6B', finished2p());
    expect(await t.escrow.payoutStacks(b.room, finished2p())).toBe('paid');
    b.room.pokerEscrow!.status = 'cancelled';
    b.room.gameState = null; b.room.started = false; b.room.pokerGameMatchId = undefined;
    expect(await t.teardown(b.room)).toBe('keep');
    expect(b.room.pokerFrozen).toBe(true);
    expect(await t.ledger(b.M, 'table_cancel_refund')).toBe(0);

    // (3) an exact durable CANCEL_REFUND with no state IS purgeable.
    const c = await t.bankrollRoom('DR6C');
    expect(await t.escrow.refundBuyInsResult(c.room)).toBe('confirmed_refund');
    c.room.gameState = null; c.room.started = false; c.room.pokerGameMatchId = undefined;
    expect(await t.teardown(c.room)).toBe('purge');
    expect(await t.balance(c.U1)).toBe(CLAIM);
    // …and a fresh START on such a table mints exactly one new match.
    expect((await t.escrow.debitFreshStart(c.room)).ok).toBe(true);
    expect(await t.matchCount('DR6C')).toBe(2);
    expect(await t.escrow.refundBuyInsResult(c.room)).toBe('confirmed_refund');

    // Repeated teardown/bootstrap is idempotent and never mutates a wallet.
    const before = await t.balance(a.U1);
    expect(await t.teardown(a.room)).toBe('keep');
    await t.bootstrapPass([a.room, b.room]);
    expect(await t.balance(a.U1)).toBe(before);
    expect(t.frozenLog.filter((l) => l.startsWith('DR6A —'))).toHaveLength(1);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2, c.U1, c.U2]);
  });
});
