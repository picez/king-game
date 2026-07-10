import { describe, it, expect } from 'vitest';
import {
  isFinishedPreferansGame, summarizeFinishedPreferansGame, computePreferansStatDeltas,
  preferansFinishSignature, preferansContractLabel,
} from './preferansStats';
import type { PreferansHandResult, PreferansPlayer, PreferansState } from '../games/preferans/types';

const P = (seat: number): PreferansPlayer => ({
  id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: seat === 2 ? 'ai' : 'human',
});

const hand = (over: Partial<PreferansHandResult>): PreferansHandResult => ({
  handNumber: 1, declarerSeat: 0, contract: { level: 6, suit: 'spades' },
  declarerTricks: 6, made: true, deltaBySeat: [1, 0, 0], ...over,
});

/** A finished 3p match (each for self). Default: seat 0 wins to 6. */
function finished(over: Partial<PreferansState> = {}): PreferansState {
  return {
    gameType: 'preferans',
    phase: 'game_finished',
    players: [P(0), P(1), P(2)],
    dealerSeat: 0, currentSeat: 0,
    handsBySeat: [[], [], []], talon: [], discards: [],
    bids: [], passed: [true, true, true], highBid: null,
    declarerSeat: null, contract: null,
    currentTrick: null, completedTricks: [], tricksBySeat: [0, 0, 0],
    scores: [6, -2, 2],
    handNumber: 3, targetScore: 6, options: { targetScore: 6 },
    lastHand: null,
    handHistory: [
      hand({ handNumber: 1, declarerSeat: 0, contract: { level: 6, suit: 'spades' }, made: true, deltaBySeat: [1, 0, 0] }),
      hand({ handNumber: 2, declarerSeat: 1, contract: { level: 7, suit: 'hearts' }, made: false, deltaBySeat: [2, -2, 2] }),
      hand({ handNumber: 3, declarerSeat: 0, contract: { level: 8, suit: 'NT' }, made: true, deltaBySeat: [3, 0, 0] }),
    ],
    winnerSeat: 0,
    ...over,
  };
}

describe('preferansContractLabel', () => {
  it('is a compact, word-free label incl. No-Trump and level 10', () => {
    expect(preferansContractLabel({ level: 6, suit: 'spades' })).toBe('6S');
    expect(preferansContractLabel({ level: 7, suit: 'hearts' })).toBe('7H');
    expect(preferansContractLabel({ level: 8, suit: 'NT' })).toBe('8NT');
    expect(preferansContractLabel({ level: 10, suit: 'diamonds' })).toBe('10D');
  });
});

describe('isFinishedPreferansGame', () => {
  it('is true only when the phase is game_finished', () => {
    expect(isFinishedPreferansGame(finished())).toBe(true);
    expect(isFinishedPreferansGame(finished({ phase: 'playing' }))).toBe(false);
    expect(isFinishedPreferansGame(null)).toBe(false);
  });
});

describe('summarizeFinishedPreferansGame', () => {
  it('marks the unique winner seat and gives each seat its final score', () => {
    const s = summarizeFinishedPreferansGame(finished());
    expect(s.playerCount).toBe(3);
    expect(s.winnerSeat).toBe(0);
    expect(s.isDraw).toBe(false);
    expect(s.finalScores).toEqual([6, -2, 2]);
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    expect(byId['player-0'].isWinner).toBe(true);
    expect(byId['player-1'].isWinner).toBe(false);
    expect(byId['player-2'].isWinner).toBe(false);
    expect(byId['player-0'].finalScore).toBe(6);
    expect(byId['player-1'].finalScore).toBe(-2);   // negative score carried through
    expect(s.winners).toEqual(['player-0']);
  });

  it('tallies declarer / contract counters per seat from the hand history', () => {
    const s = summarizeFinishedPreferansGame(finished());
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    expect(byId['player-0']).toMatchObject({ declarerCount: 2, contractsMade: 2, contractsFailed: 0 });
    expect(byId['player-1']).toMatchObject({ declarerCount: 1, contractsMade: 0, contractsFailed: 1 });
    expect(byId['player-2']).toMatchObject({ declarerCount: 0, contractsMade: 0, contractsFailed: 0 });
    expect(s.handsPlayed).toBe(3);
  });

  it('produces score-only rounds (per-seat delta, contract label, NO cards)', () => {
    const s = summarizeFinishedPreferansGame(finished());
    expect(s.rounds).toHaveLength(3);
    // Hand 2 (7♥ set): declarer seat 1 −2, each defender +2.
    expect(s.rounds[1].scoreByPlayer).toEqual({ 'player-0': 2, 'player-1': -2, 'player-2': 2 });
    expect(s.rounds[1].modeId).toBe('7H');
    expect(s.rounds[2].modeId).toBe('8NT');   // No-Trump label
    // A JSON scan of the whole summary must not contain any card / private key.
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/"rank"|"handsBySeat"|"talon"|"discards"|"currentTrick"|"tricksBySeat"/);
  });

  it('a draw (winnerSeat null) marks no winner', () => {
    const s = summarizeFinishedPreferansGame(finished({ winnerSeat: null, scores: [6, 6, 6] }));
    expect(s.isDraw).toBe(true);
    expect(s.winners).toEqual([]);
    expect(s.players.every((p) => !p.isWinner)).toBe(true);
  });
});

describe('computePreferansStatDeltas', () => {
  it('emits per-player win/loss/draw + score/contract deltas (one per seat)', () => {
    const deltas = computePreferansStatDeltas(summarizeFinishedPreferansGame(finished()));
    const byId = Object.fromEntries(deltas.map((d) => [d.playerId, d]));
    expect(byId['player-0']).toMatchObject({
      won: true, lost: false, drawn: false, finalScore: 6, handsPlayed: 3,
      declarerCount: 2, contractsMade: 2, contractsFailed: 0,
    });
    expect(byId['player-1']).toMatchObject({ won: false, lost: true, drawn: false, finalScore: -2 });
    expect(byId['player-2']).toMatchObject({ won: false, lost: true, drawn: false });
  });

  it('on a draw every seat is drawn (neither won nor lost)', () => {
    const deltas = computePreferansStatDeltas(summarizeFinishedPreferansGame(finished({ winnerSeat: null })));
    expect(deltas.every((d) => d.drawn && !d.won && !d.lost)).toBe(true);
  });
});

describe('preferansFinishSignature', () => {
  it('is stable for the same outcome and differs for a different winner/score', () => {
    const a = preferansFinishSignature(finished());
    expect(a).toBe(preferansFinishSignature(finished()));
    expect(preferansFinishSignature(finished({ winnerSeat: 1, scores: [-2, 6, 2] }))).not.toBe(a);
    expect(preferansFinishSignature(finished({ scores: [10, -2, 2] }))).not.toBe(a);
  });
});
