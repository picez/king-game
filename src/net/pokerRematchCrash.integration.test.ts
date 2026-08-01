import { describe, it, expect, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';
import { scopedOrphanScan, withPokerDbSuiteLock } from './pokerDbSuite.testutil';

// Stage 37.7.12 FAIL 1 (integration, real Postgres). A paid REMATCH debits a NEW escrow (M1) before
// the new hand exists; a socket close persists the room in that window (the close handler does not
// take the room lock), and a crash there used to leave "escrow M1 + the FINISHED state of M0". The
// old recovery paid M1 out from M0's stacks and re-recorded M0's result under M1's identity.
//
// These drive the REAL production paths — `recoverRestoredBankrollRoom` (bootstrap),
// `settleAndRecordBankrollPokerFinish` + `payoutPending` (sweep), `settleRoomForDeletion` (teardown)
// and `reconcileOrphanedDebits` (orphan scan) — across every crash window.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
const P = (seat: number): PokerPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' });
function tel2(): PokerTelemetry { return { handsPlayedBySeat: [8, 8], handsWonBySeat: [3, 5], showdownsWonBySeat: [1, 3], potsWonBySeat: [3, 6], biggestPotBySeat: [400, 900], allInsWonBySeat: [0, 1], royalFlushBySeat: [0, 0] }; }
/** A finished heads-up match: seat `winner` holds the whole 10,000 escrow. */
function finished2p(winner: 0 | 1 = 1): PokerState {
  const f = () => [false, false];
  return {
    gameType: 'poker', phase: 'game_finished', playerCount: 2, players: [P(0), P(1)],
    options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 }, buttonSeat: 0, handNumber: 8, street: 'river',
    stacksBySeat: winner === 1 ? [0, 10000] : [10000, 0], holeCardsBySeat: [[], []], board: [], deck: [], burned: [],
    committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(), wasAllInBySeat: f(),
    actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: winner === 1 ? [true, false] : [false, true],
    currentBet: 0, minRaise: 50, toActSeat: winner, revealedBySeat: f(), lastHand: null, winnerSeat: winner,
    actionLog: [], telemetry: tel2(),
  } as unknown as PokerState;
}
const live2p = () => ({ ...finished2p(), phase: 'betting', street: 'flop', stacksBySeat: [4000, 6000], winnerSeat: null, eliminatedBySeat: [false, false] } as unknown as PokerState);
const isFin = (s: PokerState) => s.phase === 'game_finished';

afterEach(async () => {
  const escrow = await import('../../server/pokerEscrow');
  escrow.__setRefundFailure(false); escrow.__setPayoutFailure(false);
});


// Poker DB integration files share one Postgres and the orphan scan is cluster-wide —
// serialize them on the shared advisory lock (see pokerDbSuite.testutil).
withPokerDbSuiteLock(beforeAll, afterAll);

describe.skipIf(!TEST_DATABASE_URL)('a crashed paid rematch never pays the NEW escrow for the OLD result (Stage 37.7.12 FAIL 1)', () => {
  /** Plays M0 to a paid + recorded finish, then exposes the production recovery entry points. */
  async function setup(code: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { bindGameToEscrow, gameBoundToEscrow } = await import('../../server/pokerBinding');
    const { recoverRestoredBankrollRoom } = await import('../../server/pokerBootstrap');
    const { settleAndRecordBankrollPokerFinish, recordConfirmedPokerStats, settleRoomForDeletion } = await import('../../server/pokerFinish');
    const { createRoom, addMember, serializeRoom, deserializeRoom, snapshot } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const U1 = await users.createAccountUser({ email: null, name: `${code}A`, emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: `${code}B`, emailVerified: false });
    await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
    const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });

    // ── M0: a real paid match, paid out and recorded (exactly what precedes a rematch) ───────────
    room.started = true; room.gameState = finished2p() as unknown as typeof room.gameState;
    await escrow.debitBuyIns(room);
    bindGameToEscrow(room);                       // what a successful START does
    const M0 = room.pokerEscrow!.matchId;
    const marker = new Map<string, string>();
    const statsDeps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); },
      record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });
    expect(await escrow.payoutStacks(room, finished2p())).toBe('paid');
    expect(await recordConfirmedPokerStats(room, finished2p(), statsDeps())).toBe('recorded');
    const balAfterM0 = {
      U1: (await wallet.getWalletView(U1, DAY)).balance,
      U2: (await wallet.getWalletView(U2, DAY)).balance,
    };

    const advance = vi.fn(); const clearTimers = vi.fn(); const persist = vi.fn();
    const frozenLog: string[] = [];
    const freeze = (r: ServerRoom, reason: string) => { if (!r.pokerFrozen) { r.pokerFrozen = true; frozenLog.push(`${r.code} — ${reason}`); } };
    const bootstrap = (r: ServerRoom) => recoverRestoredBankrollRoom(r, {
      reconcileEscrow: escrow.reconcileEscrow, isFinished: isFin, refundBuyIns: escrow.refundBuyIns,
      rescheduleAdvance: advance, persist, clearTimers, freeze,
    });
    const sweepFinish = (r: ServerRoom) => settleAndRecordBankrollPokerFinish(r, r.gameState as PokerState, {
      payoutStacks: escrow.payoutStacks, persist, broadcast: () => {}, clearRematch: () => {}, freeze,
      recordStats: (rm, st) => recordConfirmedPokerStats(rm, st, statsDeps()),
    });
    const teardown = (r: ServerRoom) => settleRoomForDeletion(r, {
      reconcileEscrow: escrow.reconcileEscrow, hasUnsettledEscrow: escrow.hasUnsettledEscrow, isFinished: isFin,
      settleAndRecord: sweepFinish, refundBuyIns: escrow.refundBuyIns, persist, freeze, clearTimers,
    });

    const ledger = async (matchId: string, reason: string) =>
      ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${matchId} AND reason = ${reason}`) as Array<{ n: number }>)[0].n;
    const gameRows = async () => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${code}`) as Array<{ n: number }>)[0].n;
    const balances = async () => ({ U1: (await wallet.getWalletView(U1, DAY)).balance, U2: (await wallet.getWalletView(U2, DAY)).balance });
    const cleanup = async () => {
      await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${code})`;
      await conn!.sql`DELETE FROM games WHERE room_code = ${code}`;
      await conn!.sql`DELETE FROM poker_matches WHERE room_code = ${code}`;
      await conn!.sql`DELETE FROM user_stats WHERE user_id IN (${U1}, ${U2})`;
      await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
    };
    return {
      escrow, wallet, conn, room, code, U1, U2, M0, balAfterM0, statsDeps, bindGameToEscrow, gameBoundToEscrow,
      serializeRoom, deserializeRoom, snapshot, bootstrap, sweepFinish, teardown, ledger, gameRows, balances,
      advance, frozenLog, cleanup, recordConfirmedPokerStats,
    };
  }

  it('crash window 3 (the reported bug): FUNDED M1 + the old finished M0 state → refund M1, ZERO payout/stats', async () => {
    const t = await setup('RMC1');
    // The rematch debit commits; the process dies before restartGame → the room still holds M0's state.
    expect((await t.escrow.debitRematch(t.room)).ok).toBe(true);
    const M1 = t.room.pokerEscrow!.matchId;
    expect(M1).not.toBe(t.M0);
    expect(t.gameBoundToEscrow(t.room)).toBe(false);       // M1 did NOT produce this state
    expect(t.escrow.payoutPending(t.room)).toBe(false);    // …so it is never payout-pending
    expect(t.escrow.unboundEscrowGame(t.room)).toBe(true);
    expect(t.escrow.pokerRecoveryBlocked(t.room)).toBe(true); // no rematch/gameplay while unresolved

    const restored = t.deserializeRoom(t.serializeRoom(t.room))!;
    expect(await t.bootstrap(restored)).toBe('unbound_debit');
    expect(t.advance).not.toHaveBeenCalled();              // never resumed
    expect(restored.gameState).toBeNull();                 // the old generation's state is dropped
    expect(restored.pokerGameMatchId).toBeUndefined();
    expect(restored.pokerMatchCancelled).toBe(true);       // refund CONFIRMED → honest cancelled lobby
    expect(restored.pokerFrozen).toBeUndefined();

    expect(await t.ledger(M1, 'table_payout')).toBe(0);    // the new escrow was NEVER paid
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2); // …it was refunded once per seat
    expect(await t.ledger(t.M0, 'table_payout')).toBe(1);  // M0's payout untouched (only the winner is credited)
    expect(await t.gameRows()).toBe(1);                    // NO second stats row under M1
    expect(await t.balances()).toEqual(t.balAfterM0);      // balances back to the pre-rematch values
    await t.cleanup();
  });

  it('crash window 2 (socket close persists MID-DEBIT): PENDING M1 + committed debit → refund M1, ZERO payout/stats', async () => {
    const t = await setup('RMC2');
    // The close handler persists WITHOUT the room lock, while the debit is still awaiting Postgres.
    const inFlight = t.escrow.debitRematch(t.room);
    // The storage layer writes JSON — snapshot it right now, exactly as the close handler would.
    const persistedMidDebit = JSON.parse(JSON.stringify(t.serializeRoom(t.room))); // escrow M1 = 'pending' + the M0 state
    expect((persistedMidDebit as { pokerEscrow?: { status: string } }).pokerEscrow!.status).toBe('pending');
    expect((await inFlight).ok).toBe(true);                        // the DB debit then commits
    const M1 = t.room.pokerEscrow!.matchId;

    const restored = t.deserializeRoom(persistedMidDebit)!;        // …and the process dies right there
    expect(restored.pokerEscrow!.status).toBe('pending');
    expect(await t.bootstrap(restored)).toBe('unbound_debit');     // reconcile → funded, binding → unbound
    expect(restored.gameState).toBeNull();
    expect(restored.pokerMatchCancelled).toBe(true);
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    expect(await t.gameRows()).toBe(1);
    expect(await t.balances()).toEqual(t.balAfterM0);
    await t.cleanup();
  });

  it('crash window 1: PENDING M1 persisted but the debit NEVER committed → dropped; no payout/refund/stats', async () => {
    const t = await setup('RMC3');
    // A pending escrow whose transaction rolled back: nothing was ever charged for this match id.
    const M1 = randomUUID();
    t.room.pokerEscrow = { matchId: M1, buyIn: 5000, status: 'pending', seats: [{ seat: 0, userId: t.U1, amount: 5000 }, { seat: 1, userId: t.U2, amount: 5000 }] };
    const restored = t.deserializeRoom(t.serializeRoom(t.room))!;

    expect(await t.bootstrap(restored)).toBe('cancelled');
    expect(restored.pokerEscrow).toBeUndefined();          // reconcile dropped the uncommitted debit
    expect(restored.gameState).toBeNull();
    expect(restored.pokerGameMatchId).toBeUndefined();
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.ledger(M1, 'table_buy_in')).toBe(0);
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(0);
    expect(await t.gameRows()).toBe(1);                    // only M0's row
    expect(await t.balances()).toEqual(t.balAfterM0);
    await t.cleanup();
  });

  it('crash window 4: a BOUND live M1 state restores normally (advance re-armed, nothing settled)', async () => {
    const t = await setup('RMC4');
    expect((await t.escrow.debitRematch(t.room)).ok).toBe(true);
    const M1 = t.room.pokerEscrow!.matchId;
    t.room.gameState = live2p() as unknown as typeof t.room.gameState; // restartGame succeeded…
    t.bindGameToEscrow(t.room);                                        // …and bound the state to M1

    const restored = t.deserializeRoom(t.serializeRoom(t.room))!;
    expect(restored.pokerGameMatchId).toBe(M1);
    expect(await t.bootstrap(restored)).toBe('live');
    expect(t.advance).toHaveBeenCalledOnce();              // a real live match resumes
    expect(restored.gameState).not.toBeNull();
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(0);
    // Clean up the still-funded M1 so the suite leaves no unsettled match behind.
    expect(await t.escrow.refundBuyIns(restored)).toBe(true);
    await t.cleanup();
  });

  it('crash window 5: a BOUND finished M1 state pays out + records EXACTLY once', async () => {
    const t = await setup('RMC5');
    expect((await t.escrow.debitRematch(t.room)).ok).toBe(true);
    const M1 = t.room.pokerEscrow!.matchId;
    t.room.gameState = finished2p(0) as unknown as typeof t.room.gameState; // M1 played out, seat 0 won
    t.bindGameToEscrow(t.room);

    const restored = t.deserializeRoom(t.serializeRoom(t.room))!;
    expect(await t.bootstrap(restored)).toBe('payout_pending');
    expect(t.escrow.payoutPending(restored)).toBe(true);
    const out = await t.sweepFinish(restored);
    expect(out.result).toBe('paid');
    expect(out.stats).toBe('recorded');
    expect(await t.ledger(M1, 'table_payout')).toBe(1);    // seat 0 credited once
    expect(await t.gameRows()).toBe(2);                    // M0 + M1, distinct identities
    // A repeat sweep never double-pays or double-records.
    const again = await t.sweepFinish(restored);
    expect(['already_paid', 'paid']).toContain(again.result);
    expect(await t.ledger(M1, 'table_payout')).toBe(1);
    expect(await t.gameRows()).toBe(2);
    await t.cleanup();
  });

  it('crash window 6: a LEGACY room with NO binding fails closed — frozen, nothing paid/refunded/recorded', async () => {
    const t = await setup('RMC6');
    expect((await t.escrow.debitRematch(t.room)).ok).toBe(true);
    const M1 = t.room.pokerEscrow!.matchId;
    t.room.gameState = finished2p() as unknown as typeof t.room.gameState;
    const json = JSON.parse(JSON.stringify(t.serializeRoom(t.room))) as Record<string, unknown>;
    delete json.pokerGameMatchId;                          // a save written before 37.7.12
    const restored = t.deserializeRoom(json)!;

    expect(await t.bootstrap(restored)).toBe('unknown_binding');
    expect(restored.pokerFrozen).toBe(true);
    expect(t.frozenLog).toEqual([`RMC6 — unknown match generation for the persisted game`]);
    expect(restored.gameState).not.toBeNull();             // evidence kept, nothing destroyed
    expect(t.advance).not.toHaveBeenCalled();
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(0);
    expect(await t.gameRows()).toBe(1);
    expect(await t.teardown(restored)).toBe('keep');        // a frozen paid room is never purged
    // The public snapshot exposes only `frozen` — no binding, match id, user id or escrow.
    const snap = JSON.stringify(t.snapshot(restored));
    expect(JSON.parse(snap).pokerRecovery).toBe('frozen');
    for (const secret of [M1, t.M0, t.U1, t.U2, 'pokerGameMatchId', 'pokerEscrow']) expect(snap).not.toContain(secret);
    // Resolve the real M1 debit so the suite leaves nothing unsettled.
    restored.pokerFrozen = undefined;
    expect(await t.escrow.refundBuyIns(restored)).toBe(true);
    await t.cleanup();
  });

  it('the orphan scan does NOT protect an unbound debit, but DOES protect a bound live match', async () => {
    const t = await setup('RMC7');
    expect((await t.escrow.debitRematch(t.room)).ok).toBe(true);
    const M1 = t.room.pokerEscrow!.matchId;
    const restored = t.deserializeRoom(t.serializeRoom(t.room))!; // unbound: M1 + the M0 state

    // (37.7.13) The PRODUCTION protection rule — the same `settlementProtectedMatchId` the bootstrap
    // pipeline uses, no longer a copy of it in the test.
    const { settlementProtectedMatchId, classifyBootstrapRecovery } = await import('../../server/pokerBootstrap');
    const protectedId = settlementProtectedMatchId(restored, classifyBootstrapRecovery(restored, isFin));
    expect(protectedId).toBeNull();                         // an unplayed debit is NOT an active match
    const { refunded } = await scopedOrphanScan((m) => m.matchId === M1);
    expect(refunded).toContain(M1);                         // → refunded exactly once by the orphan scan
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    // A repeat scan refunds nothing new; a BOUND live match is protected instead.
    const second = await scopedOrphanScan((m) => m.matchId === M1);
    expect(second.refunded).not.toContain(M1);
    expect(await t.gameRows()).toBe(1);
    expect(await t.balances()).toEqual(t.balAfterM0);
    await t.cleanup();
  });

  it('a transient refund failure keeps settlement-pending; the retry refunds once, then M2 plays normally', async () => {
    const t = await setup('RMC8');
    expect((await t.escrow.debitRematch(t.room)).ok).toBe(true);
    const M1 = t.room.pokerEscrow!.matchId;
    const restored = t.deserializeRoom(t.serializeRoom(t.room))!;

    // The refund fails transiently during recovery → an honest settlement-pending room (NOT cancelled).
    t.escrow.__setRefundFailure(true);
    expect(await t.bootstrap(restored)).toBe('unbound_debit');
    expect(restored.gameState).toBeNull();
    expect(restored.pokerEscrow!.status).toBe('funded');
    expect(restored.pokerMatchCancelled).toBeUndefined();
    expect(t.escrow.settlementPending(restored)).toBe(true);   // the sweep keeps retrying
    expect(t.escrow.pokerRecoveryBlocked(restored)).toBe(true);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(0);
    // Teardown must NOT purge while chips are still owed.
    expect(await t.teardown(restored)).toBe('keep');

    // The DB recovers → the sweep's refund resolves it exactly once.
    t.escrow.__setRefundFailure(false);
    expect(await t.escrow.refundBuyIns(restored)).toBe(true);
    restored.pokerMatchCancelled = true;
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    expect(await t.balances()).toEqual(t.balAfterM0);

    // …and a brand-new match M2 can now be started and played to a paid finish.
    const fresh = await t.escrow.debitFreshStart(restored);
    expect(fresh.ok).toBe(true);
    const M2 = restored.pokerEscrow!.matchId;
    expect([t.M0, M1]).not.toContain(M2);
    restored.started = true;
    restored.gameState = finished2p(0) as unknown as typeof restored.gameState;
    t.bindGameToEscrow(restored);
    const out = await t.sweepFinish(restored);
    expect(out.result).toBe('paid');
    expect(out.stats).toBe('recorded');
    expect(await t.ledger(M2, 'table_payout')).toBe(1);
    expect(await t.gameRows()).toBe(2);                        // M0 + M2 (M1 never produced a row)
    await t.cleanup();
  });

  it('teardown of an unbound room refunds before purging, and never settles the stale state', async () => {
    const t = await setup('RMC9');
    expect((await t.escrow.debitRematch(t.room)).ok).toBe(true);
    const M1 = t.room.pokerEscrow!.matchId;
    const restored = t.deserializeRoom(t.serializeRoom(t.room))!;

    expect(await t.teardown(restored)).toBe('purge');          // resolved → safe to delete
    expect(restored.gameState).toBeNull();
    expect(await t.ledger(M1, 'table_payout')).toBe(0);
    expect(await t.ledger(M1, 'table_cancel_refund')).toBe(2);
    expect(await t.gameRows()).toBe(1);
    expect(await t.balances()).toEqual(t.balAfterM0);
    await t.cleanup();
  });

  it('the stats recorder itself refuses an unbound state (no row under the new match id)', async () => {
    const t = await setup('RMC10');
    expect((await t.escrow.debitRematch(t.room)).ok).toBe(true);
    let writes = 0;
    const res = await t.recordConfirmedPokerStats(t.room, finished2p(), {
      alreadyRecorded: () => false, markRecorded: () => {}, unmarkRecorded: () => {},
      record: async () => { writes++; return { recorded: true }; },
    });
    expect(res).toBe('invalid');
    expect(writes).toBe(0);
    expect(await t.gameRows()).toBe(1);
    expect(await t.escrow.refundBuyIns(t.room)).toBe(true); // leave nothing unsettled
    await t.cleanup();
  });
});
