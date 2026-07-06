import { describe, it, expect } from 'vitest';
import type { DurakPlayer, DurakState } from '../games/durak/types';

// Optional integration test for the Durak stats repository (DURAK-1).
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// The repository (and drizzle/pg driver) is imported DYNAMICALLY so normal runs
// never load the driver. A unique room code per run keeps the test re-runnable;
// stat assertions are deltas (before/after) so repeated runs never flake.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const P = (seat: number): DurakPlayer => ({
  id: `player-${seat}`, name: seat === 2 ? 'Bot 1' : `P${seat}`, seatIndex: seat,
  type: seat === 2 ? 'ai' : 'human', hand: [],
});

/** Minimal finished 3p Durak state — seat 1 is the fool; seat 2 is a bot. */
function finishedDurak(foolSeat: number, isDraw = false): DurakState {
  const players = [P(0), P(1), P(2)];
  const foolId = isDraw ? null : `player-${foolSeat}`;
  const winnerIds = isDraw ? players.map((p) => p.id) : players.filter((p) => p.id !== foolId).map((p) => p.id);
  return {
    gameType: 'durak', variant: 'simple', players,
    drawPile: [], trumpSuit: 'spades', trumpCard: { rank: '6', suit: 'spades', value: 6 },
    attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0, passedAttackers: [],
    table: [], discardPile: [], status: 'finished', boutLimit: 6,
    foolId, winnerIds, isDraw,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('durak stats repository (integration, DURAK-1)', () => {
  it('records outcome stats, excludes bots, and is idempotent', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const durak = await import('../../server/db/durakStats');

    const u0 = await users.getOrCreateGuest('it-durak-u0'); // winner
    const u1 = await users.getOrCreateGuest('it-durak-u1'); // fool
    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]); // seat2 = bot

    const state = finishedDurak(1); // player-1 is the fool
    const roomCode = `DIT${Math.floor(Math.random() * 1e6)}`;

    const w0 = await durak.getDurakStats(u0.id);
    const f0 = await durak.getDurakStats(u1.id);

    const r1 = await durak.recordFinishedDurakGame(roomCode, state, seatUsers);
    expect(r1.recorded).toBe(true);
    expect(r1.humanPlayers).toBe(2);       // bot excluded

    const r2 = await durak.recordFinishedDurakGame(roomCode, state, seatUsers);
    expect(r2.recorded).toBe(false);       // idempotent (game_key)

    const w1 = await durak.getDurakStats(u0.id);
    const f1 = await durak.getDurakStats(u1.id);

    // Winner: +1 game, +1 win, no fool.
    expect(w1.gamesPlayed - w0.gamesPlayed).toBe(1);
    expect(w1.gamesWon - w0.gamesWon).toBe(1);
    expect(w1.foolCount - w0.foolCount).toBe(0);
    // Fool: +1 game, +1 loss, +1 fool.
    expect(f1.gamesPlayed - f0.gamesPlayed).toBe(1);
    expect(f1.gamesLost - f0.gamesLost).toBe(1);
    expect(f1.foolCount - f0.foolCount).toBe(1);
    expect(f1.gameType).toBe('durak');
  });
});
