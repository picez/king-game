import { describe, it, expect } from 'vitest';
import {
  isFinishedDebercGame, summarizeFinishedDebercGame, computeDebercStatDeltas, debercFinishSignature,
} from './debercStats';
import type { DebercPlayer, DebercState } from '../games/deberc/types';

const P = (seat: number): DebercPlayer => ({
  id: `player-${seat}`, name: `P${seat}`, seatIndex: seat,
  type: seat === 2 ? 'ai' : 'human', hand: [],
});

/** A minimal finished 4p match: teams [0,1,0,1]; team 0 (seats 0&2) wins. */
function finished4p(over: Partial<DebercState> = {}): DebercState {
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
    matchScore: [520, 300], hvMarks: [0, 0], beitMarks: [0, 0],
    lastHand: null, handHistory: [],
    winnerTeam: 0, jackpot: false, ...over,
  };
}

/** A finished 3p match: three solo teams [0,1,2]; seat 1 (team 1) wins. */
function finished3p(over: Partial<DebercState> = {}): DebercState {
  return {
    ...finished4p(),
    players: [P(0), P(1), P(2)],
    teamOf: [0, 1, 2], teamCount: 3,
    matchScore: [300, 520, 200], winnerTeam: 1, ...over,
  };
}

describe('isFinishedDebercGame', () => {
  it('is true only when the match phase is finished', () => {
    expect(isFinishedDebercGame(finished4p())).toBe(true);
    expect(isFinishedDebercGame(finished4p({ phase: 'playing' }))).toBe(false);
    expect(isFinishedDebercGame(null)).toBe(false);
  });
});

describe('summarizeFinishedDebercGame', () => {
  it('marks both seats of the winning team as winners (4p pairs)', () => {
    const s = summarizeFinishedDebercGame(finished4p());
    expect(s.playerCount).toBe(4);
    expect(s.winnerTeam).toBe(0);
    expect(s.isJackpot).toBe(false);
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    expect(byId['player-0'].isWinner).toBe(true);
    expect(byId['player-2'].isWinner).toBe(true);   // partner of seat 0
    expect(byId['player-1'].isWinner).toBe(false);
    expect(byId['player-3'].isWinner).toBe(false);
    expect(byId['player-2'].type).toBe('ai');
    expect(s.winners.sort()).toEqual(['player-0', 'player-2']);
  });

  it('a 3p match has a single winner', () => {
    const s = summarizeFinishedDebercGame(finished3p());
    expect(s.winnerTeam).toBe(1);
    expect(s.winners).toEqual(['player-1']);
    expect(s.players.filter((p) => p.isWinner)).toHaveLength(1);
  });

  it('carries the jackpot flag', () => {
    const s = summarizeFinishedDebercGame(finished4p({ jackpot: true }));
    expect(s.isJackpot).toBe(true);
  });
});

describe('computeDebercStatDeltas', () => {
  it('flags won per seat and jackpot for winners only', () => {
    const deltas = computeDebercStatDeltas(summarizeFinishedDebercGame(finished4p({ jackpot: true })));
    const byId = Object.fromEntries(deltas.map((d) => [d.playerId, d]));
    expect(byId['player-0']).toMatchObject({ won: true, isJackpot: true });
    expect(byId['player-2']).toMatchObject({ won: true, isJackpot: true });
    expect(byId['player-1']).toMatchObject({ won: false, isJackpot: false });
  });

  it('a target win is not a jackpot', () => {
    const deltas = computeDebercStatDeltas(summarizeFinishedDebercGame(finished4p()));
    expect(deltas.every((d) => !d.isJackpot)).toBe(true);
  });
});

describe('debercFinishSignature', () => {
  it('is stable for the same outcome and differs for a different winner', () => {
    const a = debercFinishSignature(finished4p());
    expect(a).toBe(debercFinishSignature(finished4p()));
    const b = debercFinishSignature(finished4p({ winnerTeam: 1 }));
    expect(b).not.toBe(a);
  });

  it('a jackpot win has its own signature', () => {
    const jp = debercFinishSignature(finished4p({ jackpot: true }));
    expect(jp).toContain('jackpot');
    expect(jp).not.toBe(debercFinishSignature(finished4p()));
  });
});
