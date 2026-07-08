import { describe, it, expect } from 'vitest';
import type { TarneebHandResult, TarneebPlayer, TarneebState } from '../games/tarneeb/types';

// Optional integration test for the Tarneeb stats repository (TARNEEB-STATS-2).
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// The repository (and drizzle/pg driver) is imported DYNAMICALLY so normal runs
// never load the driver. A unique room code per run keeps the test re-runnable;
// stat assertions are deltas (before/after) so repeated runs never flake.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const P = (seat: number): TarneebPlayer => ({
  id: `player-${seat}`, name: seat === 2 ? 'Bot 1' : `P${seat}`, seatIndex: seat,
  type: seat === 2 ? 'ai' : 'human',
});

const hand = (over: Partial<TarneebHandResult>): TarneebHandResult => ({
  handNumber: 1, bid: 8, declarerSeat: 0, declarerTeam: 'A', trumpSuit: 'spades',
  declarerTricks: 8, defenderTricks: 5, made: true, deltaByTeam: { A: 8, B: 0 }, ...over,
});

/** Minimal finished 4p Tarneeb match — teams A=[0,2]/B=[1,3]; `winner` wins. */
function finishedTarneeb(winner: 'A' | 'B'): TarneebState {
  return {
    gameType: 'tarneeb',
    phase: 'game_finished',
    players: [P(0), P(1), P(2), P(3)],
    teams: { A: [0, 2], B: [1, 3] },
    dealerSeat: 0, currentSeat: 0,
    handsBySeat: [[], [], [], []],
    bids: [], passed: [true, true, true, true], highestBid: null,
    declarerSeat: null, declarerTeam: null, trumpSuit: null,
    currentTrick: null, completedTricks: [], tricksByTeam: { A: 0, B: 0 },
    scoresByTeam: winner === 'A' ? { A: 44, B: 20 } : { A: 20, B: 44 },
    handNumber: 2, targetScore: 41,
    options: { targetScore: 41, kabootMode: 'off', allowNoTrump: false },
    lastHand: null,
    handHistory: [
      hand({ handNumber: 1, declarerSeat: 0, declarerTeam: 'A', made: true, deltaByTeam: { A: 9, B: 0 } }),
      hand({ handNumber: 2, declarerSeat: 1, declarerTeam: 'B', bid: 9, made: false, deltaByTeam: { A: 4, B: -9 } }),
    ],
    winnerTeam: winner,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('tarneeb stats repository (integration, TARNEEB-STATS-2)', () => {
  it('records team outcome + contract counters, excludes bots, and is idempotent', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const tarneeb = await import('../../server/db/tarneebStats');

    const u0 = await users.getOrCreateGuest('it-tarneeb-u0'); // team A → winner + declarer
    const u1 = await users.getOrCreateGuest('it-tarneeb-u1'); // team B → loser + failed declarer
    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]);

    const state = finishedTarneeb('A');
    const roomCode = `TNIT${Math.floor(Math.random() * 1e6)}`;

    const w0 = await tarneeb.getTarneebStats(u0.id);
    const l0 = await tarneeb.getTarneebStats(u1.id);

    const r1 = await tarneeb.recordFinishedTarneebGame(roomCode, state, seatUsers);
    expect(r1.recorded).toBe(true);
    expect(r1.humanPlayers).toBe(2);       // bot (seat 2) excluded

    const r2 = await tarneeb.recordFinishedTarneebGame(roomCode, state, seatUsers);
    expect(r2.recorded).toBe(false);       // idempotent (game_key)

    const w1 = await tarneeb.getTarneebStats(u0.id);
    const l1 = await tarneeb.getTarneebStats(u1.id);

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
    expect(l1.gameType).toBe('tarneeb');
  });

  it('leaderboard exposes public fields + self marker, never a userId', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const tarneeb = await import('../../server/db/tarneebStats');
    const u0 = await users.getOrCreateGuest('it-tarneeb-u0');

    const lb = await tarneeb.getTarneebLeaderboard(50, u0.id);
    const me = lb.find((e) => e.self);
    expect(me).toBeTruthy();
    expect(typeof me?.gamesPlayed).toBe('number');
    expect(typeof me?.contractsMade).toBe('number');
    expect('userId' in (me as object)).toBe(false); // no private id exposed
  });

  it('stores NO cards/hands in games/game_players/rounds (privacy sweep)', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const tarneeb = await import('../../server/db/tarneebStats');
    const { getDb } = await import('../../server/db/client');
    const { games, gamePlayers, rounds } = await import('../../server/db/schema');
    const { eq } = await import('drizzle-orm');

    const u0 = await users.getOrCreateGuest('it-tarneeb-sweep0');
    const u1 = await users.getOrCreateGuest('it-tarneeb-sweep1');
    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]);
    const roomCode = `TNSW${Math.floor(Math.random() * 1e6)}`;
    const rec = await tarneeb.recordFinishedTarneebGame(roomCode, finishedTarneeb('A'), seatUsers);
    expect(rec.recorded).toBe(true);

    const conn = await getDb();
    const db = conn!.db;
    const g = (await db.select().from(games).where(eq(games.roomCode, roomCode)))[0];
    const gp = await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, g.id));
    const rr = await db.select().from(rounds).where(eq(rounds.gameId, g.id));

    // No card rank/suit vocabulary anywhere in the persisted rows.
    const blob = JSON.stringify({ result: g.result, gamePlayers: gp, rounds: rr });
    expect(blob).not.toMatch(/hearts|spades|diamonds|clubs|"rank"|handsBySeat|currentTrick/);
    // rounds are score-only (numbers keyed by playerId).
    for (const r of rr) {
      for (const v of Object.values(r.scores as Record<string, number>)) {
        expect(typeof v).toBe('number');
      }
    }
  });
});
