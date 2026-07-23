import { describe, it, expect, afterEach } from 'vitest';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';
import type { StatsResult } from '../../server/pokerFinish';

// Stage 37.7.9 FAIL 2 (integration, real Postgres): a payout that CONFIRMS but whose stats write then
// FAILS transiently must not lose the stats. The paid finish becomes STATS-PENDING (persisted): the
// payout ran exactly once, the finished state + stable matchId are kept, a rematch is blocked, and a
// background retry records the stats EXACTLY once (idempotent, survives restart). SKIPPED without DB.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
function P(seat: number): PokerPlayer { return { id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' }; }
function tel2(): PokerTelemetry {
  return { handsPlayedBySeat: [8, 8], handsWonBySeat: [3, 5], showdownsWonBySeat: [1, 3], potsWonBySeat: [3, 6], biggestPotBySeat: [400, 900], allInsWonBySeat: [0, 1], royalFlushBySeat: [0, 0] };
}
function finished2p(): PokerState {
  const f = () => [false, false];
  return { gameType: 'poker', phase: 'game_finished', playerCount: 2, players: [P(0), P(1)], options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 }, buttonSeat: 0, handNumber: 8, street: 'river', stacksBySeat: [0, 10000], holeCardsBySeat: [[], []], board: [], deck: [], burned: [], committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(), wasAllInBySeat: f(), actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: [true, false], currentBet: 0, minRaise: 50, toActSeat: 1, revealedBySeat: f(), lastHand: null, winnerSeat: 1, actionLog: [], telemetry: tel2() } as unknown as PokerState;
}

afterEach(async () => {
  const escrow = await import('../../server/pokerEscrow');
  escrow.__setRefundFailure(false); escrow.__setPayoutFailure(false);
});

describe.skipIf(!TEST_DATABASE_URL)('stats-pending recovery after a paid finish (Stage 37.7.9 FAIL 2)', () => {
  it('paid once + first stats fails → stats-pending; a retry records exactly once (survives restart)', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { settleAndRecordBankrollPokerFinish, recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const { createRoom, addMember, serializeRoom, deserializeRoom } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const U1 = await users.createAccountUser({ email: null, name: 'SpA', emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: 'SpB', emailVerified: false });
    await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
    const CODE = 'SPEND1';
    const room = createRoom({ code: CODE, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
    room.started = true; room.gameState = finished2p() as unknown as typeof room.gameState;
    await escrow.debitBuyIns(room);
    const M = room.pokerEscrow!.matchId;

    const payoutRows = async () => ((await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${M} AND reason = 'table_payout'`) as Array<{ n: number }>)[0].n;
    const gameRows = async () => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${CODE}`) as Array<{ n: number }>)[0].n;
    // A stats recorder that fails the FIRST call, then works.
    let failNext = true;
    const marker = new Map<string, string>();
    const statsDeps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id,
      markRecorded: (c: string, id: string) => { marker.set(c, id); },
      unmarkRecorded: (c: string) => { marker.delete(c); },
      record: async (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => {
        if (failNext) { failNext = false; throw new Error('transient stats DB failure'); }
        return pokerStats.recordFinishedPokerGame(c, st, su, mid);
      },
    });
    const finishDeps = () => ({
      payoutStacks: escrow.payoutStacks, persist: () => {}, broadcast: () => {}, clearRematch: () => {},
      freeze: (r: ServerRoom) => { r.pokerFrozen = true; },
      recordStats: (r: ServerRoom, s: PokerState): Promise<StatsResult> => recordConfirmedPokerStats(r, s, statsDeps()),
    });

    // Finish: payout confirms, but the stats write throws → STATS-PENDING.
    const out = await settleAndRecordBankrollPokerFinish(room, finished2p(), finishDeps());
    expect(out.result).toBe('paid');
    expect(out.stats).toBe('failed');
    expect(room.pokerStatsPending).toBe(true);
    expect(room.pokerEscrow!.status).toBe('settled'); // money is OUT
    expect(await payoutRows()).toBe(1);               // paid exactly once
    expect(await gameRows()).toBe(0);                 // stats NOT recorded yet
    expect(escrow.statsPending(room)).toBe(true);
    expect(escrow.payoutPending(room)).toBe(false);   // never re-paid
    expect(escrow.pokerRecoveryBlocked(room)).toBe(true); // rematch blocked
    expect(room.gameState).not.toBeNull();            // finished state kept for the retry

    // A process RESTART between payout and the stats write: serialize → restore keeps stats-pending
    // + the stable matchId (the in-memory dedup marker is lost, but the durable game_key is authoritative).
    const restored = deserializeRoom(serializeRoom(room))!;
    expect(restored.pokerStatsPending).toBe(true);
    expect(restored.pokerEscrow!.matchId).toBe(M);
    marker.clear(); // simulate the fresh process (empty recordedFinish)

    // Background retry (the sweep) after the DB recovers → records EXACTLY once, clears the flag.
    const s1 = await recordConfirmedPokerStats(restored, restored.gameState as PokerState, statsDeps());
    expect(s1).toBe('recorded');
    restored.pokerStatsPending = undefined; // (the sweep clears it on a non-failed result)
    expect(await gameRows()).toBe(1);
    expect(escrow.statsPending(restored)).toBe(false);
    expect(escrow.pokerRecoveryBlocked(restored)).toBe(false); // rematch re-enabled

    // Idempotent: a further retry (even with a fresh marker) never writes a second row.
    marker.clear();
    const s2 = await recordConfirmedPokerStats(restored, restored.gameState as PokerState, statsDeps());
    expect(s2).toBe('already_exists');
    expect(await gameRows()).toBe(1);

    await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${CODE})`;
    await conn!.sql`DELETE FROM games WHERE room_code = ${CODE}`;
    await conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
    await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });

  it('settleAndRecord CLEARS a prior stats-pending once the stats finally record', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { settleAndRecordBankrollPokerFinish, recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const { createRoom, addMember } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const U1 = await users.createAccountUser({ email: null, name: 'Sp2A', emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: 'Sp2B', emailVerified: false });
    await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
    const CODE = 'SPEND2';
    const room = createRoom({ code: CODE, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
    room.started = true; room.gameState = finished2p() as unknown as typeof room.gameState;
    await escrow.debitBuyIns(room);
    const M = room.pokerEscrow!.matchId;
    room.pokerStatsPending = true; // pretend a prior stats attempt failed
    const marker = new Map<string, string>();
    const finishDeps = () => ({
      payoutStacks: escrow.payoutStacks, persist: () => {}, broadcast: () => {}, clearRematch: () => {}, freeze: () => {},
      recordStats: (r: ServerRoom, s: PokerState): Promise<StatsResult> => recordConfirmedPokerStats(r, s, {
        alreadyRecorded: (c, id) => marker.get(c) === id, markRecorded: (c, id) => { marker.set(c, id); }, unmarkRecorded: (c) => { marker.delete(c); },
        record: (c, st, su, mid) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
      }),
    });
    // payoutStacks → already settled → already_paid → stats now succeed → flag cleared.
    await escrow.payoutStacks(room, finished2p()); // settle first (idempotent) so result is already_paid
    const out = await settleAndRecordBankrollPokerFinish(room, finished2p(), finishDeps());
    expect(out.result).toBe('already_paid');
    expect(out.stats).toBe('recorded');
    expect(room.pokerStatsPending).toBeUndefined(); // resolved → cleared

    await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${CODE})`;
    await conn!.sql`DELETE FROM games WHERE room_code = ${CODE}`;
    await conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
    await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });
});
