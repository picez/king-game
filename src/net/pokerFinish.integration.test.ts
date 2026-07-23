import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 37.7.8 FAIL 1 (integration, real Postgres): SETTLEMENT-BEFORE-STATS for bankroll poker.
// Stats/rating/achievements are recorded ONLY after a CONFIRMED payout — never before, never in
// parallel, never for a refunded/invalid match. SKIPPED unless TEST_DATABASE_URL is set.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));

// A complete 2-human FINISHED poker state (seat 1 wins the whole 10000 escrow). Conserves the
// escrow (2 × 5000 buy-in). `invalid` variant breaks conservation (Σ stacks ≠ Σ buy-ins).
function P(seat: number): PokerPlayer { return { id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' }; }
function tel2(): PokerTelemetry {
  const z = () => [0, 0];
  return {
    handsPlayedBySeat: [8, 8], handsWonBySeat: [3, 5], showdownsWonBySeat: [1, 3],
    potsWonBySeat: [3, 6], biggestPotBySeat: [400, 900], allInsWonBySeat: [0, 1], royalFlushBySeat: z(),
  };
}
function finished2p(stacks: [number, number] = [0, 10000]): PokerState {
  const f = () => [false, false];
  return {
    gameType: 'poker', phase: 'game_finished', playerCount: 2, players: [P(0), P(1)],
    options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 },
    buttonSeat: 0, handNumber: 8, street: 'river', stacksBySeat: stacks,
    holeCardsBySeat: [[], []], board: [], deck: [], burned: [],
    committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(),
    allInBySeat: f(), wasAllInBySeat: f(), actedBySeat: f(), raiseOpenBySeat: f(),
    eliminatedBySeat: [true, false], currentBet: 0, minRaise: 50, toActSeat: 1,
    revealedBySeat: f(), lastHand: null, winnerSeat: 1, actionLog: [], telemetry: tel2(),
  } as unknown as PokerState;
}

afterEach(async () => {
  // FAIL 4: fault seams are global module state — always reset so a failure can't cascade.
  const escrow = await import('../../server/pokerEscrow');
  escrow.__setRefundFailure(false); escrow.__setPayoutFailure(false);
});

describe.skipIf(!TEST_DATABASE_URL)('settlement-before-stats for bankroll poker (Stage 37.7.8 FAIL 1)', () => {
  async function setup(code: string) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { settleAndRecordBankrollPokerFinish, recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const { createRoom, addMember } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const U1 = await users.createAccountUser({ email: null, name: `${code}A`, emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: `${code}B`, emailVerified: false });
    await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
    const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
    room.started = true;

    const marker = new Map<string, string>();
    const realRecord = (r: ServerRoom, s: PokerState) => recordConfirmedPokerStats(r, s, {
      alreadyRecorded: (c, sig) => marker.get(c) === sig,
      markRecorded: (c, sig) => { marker.set(c, sig); },
      unmarkRecorded: (c) => { marker.delete(c); },
      record: (c, st, su, mid) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });
    const deps = (recordStats: (r: ServerRoom, s: PokerState) => Promise<import('../../server/pokerFinish').StatsResult>) => ({
      payoutStacks: escrow.payoutStacks,
      persist: () => {}, broadcast: () => {}, clearRematch: () => {},
      freeze: (r: ServerRoom) => { r.pokerFrozen = true; },
      recordStats,
    });
    const payoutRows = async (matchId: string) => {
      const n = await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${matchId} AND reason = 'table_payout'`;
      return (n as Array<{ n: number }>)[0].n;
    };
    const gameRows = async () => {
      const n = await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${code} AND game_type = 'poker'`;
      return (n as Array<{ n: number }>)[0].n;
    };
    const cleanup = async (matchId: string) => {
      await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${code})`;
      await conn!.sql`DELETE FROM games WHERE room_code = ${code}`;
      await conn!.sql`DELETE FROM poker_matches WHERE match_id = ${matchId}`;
      await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
    };
    return { escrow, wallet, settleAndRecordBankrollPokerFinish, realRecord, deps, room, U1, U2, payoutRows, gameRows, cleanup, conn };
  }

  it('retry_pending → NO payout ledger, NO stats/game row, NO stats recorder call', async () => {
    const t = await setup('FIN_RP');
    await t.escrow.debitBuyIns(t.room);
    const M = t.room.pokerEscrow!.matchId;
    t.room.gameState = finished2p() as unknown as typeof t.room.gameState; // the room holds the finished game
    const spy = vi.fn(async (): Promise<import('../../server/pokerFinish').StatsResult> => 'recorded');
    t.escrow.__setPayoutFailure(true);
    const out = await t.settleAndRecordBankrollPokerFinish(t.room, finished2p(), t.deps(spy));
    expect(out.result).toBe('retry_pending');
    expect(out.stats).toBeNull();
    expect(spy).not.toHaveBeenCalled();          // stats recorder NEVER invoked before payout
    expect(await t.payoutRows(M)).toBe(0);        // no payout
    expect(await t.gameRows()).toBe(0);           // no game/stats row
    expect(t.room.pokerEscrow!.status).toBe('funded');
    expect(t.escrow.payoutPending(t.room)).toBe(true);
    await t.cleanup(M);
  });

  it('retry then paid → payout once + stats once; a repeat (rebroadcast) never duplicates', async () => {
    const t = await setup('FIN_PAID');
    await t.escrow.debitBuyIns(t.room);
    const M = t.room.pokerEscrow!.matchId;
    // First attempt fails transiently → no stats.
    t.escrow.__setPayoutFailure(true);
    expect((await t.settleAndRecordBankrollPokerFinish(t.room, finished2p(), t.deps(t.realRecord))).result).toBe('retry_pending');
    expect(await t.gameRows()).toBe(0);
    // DB recovers → paid → stats recorded EXACTLY once.
    t.escrow.__setPayoutFailure(false);
    const paid = await t.settleAndRecordBankrollPokerFinish(t.room, finished2p(), t.deps(t.realRecord));
    expect(paid.result).toBe('paid');
    expect(paid.stats).toBe('recorded');
    expect(await t.payoutRows(M)).toBe(1);
    expect(await t.gameRows()).toBe(1);
    // A rebroadcast/reconnect/retry → already_paid, stats NOT written again.
    const again = await t.settleAndRecordBankrollPokerFinish(t.room, finished2p(), t.deps(t.realRecord));
    expect(again.result).toBe('already_paid');
    expect(again.stats).toBe('already_exists');
    expect(await t.payoutRows(M)).toBe(1);        // still one payout
    expect(await t.gameRows()).toBe(1);           // still one game row
    await t.cleanup(M);
  });

  it('already_refunded → NO payout, NO stats; room becomes a cancelled lobby', async () => {
    const t = await setup('FIN_REF');
    await t.escrow.debitBuyIns(t.room);
    const M = t.room.pokerEscrow!.matchId;
    await t.escrow.refundBuyIns(t.room);           // escrow → cancelled (mutex)
    const spy = vi.fn(async (): Promise<import('../../server/pokerFinish').StatsResult> => 'recorded');
    const out = await t.settleAndRecordBankrollPokerFinish(t.room, finished2p(), t.deps(spy));
    expect(out.result).toBe('already_refunded');
    expect(spy).not.toHaveBeenCalled();
    expect(await t.payoutRows(M)).toBe(0);
    expect(await t.gameRows()).toBe(0);
    expect(t.room.pokerMatchCancelled).toBe(true);
    expect(t.room.gameState).toBeNull();
    await t.cleanup(M);
  });

  it('invalid conservation → NO payout, NO stats; room is permanently FROZEN', async () => {
    const t = await setup('FIN_INV');
    await t.escrow.debitBuyIns(t.room);
    const M = t.room.pokerEscrow!.matchId;
    t.room.gameState = finished2p([0, 9999]) as unknown as typeof t.room.gameState;
    const spy = vi.fn(async (): Promise<import('../../server/pokerFinish').StatsResult> => 'recorded');
    // Σ stacks (9999) ≠ Σ buy-ins (10000) → conservation fails closed → invalid.
    const out = await t.settleAndRecordBankrollPokerFinish(t.room, finished2p([0, 9999]), t.deps(spy));
    expect(out.result).toBe('invalid');
    expect(spy).not.toHaveBeenCalled();
    expect(await t.payoutRows(M)).toBe(0);
    expect(await t.gameRows()).toBe(0);
    expect(t.room.pokerFrozen).toBe(true);          // permanent operator freeze
    expect(t.escrow.payoutPending(t.room)).toBe(false); // sweep will NOT retry a frozen room
    await t.cleanup(M);
  });
});
