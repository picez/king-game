import { describe, it, expect } from 'vitest';
import type { GameState, Player, Score, RoundRecord } from '../models/types';

// Optional integration test for the Stage 5 stats repository.
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// The repository (and drizzle/pg driver) is imported DYNAMICALLY so normal runs
// never load the driver. A unique room code per run keeps the test re-runnable;
// stat assertions are deltas (before/after) so repeated runs never flake.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// A minimal finished 3p GameState (only the fields the aggregator reads). Seat 2
// is a bot — it must never get a user_stats row.
function finished3p(totals: [number, number, number], history: RoundRecord[]): GameState {
  const players: Player[] = totals.map((_, i) => ({
    id: `player-${i}`, name: i === 2 ? 'Bot 1' : `P${i}`, hand: [], seatIndex: i,
    isDealer: false, type: i === 2 ? 'ai' : 'human', avatar: '😀',
  }));
  const scores: Record<string, Score> = {};
  totals.forEach((total, i) => { scores[`player-${i}`] = { playerId: `player-${i}`, roundScores: [], total }; });
  return {
    config: { playerCount: 3 } as GameState['config'],
    players, scores, modeQueue: [], currentRoundIdx: 0,
    currentRound: null as unknown as GameState['currentRound'], currentTrick: null,
    currentLeaderIdx: 0, dealerIndex: 0, status: 'game_finished', trumpSuit: null,
    kittyForExchange: [], dealerModes: {}, roundHistory: history,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('stats repository (integration)', () => {
  it('records a finished game once, excludes bots, and increments user_stats', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const stats = await import('../../server/db/stats');

    const u0 = await users.getOrCreateGuest('it-stats-u0');
    const u1 = await users.getOrCreateGuest('it-stats-u1');

    // Seat 0 → u0, seat 1 → u1, seat 2 → bot (absent from the map).
    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]);

    // player-0 wins (highest total: -9 > -25 > -16).
    const state = finished3p([-9, -25, -16], [
      { roundNumber: 1, dealerId: 'player-0', modeId: 'no_hearts', trumpOccurrence: 0, scoreByPlayer: { 'player-0': -5, 'player-1': -10, 'player-2': -10 } },
      { roundNumber: 2, dealerId: 'player-1', modeId: 'no_hearts', trumpOccurrence: 0, scoreByPlayer: { 'player-0': -4, 'player-1': -15, 'player-2': -6 } },
    ]);

    const roomCode = `IT${Math.floor(Math.random() * 1e6)}`;
    const before0 = await stats.getUserStats(u0.id);
    const before1 = await stats.getUserStats(u1.id);

    const r1 = await stats.recordFinishedGame(roomCode, state, seatUsers);
    expect(r1.recorded).toBe(true);
    expect(r1.humanPlayers).toBe(2); // bot excluded

    // Idempotent: a reconnect/rebroadcast re-trigger must NOT double-count.
    const r2 = await stats.recordFinishedGame(roomCode, state, seatUsers);
    expect(r2.recorded).toBe(false);

    const after0 = await stats.getUserStats(u0.id);
    const after1 = await stats.getUserStats(u1.id);

    // Exactly one game added despite two record calls.
    expect(after0.gamesPlayed - before0.gamesPlayed).toBe(1);
    expect(after0.gamesWon - before0.gamesWon).toBe(1);   // u0 won
    expect(after0.gamesLost - before0.gamesLost).toBe(0);
    expect(after0.roundsPlayed - before0.roundsPlayed).toBe(2);

    expect(after1.gamesPlayed - before1.gamesPlayed).toBe(1);
    expect(after1.gamesWon - before1.gamesWon).toBe(0);   // u1 lost
    expect(after1.gamesLost - before1.gamesLost).toBe(1);

    // King aggregate: best game score is the (highest) final total for u0.
    expect((after0.stats as { bestGameScore?: number }).bestGameScore).toBeGreaterThanOrEqual(-9);
  });
});
