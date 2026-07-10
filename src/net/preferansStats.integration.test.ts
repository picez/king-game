import { describe, it, expect } from 'vitest';
import type { PreferansHandResult, PreferansPlayer, PreferansState } from '../games/preferans/types';

// Optional integration test for the Preferans stats repository (PREFERANS-STATS-2).
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// The repository (and drizzle/pg driver) is imported DYNAMICALLY so normal runs
// never load the driver. A unique room code per run keeps the test re-runnable;
// stat assertions are deltas (before/after) so repeated runs never flake.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const P = (seat: number): PreferansPlayer => ({
  id: `player-${seat}`, name: seat === 2 ? 'Bot 1' : `P${seat}`, seatIndex: seat,
  type: seat === 2 ? 'ai' : 'human',
});

const hand = (over: Partial<PreferansHandResult>): PreferansHandResult => ({
  handNumber: 1, declarerSeat: 0, contract: { level: 6, suit: 'spades' },
  declarerTricks: 6, made: true, deltaBySeat: [1, 0, 0], ...over,
});

/** Minimal finished 3p Preferans match: seat 0 wins (declarer, made); seat 1 loses
 *  (declarer, failed); seat 2 is a bot. */
function finishedPreferans(): PreferansState {
  return {
    gameType: 'preferans',
    phase: 'game_finished',
    players: [P(0), P(1), P(2)],
    dealerSeat: 0, currentSeat: 0,
    handsBySeat: [[], [], []], talon: [], discards: [],
    bids: [], passed: [true, true, true], highBid: null,
    declarerSeat: null, contract: null,
    currentTrick: null, completedTricks: [], tricksBySeat: [0, 0, 0],
    scores: [3, -2, 2],
    handNumber: 2, targetScore: 3, options: { targetScore: 3 },
    lastHand: null,
    handHistory: [
      hand({ handNumber: 1, declarerSeat: 0, contract: { level: 6, suit: 'spades' }, made: true, deltaBySeat: [1, 0, 0] }),
      hand({ handNumber: 2, declarerSeat: 1, contract: { level: 7, suit: 'hearts' }, made: false, deltaBySeat: [2, -2, 2] }),
    ],
    winnerSeat: 0,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('preferans stats repository (integration, PREFERANS-STATS-2)', () => {
  it('records per-seat outcome + contract counters, excludes bots, and is idempotent', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const preferans = await import('../../server/db/preferansStats');

    const u0 = await users.getOrCreateGuest('it-preferans-u0'); // winner + declarer (made)
    const u1 = await users.getOrCreateGuest('it-preferans-u1'); // loser + failed declarer
    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]);

    const state = finishedPreferans();
    const roomCode = `PFIT${Math.floor(Math.random() * 1e6)}`;

    const w0 = await preferans.getPreferansStats(u0.id);
    const l0 = await preferans.getPreferansStats(u1.id);

    const r1 = await preferans.recordFinishedPreferansGame(roomCode, state, seatUsers);
    expect(r1.recorded).toBe(true);
    expect(r1.humanPlayers).toBe(2);       // bot (seat 2) excluded

    const r2 = await preferans.recordFinishedPreferansGame(roomCode, state, seatUsers);
    expect(r2.recorded).toBe(false);       // idempotent (game_key)

    const w1 = await preferans.getPreferansStats(u0.id);
    const l1 = await preferans.getPreferansStats(u1.id);

    // Winner (declarer seat 0): +1 game, +1 win, +2 hands, +1 declarer, +1 made.
    expect(w1.gamesPlayed - w0.gamesPlayed).toBe(1);
    expect(w1.gamesWon - w0.gamesWon).toBe(1);
    expect(w1.handsPlayed - w0.handsPlayed).toBe(2);
    expect(w1.handsAsDeclarer - w0.handsAsDeclarer).toBe(1);
    expect(w1.contractsMade - w0.contractsMade).toBe(1);
    // Loser (declarer seat 1): +1 game, +1 loss, +1 declarer, +1 failed.
    expect(l1.gamesPlayed - l0.gamesPlayed).toBe(1);
    expect(l1.gamesLost - l0.gamesLost).toBe(1);
    expect(l1.contractsFailed - l0.contractsFailed).toBe(1);
    expect(l1.gameType).toBe('preferans');
  });

  it('leaderboard exposes public fields + self marker, never a userId', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const preferans = await import('../../server/db/preferansStats');
    const u0 = await users.getOrCreateGuest('it-preferans-u0');

    const lb = await preferans.getPreferansLeaderboard(50, u0.id);
    const me = lb.find((e) => e.self);
    expect(me).toBeTruthy();
    expect(typeof me?.gamesPlayed).toBe('number');
    expect(typeof me?.contractsMade).toBe('number');
    expect('userId' in (me as object)).toBe(false); // no private id exposed
  });

  it('stores NO cards/hands/talon/discards in games/game_players/rounds (privacy sweep)', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const preferans = await import('../../server/db/preferansStats');
    const { getDb } = await import('../../server/db/client');
    const { games, gamePlayers, rounds } = await import('../../server/db/schema');
    const { eq } = await import('drizzle-orm');

    const u0 = await users.getOrCreateGuest('it-preferans-sweep0');
    const u1 = await users.getOrCreateGuest('it-preferans-sweep1');
    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]);
    const roomCode = `PFSW${Math.floor(Math.random() * 1e6)}`;
    const rec = await preferans.recordFinishedPreferansGame(roomCode, finishedPreferans(), seatUsers);
    expect(rec.recorded).toBe(true);

    const conn = await getDb();
    const db = conn!.db;
    const g = (await db.select().from(games).where(eq(games.roomCode, roomCode)))[0];
    const gp = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, g.id));
    const rr = await db.select().from(rounds).where(eq(rounds.gameId, g.id));

    // No card/suit vocabulary or private-zone keys anywhere in the persisted rows.
    const blob = JSON.stringify({ result: g.result, gamePlayers: gp, rounds: rr });
    expect(blob).not.toMatch(/hearts|spades|diamonds|clubs|"rank"|handsBySeat|talon|discards|currentTrick/);
    // rounds are score-only (numbers keyed by playerId).
    for (const r of rr) {
      for (const v of Object.values(r.scores as Record<string, number>)) {
        expect(typeof v).toBe('number');
      }
    }
  });
});
