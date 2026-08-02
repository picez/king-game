import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { scopedOrphanScan, withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 38.0.3C §17 — the ONLINE bankroll between-hands REBUY, against REAL PostgreSQL.
// A rebuy adds real chips to a live paid match, so every guarantee the buy-in has must
// hold for it too: exactly one debit per (match, hand, user), a crash between the debit
// and the state apply reconciled exactly once, structural corruption frozen rather than
// guessed, and payout/refund conserving initial buy-ins PLUS rebuys.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
const BUY_IN = 5000;
const P = (seat: number): PokerPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' });
function tel2(): PokerTelemetry {
  return {
    handsPlayedBySeat: [4, 4], handsWonBySeat: [3, 1], showdownsWonBySeat: [1, 0],
    potsWonBySeat: [3, 1], biggestPotBySeat: [900, 400], allInsWonBySeat: [0, 0], royalFlushBySeat: [0, 0],
  };
}

/** A 2-seat table paused in a rebuy window: seat 1 busted on hand 4. */
function windowState(): PokerState {
  const f = () => [false, false];
  return {
    gameType: 'poker', phase: 'rebuy_window', playerCount: 2, players: [P(0), P(1)],
    options: { startingStack: BUY_IN, smallBlind: 25, bigBlind: 50, blindGrowthEveryHands: 0 },
    buttonSeat: 0, handNumber: 4, street: 'river', smallBlindCurrent: 25, bigBlindCurrent: 50,
    stacksBySeat: [2 * BUY_IN, 0], holeCardsBySeat: [[], []], board: [], deck: [], burned: [],
    committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(),
    wasAllInBySeat: f(), actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: f(),
    currentBet: 0, minRaise: 50, toActSeat: 0, revealedBySeat: f(),
    lastHand: { handNumber: 4, wonBySeat: [BUY_IN, 0], showdown: true, revealedSeats: [], categoryBySeat: {}, winningFiveBySeat: {}, pots: [], newlyEliminated: [] },
    winnerSeat: null, actionLog: [], telemetry: tel2(),
    rebuyWindow: { handNumber: 4, eligibleSeats: [1], decisionBySeat: ['pending', 'pending'] },
    appliedRebuys: [],
  } as unknown as PokerState;
}

const isFin = (s: PokerState) => s.phase === 'game_finished';

withPokerDbSuiteLock(beforeAll, afterAll);

describe.skipIf(!TEST_DATABASE_URL)('online bankroll rebuy (Stage 38.0.3C §17)', () => {
  async function ctx() {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const rebuy = await import('../../server/pokerRebuy');
    const { bindGameToEscrow } = await import('../../server/pokerBinding');
    const { createRoom, addMember, serializeRoom, deserializeRoom, snapshot } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const codes = new Set<string>();
    const frozen: string[] = [];
    const persist = vi.fn();
    const broadcast = vi.fn();
    const freeze = (r: ServerRoom, reason: string) => { if (!r.pokerFrozen) { r.pokerFrozen = true; frozen.push(`${r.code} — ${reason}`); } };
    const deps = (now = () => Date.now()) => ({ persist, broadcast, freeze, now });

    async function table(code: string, state: PokerState = windowState()) {
      codes.add(code);
      const U1 = await users.createAccountUser({ email: null, name: `${code}A`, emailVerified: false });
      const U2 = await users.createAccountUser({ email: null, name: `${code}B`, emailVerified: false });
      await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
      const room = createRoom({
        code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker',
        host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 },
        pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: BUY_IN,
      });
      addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
      room.started = true;
      room.gameState = state as unknown as typeof room.gameState;
      expect((await escrow.debitBuyIns(room)).ok).toBe(true);
      bindGameToEscrow(room);
      return { room, U1, U2, M: room.pokerEscrow!.matchId };
    }

    const rows = async (M: string, reason: string) =>
      ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = ${reason}`) as Array<{ n: number }>)[0].n;
    const balance = async (u: string) => (await wallet.getWalletView(u, DAY)).balance;
    const settlements = async (M: string) =>
      ((await conn!.sql`SELECT count(*)::int AS n FROM poker_match_settlements WHERE match_id = ${M}`) as Array<{ n: number }>)[0].n;

    return {
      users, wallet, escrow, rebuy, conn, codes, frozen, persist, broadcast, freeze, deps,
      table, rows, balance, settlements, serializeRoom, deserializeRoom, snapshot, bindGameToEscrow,
    };
  }

  // 1 ────────────────────────────────────────────────────────────────────────
  it('1: one rebuy → exactly one ledger row and one restored stack', async () => {
    const c = await ctx();
    const { room, U2, M } = await c.table('RB01');
    const before = await c.balance(U2);
    const out = await c.rebuy.performRebuy(room, U2, 1, c.deps());
    expect(out.ok).toBe(true);
    expect(await c.rows(M, 'table_rebuy')).toBe(1);
    expect(await c.balance(U2)).toBe(before - BUY_IN);
    const st = room.gameState as unknown as PokerState;
    expect(st.stacksBySeat[1]).toBe(BUY_IN);
    expect(st.appliedRebuys).toEqual([{ handNumber: 4, seat: 1 }]);
  });

  // 2 ────────────────────────────────────────────────────────────────────────
  it('2: a duplicate sequential request debits once and adds one stack', async () => {
    const c = await ctx();
    const { room, U2, M } = await c.table('RB02');
    const before = await c.balance(U2);
    expect((await c.rebuy.performRebuy(room, U2, 1, c.deps())).ok).toBe(true);
    // The seat is no longer eligible, so the second request is refused outright.
    const second = await c.rebuy.performRebuy(room, U2, 1, c.deps());
    expect(second.ok).toBe(false);
    expect(await c.rows(M, 'table_rebuy')).toBe(1);
    expect(await c.balance(U2)).toBe(before - BUY_IN);
    expect((room.gameState as unknown as PokerState).appliedRebuys).toHaveLength(1);
  });

  // 3 ────────────────────────────────────────────────────────────────────────
  it('3: CONCURRENT duplicate requests debit exactly once', async () => {
    const c = await ctx();
    const { room, U2, M } = await c.table('RB03');
    const before = await c.balance(U2);
    const [a, b] = await Promise.all([
      c.rebuy.performRebuy(room, U2, 1, c.deps()),
      c.rebuy.performRebuy(room, U2, 1, c.deps()),
    ]);
    expect([a.ok, b.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(await c.rows(M, 'table_rebuy')).toBe(1);
    expect(await c.balance(U2)).toBe(before - BUY_IN);
    expect((room.gameState as unknown as PokerState).appliedRebuys).toHaveLength(1);
  });

  // 4 ────────────────────────────────────────────────────────────────────────
  it('4: an insufficient wallet debits nothing and leaves the stack at 0', async () => {
    const c = await ctx();
    const { room, U2, M } = await c.table('RB04');
    // Drain the wallet to just under one buy-in.
    const bal = await c.balance(U2);
    await c.wallet.adjustWallet?.(U2, -(bal - (BUY_IN - 1)), 'table_buy_in', `drain:${M}:${U2}`)
      ?? await (await import('../../server/db/client')).getDb().then(async (conn) => {
        await conn!.db.transaction(async (tx) => {
          await c.wallet.adjustWalletTx(tx, U2, -(bal - (BUY_IN - 1)), 'table_buy_in', `drain:${M}:${U2}`, {});
        });
      });
    const out = await c.rebuy.performRebuy(room, U2, 1, c.deps());
    expect(out).toEqual({ ok: false, reason: 'insufficient' });
    expect(await c.rows(M, 'table_rebuy')).toBe(0);
    expect(await c.balance(U2)).toBe(BUY_IN - 1);
    expect((room.gameState as unknown as PokerState).stacksBySeat[1]).toBe(0);
    // The seat may still decline (or retry) while the window is open.
    expect(c.rebuy.rebuyRequestAllowed(room, 1)).toBe(true);
  });

  // 5 ────────────────────────────────────────────────────────────────────────
  it('5: two busted users rebuy independently', async () => {
    const c = await ctx();
    const st = windowState();
    st.stacksBySeat = [0, 0];
    st.rebuyWindow = { handNumber: 4, eligibleSeats: [0, 1], decisionBySeat: ['pending', 'pending'] };
    const { room, U1, U2, M } = await c.table('RB05', st);
    expect((await c.rebuy.performRebuy(room, U1, 0, c.deps())).ok).toBe(true);
    expect((await c.rebuy.performRebuy(room, U2, 1, c.deps())).ok).toBe(true);
    expect(await c.rows(M, 'table_rebuy')).toBe(2);
    const after = room.gameState as unknown as PokerState;
    expect(after.stacksBySeat).toEqual([BUY_IN, BUY_IN]);
    expect(after.appliedRebuys).toHaveLength(2);
  });

  // 6 + 7 ───────────────────────────────────────────────────────────────────
  it('6/7: the exact key is idempotent; the same key for a DIFFERENT op fails closed', async () => {
    const c = await ctx();
    const { room, U2, M } = await c.table('RB06');
    const key = c.wallet.rebuyIdempotencyKey(M, 4, U2);
    expect((await c.rebuy.performRebuy(room, U2, 1, c.deps())).ok).toBe(true);
    const after = await c.balance(U2);
    // An exact repeat of the SAME logical op is a no-op.
    await c.conn!.db.transaction(async (tx) => {
      const r = await c.wallet.adjustWalletTx(tx, U2, -BUY_IN, 'table_rebuy', key, { matchId: M, roomCode: 'RB06' });
      expect(r.applied).toBe(false);
    });
    expect(await c.balance(U2)).toBe(after);
    // The same key with a DIFFERENT delta/reason is a permanent conflict.
    await expect(c.conn!.db.transaction(async (tx) => {
      await c.wallet.adjustWalletTx(tx, U2, -1, 'table_rebuy', key, { matchId: M, roomCode: 'RB06' });
    })).rejects.toThrow();
    expect(await c.rows(M, 'table_rebuy')).toBe(1);
  });

  // 8 + 9 ───────────────────────────────────────────────────────────────────
  it('8/9: a debit that committed before a crash is applied exactly once, and repeat recovery is a no-op', async () => {
    const c = await ctx();
    const { room, U2, M } = await c.table('RB08');
    // Simulate the crash window: commit the ledger row WITHOUT applying the pure REBUY.
    await c.conn!.db.transaction(async (tx) => {
      await c.wallet.adjustWalletTx(tx, U2, -BUY_IN, 'table_rebuy', c.wallet.rebuyIdempotencyKey(M, 4, U2), { matchId: M, roomCode: 'RB08' });
    });
    expect((room.gameState as unknown as PokerState).stacksBySeat[1]).toBe(0);

    expect(await c.rebuy.reconcileRebuys(room, c.deps())).toBe('applied');
    const st = room.gameState as unknown as PokerState;
    expect(st.stacksBySeat[1]).toBe(BUY_IN);
    expect(st.appliedRebuys).toEqual([{ handNumber: 4, seat: 1 }]);
    expect(room.pokerFrozen).toBeUndefined();

    // Running recovery again changes nothing (no second stack).
    expect(await c.rebuy.reconcileRebuys(room, c.deps())).toBe('noop');
    expect((room.gameState as unknown as PokerState).stacksBySeat[1]).toBe(BUY_IN);
    expect(await c.rows(M, 'table_rebuy')).toBe(1);
  });

  // 10 ──────────────────────────────────────────────────────────────────────
  it('10: a room CLAIMING a rebuy with no durable row is frozen (never minted)', async () => {
    const c = await ctx();
    const st = windowState();
    st.stacksBySeat = [2 * BUY_IN, BUY_IN];
    st.appliedRebuys = [{ handNumber: 4, seat: 1 }];
    st.rebuyWindow = { handNumber: 4, eligibleSeats: [1], decisionBySeat: ['pending', 'rebought'] };
    const { room, M } = await c.table('RB10', st);
    expect(await c.rebuy.reconcileRebuys(room, c.deps())).toBe('frozen');
    expect(room.pokerFrozen).toBe(true);
    expect(await c.rows(M, 'table_rebuy')).toBe(0);
    expect(c.frozen.join()).toContain('RB10');
  });

  // 11 + 12 + 13 ────────────────────────────────────────────────────────────
  it('11/12/13: a malformed key, a wrong delta and a foreign user each freeze', async () => {
    for (const [code, mutate] of [
      ['RB11', (M: string, U: string) => ({ key: `rebuy:${M}:notanumber:${U}`, delta: -BUY_IN, user: U })],
      ['RB12', (M: string, U: string) => ({ key: `rebuy:${M}:4:${U}`, delta: -1, user: U })],
      ['RB13', (M: string, _U: string) => ({ key: `rebuy:${M}:4:ghost`, delta: -BUY_IN, user: 'ghost' })],
    ] as const) {
      const c = await ctx();
      const { room, U1, U2, M } = await c.table(code);
      const spec = mutate(M, code === 'RB13' ? U1 : U2);
      // Write the row DIRECTLY so a structurally impossible shape can be exercised.
      const target = code === 'RB13' ? U1 : U2;
      await c.conn!.sql`
        INSERT INTO poker_ledger (user_id, reason, delta, balance_after, idempotency_key, match_id, room_code)
        VALUES (${target}, 'table_rebuy', ${spec.delta}, 0, ${spec.key}, ${M}, ${code})`;
      const res = await c.rebuy.reconcileRebuys(room, c.deps());
      expect(res, `${code} must freeze`).toBe('frozen');
      expect(room.pokerFrozen).toBe(true);
      expect((room.gameState as unknown as PokerState).stacksBySeat[1]).toBe(0);
      void U2;
    }
  });

  // 14 ──────────────────────────────────────────────────────────────────────
  it('14: a timeout cannot close the window while a debit is in flight', async () => {
    const c = await ctx();
    const { room } = await c.table('RB14');
    c.rebuy.ensureRebuyDeadline(room, { now: () => 1_000 });
    // The deadline has long passed…
    expect(c.rebuy.shouldCloseRebuyWindow(room, 10_000_000)).toBe(true);
    // …but an in-flight debit blocks the close outright.
    room.pokerRebuyInFlight = new Set([1]);
    expect(c.rebuy.shouldCloseRebuyWindow(room, 10_000_000)).toBe(false);
    room.pokerRebuyInFlight = undefined;
    expect(c.rebuy.shouldCloseRebuyWindow(room, 10_000_000)).toBe(true);
  });

  // 15 ──────────────────────────────────────────────────────────────────────
  it('15: the payout equals initial buy-ins PLUS the rebuy', async () => {
    const c = await ctx();
    const { room, U1, U2, M } = await c.table('RB15');
    expect((await c.rebuy.performRebuy(room, U2, 1, c.deps())).ok).toBe(true);
    // Close the window, then finish with seat 0 holding the FUNDED total.
    expect(c.rebuy.closeRebuyWindow(room)).toBe(true);
    const funded = 2 * BUY_IN + BUY_IN;
    const finished = {
      ...(room.gameState as unknown as PokerState),
      phase: 'game_finished', winnerSeat: 0, stacksBySeat: [funded, 0], eliminatedBySeat: [false, true],
    } as unknown as PokerState;
    room.gameState = finished as unknown as typeof room.gameState;

    const before1 = await c.balance(U1);
    expect(await c.escrow.payoutStacks(room, finished)).toBe('paid');
    expect(await c.balance(U1)).toBe(before1 + funded);
    expect(await c.settlements(M)).toBe(1);
    // A replay is idempotent.
    expect(await c.escrow.payoutStacks(room, finished)).toBe('already_paid');
    expect(await c.rows(M, 'table_payout')).toBe(1);
  });

  // 16 ──────────────────────────────────────────────────────────────────────
  it('16: a refund returns each account its buy-in PLUS its own rebuys', async () => {
    const c = await ctx();
    const { room, U1, U2, M } = await c.table('RB16');
    expect((await c.rebuy.performRebuy(room, U2, 1, c.deps())).ok).toBe(true);
    const b1 = await c.balance(U1); const b2 = await c.balance(U2);
    expect(await c.escrow.refundBuyInsResult(room)).toBe('confirmed_refund');
    expect(await c.balance(U1)).toBe(b1 + BUY_IN);              // buy-in only
    expect(await c.balance(U2)).toBe(b2 + BUY_IN + BUY_IN);     // buy-in + their rebuy
    expect(await c.settlements(M)).toBe(1);
    expect(await c.escrow.refundBuyInsResult(room)).toBe('confirmed_refund'); // idempotent
    expect(await c.rows(M, 'table_cancel_refund')).toBe(2);
  });

  // 17 ──────────────────────────────────────────────────────────────────────
  it('17: a payout/refund race resolves to exactly ONE terminal outcome', async () => {
    const c = await ctx();
    const { room, U2, M } = await c.table('RB17');
    expect((await c.rebuy.performRebuy(room, U2, 1, c.deps())).ok).toBe(true);
    c.rebuy.closeRebuyWindow(room);
    const funded = 3 * BUY_IN;
    const finished = {
      ...(room.gameState as unknown as PokerState),
      phase: 'game_finished', winnerSeat: 0, stacksBySeat: [funded, 0], eliminatedBySeat: [false, true],
    } as unknown as PokerState;
    room.gameState = finished as unknown as typeof room.gameState;
    const [pay, ref] = await Promise.all([
      c.escrow.payoutStacks(room, finished),
      c.escrow.refundBuyInsResult(room),
    ]);
    expect(await c.settlements(M)).toBe(1);
    const paid = await c.rows(M, 'table_payout');
    const refunded = await c.rows(M, 'table_cancel_refund');
    expect(paid === 0 || refunded === 0).toBe(true);           // mutually exclusive
    expect([pay, ref].join()).toMatch(/paid|refund/);
  });

  // 18 + 19 ─────────────────────────────────────────────────────────────────
  it('18/19: the orphan scan never refunds a LIVE match holding an unresolved rebuy', async () => {
    const c = await ctx();
    const { room, U2, M } = await c.table('RB18');
    expect((await c.rebuy.performRebuy(room, U2, 1, c.deps())).ok).toBe(true);
    // The production protection set covers every live room's match id.
    const scan = await scopedOrphanScan((m) => c.codes.has(m.roomCode), new Set([M]));
    expect(scan.refunded).not.toContain(M);
    expect(await c.rows(M, 'table_cancel_refund')).toBe(0);
    expect(await c.rows(M, 'table_rebuy')).toBe(1);
    expect(room.pokerEscrow!.status).toBe('funded');
  });

  // 20 ──────────────────────────────────────────────────────────────────────
  it('20: the PUBLIC snapshot leaks no wallet balance, userId, matchId or ledger key', async () => {
    const c = await ctx();
    const { room, U1, U2, M } = await c.table('RB20');
    expect((await c.rebuy.performRebuy(room, U2, 1, c.deps())).ok).toBe(true);
    c.rebuy.ensureRebuyDeadline(room, { now: () => 5_000 });
    const snap = JSON.stringify(c.snapshot(room));
    for (const secret of [M, U1, U2, 'rebuy:', 'idempotency', 'balance']) {
      expect(snap, `snapshot leaked ${secret}`).not.toContain(secret);
    }
    // The absolute deadline IS public (the client renders a countdown from it).
    expect(JSON.parse(snap).pokerRebuyDeadlineAt).toBeGreaterThan(0);
    // The public game state carries only seat-level decisions.
    const st = JSON.stringify((room.gameState as unknown as PokerState).rebuyWindow);
    expect(st).toContain('eligibleSeats');
    for (const secret of [M, U1, U2]) expect(st).not.toContain(secret);
  });

  // Deadline semantics ──────────────────────────────────────────────────────
  it('mints the deadline ONCE and a reconnect/restart never extends it', async () => {
    const c = await ctx();
    const { room } = await c.table('RB21');
    expect(c.rebuy.ensureRebuyDeadline(room, { now: () => 1_000 })).toBe(true);
    const first = room.pokerRebuyDeadlineAt;
    expect(first).toBe(1_000 + c.rebuy.REBUY_WINDOW_MS);
    // A rebroadcast / reconnect / another advance tick must NOT re-mint.
    expect(c.rebuy.ensureRebuyDeadline(room, { now: () => 9_999 })).toBe(false);
    expect(room.pokerRebuyDeadlineAt).toBe(first);
    // A restart restores the SAME absolute instant.
    const restored = c.deserializeRoom(JSON.parse(JSON.stringify(c.serializeRoom(room))));
    expect(restored!.pokerRebuyDeadlineAt).toBe(first);
    expect(c.rebuy.ensureRebuyDeadline(restored!, { now: () => 50_000 })).toBe(false);
    expect(restored!.pokerRebuyDeadlineAt).toBe(first);
    // An already-expired restored window may close.
    expect(c.rebuy.shouldCloseRebuyWindow(restored!, first! + 1)).toBe(true);
  });

  it('closes EARLY once every eligible seat has answered', async () => {
    const c = await ctx();
    const { room, U2 } = await c.table('RB22');
    c.rebuy.ensureRebuyDeadline(room, { now: () => 0 });
    expect(c.rebuy.shouldCloseRebuyWindow(room, 1)).toBe(false);   // still undecided
    expect((await c.rebuy.performRebuy(room, U2, 1, c.deps())).ok).toBe(true);
    expect(c.rebuy.shouldCloseRebuyWindow(room, 1)).toBe(true);    // everyone answered
    expect(c.rebuy.closeRebuyWindow(room)).toBe(true);
    const st = room.gameState as unknown as PokerState;
    expect(st.phase).toBe('hand_complete');                        // the rebought seat plays on
    expect(st.eliminatedBySeat[1]).toBe(false);
    expect(room.pokerRebuyDeadlineAt).toBeUndefined();
  });
});
