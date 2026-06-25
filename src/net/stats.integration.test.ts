import { describe, it, expect } from 'vitest';
import type { GameState, Player, Score, RoundRecord } from '../models/types';

// Optional integration test for the Stage 5/5.2 stats repository.
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// The repository (and drizzle/pg driver) is imported DYNAMICALLY so normal runs
// never load the driver. A unique room code per run keeps the test re-runnable;
// stat assertions are deltas (before/after) so repeated runs never flake.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// A minimal finished 3p GameState — only the fields the aggregator reads. Seat 2
// is a bot; it must never get a user_stats row.
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

describe.skipIf(!TEST_DATABASE_URL)('stats repository (integration, Stage 5.2)', () => {
  it('records richer stats, excludes bots, and is idempotent', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const stats = await import('../../server/db/stats');

    const u0 = await users.getOrCreateGuest('it-stats-u0');
    const u1 = await users.getOrCreateGuest('it-stats-u1');
    await users.updateDisplayName(u0.id, 'Alice');
    await users.upsertGlobalSettings(u0.id, { avatar: '🦊' });

    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]); // seat2 = bot

    // player-0 wins (highest total). 2 no_hearts rounds + 1 trump round.
    const state = finished3p([-9, -25, -16], [
      { roundNumber: 1, dealerId: 'player-0', modeId: 'no_hearts', trumpOccurrence: 0, scoreByPlayer: { 'player-0': -5, 'player-1': -10, 'player-2': -10 } },
      { roundNumber: 2, dealerId: 'player-1', modeId: 'no_hearts', trumpOccurrence: 0, scoreByPlayer: { 'player-0': -4, 'player-1': -15, 'player-2': -6 } },
      { roundNumber: 3, dealerId: 'player-2', modeId: 'trump', trumpOccurrence: 1, scoreByPlayer: { 'player-0': 0, 'player-1': 0, 'player-2': 0 } },
    ]);

    const roomCode = `IT${Math.floor(Math.random() * 1e6)}`;
    const before = await stats.getUserStats(u0.id);

    const r1 = await stats.recordFinishedGame(roomCode, state, seatUsers);
    expect(r1.recorded).toBe(true);
    expect(r1.humanPlayers).toBe(2);              // bot excluded

    const r2 = await stats.recordFinishedGame(roomCode, state, seatUsers);
    expect(r2.recorded).toBe(false);              // idempotent (game_key)

    const after = await stats.getUserStats(u0.id);
    expect(after.statsVersion).toBe(2);
    expect(after.gamesPlayed - before.gamesPlayed).toBe(1);
    expect(after.gamesWon - before.gamesWon).toBe(1);
    expect(after.roundsPlayed - before.roundsPlayed).toBe(3);
    expect(after.trumpRoundsPlayed - before.trumpRoundsPlayed).toBe(1);
    expect(after.negativeRoundsPlayed - before.negativeRoundsPlayed).toBe(2);
    expect(after.winRate).not.toBeNull();
    expect(typeof after.averageScore).toBe('number');
    expect(after.bestScore).not.toBeNull();
    expect(after.worstScore).not.toBeNull();
    expect(after.surrenderedSupported).toBe(false);
    expect(after.modeBreakdown.no_hearts.rounds).toBeGreaterThanOrEqual(2);

    // Rebuild from games/game_players/rounds must match the incremental cache.
    const reb = await stats.rebuildUserStats(u0.id);
    expect(reb.gamesPlayed).toBe(after.gamesPlayed);
    expect(reb.gamesWon).toBe(after.gamesWon);
    expect(reb.totalScore).toBe(after.totalScore);
    expect(reb.bestScore).toBe(after.bestScore);
    expect(reb.worstScore).toBe(after.worstScore);
    expect(reb.trumpRoundsPlayed).toBe(after.trumpRoundsPlayed);
    expect(reb.negativeRoundsPlayed).toBe(after.negativeRoundsPlayed);
  });

  it('leaderboard exposes public fields + self marker, never a userId', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const stats = await import('../../server/db/stats');
    const u0 = await users.getOrCreateGuest('it-stats-u0');

    const lb = await stats.getLeaderboard('king', 50, u0.id);
    const me = lb.find((e) => e.self);
    expect(me).toBeTruthy();
    expect(me?.displayName).toBe('Alice');
    expect(me?.avatar).toBe('🦊');
    expect(typeof me?.winRate === 'number' || me?.winRate === null).toBe(true);
    expect('userId' in (me as object)).toBe(false);   // no private id exposed
  });

  it('tolerates a legacy v1 stats row without crashing', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const stats = await import('../../server/db/stats');
    const client = await import('../../server/db/client');
    const conn = await client.getDb();
    const sql = conn!.sql as unknown as (s: TemplateStringsArray, ...a: unknown[]) => Promise<unknown[]>;

    const c = await users.getOrCreateGuest('it-stats-legacy');
    // Write a v1-shaped row directly (modeBreakdown = numbers; no best/worst/trump).
    const legacy = JSON.stringify({ totalScore: -30, bestGameScore: -10, modeBreakdown: { no_hearts: -20, trump: 8 } });
    await sql`insert into user_stats (user_id, game_type, games_played, games_won, games_lost, rounds_played, stats)
      values (${c.id}, 'king', 2, 1, 1, 18, ${legacy}::jsonb)
      on conflict (user_id, game_type) do update set stats = ${legacy}::jsonb, games_played = 2, games_won = 1, games_lost = 1, rounds_played = 18`;

    const view = await stats.getUserStats(c.id);
    expect(view.gamesPlayed).toBe(2);
    expect(view.winRate).toBe(50);
    expect(view.bestScore).toBe(-10);
    expect(view.worstScore).toBeNull();             // missing in v1 → null
    expect(view.trumpRoundsPlayed).toBe(0);         // unknown in v1 → 0
    expect(view.modeBreakdown.no_hearts).toEqual({ rounds: 0, totalScore: -20, averageScore: null });
  });
});
