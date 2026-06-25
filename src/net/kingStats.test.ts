import { describe, it, expect } from 'vitest';
import type { GameState, Player, Score, RoundRecord } from '../models/types';
import {
  isFinishedGame, summarizeFinishedGame, computeStatDeltas,
} from './kingStats';

// A minimal finished GameState — only the fields the aggregator reads (config,
// players, scores, roundHistory, status). Built by hand so the test is
// deterministic without playing out 27/36 rounds.
function finishedState(opts: {
  playerCount: 3 | 4;
  totals: number[];
  rounds: RoundRecord[];
}): GameState {
  const players: Player[] = opts.totals.map((_, i) => ({
    id: `player-${i}`,
    name: i === 0 ? 'Alice' : `P${i}`,
    hand: [],
    seatIndex: i,
    isDealer: false,
    type: i === opts.totals.length - 1 ? 'ai' : 'human',
    avatar: '😀',
  }));
  const scores: Record<string, Score> = {};
  opts.totals.forEach((total, i) => {
    scores[`player-${i}`] = { playerId: `player-${i}`, roundScores: [], total };
  });
  return {
    config: { playerCount: opts.playerCount } as GameState['config'],
    players,
    scores,
    modeQueue: [],
    currentRoundIdx: 0,
    currentRound: null as unknown as GameState['currentRound'],
    currentTrick: null,
    currentLeaderIdx: 0,
    dealerIndex: 0,
    status: 'game_finished',
    trumpSuit: null,
    kittyForExchange: [],
    dealerModes: {},
    roundHistory: opts.rounds,
  };
}

const round = (
  roundNumber: number, dealerId: string, modeId: RoundRecord['modeId'],
  trumpOccurrence: number, scoreByPlayer: Record<string, number>,
): RoundRecord => ({ roundNumber, dealerId, modeId, trumpOccurrence, scoreByPlayer });

describe('isFinishedGame', () => {
  it('is true only for a game_finished state', () => {
    expect(isFinishedGame(null)).toBe(false);
    expect(isFinishedGame({ status: 'playing' } as GameState)).toBe(false);
    expect(isFinishedGame({ status: 'game_finished' } as GameState)).toBe(true);
  });
});

describe('summarizeFinishedGame — winner = highest total', () => {
  it('picks the single highest total as the sole winner', () => {
    // King totals are mostly negative; the least-negative (highest) wins.
    const s = finishedState({
      playerCount: 3,
      totals: [-40, -120, -85],
      rounds: [round(1, 'player-0', 'no_hearts', 0, { 'player-0': -40, 'player-1': -120, 'player-2': -85 })],
    });
    const sum = summarizeFinishedGame(s);
    expect(sum.winners).toEqual(['player-0']);
    expect(sum.players.find((p) => p.playerId === 'player-0')?.isWinner).toBe(true);
    expect(sum.players.find((p) => p.playerId === 'player-1')?.isWinner).toBe(false);
    expect(sum.roundsPlayed).toBe(1);
    expect(sum.playerCount).toBe(3);
  });

  it('treats an equal top total as co-winners', () => {
    const s = finishedState({
      playerCount: 3,
      totals: [-50, -50, -90],
      rounds: [],
    });
    const sum = summarizeFinishedGame(s);
    expect(sum.winners.sort()).toEqual(['player-0', 'player-1']);
  });

  it('snapshots seat/name/type and maps rounds score-only', () => {
    const s = finishedState({
      playerCount: 3,
      totals: [10, -10, -20],
      rounds: [round(1, 'player-1', 'trump', 1, { 'player-0': 10, 'player-1': -5, 'player-2': -5 })],
    });
    const sum = summarizeFinishedGame(s);
    const ai = sum.players.find((p) => p.playerId === 'player-2');
    expect(ai?.type).toBe('ai');
    expect(sum.players[0].seatIndex).toBe(0);
    expect(sum.rounds[0]).toMatchObject({ roundIndex: 1, modeId: 'trump', dealerPlayerId: 'player-1', trumpOccurrence: 1 });
    expect(sum.rounds[0].scoreByPlayer).toEqual({ 'player-0': 10, 'player-1': -5, 'player-2': -5 });
  });
});

describe('computeStatDeltas', () => {
  it('sums each player score per mode and flags wins/losses', () => {
    const s = finishedState({
      playerCount: 3,
      totals: [-9, -25, -16],
      rounds: [
        round(1, 'player-0', 'no_hearts', 0, { 'player-0': -5, 'player-1': -10, 'player-2': -10 }),
        round(2, 'player-1', 'no_hearts', 0, { 'player-0': -4, 'player-1': -15, 'player-2': -6 }),
        round(3, 'player-2', 'trump', 1, { 'player-0': 0, 'player-1': 0, 'player-2': 0 }),
      ],
    });
    const deltas = computeStatDeltas(summarizeFinishedGame(s));
    const d0 = deltas.find((d) => d.playerId === 'player-0')!;
    expect(d0.won).toBe(true);                  // -9 is the highest total
    expect(d0.roundsPlayed).toBe(3);
    expect(d0.modeBreakdown).toEqual({ no_hearts: -9, trump: 0 });
    expect(d0.totalScore).toBe(-9);
    expect(d0.bestGameScore).toBe(-9);
    const d1 = deltas.find((d) => d.playerId === 'player-1')!;
    expect(d1.won).toBe(false);
    expect(d1.modeBreakdown.no_hearts).toBe(-25);
  });
});
