import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { scopedOrphanScan, withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';
import type { ClientMessage, ErrorCode } from './messages';

// Stage 37.7.17 (integration, real Postgres).
//
// FAIL 1: the GLOBAL orphan refund (and `reconcileCorruptRoom`) still used the UNGUARDED settlement
// gate, trusting a `poker_matches` row merely because it PARSED. A row whose `table_buy_in` ledger
// was missing/partial/for the wrong account was refunded to EVERY durable seat — MINTING chips for a
// user who was never debited — and the match was closed with a `cancel_refund` settlement.
// FAIL 2: a room with NO escrow but a live state + generation binding was classified `cancelled`
// unconditionally: its state and binding were wiped regardless of whether the orphan scan actually
// refunded anything (a transient scan failure, a durable PAYOUT, or no binding at all).
// FAIL 3: `refundBuyInsResult` answered `resolved` for any TERMINAL escrow status without consulting
// the DB, so a teardown could purge a table whose settlement the DB never recorded.

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

describe.skipIf(!TEST_DATABASE_URL)('guarded orphan settlement + escrowless recovery claims (Stage 37.7.17)', () => {
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
      reconcileEscrow: escrow.resolveEscrowEvidence, isFinished: isFin, refundBuyIns: escrow.refundBuyIns,
      rescheduleAdvance: advance, persist, clearTimers, freeze,
    });
    /** The production pipeline; `scan` overrides the orphan scan (e.g. to simulate a transient failure). */
    async function productionBootstrap(restored: ServerRoom[], scan?: (ids: Set<string>) => Promise<{ refunded: string[]; corrupt: string[] }>) {
      return runBootstrapEconomyRecovery(restored, {
        ...recoveryDeps(),
        isBankrollRoom: escrow.isBankrollRoom, hasUnsettledEscrow: escrow.hasUnsettledEscrow,
        reconcileCorruptRoom: escrow.reconcileCorruptRoom, withRoomLock: escrow.withRoomLock,
        roomExists: () => true, log: () => {}, logError: () => {},
        reconcileOrphanedDebits: scan ?? ((ids) => scopedOrphanScan((m) => codes.has(m.roomCode), ids)),
      });
    }
    const marker = new Map<string, string>();
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
    const gameRows = async (c: string) => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${c}`) as Array<{ n: number }>)[0].n;
    const balance = async (u: string) => (await wallet.getWalletView(u, DAY)).balance;
    const restore = (r: ServerRoom) => deserializeRoom(serializeRoom(r))!;
    /** Strip the escrow, keeping the state + generation binding — the escrowless claim shape. */
    const escrowless = (r: ServerRoom, opts: { binding?: boolean } = {}) => {
      const out = restore(r);
      out.pokerEscrow = undefined;
      if (opts.binding === false) out.pokerGameMatchId = undefined;
      return out;
    };
    const cleanup = async (ids: string[]) => {
      for (const c of codes) {
        await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${c})`;
        await conn!.sql`DELETE FROM games WHERE room_code = ${c}`;
        await conn!.sql`DELETE FROM poker_matches WHERE room_code = ${c}`;
      }
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN ${conn!.sql(ids)}`;
      await conn!.sql`DELETE FROM users WHERE id IN ${conn!.sql(ids)}`;
    };

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
      escrow, wallet, conn, users, snapshot, restore, escrowless, bankrollRoom, productionBootstrap,
      teardown, ledger, settlements, gameRows, balance, cleanup, wsReject, advance, frozenLog, codes,
      recordConfirmedPokerStats, statsDeps,
    };
  }

  // ── FAIL 1 — the global orphan refund is guarded ───────────────────────────────────────────────

  it('A-F — an orphan whose buy-in ledger does not back the record is NEVER refunded', async () => {
    const t = await ctx('GS1');
    const cases: Array<[string, (c: { M: string; U1: string; U2: string }) => Promise<unknown>]> = [
      ['A missing row', (c) => t.conn!.sql`DELETE FROM poker_ledger WHERE match_id = ${c.M} AND user_id = ${c.U2}`],
      ['B empty ledger', (c) => t.conn!.sql`DELETE FROM poker_ledger WHERE match_id = ${c.M}`],
      ['D wrong delta', (c) => t.conn!.sql`UPDATE poker_ledger SET delta = -1 WHERE match_id = ${c.M} AND user_id = ${c.U2}`],
      ['E wrong room', (c) => t.conn!.sql`UPDATE poker_ledger SET room_code = 'ZZZZ' WHERE match_id = ${c.M} AND user_id = ${c.U2}`],
      ['E2 wrong key', (c) => t.conn!.sql`UPDATE poker_ledger SET idempotency_key = ${'buyin:other:' + c.U2} WHERE match_id = ${c.M} AND user_id = ${c.U2}`],
    ];
    const owned: string[] = [];
    const made: Array<{ M: string; U1: string; U2: string; code: string }> = [];
    for (const [name, mutate] of cases) {
      const r = await t.bankrollRoom(`GS1${name[0]}${made.length}`);
      await mutate(r);
      made.push(r); owned.push(r.U1, r.U2);
    }
    // C: the row count is right but one debit belongs to another account.
    const c = await t.bankrollRoom('GS1C');
    const outsider = await t.users.createAccountUser({ email: null, name: 'GS1CX', emailVerified: false });
    await t.conn!.sql`UPDATE poker_ledger SET user_id = ${outsider} WHERE match_id = ${c.M} AND user_id = ${c.U2}`;
    made.push(c); owned.push(c.U1, c.U2, outsider);
    // F: all expected rows correct, plus an EXTRA buy-in row.
    const f = await t.bankrollRoom('GS1F');
    const extra = await t.users.createAccountUser({ email: null, name: 'GS1FX', emailVerified: false });
    await t.conn!.sql`INSERT INTO poker_ledger (user_id, reason, delta, balance_after, idempotency_key, match_id, room_code)
      VALUES (${extra}, 'table_buy_in', ${-BUY_IN}, 0, ${`buyin:${f.M}:${extra}`}, ${f.M}, 'GS1F')`;
    made.push(f); owned.push(f.U1, f.U2, extra);

    const scan = await scopedOrphanScan((m) => t.codes.has(m.roomCode));
    for (const r of made) {
      expect(scan.refunded).not.toContain(r.M);                       // never refunded…
      expect(scan.corrupt).toContain(r.M);                            // …reported as operator-owned
      expect(await t.ledger(r.M, 'table_cancel_refund')).toBe(0);     // no chips minted
      expect(await t.settlements(r.M)).toBe(0);                       // and no settlement row
    }
    expect(await t.balance(made[1].U1)).toBe(CLAIM - BUY_IN);         // B's debited seat is untouched
    expect(await t.balance(outsider)).toBe(0);
    // A repeat scan is idempotent — still nothing settled.
    const again = await scopedOrphanScan((m) => t.codes.has(m.roomCode));
    expect(again.refunded).toHaveLength(0);
    for (const r of made) expect(await t.settlements(r.M)).toBe(0);
    // Clean up the operator-owned records so the suite leaves nothing unsettled.
    for (const r of made) await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${r.M}`;
    await t.cleanup(owned);
  });

  it('G — the corrupt-room recovery path is guarded too, and an EXACT orphan still refunds once', async () => {
    const t = await ctx('GS2');
    // G: reconcileCorruptRoom must not credit a record its ledger does not back.
    const bad = await t.bankrollRoom('GS2A');
    await t.conn!.sql`DELETE FROM poker_ledger WHERE match_id = ${bad.M} AND user_id = ${bad.U2}`;
    bad.room.pokerEscrowCorrupt = true;
    expect(await t.escrow.reconcileCorruptRoom(bad.room)).toBe(false);   // fail closed → caller freezes
    expect(await t.ledger(bad.M, 'table_cancel_refund')).toBe(0);
    expect(await t.settlements(bad.M)).toBe(0);
    expect(bad.room.pokerEscrowCorrupt).toBe(true);                      // still unresolved

    // …while an EXACT record is still refunded exactly once by both paths.
    const ok = await t.bankrollRoom('GS2B');
    ok.room.pokerEscrowCorrupt = true;
    expect(await t.escrow.reconcileCorruptRoom(ok.room)).toBe(true);
    expect(await t.ledger(ok.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(ok.U1)).toBe(CLAIM);
    const scan = await scopedOrphanScan((m) => t.codes.has(m.roomCode));
    expect(scan.refunded).not.toContain(ok.M);                           // already settled
    expect(await t.ledger(ok.M, 'table_cancel_refund')).toBe(2);
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${bad.M}`;
    await t.cleanup([bad.U1, bad.U2, ok.U1, ok.U2]);
  });

  // ── FAIL 2 — the escrowless recovery state machine ─────────────────────────────────────────────

  it('1 — a transient orphan-scan failure never cancels an escrowless claim', async () => {
    const t = await ctx('GS3');
    const a = await t.bankrollRoom('GS3A');
    const r = t.escrowless(a.room);
    const rep = await t.productionBootstrap([r], async () => { throw new Error('transient'); });
    expect(rep.recoveries.get('GS3A')).toBe('recovery_pending');
    expect(r.gameState).not.toBeNull();                    // state + binding preserved
    expect(r.pokerGameMatchId).toBe(a.M);
    expect(r.pokerMatchCancelled).toBeUndefined();
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(0);
    expect(await t.settlements(a.M)).toBe(0);
    expect(await t.gameRows('GS3A')).toBe(0);
    expect(t.escrow.pokerRecoveryBlocked(r)).toBe(true);
    expect(await t.teardown(r)).toBe('keep');
    expect(await t.wsReject(r, a.U1)).toEqual(['SETTLEMENT_PENDING']);
    // The public snapshot stays opaque and carries no economy identifiers.
    const snap = JSON.stringify(t.snapshot(r));
    for (const secret of [a.M, a.U1, a.U2, 'pokerGameMatchId', 'pokerEscrow']) expect(snap).not.toContain(secret);
    await t.cleanup([a.U1, a.U2]);
  });

  it('2 — only a CONFIRMED refund for that exact matchId turns an escrowless claim into a clean lobby', async () => {
    const t = await ctx('GS4');
    const a = await t.bankrollRoom('GS4A');
    const r = t.escrowless(a.room);
    const rep = await t.productionBootstrap([r]);          // the real scan refunds the orphan
    expect(rep.orphanRefunded).toContain(a.M);
    expect(rep.recoveries.get('GS4A')).toBe('cancelled');
    expect(r.gameState).toBeNull();
    expect(r.pokerGameMatchId).toBeUndefined();
    expect(r.pokerMatchCancelled).toBe(true);
    expect(r.pokerFrozen).toBeUndefined();
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(2);
    expect(await t.balance(a.U1)).toBe(CLAIM);
    // A repeated boot settles nothing new.
    await t.productionBootstrap([t.restore(r)]);
    expect(await t.ledger(a.M, 'table_cancel_refund')).toBe(2);
    await t.cleanup([a.U1, a.U2]);
  });

  it('3-6 — escrowless claims over a paid / refunded / corrupt / partial durable match', async () => {
    const t = await ctx('GS5');
    // 3: the durable match was PAID — never cancelled, frozen, no stats.
    const paid = await t.bankrollRoom('GS5A', finished2p());
    expect(await t.escrow.payoutStacks(paid.room, finished2p())).toBe('paid');
    const rp = t.escrowless(paid.room);
    const repP = await t.productionBootstrap([rp]);
    expect(repP.reconciled.get('GS5A')).toBe('escrowless_unknown');
    expect(repP.recoveries.get('GS5A')).toBe('corrupt_debit');
    expect(rp.pokerFrozen).toBe(true);
    expect(rp.gameState).not.toBeNull();
    expect(rp.pokerGameMatchId).toBe(paid.M);
    expect(await t.ledger(paid.M, 'table_payout')).toBe(1);
    expect(await t.recordConfirmedPokerStats(rp, rp.gameState as PokerState, t.statsDeps())).toBe('invalid');
    expect(await t.gameRows('GS5A')).toBe(0);

    // 4: the durable match was durably REFUNDED — a confirmed cancelled lobby, no second refund.
    const ref = await t.bankrollRoom('GS5B');
    expect(await t.escrow.refundBuyIns(ref.room)).toBe(true);
    const rr = t.escrowless(ref.room);
    const repR = await t.productionBootstrap([rr]);
    expect(repR.reconciled.get('GS5B')).toBe('cancelled');
    expect(repR.recoveries.get('GS5B')).toBe('cancelled');
    expect(rr.gameState).toBeNull();
    expect(await t.ledger(ref.M, 'table_cancel_refund')).toBe(2);

    // 5: a CORRUPT durable row → frozen, nothing settled.
    const corrupt = await t.bankrollRoom('GS5C');
    const badSeats = JSON.stringify([{ seat: 0, userId: corrupt.U1, amount: BUY_IN }, { seat: 1, userId: corrupt.U2, amount: 1 }]);
    await t.conn!.sql`UPDATE poker_matches SET seats = ${badSeats}::jsonb WHERE match_id = ${corrupt.M}`;
    const rc = t.escrowless(corrupt.room);
    const repC = await t.productionBootstrap([rc]);
    expect(repC.reconciled.get('GS5C')).toBe('corrupt_durable');
    expect(rc.pokerFrozen).toBe(true);
    expect(rc.gameState).not.toBeNull();
    expect(await t.settlements(corrupt.M)).toBe(0);

    // 6: a PARTIAL ledger behind an otherwise valid row → frozen.
    const partial = await t.bankrollRoom('GS5D');
    await t.conn!.sql`DELETE FROM poker_ledger WHERE match_id = ${partial.M} AND user_id = ${partial.U2}`;
    const rd = t.escrowless(partial.room);
    const repD = await t.productionBootstrap([rd]);
    expect(repD.reconciled.get('GS5D')).toBe('corrupt_partial');
    expect(rd.pokerFrozen).toBe(true);
    expect(rd.gameState).not.toBeNull();
    expect(await t.settlements(partial.M)).toBe(0);
    expect(await t.balance(partial.U1)).toBe(CLAIM - BUY_IN);

    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id IN (${corrupt.M}, ${partial.M})`;
    await t.cleanup([paid.U1, paid.U2, ref.U1, ref.U2, corrupt.U1, corrupt.U2, partial.U1, partial.U2]);
  });

  it('7-8 — a claim with NO binding, and owed stats with no escrow, both fail closed', async () => {
    const t = await ctx('GS6');
    // 7: a game state with no escrow AND no binding — ownership is unknowable.
    const a = await t.bankrollRoom('GS6A');
    const ra = t.escrowless(a.room, { binding: false });
    const repA = await t.productionBootstrap([ra], async () => ({ refunded: [], corrupt: [] }));
    expect(repA.reconciled.get('GS6A')).toBe('escrowless_unknown');
    expect(repA.recoveries.get('GS6A')).toBe('corrupt_debit');
    expect(ra.pokerFrozen).toBe(true);
    expect(ra.gameState).not.toBeNull();
    expect(ra.pokerMatchCancelled).toBeUndefined();

    // 8: owed stats with no escrow and no state — the flag is evidence, never silently cleared.
    const b = await t.bankrollRoom('GS6B', finished2p());
    const rb = t.escrowless(b.room, { binding: false });
    rb.gameState = null; rb.started = false; rb.pokerStatsPending = true;
    const repB = await t.productionBootstrap([rb], async () => ({ refunded: [], corrupt: [] }));
    expect(repB.recoveries.get('GS6B')).toBe('corrupt_debit');
    expect(rb.pokerFrozen).toBe(true);
    expect(rb.pokerStatsPending).toBe(true);
    expect(await t.gameRows('GS6B')).toBe(0);
    expect(t.escrow.statsPending(rb)).toBe(false);        // frozen → the sweep never retries it
    // 9: repeated bootstrap is idempotent and does not re-log.
    await t.productionBootstrap([ra, rb], async () => ({ refunded: [], corrupt: [] }));
    expect(t.frozenLog.filter((l) => l.startsWith('GS6A —'))).toHaveLength(1);
    expect(t.frozenLog.filter((l) => l.startsWith('GS6B —'))).toHaveLength(1);
    expect(await t.gameRows('GS6B')).toBe(0);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2]);
  });

  // ── FAIL 3 — the terminal fast path is no longer self-proof ────────────────────────────────────

  it('a TERMINAL escrow claim is re-proved against the DB before a teardown may purge', async () => {
    const t = await ctx('GS7');
    // The room believes the match settled; the DB recorded nothing.
    const a = await t.bankrollRoom('GS7A');
    a.room.pokerEscrow!.status = 'settled';
    expect(await t.escrow.refundBuyInsResult(a.room)).toBe('invalid');
    expect(await t.settlements(a.M)).toBe(0);
    a.room.gameState = null; a.room.started = false;
    expect(await t.teardown(a.room)).toBe('keep');        // never purged on an unproven claim
    expect(a.room.pokerFrozen).toBe(true);

    // A genuinely refunded escrow still resolves, and a genuinely paid one too.
    const b = await t.bankrollRoom('GS7B');
    expect(await t.escrow.refundBuyInsResult(b.room)).toBe('resolved');
    expect(await t.escrow.refundBuyInsResult(b.room)).toBe('resolved'); // terminal replay, re-proved
    expect(await t.ledger(b.M, 'table_cancel_refund')).toBe(2);
    const c = await t.bankrollRoom('GS7C', finished2p());
    expect(await t.escrow.payoutStacks(c.room, finished2p())).toBe('paid');
    expect(await t.escrow.refundBuyInsResult(c.room)).toBe('resolved'); // already paid → resolved
    expect(await t.ledger(c.M, 'table_cancel_refund')).toBe(0);
    // A transient read failure is retryable, never a permanent verdict.
    t.escrow.__setReconcileFailure(true);
    expect(await t.escrow.refundBuyInsResult(c.room)).toBe('retry_pending');
    t.escrow.__setReconcileFailure(false);
    await t.cleanup([a.U1, a.U2, b.U1, b.U2, c.U1, c.U2]);
  });

  it('healthy rooms, non-poker and LOCAL poker are untouched by any of this', async () => {
    const t = await ctx('GS8');
    const live = await t.bankrollRoom('GS8A');
    const r = t.restore(live.room);
    const rep = await t.productionBootstrap([r]);
    expect(rep.reconciled.get('GS8A')).toBe('funded');
    expect(rep.recoveries.get('GS8A')).toBe('live');
    expect(t.advance).toHaveBeenCalledTimes(1);
    expect(await t.ledger(live.M, 'table_cancel_refund')).toBe(0);
    expect(await t.escrow.refundBuyIns(r)).toBe(true);

    const { createRoom } = await import('./serverCore');
    const king = createRoom({ code: 'GS8K', playerCount: 4, modeSelectionType: 'fixed', gameType: 'king', host: { clientId: 'a', reconnectToken: 't', name: 'A' } });
    king.started = true; king.gameState = { phase: 'playing' } as unknown as typeof king.gameState;
    const local = createRoom({ code: 'GS8P', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A' } });
    local.started = true; local.gameState = live2p() as unknown as typeof local.gameState;
    const rep2 = await t.productionBootstrap([king, local], async () => ({ refunded: [], corrupt: [] }));
    expect(rep2.recoveries.size).toBe(0);
    expect(king.pokerFrozen).toBeUndefined();
    expect(local.pokerFrozen).toBeUndefined();
    expect(local.gameState).not.toBeNull();
    await t.cleanup([live.U1, live.U2]);
  });
});
