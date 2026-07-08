import { describe, it, expect } from 'vitest';
import type { DebercPlayer, DebercState } from '../games/deberc/types';

// Optional integration test for the Deberc stats repository (DEBERC-STATS-2).
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// The repository (and drizzle/pg driver) is imported DYNAMICALLY so normal runs
// never load the driver. A unique room code per run keeps the test re-runnable;
// stat assertions are deltas (before/after) so repeated runs never flake.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const P = (seat: number): DebercPlayer => ({
  id: `player-${seat}`, name: seat === 2 ? 'Bot 1' : `P${seat}`, seatIndex: seat,
  type: seat === 2 ? 'ai' : 'human', hand: [],
});

/** Minimal finished 4p Deberc match — teams [0,1,0,1]; team `winnerTeam` wins. */
function finishedDeberc(winnerTeam: number, jackpot = false): DebercState {
  return {
    gameType: 'deberc', matchSize: 'small',
    players: [P(0), P(1), P(2), P(3)],
    teamOf: [0, 1, 0, 1], teamCount: 2,
    phase: 'finished',
    tableTrumpCard: { rank: '6', suit: 'spades', value: 6 },
    stock: [], prykup: [[], [], [], []], trumpSuit: 'spades',
    objazSeat: 0, dealerSeat: 0, bidderSeat: 0, bids: [], bidRound: 1,
    currentTrick: null, turnSeat: 0, wonCards: [[], [], [], []], tricksPlayed: 9,
    seatsWithTricks: [], melds: [], meldTurnSeat: 0, declaredMelds: [], meldsDone: [],
    dealtHands: [], bellaEligible: [], bellaEarned: [],
    matchScore: winnerTeam === 0 ? [520, 300] : [300, 520], hvMarks: [0, 0], beitMarks: [0, 0],
    lastHand: null, handHistory: [],
    winnerTeam, jackpot,
  };
}

describe.skipIf(!TEST_DATABASE_URL)('deberc stats repository (integration, DEBERC-STATS-2)', () => {
  it('records team outcome + jackpot, excludes bots, and is idempotent', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const deberc = await import('../../server/db/debercStats');

    const u0 = await users.getOrCreateGuest('it-deberc-u0'); // team 0 → winner
    const u1 = await users.getOrCreateGuest('it-deberc-u1'); // team 1 → loser
    // seats: 0=u0 (team0, win), 1=u1 (team1, lose), 2=bot (team0), 3=human absent.
    const seatUsers = new Map<number, string | null>([[0, u0.id], [1, u1.id]]);

    const state = finishedDeberc(0, true); // team 0 wins via jackpot
    const roomCode = `DBIT${Math.floor(Math.random() * 1e6)}`;

    const w0 = await deberc.getDebercStats(u0.id);
    const l0 = await deberc.getDebercStats(u1.id);

    const r1 = await deberc.recordFinishedDebercGame(roomCode, state, seatUsers);
    expect(r1.recorded).toBe(true);
    expect(r1.humanPlayers).toBe(2);       // bot (seat 2) excluded

    const r2 = await deberc.recordFinishedDebercGame(roomCode, state, seatUsers);
    expect(r2.recorded).toBe(false);       // idempotent (game_key)

    const w1 = await deberc.getDebercStats(u0.id);
    const l1 = await deberc.getDebercStats(u1.id);

    // Winner: +1 game, +1 win, +1 jackpot.
    expect(w1.gamesPlayed - w0.gamesPlayed).toBe(1);
    expect(w1.gamesWon - w0.gamesWon).toBe(1);
    expect(w1.jackpotCount - w0.jackpotCount).toBe(1);
    // Loser: +1 game, +1 loss, no jackpot credited.
    expect(l1.gamesPlayed - l0.gamesPlayed).toBe(1);
    expect(l1.gamesLost - l0.gamesLost).toBe(1);
    expect(l1.jackpotCount - l0.jackpotCount).toBe(0);
    expect(l1.gameType).toBe('deberc');
  });

  it('leaderboard exposes public fields + self marker, never a userId', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const deberc = await import('../../server/db/debercStats');
    const u0 = await users.getOrCreateGuest('it-deberc-u0');

    const lb = await deberc.getDebercLeaderboard(50, u0.id);
    const me = lb.find((e) => e.self);
    expect(me).toBeTruthy();
    expect(typeof me?.gamesPlayed).toBe('number');
    expect(typeof me?.jackpotCount).toBe('number');
    expect('userId' in (me as object)).toBe(false); // no private id exposed
  });
});
