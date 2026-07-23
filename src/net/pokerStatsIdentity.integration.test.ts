import { describe, it, expect } from 'vitest';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 37.7.9 FAIL 1 (integration, real Postgres): two DISTINCT paid matches in the SAME room can
// finish with an IDENTICAL outcome. Their stats identity MUST come from the stable unique escrow
// matchId (not the content), so the second match is recorded (its own games row), and reprocessing
// either match is idempotent (no third row). SKIPPED unless TEST_DATABASE_URL is set.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
function P(seat: number): PokerPlayer { return { id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' }; }
function tel2(): PokerTelemetry {
  return { handsPlayedBySeat: [8, 8], handsWonBySeat: [3, 5], showdownsWonBySeat: [1, 3], potsWonBySeat: [3, 6], biggestPotBySeat: [400, 900], allInsWonBySeat: [0, 1], royalFlushBySeat: [0, 0] };
}
// IDENTICAL outcome every call: winnerSeat 1, handNumber 8, winners [player-1].
function finished2p(): PokerState {
  const f = () => [false, false];
  return { gameType: 'poker', phase: 'game_finished', playerCount: 2, players: [P(0), P(1)], options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 }, buttonSeat: 0, handNumber: 8, street: 'river', stacksBySeat: [0, 10000], holeCardsBySeat: [[], []], board: [], deck: [], burned: [], committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(), wasAllInBySeat: f(), actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: [true, false], currentBet: 0, minRaise: 50, toActSeat: 1, revealedBySeat: f(), lastHand: null, winnerSeat: 1, actionLog: [], telemetry: tel2() } as unknown as PokerState;
}

describe.skipIf(!TEST_DATABASE_URL)('bankroll stats identity = escrow matchId (Stage 37.7.9 FAIL 1)', () => {
  it('two identical-outcome matches in one room record TWO games rows; reprocessing is idempotent', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const pokerStats = await import('../../server/db/pokerStats');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const U1 = await users.createAccountUser({ email: null, name: 'IdA', emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: 'IdB', emailVerified: false });
    const su = new Map<number, string | null>([[0, U1], [1, U2]]);
    const CODE = 'IDENT1';
    const gameRows = async () => ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${CODE}`) as Array<{ n: number }>)[0].n;
    const winnerRows = async () => ((await conn!.sql`SELECT count(*)::int AS n FROM game_players WHERE user_id = ${U2} AND is_winner = true`) as Array<{ n: number }>)[0].n;

    // Match M1 and match M2 have the SAME content but DIFFERENT stable matchIds.
    const r1 = await pokerStats.recordFinishedPokerGame(CODE, finished2p(), su, 'match-M1');
    const r2 = await pokerStats.recordFinishedPokerGame(CODE, finished2p(), su, 'match-M2');
    expect(r1.recorded).toBe(true);
    expect(r2.recorded).toBe(true);                 // NOT dropped as a duplicate (distinct matchId)
    expect(await gameRows()).toBe(2);               // two durable games
    expect(await winnerRows()).toBe(2);             // winner credited for BOTH matches

    // Reprocessing EITHER match (rebroadcast/reconnect/restart) creates no third row.
    expect((await pokerStats.recordFinishedPokerGame(CODE, finished2p(), su, 'match-M1')).recorded).toBe(false);
    expect((await pokerStats.recordFinishedPokerGame(CODE, finished2p(), su, 'match-M2')).recorded).toBe(false);
    expect(await gameRows()).toBe(2);
    expect(await winnerRows()).toBe(2);

    // Sanity: the OLD content-only behaviour WOULD have collided — prove the keys differ by matchId.
    await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${CODE})`;
    await conn!.sql`DELETE FROM games WHERE room_code = ${CODE}`;
    await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });
});
