import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { scopedOrphanScan, withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 37.7.15 (integration, real Postgres). Drives the PRODUCTION bootstrap pipeline.
//
// FAIL 1: corrupt durable records were associated with a restored room by ROOM CODE. A code is 4
// chars and `makeRoomCode` only avoids collisions with the LIVE rooms, while an unresolved corrupt
// `poker_matches` row outlives its room — so a stale corrupt record permanently froze a brand-new,
// perfectly healthy table that reused the code.
// FAIL 2: bootstrap only checked that a durable row PARSED. It never proved the row (and the buy-in
// ledger) actually belong to the room's escrow, so a missing/mismatched record — or a ledger with the
// right COUNT but the wrong accounts/amounts/keys/room — was still resumed as `live`.
// FAIL 3: the "operator logs never contain a matchId" claim was false; several economy logs printed
// raw match ids.

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

describe.skipIf(!TEST_DATABASE_URL)('exact durable ownership + collision-safe corrupt handling (Stage 37.7.15)', () => {
  async function ctx(prefix: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { bindGameToEscrow } = await import('../../server/pokerBinding');
    const { runBootstrapEconomyRecovery } = await import('../../server/pokerBootstrap');
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
      // The PRODUCTION recovery dep (server/index.ts `bootstrapRecoveryDeps`): exact ownership,
      // covering a `funded` escrow too — not the narrower transient-only `reconcileEscrow`.
      reconcileEscrow: escrow.resolveEscrowEvidence, isFinished: isFin, refundBuyIns: escrow.refundBuyInsResult,
      rescheduleAdvance: advance, persist, clearTimers, freeze,
    });

    async function productionBootstrap(restored: ServerRoom[]) {
      return runBootstrapEconomyRecovery(restored, {
        ...recoveryDeps(),
        isBankrollRoom: escrow.isBankrollRoom, hasUnsettledEscrow: escrow.hasUnsettledEscrow,
        reconcileCorruptRoom: escrow.reconcileCorruptRoom, withRoomLock: escrow.withRoomLock,
        roomExists: () => true, log: () => {}, logError: () => {},
        reconcileOrphanedDebits: (ids) => scopedOrphanScan((m) => codes.has(m.roomCode), ids),
      });
    }

    const marker = new Map<string, string>();
    const pokerStats = await import('../../server/db/pokerStats');
    const statsDeps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); },
      record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });
    const teardown = (r: ServerRoom) => settleRoomForDeletion(r, {
      reconcileEscrow: escrow.reconcileEscrow, hasUnsettledEscrow: escrow.hasUnsettledEscrow, isFinished: isFin,
      settleAndRecord: (rm, st) => settleAndRecordBankrollPokerFinish(rm, st, {
        payoutStacks: escrow.payoutStacks, persist, broadcast: () => {}, clearRematch: () => {}, freeze,
        recordStats: (r2, s2) => recordConfirmedPokerStats(r2, s2, statsDeps()),
      }),
      refundBuyIns: escrow.refundBuyInsResult, persist, freeze, clearTimers,
    });

    async function bankrollRoom(code: string, state: PokerState = live2p()) {
      codes.add(code);
      const U1 = await users.createAccountUser({ email: null, name: `${code}A`, emailVerified: false });
      const U2 = await users.createAccountUser({ email: null, name: `${code}B`, emailVerified: false });
      await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
      const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: BUY_IN });
      addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
      room.started = true; room.gameState = state as unknown as typeof room.gameState;
      expect((await escrow.debitBuyIns(room)).ok).toBe(true);
      bindGameToEscrow(room);
      return { room, code, U1, U2, M: room.pokerEscrow!.matchId };
    }

    const ledger = async (M: string, reason: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = ${reason}`) as Array<{ n: number }>)[0].n;
    const settlements = async (M: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_match_settlements WHERE match_id = ${M}`) as Array<{ n: number }>)[0].n;
    const gameRows = async (code: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${code}`) as Array<{ n: number }>)[0].n;
    const balance = async (u: string) => (await wallet.getWalletView(u, DAY)).balance;
    const restore = (room: ServerRoom) => deserializeRoom(serializeRoom(room))!;
    const cleanup = async (ids: string[]) => {
      for (const c of codes) {
        await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${c})`;
        await conn!.sql`DELETE FROM games WHERE room_code = ${c}`;
        await conn!.sql`DELETE FROM poker_matches WHERE room_code = ${c}`;
      }
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN ${conn!.sql(ids)}`;
      await conn!.sql`DELETE FROM users WHERE id IN ${conn!.sql(ids)}`;
    };

    /** Bootstrap the room and assert the FULL fail-closed contract for corrupt/unprovable evidence. */
    async function expectFrozenFailClosed(room: ServerRoom, code: string, M: string, U1: string) {
      const r = restore(room);
      const before = await balance(U1);
      const report = await productionBootstrap([r]);
      expect(report.recoveries.get(code)).toBe('corrupt_debit');
      expect(r.pokerFrozen).toBe(true);
      expect(advance).not.toHaveBeenCalled();
      expect(r.gameState).not.toBeNull();          // state, binding + escrow all preserved
      expect(r.pokerGameMatchId).toBeDefined();
      expect(r.pokerEscrow).toBeDefined();
      expect(r.pokerMatchCancelled).toBeUndefined();
      expect(await ledger(M, 'table_cancel_refund')).toBe(0);
      expect(await ledger(M, 'table_payout')).toBe(0);
      expect(await settlements(M)).toBe(0);
      expect(await gameRows(code)).toBe(0);
      expect(await balance(U1)).toBe(before);
      expect(escrow.pokerRecoveryBlocked(r)).toBe(true);
      expect(await teardown(r)).toBe('keep');
      expect(JSON.parse(JSON.stringify(snapshot(r))).pokerRecovery).toBe('frozen');
      // A repeated boot is idempotent and does not re-log.
      const again = restore(r);
      expect((await productionBootstrap([again])).recoveries.get(code)).toBe('frozen');
      expect(frozenLog.filter((l) => l.startsWith(`${code} —`))).toHaveLength(1);
      return r;
    }

    return {
      escrow, wallet, conn, snapshot, restore, bankrollRoom, productionBootstrap, teardown,
      ledger, settlements, gameRows, balance, cleanup, expectFrozenFailClosed,
      advance, frozenLog, codes, bindGameToEscrow,
    };
  }

  // ── FAIL 1 — collision-safe corrupt association ────────────────────────────────────────────────

  it('FAIL 1 — a stale corrupt durable match never freezes a HEALTHY room that reused its room code', async () => {
    const t = await ctx('OW1');
    const CODE = 'OW1A';
    // M_old: corrupt + unresolved, for room code OW1A, whose room is long gone.
    const M_old = `stale-${CODE}-${Math.floor(Date.now() % 1e7)}`;
    const badSeats = JSON.stringify([{ seat: 0, userId: 'ghost-1', amount: BUY_IN }, { seat: 1, userId: 'ghost-2', amount: BUY_IN - 1 }]);
    await t.conn!.sql`INSERT INTO poker_matches (match_id, room_code, buy_in, seats) VALUES (${M_old}, ${CODE}, ${BUY_IN}, ${badSeats}::jsonb)`;
    // A brand-new, perfectly healthy bankroll table later reuses the same 4-char code.
    const fresh = await t.bankrollRoom(CODE);
    const before = { U1: await t.balance(fresh.U1), U2: await t.balance(fresh.U2) };
    const r = t.restore(fresh.room);

    const report = await t.productionBootstrap([r]);
    expect(report.recoveries.get(CODE)).toBe('live');       // the healthy match is untouched…
    expect(report.corruptDurableRooms).not.toContain(CODE); // …and never associated with M_old
    expect(r.pokerFrozen).toBeUndefined();
    expect(t.advance).toHaveBeenCalledTimes(1);
    expect(t.frozenLog).toEqual([]);
    expect(await t.balance(fresh.U1)).toBe(before.U1);       // bootstrap moved no chips
    expect(await t.balance(fresh.U2)).toBe(before.U2);
    // M_old stays operator-owned: unresolved, never refunded, never settled.
    expect(await t.ledger(M_old, 'table_cancel_refund')).toBe(0);
    expect(await t.ledger(M_old, 'table_payout')).toBe(0);
    expect(await t.settlements(M_old)).toBe(0);
    const still = (await t.conn!.sql`SELECT count(*)::int AS n FROM poker_matches WHERE match_id = ${M_old}`) as Array<{ n: number }>;
    expect(still[0].n).toBe(1);

    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M_old}`;
    expect(await t.escrow.refundBuyInsResult(r)).toBe('confirmed_refund');
    await t.cleanup([fresh.U1, fresh.U2]);
  });

  it('FAIL 1 — a corrupt durable record for the room\'s OWN match still freezes it', async () => {
    const t = await ctx('OW2');
    const a = await t.bankrollRoom('OW2A');
    const bad = JSON.stringify([{ seat: 0, userId: a.U1, amount: BUY_IN }, { seat: 1, userId: a.U2, amount: BUY_IN - 1 }]);
    await t.conn!.sql`UPDATE poker_matches SET seats = ${bad}::jsonb WHERE match_id = ${a.M}`;
    const r = t.restore(a.room);
    const report = await t.productionBootstrap([r]);
    expect(report.corruptDurableRooms).toContain('OW2A');
    expect(r.pokerFrozen).toBe(true);
    expect(t.advance).not.toHaveBeenCalled();
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${a.M}`;
    await t.cleanup([a.U1, a.U2]);
  });

  // ── FAIL 2 — exact durable ownership (the full matrix) ─────────────────────────────────────────

  it('FAIL 2 (1) — a MISSING durable poker_matches row freezes the funded bound room', async () => {
    const t = await ctx('OW3');
    const a = await t.bankrollRoom('OW3A');
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${a.M}`;
    await t.expectFrozenFailClosed(a.room, 'OW3A', a.M, a.U1);
    await t.cleanup([a.U1, a.U2]);
  });

  it('FAIL 2 (2-5) — a durable row with the wrong roomCode / buyIn / seat set / seat count freezes', async () => {
    const t = await ctx('OW4');
    // (2) wrong roomCode
    const a = await t.bankrollRoom('OW4A');
    await t.conn!.sql`UPDATE poker_matches SET room_code = 'ZZZZ' WHERE match_id = ${a.M}`;
    await t.expectFrozenFailClosed(a.room, 'OW4A', a.M, a.U1);
    // (3) wrong buyIn (seats stay consistent so the row still parses)
    const b = await t.bankrollRoom('OW4B');
    const bSeats = JSON.stringify([{ seat: 0, userId: b.U1, amount: 9000 }, { seat: 1, userId: b.U2, amount: 9000 }]);
    await t.conn!.sql`UPDATE poker_matches SET buy_in = 9000, seats = ${bSeats}::jsonb WHERE match_id = ${b.M}`;
    await t.expectFrozenFailClosed(b.room, 'OW4B', b.M, b.U1);
    // (4) a parse-VALID but DIFFERENT seat/user set (seats swapped between accounts)
    const c = await t.bankrollRoom('OW4C');
    const cSeats = JSON.stringify([{ seat: 0, userId: c.U2, amount: BUY_IN }, { seat: 1, userId: c.U1, amount: BUY_IN }]);
    await t.conn!.sql`UPDATE poker_matches SET seats = ${cSeats}::jsonb WHERE match_id = ${c.M}`;
    await t.expectFrozenFailClosed(c.room, 'OW4C', c.M, c.U1);
    // (5) an EXTRA seat (still parse-valid: 3 unique seats/users at the same buy-in)
    const d = await t.bankrollRoom('OW4D');
    const extra = await (await import('../../server/db/users')).createAccountUser({ email: null, name: 'OW4DX', emailVerified: false });
    const dSeats = JSON.stringify([{ seat: 0, userId: d.U1, amount: BUY_IN }, { seat: 1, userId: d.U2, amount: BUY_IN }, { seat: 2, userId: extra, amount: BUY_IN }]);
    await t.conn!.sql`UPDATE poker_matches SET seats = ${dSeats}::jsonb WHERE match_id = ${d.M}`;
    await t.expectFrozenFailClosed(d.room, 'OW4D', d.M, d.U1);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2, c.U1, c.U2, d.U1, d.U2, extra]);
  });

  it('FAIL 2 (6-9) — a buy-in ledger with the wrong account / delta / room / an extra row freezes', async () => {
    const t = await ctx('OW5');
    // (6) the COUNT is right but one row belongs to another account (the old count-only check passed).
    const a = await t.bankrollRoom('OW5A');
    const outsider = await (await import('../../server/db/users')).createAccountUser({ email: null, name: 'OW5AX', emailVerified: false });
    await t.conn!.sql`UPDATE poker_ledger SET user_id = ${outsider} WHERE match_id = ${a.M} AND user_id = ${a.U2}`;
    await t.expectFrozenFailClosed(a.room, 'OW5A', a.M, a.U1);
    // (7) a wrong delta.
    const b = await t.bankrollRoom('OW5B');
    await t.conn!.sql`UPDATE poker_ledger SET delta = -1 WHERE match_id = ${b.M} AND user_id = ${b.U2}`;
    await t.expectFrozenFailClosed(b.room, 'OW5B', b.M, b.U1);
    // (8) a wrong room code on the ledger row.
    const c = await t.bankrollRoom('OW5C');
    await t.conn!.sql`UPDATE poker_ledger SET room_code = 'ZZZZ' WHERE match_id = ${c.M} AND user_id = ${c.U2}`;
    await t.expectFrozenFailClosed(c.room, 'OW5C', c.M, c.U1);
    // (9) all expected rows are correct, but an EXTRA buy-in row exists for the same match.
    const d = await t.bankrollRoom('OW5D');
    const extra = await (await import('../../server/db/users')).createAccountUser({ email: null, name: 'OW5DX', emailVerified: false });
    await t.conn!.sql`INSERT INTO poker_ledger (user_id, reason, delta, balance_after, idempotency_key, match_id, room_code)
      VALUES (${extra}, 'table_buy_in', ${-BUY_IN}, 0, ${`buyin:${d.M}:${extra}`}, ${d.M}, 'OW5D')`;
    await t.expectFrozenFailClosed(d.room, 'OW5D', d.M, d.U1);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2, c.U1, c.U2, d.U1, d.U2, outsider, extra]);
  });

  it('FAIL 2 (10) — an EXACT durable record + EXACT ledger is a healthy live table', async () => {
    const t = await ctx('OW6');
    const a = await t.bankrollRoom('OW6A');
    const r = t.restore(a.room);
    const report = await t.productionBootstrap([r]);
    expect(report.reconciled.get('OW6A')).toBe('funded');
    expect(report.recoveries.get('OW6A')).toBe('live');
    expect(r.pokerFrozen).toBeUndefined();
    expect(t.advance).toHaveBeenCalledTimes(1);
    expect(await t.balance(a.U1)).toBe(CLAIM - BUY_IN);
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);
    expect(await t.escrow.refundBuyInsResult(r)).toBe('confirmed_refund');
    await t.cleanup([a.U1, a.U2]);
  });

  it('FAIL 2 (11) — settlement precedence is unchanged by the new ownership proof', async () => {
    const t = await ctx('OW7');
    // A committed PAYOUT outranks a stale `pending` room status → paid_finish, never re-paid.
    const a = await t.bankrollRoom('OW7A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    const paid = await t.balance(a.U2);
    a.room.pokerEscrow!.status = 'pending';
    const ra = t.restore(a.room);
    const repA = await t.productionBootstrap([ra]);
    expect(repA.reconciled.get('OW7A')).toBe('settled');
    expect(repA.recoveries.get('OW7A')).toBe('paid_finish');
    expect(await t.ledger(a.M, 'table_payout')).toBe(1);
    expect(await t.balance(a.U2)).toBe(paid);

    // A committed REFUND likewise → cancelled, never refunded twice.
    const b = await t.bankrollRoom('OW7B');
    expect(await t.escrow.refundBuyInsResult(b.room)).toBe('confirmed_refund');
    b.room.pokerEscrow!.status = 'pending';
    const rb = t.restore(b.room);
    const repB = await t.productionBootstrap([rb]);
    expect(repB.reconciled.get('OW7B')).toBe('cancelled');
    expect(repB.recoveries.get('OW7B')).toBe('cancelled');
    expect(rb.gameState).toBeNull();
    expect(await t.ledger(b.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(b.U1)).toBe(CLAIM);
    expect(t.advance).not.toHaveBeenCalled();
    await t.cleanup([a.U1, a.U2, b.U1, b.U2]);
  });

  it('FAIL 2 (12) — an explicit unbound fresh generation with EXACT evidence still refunds once', async () => {
    const t = await ctx('OW8');
    const a = await t.bankrollRoom('OW8A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    const balAfterM0 = { U1: await t.balance(a.U1), U2: await t.balance(a.U2) };
    expect((await t.escrow.debitRematch(a.room)).ok).toBe(true);
    const M1 = a.room.pokerEscrow!.matchId;
    const r = t.restore(a.room);
    const report = await t.productionBootstrap([r]);
    expect(report.reconciled.get('OW8A')).toBe('funded');   // M1's own evidence is exact
    expect(report.recoveries.get('OW8A')).toBe('unbound_debit');
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    expect(await t.ledger(a.M, 'table_payout')).toBe(1);
    expect(await t.balance(a.U1)).toBe(balAfterM0.U1);
    expect(await t.balance(a.U2)).toBe(balAfterM0.U2);
    expect(await t.gameRows('OW8A')).toBe(0);
    await t.cleanup([a.U1, a.U2]);
  });

  it('a TRANSIENT DB failure is retry_pending, never permanent corruption', async () => {
    const t = await ctx('OW9');
    const a = await t.bankrollRoom('OW9A');
    const r = t.restore(a.room);
    t.escrow.__setReconcileFailure(true);
    const report = await t.productionBootstrap([r]);
    expect(report.reconciled.get('OW9A')).toBe('retry_pending');
    expect(report.recoveries.get('OW9A')).toBe('recovery_pending');
    expect(r.pokerFrozen).toBeUndefined();                   // NOT corruption
    expect(r.gameState).not.toBeNull();
    expect(r.pokerEscrow!.status).toBe('funded');
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);
    // The DB recovers → the very next boot proves exact ownership and resumes the table.
    t.escrow.__setReconcileFailure(false);
    const again = t.restore(r);
    const second = await t.productionBootstrap([again]);
    expect(second.reconciled.get('OW9A')).toBe('funded');
    expect(second.recoveries.get('OW9A')).toBe('live');
    expect(t.advance).toHaveBeenCalledTimes(1);
    expect(await t.escrow.refundBuyInsResult(again)).toBe('confirmed_refund');
    await t.cleanup([a.U1, a.U2]);
  });

  // ── FAIL 3 — secret-free economy logs ──────────────────────────────────────────────────────────

  it('FAIL 3 — real production economy logs never contain a matchId, userId or private field', async () => {
    const t = await ctx('OWA');
    const healthy = await t.bankrollRoom('OWAA');
    // An orphan that WILL be refunded (it is not protected) + a corrupt durable record.
    const orphan = await t.bankrollRoom('OWAB');
    const M_corrupt = `corr-${Math.floor(Date.now() % 1e7)}`;
    const badSeats = JSON.stringify([{ seat: 0, userId: healthy.U1, amount: BUY_IN }, { seat: 1, userId: healthy.U2, amount: 1 }]);
    await t.conn!.sql`INSERT INTO poker_matches (match_id, room_code, buy_in, seats) VALUES (${M_corrupt}, 'OWAZ', ${BUY_IN}, ${badSeats}::jsonb)`;

    const logs: string[] = [];
    const sl = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    const se = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
    try {
      // (a) the corrupt-durable scan + a valid orphan refund…
      await scopedOrphanScan((m) => t.codes.has(m.roomCode) || m.matchId === M_corrupt, new Set([healthy.M]));
      // (b) …an invalid payout validation…
      const bad = { ...finished2p(), stacksBySeat: [1, 1] } as unknown as PokerState;
      expect(await t.escrow.payoutStacks(healthy.room, bad)).toBe('invalid');
      // (c) …and a repeated bootstrap of a corrupt-evidence room.
      await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${healthy.M}`;
      const r = t.restore(healthy.room);
      await t.productionBootstrap([r]);
      await t.productionBootstrap([t.restore(r)]);
    } finally { sl.mockRestore(); se.mockRestore(); }

    const joined = logs.join('\n');
    for (const secret of [healthy.M, orphan.M, M_corrupt, healthy.U1, healthy.U2, orphan.U1, orphan.U2, 'pokerGameMatchId', 'pokerEscrow', 'stacksBySeat', 'idempotency']) {
      expect(joined).not.toContain(secret);
    }
    // Safe operational context IS allowed, and the freeze is not repeated.
    expect(joined).toContain('OWAB');                       // room code
    expect(t.frozenLog.filter((l) => l.startsWith('OWAA —'))).toHaveLength(1);
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M_corrupt}`;
    await t.cleanup([healthy.U1, healthy.U2, orphan.U1, orphan.U2]);
  });
});
