import { describe, it, expect, afterEach } from 'vitest';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';
import type { StatsResult, BankrollFinishOutcome } from '../../server/pokerFinish';

// Stage 37.7.10 FAIL 2 (integration, real Postgres): production teardown (`settleRoomForDeletion`) runs
// the SAME settle→stats lifecycle as finish/sweep — a finished paid room records its owed stats before
// purge (no raw payout→purge bypass), never re-pays, and is KEPT on a transient stats failure.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
function P(seat: number): PokerPlayer { return { id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' }; }
function tel2(): PokerTelemetry { return { handsPlayedBySeat: [8, 8], handsWonBySeat: [3, 5], showdownsWonBySeat: [1, 3], potsWonBySeat: [3, 6], biggestPotBySeat: [400, 900], allInsWonBySeat: [0, 1], royalFlushBySeat: [0, 0] }; }
function finished2p(): PokerState {
  const f = () => [false, false];
  return { gameType: 'poker', phase: 'game_finished', playerCount: 2, players: [P(0), P(1)], options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 }, buttonSeat: 0, handNumber: 8, street: 'river', stacksBySeat: [0, 10000], holeCardsBySeat: [[], []], board: [], deck: [], burned: [], committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(), wasAllInBySeat: f(), actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: [true, false], currentBet: 0, minRaise: 50, toActSeat: 1, revealedBySeat: f(), lastHand: null, winnerSeat: 1, actionLog: [], telemetry: tel2() } as unknown as PokerState;
}
/** The SAME match mid-hand — what a room JSON persisted before the finish landed looks like. */
function unfinished2p(): PokerState {
  return { ...finished2p(), phase: 'betting', street: 'flop', stacksBySeat: [4000, 6000], winnerSeat: null, eliminatedBySeat: [false, false] } as unknown as PokerState;
}
const isFin = (s: PokerState) => s.phase === 'game_finished';

describe.skipIf(!TEST_DATABASE_URL)('teardown settles THEN records stats (Stage 37.7.10 FAIL 2)', () => {
  async function setup(code: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { settleRoomForDeletion, settleAndRecordBankrollPokerFinish, recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const { createRoom, addMember } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const U1 = await users.createAccountUser({ email: null, name: `${code}A`, emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: `${code}B`, emailVerified: false });
    await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
    const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
    room.started = true; room.gameState = finished2p() as unknown as typeof room.gameState;
    await escrow.debitBuyIns(room);
    const M = room.pokerEscrow!.matchId;
    const marker = new Map<string, string>();
    let statsThrows = false;
    const frozenLog: string[] = [];
    const freeze = (r: ServerRoom, reason: string) => { if (!r.pokerFrozen) { r.pokerFrozen = true; frozenLog.push(`${r.code} — ${reason}`); } };
    const settleAndRecord = (r: ServerRoom, s: PokerState): Promise<BankrollFinishOutcome> => settleAndRecordBankrollPokerFinish(r, s, {
      payoutStacks: escrow.payoutStacks, persist: () => {}, broadcast: () => {}, clearRematch: () => {}, freeze,
      recordStats: (rm, st): Promise<StatsResult> => recordConfirmedPokerStats(rm, st, {
        alreadyRecorded: (c, id) => marker.get(c) === id, markRecorded: (c, id) => { marker.set(c, id); }, unmarkRecorded: (c) => { marker.delete(c); },
        record: (c, sst, su, mid) => { if (statsThrows) throw new Error('transient stats DB failure'); return pokerStats.recordFinishedPokerGame(c, sst, su, mid); },
      }),
    });
    const teardown = (r: ServerRoom) => settleRoomForDeletion(r, {
      reconcileEscrow: escrow.reconcileEscrow, hasUnsettledEscrow: escrow.hasUnsettledEscrow, isFinished: isFin, settleAndRecord, refundBuyIns: escrow.refundBuyIns, persist: () => {}, freeze,
    });
    const payoutRows = async () => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = 'table_payout'`) as Array<{ n: number }>)[0].n;
    const gameRows = async () => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${code}`) as Array<{ n: number }>)[0].n;
    const cleanup = async () => {
      await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${code})`;
      await conn!.sql`DELETE FROM games WHERE room_code = ${code}`;
      await conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
      await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
    };
    const refundRows = async () => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = 'table_cancel_refund'`) as Array<{ n: number }>)[0].n;
    const statRows = async () => ((await conn!.sql`SELECT count(*)::int AS n FROM user_stats WHERE user_id IN (${U1}, ${U2}) AND game_type = 'poker'`) as Array<{ n: number }>)[0].n;
    return { escrow, wallet, room, M, U1, U2, teardown, payoutRows, refundRows, gameRows, statRows, frozenLog, cleanup, setStatsThrows: (v: boolean) => { statsThrows = v; } };
  }

  it('finished funded room → payout once + stats once, THEN purge', async () => {
    const t = await setup('TDN1');
    const fate = await t.teardown(t.room);
    expect(fate).toBe('purge');
    expect(await t.payoutRows()).toBe(1);
    expect(await t.gameRows()).toBe(1);
    expect(t.room.pokerEscrow!.status).toBe('settled');
    await t.cleanup();
  });

  it('crash-window: durable payout committed, escrow persisted settling → reconcile→settled, no re-payout, stats recorded, purge', async () => {
    const t = await setup('TDN2');
    await t.escrow.payoutStacks(t.room, finished2p()); // durable payout
    t.room.pokerEscrow!.status = 'settling';           // stale room JSON
    const balBefore = (await t.wallet.getWalletView(t.U1, DAY)).balance;
    const fate = await t.teardown(t.room);
    expect(fate).toBe('purge');
    expect(await t.payoutRows()).toBe(1);               // NOT re-paid
    expect(await t.gameRows()).toBe(1);
    expect((await t.wallet.getWalletView(t.U1, DAY)).balance).toBe(balBefore);
    await t.cleanup();
  });

  it('stats write fails → room KEPT (finished state + matchId + stats-pending), payout not repeated; a retry records once', async () => {
    const t = await setup('TDN3');
    t.setStatsThrows(true);
    const fate1 = await t.teardown(t.room);
    expect(fate1).toBe('keep');                         // NOT purged
    expect(await t.payoutRows()).toBe(1);
    expect(await t.gameRows()).toBe(0);                 // stats not written yet
    expect(t.room.pokerStatsPending).toBe(true);
    expect(t.room.gameState).not.toBeNull();            // finished state kept
    expect(t.room.pokerEscrow!.matchId).toBe(t.M);      // stable identity kept
    // Retry (DB recovers) → records once, no second payout, then purge.
    t.setStatsThrows(false);
    const fate2 = await t.teardown(t.room);
    expect(fate2).toBe('purge');
    expect(await t.payoutRows()).toBe(1);               // payout NEVER repeated
    expect(await t.gameRows()).toBe(1);                 // stats recorded exactly once
    await t.cleanup();
  });

  it('durable game row already exists → already_exists is resolved → purge, no duplicate', async () => {
    const t = await setup('TDN4');
    await t.teardown(t.room);                           // records once + purge
    expect(await t.gameRows()).toBe(1);
    // A second teardown of the same finished match (idempotent) → still one row, purge.
    const fate = await t.teardown(t.room);
    expect(fate).toBe('purge');
    expect(await t.gameRows()).toBe(1);
    expect(await t.payoutRows()).toBe(1);
    await t.cleanup();
  });

  // ── Stage 37.7.11 FAIL 1/2: teardown must fail CLOSED on an INCOHERENT paid match ──────────
  it('(37.7.11 FAIL 1) settled escrow + UNFINISHED state → KEEP + freeze, never purge, never refund/re-pay', async () => {
    const t = await setup('TDN6');
    await t.escrow.payoutStacks(t.room, finished2p());          // money is out
    const balBefore = (await t.wallet.getWalletView(t.U1, DAY)).balance;
    t.room.gameState = unfinished2p() as unknown as typeof t.room.gameState; // stale pre-finish state
    // The old teardown saw `hasUnsettledEscrow === false` here and purged the room outright.
    expect(t.escrow.hasUnsettledEscrow(t.room)).toBe(false);

    const fate = await t.teardown(t.room);
    expect(fate).toBe('keep');
    expect(t.room.pokerFrozen).toBe(true);
    expect(t.frozenLog).toEqual(['TDN6 — paid match with no finished state']);
    expect(t.room.gameState).not.toBeNull();                    // evidence kept
    expect(t.room.pokerMatchCancelled).toBeUndefined();
    expect(await t.payoutRows()).toBe(1);
    expect(await t.refundRows()).toBe(0);
    expect(await t.gameRows()).toBe(0);
    expect((await t.wallet.getWalletView(t.U1, DAY)).balance).toBe(balBefore);
    // A second teardown attempt (frozen) still keeps it and logs nothing new.
    expect(await t.teardown(t.room)).toBe('keep');
    expect(t.frozenLog).toHaveLength(1);
    expect(await t.payoutRows()).toBe(1);
    await t.cleanup();
  });

  it('(37.7.11 FAIL 2) structurally INVALID paid finish → no stats rows, permanent freeze, KEEP (no endless retry)', async () => {
    const t = await setup('TDN7');
    await t.escrow.payoutStacks(t.room, finished2p());          // paid; escrow settled
    const balBefore = (await t.wallet.getWalletView(t.U1, DAY)).balance;
    // Corrupt the restored escrow: BOTH seats claim seat 0 (the old recorder collapsed this into a
    // single Map entry and wrote a partial attribution, then cleared the owed-stats flag).
    t.room.pokerEscrow!.seats = [{ seat: 0, userId: t.U1, amount: 5000 }, { seat: 0, userId: t.U2, amount: 5000 }];

    const fate = await t.teardown(t.room);
    expect(fate).toBe('keep');                                  // never purged with stats owed
    expect(t.room.pokerFrozen).toBe(true);                      // permanent operator condition
    expect(t.frozenLog).toHaveLength(1);
    expect(await t.gameRows()).toBe(0);                         // NO games / game_players row
    expect(await t.statRows()).toBe(0);                         // NO user_stats row
    expect(await t.payoutRows()).toBe(1);                       // no re-payout
    expect(await t.refundRows()).toBe(0);                       // and no refund
    expect((await t.wallet.getWalletView(t.U1, DAY)).balance).toBe(balBefore);
    // The stats sweep skips a frozen room, so this can never spin/log every 45s.
    expect(t.escrow.statsPending(t.room)).toBe(false);
    expect(t.escrow.payoutPending(t.room)).toBe(false);
    expect(t.escrow.pokerRecoveryBlocked(t.room)).toBe(true);
    await t.cleanup();
  });

  it('already_refunded finished match → no stats, safe purge', async () => {
    const t = await setup('TDN5');
    await t.escrow.refundBuyIns(t.room);               // escrow → cancelled (mutex)
    const fate = await t.teardown(t.room);
    expect(fate).toBe('purge');
    expect(await t.gameRows()).toBe(0);                 // never recorded
    expect(await t.payoutRows()).toBe(0);
    await t.cleanup();
  });
});
