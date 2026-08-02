import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { scopedOrphanScan, withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 37.7.16 (integration, real Postgres). Drives the PRODUCTION bootstrap, finish and teardown
// paths.
//
// FAIL 1: `validateDurableOwnership` checked the SETTLEMENT ROW FIRST and returned, so a committed
// payout/refund skipped the structural proof entirely — a settled match with a missing/mismatched
// durable record became `paid_finish` (and wrote stats attributed from the ROOM escrow alone), and a
// refunded one became `cancelled`, wiping the operator's evidence.
// FAIL 2: `settled`/`cancelled` escrows were never validated at all (the evidence pass filtered on
// `hasUnsettledEscrow`), so a TERMINAL status in room JSON was trusted as DB proof.
// FAIL 3: a FRESH payout/refund claimed the settlement row and moved chips with no settlement-time
// durable proof, so a record destroyed/altered after the start could still be paid or refunded.
// FAIL 4: the evidence loader ran three separate READ COMMITTED statements, so a concurrently
// committing atomic debit could be observed as "no durable row" + "N debits" → a false freeze.

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

describe.skipIf(!TEST_DATABASE_URL)('terminal settlement integrity + settlement-time durable guard (Stage 37.7.16)', () => {
  async function ctx(prefix: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
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
      reconcileEscrow: escrow.resolveEscrowEvidence, isFinished: isFin, refundBuyIns: escrow.refundBuyInsResult,
      rescheduleAdvance: advance, persist, clearTimers, freeze,
    });
    async function productionBootstrap(restored: ServerRoom[]) {
      return runBootstrapEconomyRecovery(restored, {
        ...recoveryDeps(),
        isBankrollRoom: escrow.isBankrollRoom, hasUnsettledEscrow: escrow.hasUnsettledEscrow,
        reconcileCorruptRoom: escrow.reconcileCorruptRoom, withRoomLock: escrow.withRoomLock,
        roomExists: () => true, currentRooms: () => restored, log: () => {}, logError: () => {},
        reconcileOrphanedDebits: (ids) => scopedOrphanScan((m) => codes.has(m.roomCode), ids),
      });
    }
    const marker = new Map<string, string>();
    const statsDeps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); },
      record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });
    const finish = (r: ServerRoom) => settleAndRecordBankrollPokerFinish(r, r.gameState as PokerState, {
      payoutStacks: escrow.payoutStacks, persist, broadcast: () => {}, clearRematch: () => {}, freeze,
      recordStats: (rm, st) => recordConfirmedPokerStats(rm, st, statsDeps()),
    });
    const teardown = (r: ServerRoom) => settleRoomForDeletion(r, {
      reconcileEscrow: escrow.resolveEscrowEvidence, hasUnsettledEscrow: escrow.hasUnsettledEscrow, isFinished: isFin,
      settleAndRecord: finish, refundBuyIns: escrow.refundBuyInsResult, persist, freeze, clearTimers,
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
    const gameRows = async (c: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${c}`) as Array<{ n: number }>)[0].n;
    const balance = async (u: string) => (await wallet.getWalletView(u, DAY)).balance;
    const restore = (r: ServerRoom) => deserializeRoom(serializeRoom(r))!;
    const cleanup = async (ids: string[]) => {
      for (const c of codes) {
        await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${c})`;
        await conn!.sql`DELETE FROM games WHERE room_code = ${c}`;
        await conn!.sql`DELETE FROM poker_matches WHERE room_code = ${c}`;
      }
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN ${conn!.sql(ids)}`;
      await conn!.sql`DELETE FROM users WHERE id IN ${conn!.sql(ids)}`;
    };

    /** Bootstrap and assert the full fail-closed contract for unprovable evidence. */
    async function expectFrozen(room: ServerRoom, code: string, M: string, U1: string, expectSettlements = 0) {
      const r = restore(room);
      const before = await balance(U1);
      const report = await productionBootstrap([r]);
      expect(report.recoveries.get(code)).toBe('corrupt_debit');
      expect(r.pokerFrozen).toBe(true);
      expect(advance).not.toHaveBeenCalled();
      expect(r.gameState).not.toBeNull();                  // evidence kept, never cleaned up
      expect(r.pokerGameMatchId).toBeDefined();
      expect(r.pokerEscrow).toBeDefined();
      expect(r.pokerMatchCancelled).toBeUndefined();
      expect(await settlements(M)).toBe(expectSettlements); // never a NEW settlement row
      expect(await gameRows(code)).toBe(0);                 // never any stats
      expect(await balance(U1)).toBe(before);
      // A frozen room refuses a direct stats write too, and is never purged.
      expect(await recordConfirmedPokerStats(r, r.gameState as PokerState, statsDeps())).toBe('invalid');
      expect(await gameRows(code)).toBe(0);
      expect(await teardown(r)).toBe('keep');
      expect(JSON.parse(JSON.stringify(snapshot(r))).pokerRecovery).toBe('frozen');
      return r;
    }

    return {
      escrow, wallet, conn, users, snapshot, restore, bankrollRoom, productionBootstrap, finish, teardown,
      recordConfirmedPokerStats, statsDeps, ledger, settlements, gameRows, balance, cleanup, expectFrozen,
      advance, frozenLog, codes,
    };
  }

  // ── FAIL 1 + FAIL 2 — a settlement row never excuses a structural failure ──────────────────────

  it('A — settled + payout row + finished state + MISSING durable row → frozen, no stats', async () => {
    const t = await ctx('SI1');
    const a = await t.bankrollRoom('SI1A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${a.M}`;
    await t.expectFrozen(a.room, 'SI1A', a.M, a.U1, 1); // the payout row stays — money really moved
    expect(await t.ledger(a.M, 'table_payout')).toBe(1); // never repeated
    await t.cleanup([a.U1, a.U2]);
  });

  it('B — settled + payout row + a MISMATCHED durable participant set → frozen, no stats', async () => {
    const t = await ctx('SI2');
    const a = await t.bankrollRoom('SI2A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    const other = await t.users.createAccountUser({ email: null, name: 'SI2X', emailVerified: false });
    const seats = JSON.stringify([{ seat: 0, userId: a.U1, amount: BUY_IN }, { seat: 1, userId: other, amount: BUY_IN }]);
    await t.conn!.sql`UPDATE poker_matches SET seats = ${seats}::jsonb WHERE match_id = ${a.M}`;
    await t.expectFrozen(a.room, 'SI2A', a.M, a.U1, 1);
    expect(await t.ledger(a.M, 'table_payout')).toBe(1);
    await t.cleanup([a.U1, a.U2, other]);
  });

  it('C — cancelled + refund row + CORRUPT durable row → frozen; the state is NOT cleared', async () => {
    const t = await ctx('SI3');
    const a = await t.bankrollRoom('SI3A');
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('confirmed_refund');
    const bad = JSON.stringify([{ seat: 0, userId: a.U1, amount: BUY_IN }, { seat: 1, userId: a.U2, amount: 1 }]);
    await t.conn!.sql`UPDATE poker_matches SET seats = ${bad}::jsonb WHERE match_id = ${a.M}`;
    const r = await t.expectFrozen(a.room, 'SI3A', a.M, a.U1, 1);
    expect(r.gameState).not.toBeNull();
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(2); // never repeated
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${a.M}`;
    await t.cleanup([a.U1, a.U2]);
  });

  it('D/E/F — a TERMINAL room status the DB does not confirm (or contradicts) freezes', async () => {
    const t = await ctx('SI4');
    // D: room says settled, the DB has NO settlement row.
    const d = await t.bankrollRoom('SI4D', finished2p());
    d.room.pokerEscrow!.status = 'settled';
    const rd = t.restore(d.room);
    const repD = await t.productionBootstrap([rd]);
    expect(repD.reconciled.get('SI4D')).toBe('terminal_unconfirmed');
    expect(repD.recoveries.get('SI4D')).toBe('corrupt_debit');
    expect(rd.pokerFrozen).toBe(true);
    expect(await t.gameRows('SI4D')).toBe(0);
    expect(await t.settlements(d.M)).toBe(0);

    // E: room says settled, the DB outcome is a REFUND.
    const e = await t.bankrollRoom('SI4E', finished2p());
    expect(await t.escrow.refundBuyInsResult(e.room)).toBe('confirmed_refund');
    e.room.pokerEscrow!.status = 'settled';
    const re = t.restore(e.room);
    const repE = await t.productionBootstrap([re]);
    expect(repE.reconciled.get('SI4E')).toBe('terminal_conflict');
    expect(repE.recoveries.get('SI4E')).toBe('corrupt_debit');
    expect(re.pokerFrozen).toBe(true);
    expect(re.gameState).not.toBeNull();
    expect(await t.gameRows('SI4E')).toBe(0);

    // F: room says cancelled, the DB outcome is a PAYOUT.
    const f = await t.bankrollRoom('SI4F', finished2p());
    expect(await t.escrow.payoutStacks(f.room, finished2p())).toBe('paid');
    f.room.pokerEscrow!.status = 'cancelled';
    const rf = t.restore(f.room);
    const repF = await t.productionBootstrap([rf]);
    expect(repF.reconciled.get('SI4F')).toBe('terminal_conflict');
    expect(repF.recoveries.get('SI4F')).toBe('corrupt_debit');
    expect(rf.gameState).not.toBeNull();          // the old code CLEARED it as a cancelled lobby
    expect(rf.pokerMatchCancelled).toBeUndefined();
    expect(await t.ledger(f.M, 'table_payout')).toBe(1);
    expect(t.advance).not.toHaveBeenCalled();
    await t.cleanup([d.U1, d.U2, e.U1, e.U2, f.U1, f.U2]);
  });

  it('G/H — EXACT settled payout is a normal paid_finish; EXACT settled refund a normal cancel', async () => {
    const t = await ctx('SI5');
    // G: exact payout → paid_finish, payout not repeated, stats exactly once.
    const g = await t.bankrollRoom('SI5G', finished2p());
    expect(await t.escrow.payoutStacks(g.room, finished2p())).toBe('paid');
    const paid = await t.balance(g.U2);
    const rg = t.restore(g.room);
    const repG = await t.productionBootstrap([rg]);
    expect(repG.reconciled.get('SI5G')).toBe('settled');
    expect(repG.recoveries.get('SI5G')).toBe('paid_finish');
    expect(rg.pokerFrozen).toBeUndefined();
    expect(rg.pokerStatsPending).toBe(true);
    expect(await t.recordConfirmedPokerStats(rg, rg.gameState as PokerState, t.statsDeps())).toBe('recorded');
    expect(await t.gameRows('SI5G')).toBe(1);
    expect(await t.recordConfirmedPokerStats(rg, rg.gameState as PokerState, t.statsDeps())).toBe('already_exists');
    expect(await t.gameRows('SI5G')).toBe(1);
    expect(await t.ledger(g.M, 'table_payout')).toBe(1);
    expect(await t.balance(g.U2)).toBe(paid);

    // H: exact refund → cancelled lobby, refund not repeated.
    const h = await t.bankrollRoom('SI5H');
    expect(await t.escrow.refundBuyInsResult(h.room)).toBe('confirmed_refund');
    const rh = t.restore(h.room);
    const repH = await t.productionBootstrap([rh]);
    expect(repH.reconciled.get('SI5H')).toBe('cancelled');
    expect(repH.recoveries.get('SI5H')).toBe('cancelled');
    expect(rh.gameState).toBeNull();
    expect(rh.pokerMatchCancelled).toBe(true);
    expect(await t.ledger(h.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(h.U1)).toBe(CLAIM);
    await t.cleanup([g.U1, g.U2, h.U1, h.U2]);
  });

  // ── FAIL 3 — the settlement-time atomic ownership guard ────────────────────────────────────────

  it('1-3 — a FRESH payout is refused when the durable row/metadata/ledger changed after START', async () => {
    const t = await ctx('SI6');
    // (1) the durable row was deleted between START and the finish.
    const a = await t.bankrollRoom('SI6A', finished2p());
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${a.M}`;
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('invalid');
    expect(await t.ledger(a.M, 'table_payout')).toBe(0);
    expect(await t.settlements(a.M)).toBe(0);
    expect(await t.balance(a.U2)).toBe(CLAIM - BUY_IN);
    // …and the finish flow turns that into a permanent frozen table with no stats.
    const outA = await t.finish(a.room);
    expect(outA.result).toBe('invalid');
    expect(outA.stats).toBeNull();
    expect(a.room.pokerFrozen).toBe(true);
    expect(await t.gameRows('SI6A')).toBe(0);

    // (2) the durable metadata was altered.
    const b = await t.bankrollRoom('SI6B', finished2p());
    await t.conn!.sql`UPDATE poker_matches SET room_code = 'ZZZZ' WHERE match_id = ${b.M}`;
    expect(await t.escrow.payoutStacks(b.room, finished2p())).toBe('invalid');
    expect(await t.ledger(b.M, 'table_payout')).toBe(0);
    expect(await t.settlements(b.M)).toBe(0);

    // (3) the buy-in ledger was altered.
    const c = await t.bankrollRoom('SI6C', finished2p());
    await t.conn!.sql`UPDATE poker_ledger SET delta = -1 WHERE match_id = ${c.M} AND user_id = ${c.U2}`;
    expect(await t.escrow.payoutStacks(c.room, finished2p())).toBe('invalid');
    expect(await t.ledger(c.M, 'table_payout')).toBe(0);
    expect(await t.settlements(c.M)).toBe(0);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2, c.U1, c.U2]);
  });

  it('4 — an unfinished TEARDOWN refund is refused the same way: keep + frozen, nothing written', async () => {
    const t = await ctx('SI7');
    const a = await t.bankrollRoom('SI7A');
    await t.conn!.sql`UPDATE poker_matches SET buy_in = 9000 WHERE match_id = ${a.M}`;
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('invalid');
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);
    expect(await t.settlements(a.M)).toBe(0);
    expect(await t.balance(a.U1)).toBe(CLAIM - BUY_IN);
    // The production teardown keeps AND freezes it (never purged, never swept forever).
    a.room.gameState = null; a.room.started = false;
    expect(await t.teardown(a.room)).toBe('keep');
    expect(a.room.pokerFrozen).toBe(true);
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);
    expect(await t.settlements(a.M)).toBe(0);
    await t.cleanup([a.U1, a.U2]);
  });

  it('5-6 — the EXACT healthy finish and the EXACT healthy unfinished teardown still work', async () => {
    const t = await ctx('SI8');
    // 5: healthy finish → payout once + stats once.
    const a = await t.bankrollRoom('SI8A', finished2p());
    const out = await t.finish(a.room);
    expect(out.result).toBe('paid');
    expect(out.stats).toBe('recorded');
    expect(await t.ledger(a.M, 'table_payout')).toBe(1);
    expect(await t.gameRows('SI8A')).toBe(1);
    expect(a.room.pokerFrozen).toBeUndefined();
    // 6: healthy unfinished teardown → refund once, purge.
    const b = await t.bankrollRoom('SI8B');
    b.room.gameState = null; b.room.started = false;
    expect(await t.teardown(b.room)).toBe('purge');
    expect(await t.ledger(b.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(b.U1)).toBe(CLAIM);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2]);
  });

  it('7-10 — replays: exact settlements stay idempotent; corrupt ones never mutate and freeze', async () => {
    const t = await ctx('SI9');
    // 7: an existing EXACT payout replays as already_paid; stats are allowed exactly once.
    const a = await t.bankrollRoom('SI9A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('already_paid');
    expect(await t.ledger(a.M, 'table_payout')).toBe(1);
    expect(await t.recordConfirmedPokerStats(a.room, finished2p(), t.statsDeps())).toBe('recorded');
    expect(await t.gameRows('SI9A')).toBe(1);

    // 8: an existing payout whose ownership is now CORRUPT → invalid, no re-pay, no stats.
    const b = await t.bankrollRoom('SI9B', finished2p());
    expect(await t.escrow.payoutStacks(b.room, finished2p())).toBe('paid');
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${b.M}`;
    expect(await t.escrow.payoutStacks(b.room, finished2p())).toBe('invalid');
    expect(await t.ledger(b.M, 'table_payout')).toBe(1);
    const outB = await t.finish(b.room);
    expect(outB.result).toBe('invalid');
    expect(outB.stats).toBeNull();
    expect(b.room.pokerFrozen).toBe(true);
    expect(await t.gameRows('SI9B')).toBe(0);

    // 9: an existing EXACT refund replays without a duplicate mutation.
    const c = await t.bankrollRoom('SI9C');
    expect(await t.escrow.refundBuyInsResult(c.room)).toBe('confirmed_refund');
    // (37.7.18 FAIL 1) The idempotent replay is still reported as a CONFIRMED REFUND.
    expect(await t.escrow.refundBuyInsResult(c.room)).toBe('confirmed_refund');
    expect(await t.ledger(c.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(c.U1)).toBe(CLAIM);

    // 10: an existing refund whose ownership is now CORRUPT → nothing more happens, evidence kept.
    const d = await t.bankrollRoom('SI9D');
    expect(await t.escrow.refundBuyInsResult(d.room)).toBe('confirmed_refund');
    await t.conn!.sql`UPDATE poker_matches SET buy_in = 9000 WHERE match_id = ${d.M}`;
    // (37.7.17 FAIL 3) The terminal fast path is no longer self-proof: the room's `cancelled` claim
    // is re-checked against the durable evidence, which no longer matches → `invalid` (freeze), and
    // still NO second mutation of any kind.
    expect(await t.escrow.refundBuyInsResult(d.room)).toBe('invalid');
    expect(await t.ledger(d.M, 'table_cancel_refund')).toBe(2);
    const rd = t.restore(d.room);
    const rep = await t.productionBootstrap([rd]);
    expect(rep.recoveries.get('SI9D')).toBe('corrupt_debit');
    expect(rd.pokerFrozen).toBe(true);
    expect(rd.gameState).not.toBeNull();
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${d.M}`;
    await t.cleanup([a.U1, a.U2, b.U1, b.U2, c.U1, c.U2, d.U1, d.U2]);
  });

  // ── FAIL 4 — one consistent evidence snapshot ──────────────────────────────────────────────────

  it('FAIL 4 — evidence is read from ONE snapshot: an atomic debit committing mid-read is never split', async () => {
    const t = await ctx('SIA');
    const U1 = await t.users.createAccountUser({ email: null, name: 'SIAA', emailVerified: false });
    const U2 = await t.users.createAccountUser({ email: null, name: 'SIAB', emailVerified: false });
    await t.wallet.dailyClaim(U1, DAY); await t.wallet.dailyClaim(U2, DAY);
    const M = `snap-${Math.floor(Date.now() % 1e7)}`;
    const seats = JSON.stringify([{ seat: 0, userId: U1, amount: BUY_IN }, { seat: 1, userId: U2, amount: BUY_IN }]);

    // The whole match (durable row + both debits) commits ATOMICALLY between the loader's reads.
    let fired = 0;
    t.wallet.__setEvidenceReadGap(async () => {
      if (fired++) return;
      await t.conn!.sql`INSERT INTO poker_matches (match_id, room_code, buy_in, seats) VALUES (${M}, 'SIAZ', ${BUY_IN}, ${seats}::jsonb)`;
      await t.conn!.sql`INSERT INTO poker_ledger (user_id, reason, delta, balance_after, idempotency_key, match_id, room_code)
        VALUES (${U1}, 'table_buy_in', ${-BUY_IN}, 0, ${`buyin:${M}:${U1}`}, ${M}, 'SIAZ'),
               (${U2}, 'table_buy_in', ${-BUY_IN}, 0, ${`buyin:${M}:${U2}`}, ${M}, 'SIAZ')`;
    });
    const ev = await t.wallet.matchDurableEvidence(M);
    t.wallet.__setEvidenceReadGap(null);
    expect(fired).toBe(1); // the gap really ran between the reads

    // A single snapshot can never report "no durable row" together with committed debits.
    expect(ev.matchRowExists ? ev.buyIns.length : 0).toBe(ev.buyIns.length);
    expect(ev.matchRowExists).toBe(false);
    expect(ev.buyIns).toHaveLength(0);
    expect(ev.settlement).toBeNull();
    // The very next read (a fresh snapshot) sees the whole atomic write.
    const after = await t.wallet.matchDurableEvidence(M);
    expect(after.matchRowExists).toBe(true);
    expect(after.buyIns).toHaveLength(2);

    await t.conn!.sql`DELETE FROM poker_ledger WHERE match_id = ${M}`;
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
    await t.conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });

  it('a transient evidence failure is retry_pending, and non-poker/local rooms are untouched', async () => {
    const t = await ctx('SIB');
    const a = await t.bankrollRoom('SIBA', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    t.escrow.__setReconcileFailure(true);
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('retry_pending'); // NOT invalid
    const r = t.restore(a.room);
    const rep = await t.productionBootstrap([r]);
    expect(rep.reconciled.get('SIBA')).toBe('retry_pending');
    expect(r.pokerFrozen).toBeUndefined();
    t.escrow.__setReconcileFailure(false);
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('already_paid');

    const { createRoom } = await import('./serverCore');
    const king = createRoom({ code: 'SIBK', playerCount: 4, modeSelectionType: 'fixed', gameType: 'king', host: { clientId: 'a', reconnectToken: 't', name: 'A' } });
    king.started = true; king.gameState = { phase: 'playing' } as unknown as typeof king.gameState;
    const local = createRoom({ code: 'SIBP', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A' } });
    local.started = true; local.gameState = live2p() as unknown as typeof local.gameState;
    const rep2 = await t.productionBootstrap([king, local]);
    expect(rep2.recoveries.size).toBe(0);
    expect(king.pokerFrozen).toBeUndefined();
    expect(local.pokerFrozen).toBeUndefined();
    expect(local.gameState).not.toBeNull();
    await t.cleanup([a.U1, a.U2]);
  });
});
