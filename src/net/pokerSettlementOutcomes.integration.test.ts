import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { scopedOrphanScan, withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 37.7.18 (integration, real Postgres).
//
// FAIL 1: `RefundResult` collapsed "refunded" and "the payout won the settlement race" into one
// `resolved`, so a SettlementConflictError (durable outcome = payout) was reported as a successful
// refund — the match entered the scan's `refunded` list and callers cancelled/wiped PAID tables.
// FAIL 2: `reconcileCorruptRoom` auto-refunded every durable match sharing the room's 4-char code,
// which is reused — a corrupt room could settle a different generation's healthy match.
// FAIL 3: the global orphan scan ran only at bootstrap, so a transient failure left a roomless
// orphan debited (and an `escrowless_unresolved` room inert) until the server was RESTARTED.

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

describe.skipIf(!TEST_DATABASE_URL)('settlement outcome integrity + runtime orphan recovery (Stage 37.7.18)', () => {
  async function ctx(prefix: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { bindGameToEscrow } = await import('../../server/pokerBinding');
    const { runRuntimeEconomyRecovery } = await import('../../server/pokerBootstrap');
    const { createRoom, addMember, serializeRoom, deserializeRoom, snapshot } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const codes = new Set<string>();
    const advance = vi.fn();
    const clearTimers = vi.fn();
    const persist = vi.fn();
    const frozenLog: string[] = [];
    const freeze = (r: ServerRoom, reason: string) => { if (!r.pokerFrozen) { r.pokerFrozen = true; frozenLog.push(`${r.code} — ${reason}`); } };

    /** The PRODUCTION runtime pass (server/index.ts `runtimeEconomyRecovery`), scoped to this suite. */
    const runtimePass = (rooms: ServerRoom[], scan?: (ids: Set<string>, rc?: ReadonlySet<string>) => Promise<{ refunded: string[]; corrupt: string[] }>) =>
      runRuntimeEconomyRecovery(rooms, {
        reconcileEscrow: escrow.resolveEscrowEvidence, isFinished: isFin, refundBuyIns: escrow.refundBuyInsResult,
        rescheduleAdvance: advance, persist, clearTimers, freeze,
        isBankrollRoom: escrow.isBankrollRoom, withRoomLock: escrow.withRoomLock,
        roomExists: () => true, log: () => {}, logError: () => {},
        reconcileOrphanedDebits: scan ?? ((ids, rc) => scopedOrphanScan((m) => codes.has(m.roomCode), ids, rc)),
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
    const settlementOutcome = async (M: string) => ((await conn!.sql`SELECT outcome FROM poker_match_settlements WHERE match_id = ${M}`) as Array<{ outcome: string }>)[0]?.outcome ?? null;
    const balance = async (u: string) => (await wallet.getWalletView(u, DAY)).balance;
    const restore = (r: ServerRoom) => deserializeRoom(serializeRoom(r))!;
    const escrowless = (r: ServerRoom) => { const out = restore(r); out.pokerEscrow = undefined; return out; };
    const cleanup = async (ids: string[]) => {
      for (const c of codes) await conn!.sql`DELETE FROM poker_matches WHERE room_code = ${c}`;
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN ${conn!.sql(ids)}`;
      await conn!.sql`DELETE FROM users WHERE id IN ${conn!.sql(ids)}`;
    };
    return { escrow, wallet, conn, users, snapshot, restore, escrowless, bankrollRoom, runtimePass, ledger, settlementOutcome, balance, cleanup, advance, frozenLog, codes };
  }

  // ── FAIL 1 — a payout is never reported as a refund ────────────────────────────────────────────

  it('a durable PAYOUT is reported as already_paid, never as a confirmed refund', async () => {
    const t = await ctx('SO1');
    const a = await t.bankrollRoom('SO1A', finished2p());
    expect(await t.escrow.payoutStacks(a.room, finished2p())).toBe('paid');
    const paid = { U1: await t.balance(a.U1), U2: await t.balance(a.U2) };
    a.room.pokerEscrow!.status = 'funded';                       // the room still believes it is funded
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('already_paid');
    expect(a.room.pokerEscrow!.status).toBe('settled');
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);
    expect(await t.settlementOutcome(a.M)).toBe('payout');
    expect(await t.balance(a.U1)).toBe(paid.U1);
    expect(await t.balance(a.U2)).toBe(paid.U2);
    // …and a genuine refund still reports a CONFIRMED refund, idempotently.
    const b = await t.bankrollRoom('SO1B');
    expect(await t.escrow.refundBuyInsResult(b.room)).toBe('confirmed_refund');
    expect(await t.escrow.refundBuyInsResult(b.room)).toBe('confirmed_refund');
    expect(await t.ledger(b.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(b.U1)).toBe(CLAIM);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2]);
  });

  it('the scan RACE (payout commits mid-settlement) never enters `refunded` and never cancels a room', async () => {
    const t = await ctx('SO2');
    const a = await t.bankrollRoom('SO2A', finished2p());
    const before = { U1: await t.balance(a.U1), U2: await t.balance(a.U2) };
    // The scan reads the match as unsettled; the payout commits before the refund claims the gate.
    let fired = 0;
    t.wallet.__setEvidenceReadGap(async () => {
      if (fired++) return;
      await t.conn!.sql`INSERT INTO poker_match_settlements (match_id, outcome) VALUES (${a.M}, 'payout')`;
    });
    const scan = await scopedOrphanScan((m) => t.codes.has(m.roomCode));
    t.wallet.__setEvidenceReadGap(null);
    expect(scan.refunded).not.toContain(a.M);
    expect(scan.alreadyPaid).toContain(a.M);          // reported on its OWN axis
    expect(await t.settlementOutcome(a.M)).toBe('payout');
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);
    expect(await t.balance(a.U1)).toBe(before.U1);
    expect(await t.balance(a.U2)).toBe(before.U2);

    // An ESCROWLESS room bound to that match must NOT be cancelled by such a "refund".
    const r = t.escrowless(a.room);
    const rep = await t.runtimePass([r]);
    expect(rep.orphanRefunded).not.toContain(a.M);
    expect(r.pokerMatchCancelled).toBeUndefined();
    expect(r.gameState).not.toBeNull();
    expect(r.pokerGameMatchId).toBe(a.M);
    expect(r.pokerFrozen).toBe(true);                 // a PAID match with no escrow → operator state
    await t.cleanup([a.U1, a.U2]);
  });

  // ── FAIL 2 — a room code never authorises a settlement ─────────────────────────────────────────

  it('a corrupt persisted escrow never auto-settles durable matches that share its room code', async () => {
    const t = await ctx('SO3');
    const one = await t.bankrollRoom('SO3A');
    const before = { U1: await t.balance(one.U1), U2: await t.balance(one.U2) };
    one.room.pokerEscrow = undefined;
    one.room.pokerEscrowCorrupt = true;
    expect(await t.escrow.reconcileCorruptRoom(one.room)).toBe(false);      // fail closed → freeze
    expect(await t.settlementOutcome(one.M)).toBeNull();
    expect(await t.ledger(one.M, 'table_cancel_refund')).toBe(0);
    expect(await t.balance(one.U1)).toBe(before.U1);
    expect(one.room.pokerEscrowCorrupt).toBe(true);

    // TWO generations sharing one reused code: neither may be auto-refunded, and a runtime pass
    // fail-closed PROTECTS the code so the global scan cannot settle either.
    const gen2 = await t.bankrollRoom('SO3B');
    await t.conn!.sql`UPDATE poker_matches SET room_code = 'SO3A' WHERE match_id = ${gen2.M}`;
    expect(await t.escrow.reconcileCorruptRoom(one.room)).toBe(false);
    const rep = await t.runtimePass([one.room]);
    expect(rep.protectedRoomCodes.has('SO3A')).toBe(true);
    expect(rep.orphanRefunded).not.toContain(one.M);
    expect(rep.orphanRefunded).not.toContain(gen2.M);
    for (const M of [one.M, gen2.M]) {
      expect(await t.settlementOutcome(M)).toBeNull();
      expect(await t.ledger(M, 'table_cancel_refund')).toBe(0);
    }
    // A repeated pass is idempotent — still no wallet mutation of any kind.
    await t.runtimePass([one.room]);
    expect(await t.balance(one.U1)).toBe(before.U1);
    expect(await t.balance(gen2.U1)).toBe(CLAIM - BUY_IN);
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id IN (${one.M}, ${gen2.M})`;
    await t.cleanup([one.U1, one.U2, gen2.U1, gen2.U2]);
  });

  // ── FAIL 3 — runtime retry without a restart ───────────────────────────────────────────────────

  it('a roomless orphan left by a TRANSIENT failure is refunded by the next runtime pass', async () => {
    const t = await ctx('SO4');
    const a = await t.bankrollRoom('SO4A');
    let fail = true;
    t.wallet.__setEvidenceReadGap(async () => { if (fail) throw new Error('transient'); });
    const first = await scopedOrphanScan((m) => t.codes.has(m.roomCode));
    expect(first.refunded).not.toContain(a.M);
    expect(first.retryable).toContain(a.M);
    expect(await t.balance(a.U1)).toBe(CLAIM - BUY_IN);   // still debited
    fail = false; t.wallet.__setEvidenceReadGap(null);

    // The RUNTIME pass (no restart) resolves it exactly once.
    const rep = await t.runtimePass([]);
    expect(rep.orphanRefunded).toContain(a.M);
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(a.U1)).toBe(CLAIM);
    const again = await t.runtimePass([]);
    expect(again.orphanRefunded).not.toContain(a.M);
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(2);
    await t.cleanup([a.U1, a.U2]);
  });

  it('an escrowless claim inert after a transient scan becomes a clean lobby on the next runtime pass', async () => {
    const t = await ctx('SO5');
    const a = await t.bankrollRoom('SO5A');
    const r = t.escrowless(a.room);
    // Pass 1: the scan fails → the claim stays inert with its evidence intact.
    const first = await t.runtimePass([r], async () => { throw new Error('transient'); });
    expect(first.reconciled.get('SO5A')).toBe('escrowless_unresolved');
    expect(first.recoveries.get('SO5A')).toBeUndefined();
    expect(r.gameState).not.toBeNull();
    expect(r.pokerGameMatchId).toBe(a.M);
    expect(r.pokerMatchCancelled).toBeUndefined();
    expect(r.pokerFrozen).toBeUndefined();
    expect(t.escrow.pokerRecoveryBlocked(r)).toBe(true);
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);
    // Pass 2: the real scan confirms the refund → and ONLY then is it a clean cancelled lobby.
    const second = await t.runtimePass([r]);
    expect(second.orphanRefunded).toContain(a.M);
    expect(second.recoveries.get('SO5A')).toBe('cancelled');
    expect(r.gameState).toBeNull();
    expect(r.pokerGameMatchId).toBeUndefined();
    expect(r.pokerMatchCancelled).toBe(true);
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(a.U1)).toBe(CLAIM);
    await t.cleanup([a.U1, a.U2]);
  });

  it('two concurrent runtime passes never double-settle, and healthy rooms are untouched', async () => {
    const t = await ctx('SO6');
    const orphan = await t.bankrollRoom('SO6A');
    const live = await t.bankrollRoom('SO6B');
    const paid = await t.bankrollRoom('SO6C', finished2p());
    expect(await t.escrow.payoutStacks(paid.room, finished2p())).toBe('paid');
    const paidBal = await t.balance(paid.U2);
    const rooms = [live.room, paid.room];

    const [x, y] = await Promise.all([t.runtimePass(rooms), t.runtimePass(rooms)]);
    const refundedTwice = x.orphanRefunded.filter((m) => y.orphanRefunded.includes(m));
    expect(refundedTwice.length).toBeLessThanOrEqual(1);              // at most one pass wins
    expect(await t.ledger(orphan.M, 'table_cancel_refund')).toBe(2);  // …and the credit happens ONCE
    expect(await t.balance(orphan.U1)).toBe(CLAIM);

    // A LIVE room is protected, never refunded, and its advance is NOT re-armed by a runtime tick.
    expect(await t.ledger(live.M, 'table_cancel_refund')).toBe(0);
    expect(await t.settlementOutcome(live.M)).toBeNull();
    expect(live.room.pokerEscrow!.status).toBe('funded');
    expect(live.room.gameState).not.toBeNull();
    expect(t.advance).not.toHaveBeenCalled();
    // A PAID room keeps its payout and is never refunded.
    expect(await t.settlementOutcome(paid.M)).toBe('payout');
    expect(await t.ledger(paid.M, 'table_cancel_refund')).toBe(0);
    expect(await t.balance(paid.U2)).toBe(paidBal);
    // The public snapshot of the live table leaks nothing.
    const snap = JSON.stringify(t.snapshot(live.room));
    for (const secret of [live.M, live.U1, live.U2, 'pokerEscrow', 'pokerGameMatchId']) expect(snap).not.toContain(secret);

    expect(await t.escrow.refundBuyInsResult(live.room)).toBe('confirmed_refund');
    await t.cleanup([orphan.U1, orphan.U2, live.U1, live.U2, paid.U1, paid.U2]);
  });
});
