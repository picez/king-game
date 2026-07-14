import { describe, it, expect } from 'vitest';
import type { FiftyOnePlayer, FiftyOneState } from '../games/fiftyOne/types';

// Optional integration test for the 51 stats repository (FIFTYONE-STATS-2).
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// The repository (and drizzle/pg driver) is imported DYNAMICALLY so normal runs
// never load the driver. A unique room code per run keeps the test re-runnable;
// stat assertions are deltas (before/after) so repeated runs never flake. NO DB
// migration is needed — the free-text `game_type` column accepts 'fifty-one'.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const P = (seat: number, ai = false): FiftyOnePlayer => ({
  id: `player-${seat}`, name: ai ? 'Bot 1' : `P${seat}`, seatIndex: seat, type: ai ? 'ai' : 'human',
});

/** Minimal finished 3p 51 match: seat 0 wins (last standing, penalty 150); seats 1
 *  (loser, eliminated) and 2 (bot, eliminated) crossed 510. */
function finishedFiftyOne(): FiftyOneState {
  return {
    gameType: 'fifty-one',
    phase: 'game_finished',
    playerCount: 3,
    players: [P(0), P(1), P(2, true)],
    dealerSeat: 0, starterSeat: 1, currentSeat: 0, turnStep: 'meld_discard',
    handsBySeat: [[], [], []], drawPile: [], discardPile: [],
    openedBySeat: [true, true, true], publicMelds: [],
    scoresBySeat: [150, 512, 520],
    eliminatedSeats: [false, true, true],
    roundNumber: 8, roundWinnerSeat: 0,
    winnerSeat: 0, lastRound: null,
    options: { targetPenalty: 510 },
  };
}

describe.skipIf(!TEST_DATABASE_URL)('51 stats repository (integration, FIFTYONE-STATS-2)', () => {
  it('records per-seat outcome + penalty aggregates, excludes bots, and is idempotent', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const fiftyOne = await import('../../server/db/fiftyOneStats');

    const u0 = await users.getOrCreateGuest('it-fiftyone-u0'); // winner (last standing)
    const u1 = await users.getOrCreateGuest('it-fiftyone-u1'); // loser + eliminated
    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]);

    const state = finishedFiftyOne();
    const roomCode = `51IT${Math.floor(Math.random() * 1e6)}`;

    const w0 = await fiftyOne.getFiftyOneStats(u0.id);
    const l0 = await fiftyOne.getFiftyOneStats(u1.id);

    const r1 = await fiftyOne.recordFinishedFiftyOneGame(roomCode, state, seatUsers);
    expect(r1.recorded).toBe(true);
    expect(r1.humanPlayers).toBe(2);       // bot (seat 2) excluded

    const r2 = await fiftyOne.recordFinishedFiftyOneGame(roomCode, state, seatUsers);
    expect(r2.recorded).toBe(false);       // idempotent (game_key)

    const w1 = await fiftyOne.getFiftyOneStats(u0.id);
    const l1 = await fiftyOne.getFiftyOneStats(u1.id);

    // Winner (seat 0): +1 game, +1 win, +8 rounds, not eliminated, penalty 150.
    expect(w1.gamesPlayed - w0.gamesPlayed).toBe(1);
    expect(w1.gamesWon - w0.gamesWon).toBe(1);
    expect(w1.roundsPlayed - w0.roundsPlayed).toBe(8);
    expect(w1.timesEliminated - w0.timesEliminated).toBe(0);
    expect(w1.totalPenalty - w0.totalPenalty).toBe(150);
    // Loser (seat 1): +1 game, +1 loss, +1 elimination, penalty 512.
    expect(l1.gamesPlayed - l0.gamesPlayed).toBe(1);
    expect(l1.gamesLost - l0.gamesLost).toBe(1);
    expect(l1.timesEliminated - l0.timesEliminated).toBe(1);
    expect(l1.totalPenalty - l0.totalPenalty).toBe(512);
    expect(l1.gameType).toBe('fifty-one');
  });

  it('leaderboard exposes public fields + self marker, never a userId', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const fiftyOne = await import('../../server/db/fiftyOneStats');
    const u0 = await users.getOrCreateGuest('it-fiftyone-u0');

    const lb = await fiftyOne.getFiftyOneLeaderboard(50, u0.id);
    const me = lb.find((e) => e.self);
    expect(me).toBeTruthy();
    expect(typeof me?.gamesPlayed).toBe('number');
    expect('userId' in (me as object)).toBe(false); // no private id exposed
  });

  it('stores NO cards/hands/draw pile/melds in games/game_players (privacy sweep)', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const fiftyOne = await import('../../server/db/fiftyOneStats');
    const { getDb } = await import('../../server/db/client');
    const { games, gamePlayers } = await import('../../server/db/schema');
    const { eq } = await import('drizzle-orm');

    const u0 = await users.getOrCreateGuest('it-fiftyone-sweep0');
    const u1 = await users.getOrCreateGuest('it-fiftyone-sweep1');
    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]);
    const roomCode = `51SW${Math.floor(Math.random() * 1e6)}`;
    const rec = await fiftyOne.recordFinishedFiftyOneGame(roomCode, finishedFiftyOne(), seatUsers);
    expect(rec.recorded).toBe(true);

    const conn = await getDb();
    const db = conn!.db;
    const g = (await db.select().from(games).where(eq(games.roomCode, roomCode)))[0];
    const gp = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, g.id));

    // No card/suit vocabulary or private-zone keys anywhere in the persisted rows.
    const blob = JSON.stringify({ result: g.result, gamePlayers: gp });
    expect(blob).not.toMatch(/hearts|spades|diamonds|clubs|"rank"|"joker"|handsBySeat|drawPile|publicMelds|discardPile/);
  });
});
