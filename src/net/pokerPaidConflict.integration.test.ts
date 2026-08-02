import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { scopedOrphanScan, withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 37.7.19 (integration, real Postgres).
//
// FAIL 1: failed-start / seat-divergence / rematch / runtime-unbound callers collapsed the precise
// `RefundResult` back into a boolean, so `already_paid` (and `invalid`) were answered as a transient
// "settlement pending" — while `refundBuyInsResult` had ALREADY moved the escrow to `settled`. The
// room then matched no pending predicate, unblocked, and a later START debited a NEW buy-in.
// FAIL 2: `debitFreshStart`/`debitRematch` trusted the room JSON's TERMINAL status and cleared the
// escrow, so an unconfirmed/contradicted/structurally broken terminal claim could be replaced by a
// fresh paid match.
// FAIL 3: the runtime orphan scan built its protection set and then read `poker_matches`, so a START
// committing in that window had its LIVE match refunded while the room stayed funded+live.

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

describe.skipIf(!TEST_DATABASE_URL)('paid-conflict closure + terminal proof + scan/debit serialization (Stage 37.7.19)', () => {
  async function ctx(prefix: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { bindGameToEscrow, resolveUnboundEscrowGame } = await import('../../server/pokerBinding');
    const { runRuntimeEconomyRecovery } = await import('../../server/pokerBootstrap');
    const { runBankrollRematch } = await import('../../server/pokerRematch');
    const { createRoom, addMember, serializeRoom, deserializeRoom, snapshot } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const codes = new Set<string>();
    const advance = vi.fn();
    const clearTimers = vi.fn();
    const persist = vi.fn();
    const frozenLog: string[] = [];
    const freeze = (r: ServerRoom, reason: string) => { if (!r.pokerFrozen) { r.pokerFrozen = true; frozenLog.push(`${r.code} — ${reason}`); } };
    const policy = { freeze, persist, clearTimers };

    const runtimePass = (rooms: ServerRoom[], scan?: (ids: Set<string>, rc?: ReadonlySet<string>) => Promise<{ refunded: string[]; corrupt: string[] }>) =>
      runRuntimeEconomyRecovery(rooms, {
        reconcileEscrow: escrow.resolveEscrowEvidence, isFinished: isFin, refundBuyIns: escrow.refundBuyInsResult,
        rescheduleAdvance: advance, persist, clearTimers, freeze,
        isBankrollRoom: escrow.isBankrollRoom, withRoomLock: escrow.withRoomLock,
        roomExists: () => true, currentRooms: () => rooms, log: () => {}, logError: () => {},
        reconcileOrphanedDebits: scan ?? ((ids, rc) => scopedOrphanScan((m) => codes.has(m.roomCode), ids, rc)),
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
      return { room, code, U1, U2, M: room.pokerEscrow!.matchId };
    }

    const ledger = async (M: string, reason: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = ${reason}`) as Array<{ n: number }>)[0].n;
    const settlementOutcome = async (M: string) => ((await conn!.sql`SELECT outcome FROM poker_match_settlements WHERE match_id = ${M}`) as Array<{ outcome: string }>)[0]?.outcome ?? null;
    const matchCount = async (code: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_matches WHERE room_code = ${code}`) as Array<{ n: number }>)[0].n;
    const balance = async (u: string) => (await wallet.getWalletView(u, DAY)).balance;
    const cleanup = async (ids: string[]) => {
      for (const c of codes) await conn!.sql`DELETE FROM poker_matches WHERE room_code = ${c}`;
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN ${conn!.sql(ids)}`;
      await conn!.sql`DELETE FROM users WHERE id IN ${conn!.sql(ids)}`;
    };
    return {
      escrow, wallet, conn, snapshot, serializeRoom, deserializeRoom, bankrollRoom, runtimePass,
      runBankrollRematch, resolveUnboundEscrowGame, bindGameToEscrow, policy, freeze, persist, clearTimers,
      ledger, settlementOutcome, matchCount, balance, cleanup, advance, frozenLog, codes,
    };
  }

  // ── FAIL 1 — already_paid / invalid are permanent everywhere ───────────────────────────────────

  it('a failed START whose refund finds a PAID match freezes the table and blocks a new debit', async () => {
    const t = await ctx('PC1');
    const a = await t.bankrollRoom('PC1A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    const paid = { U1: await t.balance(a.U1), U2: await t.balance(a.U2) };
    a.room.pokerEscrow!.status = 'funded';                    // the room still believes it is funded

    // The SHARED policy every failed-start caller applies.
    const disp = t.escrow.applyRefundOutcome(a.room, await t.escrow.refundBuyInsResult(a.room), t.policy, { escrowExpected: true });
    expect(disp).toBe('frozen');
    expect(a.room.pokerFrozen).toBe(true);
    expect(a.room.pokerMatchCancelled).toBeUndefined();
    expect(a.room.pokerEscrow!.status).toBe('settled');        // the paid escrow is KEPT as evidence
    expect(t.frozenLog).toEqual(['PC1A — paid match cannot be refunded']);
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);

    // A retried START must NOT debit a brand-new match.
    a.room.started = false; a.room.gameState = null;
    const retry = await t.escrow.debitFreshStart(a.room);
    expect(retry.ok).toBe(false);
    expect(await t.matchCount('PC1A')).toBe(1);
    expect(await t.balance(a.U1)).toBe(paid.U1);
    expect(await t.balance(a.U2)).toBe(paid.U2);
    // The public snapshot stays opaque.
    expect(JSON.parse(JSON.stringify(t.snapshot(a.room))).pokerRecovery).toBe('frozen');
    await t.cleanup([a.U1, a.U2]);
  });

  it('a REMATCH whose restart fails over a PAID match returns paid_conflict, keeps evidence, freezes', async () => {
    const t = await ctx('PC2');
    const a = await t.bankrollRoom('PC2A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    const bound = a.room.pokerGameMatchId;
    // The rematch debit succeeds, the restart fails, and the refund finds the payout already won.
    const out = await t.runBankrollRematch(a.room, {
      debitRematch: async (r) => { r.pokerEscrow!.status = 'funded'; return { ok: true }; },
      refundBuyIns: t.escrow.refundBuyInsResult, freeze: t.freeze,
      restartGame: () => ({ ok: false, error: 'ILLEGAL_ACTION' as const }),
      forgetFinish: () => {}, clearRematch: () => {}, broadcastRematch: () => {}, broadcastRoom: () => {},
      logDeal: () => {}, advance: () => {}, persist: t.persist,
    });
    expect(out).toBe('paid_conflict');
    expect(a.room.pokerFrozen).toBe(true);
    expect(a.room.pokerMatchCancelled).toBeUndefined();
    expect(a.room.gameState).not.toBeNull();                   // evidence NOT cleared
    expect(a.room.pokerGameMatchId).toBe(bound);
    expect(t.escrow.pokerRecoveryBlocked(a.room)).toBe(true);
    expect((await t.escrow.debitRematch(a.room)).ok).toBe(false);
    expect(await t.matchCount('PC2A')).toBe(1);
    await t.cleanup([a.U1, a.U2]);
  });

  it('the runtime UNBOUND sweep freezes a paid conflict in the SAME tick and stays idempotent', async () => {
    const t = await ctx('PC3');
    const a = await t.bankrollRoom('PC3A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    expect((await t.escrow.debitRematch(a.room)).ok).toBe(true);
    const M1 = a.room.pokerEscrow!.matchId;
    // The payout for M1 lands first (the race this stage closes).
    await t.conn!.sql`INSERT INTO poker_match_settlements (match_id, outcome) VALUES (${M1}, 'payout')`;

    const res = await t.resolveUnboundEscrowGame(a.room, {
      refundBuyIns: t.escrow.refundBuyInsResult, persist: t.persist, clearTimers: t.clearTimers,
    });
    expect(res).toBe('paid_conflict');
    // The production sweep branch turns that into a permanent frozen table.
    const disp = t.escrow.applyRefundOutcome(a.room, 'already_paid', t.policy, { escrowExpected: true });
    expect(disp).toBe('frozen');
    expect(a.room.pokerFrozen).toBe(true);
    expect(a.room.pokerMatchCancelled).toBeUndefined();
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(0);
    // Idempotent: a second tick changes nothing and never re-logs.
    t.escrow.applyRefundOutcome(a.room, 'already_paid', t.policy, { escrowExpected: true });
    expect(t.frozenLog).toHaveLength(1);
    expect(t.escrow.pokerRecoveryBlocked(a.room)).toBe(true);
    await t.cleanup([a.U1, a.U2]);
  });

  it('`invalid` is permanent too, and only a confirmed refund cancels', async () => {
    const t = await ctx('PC4');
    const a = await t.bankrollRoom('PC4A');
    expect(t.escrow.applyRefundOutcome(a.room, 'invalid', t.policy, { escrowExpected: true })).toBe('frozen');
    expect(a.room.pokerMatchCancelled).toBeUndefined();
    const b = await t.bankrollRoom('PC4B');
    expect(t.escrow.applyRefundOutcome(b.room, 'retry_pending', t.policy, { escrowExpected: true })).toBe('settlement_pending');
    expect(b.room.pokerMatchCancelled).toBeUndefined();
    expect(b.room.pokerFrozen).toBeUndefined();
    expect(t.escrow.applyRefundOutcome(b.room, 'confirmed_refund', t.policy, { escrowExpected: true })).toBe('cancelled');
    expect(b.room.pokerMatchCancelled).toBe(true);
    // `nothing_to_refund` is NOT a success where an escrow was expected.
    const c = await t.bankrollRoom('PC4C');
    expect(t.escrow.applyRefundOutcome(c.room, 'nothing_to_refund', t.policy, { escrowExpected: true })).toBe('frozen');
    for (const r of [a, b, c]) expect(await t.ledger(r.M, 'table_cancel_refund')).toBe(0);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2, c.U1, c.U2]);
  });

  // ── FAIL 2 — a terminal claim is re-proved before a new generation replaces it ─────────────────

  it('a TERMINAL escrow is re-proved before reuse: unconfirmed / contradicted / broken all refuse', async () => {
    const t = await ctx('PC5');
    // (1) room says cancelled, the DB has NO settlement row.
    const a = await t.bankrollRoom('PC5A');
    a.room.pokerEscrow!.status = 'cancelled';
    a.room.started = false; a.room.gameState = null;
    const ra = await t.escrow.debitFreshStart(a.room);
    expect(ra).toMatchObject({ ok: false, paidConflict: true });
    expect(await t.matchCount('PC5A')).toBe(1);
    expect(a.room.pokerEscrow!.matchId).toBe(a.M);            // the escrow is NOT cleared

    // (2) room says cancelled, the DB says PAYOUT.
    const b = await t.bankrollRoom('PC5B', finished2p());
    expect(await t.escrow.payoutStacks(b.room, finished2p())).toBe('paid');
    b.room.pokerEscrow!.status = 'cancelled';
    b.room.started = false; b.room.gameState = null;
    expect(await t.escrow.debitFreshStart(b.room)).toMatchObject({ ok: false, paidConflict: true });
    expect(await t.matchCount('PC5B')).toBe(1);

    // (3) room says settled, the DB says REFUND.
    const c = await t.bankrollRoom('PC5C');
    expect(await t.escrow.refundBuyInsResult(c.room)).toBe('confirmed_refund');
    c.room.pokerEscrow!.status = 'settled';
    c.room.started = false; c.room.gameState = null;
    expect(await t.escrow.debitFreshStart(c.room)).toMatchObject({ ok: false, paidConflict: true });
    expect(await t.matchCount('PC5C')).toBe(1);

    // (4) an EXACT terminal status whose durable record is broken.
    const d = await t.bankrollRoom('PC5D');
    expect(await t.escrow.refundBuyInsResult(d.room)).toBe('confirmed_refund');
    await t.conn!.sql`UPDATE poker_matches SET buy_in = 9000 WHERE match_id = ${d.M}`;
    d.room.started = false; d.room.gameState = null;
    expect(await t.escrow.debitFreshStart(d.room)).toMatchObject({ ok: false, paidConflict: true });
    expect(await t.matchCount('PC5D')).toBe(1);

    // (5) a TRANSIENT evidence read keeps the escrow and stays retryable.
    const e = await t.bankrollRoom('PC5E');
    expect(await t.escrow.refundBuyInsResult(e.room)).toBe('confirmed_refund');
    e.room.started = false; e.room.gameState = null;
    t.escrow.__setReconcileFailure(true);
    expect(await t.escrow.debitFreshStart(e.room)).toMatchObject({ ok: false, settlementPending: true });
    expect(e.room.pokerEscrow!.matchId).toBe(e.M);
    expect(await t.matchCount('PC5E')).toBe(1);
    t.escrow.__setReconcileFailure(false);
    // …and once proven, a fresh START mints EXACTLY one new match.
    expect((await t.escrow.debitFreshStart(e.room)).ok).toBe(true);
    expect(e.room.pokerEscrow!.matchId).not.toBe(e.M);
    expect(await t.matchCount('PC5E')).toBe(2);
    expect(await t.escrow.refundBuyInsResult(e.room)).toBe('confirmed_refund');
    await t.cleanup([a.U1, a.U2, b.U1, b.U2, c.U1, c.U2, d.U1, d.U2, e.U1, e.U2]);
  });

  it('an EXACT paid, fully-finished lifecycle still allows exactly one rematch debit', async () => {
    const t = await ctx('PC6');
    const a = await t.bankrollRoom('PC6A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    expect((await t.escrow.debitRematch(a.room)).ok).toBe(true);
    const M1 = a.room.pokerEscrow!.matchId;
    expect(M1).not.toBe(a.M);
    expect(await t.matchCount('PC6A')).toBe(2);
    // A repeat is refused (the new escrow is not terminal) — never a double debit.
    expect((await t.escrow.debitRematch(a.room)).ok).toBe(false);
    expect(await t.matchCount('PC6A')).toBe(2);
    // Owed stats block reuse of a paid escrow.
    const b = await t.bankrollRoom('PC6B', finished2p());
    expect(await t.escrow.payoutStacks(b.room, finished2p())).toBe('paid');
    b.room.pokerStatsPending = true;
    expect(await t.escrow.debitRematch(b.room)).toMatchObject({ ok: false, paidConflict: true });
    expect(await t.matchCount('PC6B')).toBe(1);
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('confirmed_refund');
    await t.cleanup([a.U1, a.U2, b.U1, b.U2]);
  });

  // ── FAIL 3 — the scan and durable debits are serialized ────────────────────────────────────────

  it('a START that begins inside the scan window never has its LIVE match refunded', async () => {
    const t = await ctx('PC7');
    // A clean lobby (no escrow) — protection is built for it BEFORE any match exists.
    const seed = await t.bankrollRoom('PC7A');
    expect(await t.escrow.refundBuyInsResult(seed.room)).toBe('confirmed_refund');
    seed.room.started = false; seed.room.gameState = null;
    seed.room.pokerMatchCancelled = true;

    let started: Promise<unknown> | null = null;
    const report = await t.runtimePass([seed.room], async (ids, rc) => {
      // Exactly the TOCTOU window: the protection set is already built. Launch the production paid
      // start WITHOUT awaiting it — the economy barrier must make it wait for this scan.
      started = (async () => {
        const debit = await t.escrow.debitFreshStart(seed.room);
        expect(debit.ok).toBe(true);
        seed.room.started = true;
        seed.room.gameState = live2p() as unknown as typeof seed.room.gameState;
        t.bindGameToEscrow(seed.room);
      })();
      await new Promise((r) => setTimeout(r, 30));
      return scopedOrphanScan((m) => t.codes.has(m.roomCode), ids, rc);
    });
    await started;
    const liveMatch = seed.room.pokerEscrow!.matchId;
    expect(liveMatch).not.toBe(seed.M);
    // The LIVE match must be untouched by that scan, whichever side of the barrier it landed on.
    expect(report.orphanRefunded).not.toContain(liveMatch);
    expect(await t.settlementOutcome(liveMatch)).toBeNull();
    expect(await t.ledger(liveMatch, 'table_cancel_refund')).toBe(0);
    expect(seed.room.pokerEscrow!.status).toBe('funded');
    expect(seed.room.gameState).not.toBeNull();
    expect(await t.balance(seed.U1)).toBe(CLAIM - BUY_IN);
    // A LATER scan still protects it (it is a live bound match), and never re-arms its advance.
    const second = await t.runtimePass([seed.room]);
    expect(second.orphanRefunded).not.toContain(liveMatch);
    expect(await t.settlementOutcome(liveMatch)).toBeNull();
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.escrow.refundBuyInsResult(seed.room)).toBe('confirmed_refund');
    await t.cleanup([seed.U1, seed.U2]);
  });

  it('a scan already in flight makes a START wait — no deadlock, exactly one debit', async () => {
    const t = await ctx('PC8');
    const a = await t.bankrollRoom('PC8A');
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('confirmed_refund');
    a.room.started = false; a.room.gameState = null;

    let scanDone = false;
    let debitDone = false;
    const scan = t.escrow.withEconomyBarrier(async () => {
      await new Promise((r) => setTimeout(r, 40));
      scanDone = true;
    });
    // The START takes its room lock and then the barrier — the documented lock order.
    const start = t.escrow.withRoomLock(a.room.code, async () => {
      const res = await t.escrow.debitFreshStart(a.room);
      debitDone = true;
      expect(scanDone).toBe(true);                    // the debit waited for the scan
      return res;
    });
    await scan;
    expect(debitDone).toBe(false);                    // …and had not committed before it finished
    expect((await start).ok).toBe(true);
    expect(await t.matchCount('PC8A')).toBe(2);       // exactly ONE new match
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('confirmed_refund');
    await t.cleanup([a.U1, a.U2]);
  });
});
