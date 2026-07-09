import { describe, it, expect } from 'vitest';
import {
  isFinishedTarneebGame, summarizeFinishedTarneebGame, computeTarneebStatDeltas,
  tarneebFinishSignature,
} from './tarneebStats';
import type { TarneebHandResult, TarneebPlayer, TarneebState, Team } from '../games/tarneeb/types';

const P = (seat: number): TarneebPlayer => ({
  id: `player-${seat}`, name: `P${seat}`, seatIndex: seat,
  type: seat === 2 ? 'ai' : 'human',
});

const hand = (over: Partial<TarneebHandResult>): TarneebHandResult => ({
  handNumber: 1, bid: 8, declarerSeat: 0, declarerTeam: 'A', trumpSuit: 'spades',
  declarerTricks: 8, defenderTricks: 5, made: true, deltaByTeam: { A: 8, B: 0 }, ...over,
});

/** A finished 4p match: teams A=[0,2] / B=[1,3]; `winnerTeam` wins to 41+. */
function finished(over: Partial<TarneebState> = {}): TarneebState {
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
    scoresByTeam: { A: 45, B: 20 },
    handNumber: 3, targetScore: 41,
    options: { targetScore: 41, kabootMode: 'off', allowNoTrump: false },
    lastHand: null,
    handHistory: [
      // seat 0 (team A) declares and makes; seat 1 (team B) declares and fails.
      hand({ handNumber: 1, declarerSeat: 0, declarerTeam: 'A', bid: 8, made: true, deltaByTeam: { A: 9, B: 0 } }),
      hand({ handNumber: 2, declarerSeat: 1, declarerTeam: 'B', bid: 9, made: false, deltaByTeam: { A: 4, B: -9 } }),
      hand({ handNumber: 3, declarerSeat: 0, declarerTeam: 'A', bid: 7, made: true, deltaByTeam: { A: 8, B: 0 } }),
    ],
    winnerTeam: 'A',
    ...over,
  };
}

describe('isFinishedTarneebGame', () => {
  it('is true only when the phase is game_finished', () => {
    expect(isFinishedTarneebGame(finished())).toBe(true);
    expect(isFinishedTarneebGame(finished({ phase: 'playing' }))).toBe(false);
    expect(isFinishedTarneebGame(null)).toBe(false);
  });
});

describe('summarizeFinishedTarneebGame', () => {
  it('marks both seats of the winning team as winners (fixed pairs)', () => {
    const s = summarizeFinishedTarneebGame(finished());
    expect(s.playerCount).toBe(4);
    expect(s.winnerTeam).toBe('A');
    expect(s.finalScoresByTeam).toEqual({ A: 45, B: 20 });
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    expect(byId['player-0'].isWinner).toBe(true);
    expect(byId['player-2'].isWinner).toBe(true);   // partner of seat 0
    expect(byId['player-1'].isWinner).toBe(false);
    expect(byId['player-3'].isWinner).toBe(false);
    expect(s.winners.sort()).toEqual(['player-0', 'player-2']);
  });

  it('gives each player its team final score', () => {
    const s = summarizeFinishedTarneebGame(finished());
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    expect(byId['player-0'].teamFinalScore).toBe(45); // team A
    expect(byId['player-2'].teamFinalScore).toBe(45); // team A partner
    expect(byId['player-1'].teamFinalScore).toBe(20); // team B
  });

  it('tallies declarer / contract counters per seat from the hand history', () => {
    const s = summarizeFinishedTarneebGame(finished());
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    // seat 0 declared hands 1 & 3, both made.
    expect(byId['player-0']).toMatchObject({ declarerCount: 2, contractsMade: 2, contractsFailed: 0 });
    // seat 1 declared hand 2 and failed.
    expect(byId['player-1']).toMatchObject({ declarerCount: 1, contractsMade: 0, contractsFailed: 1 });
    // seats 2 & 3 never declared.
    expect(byId['player-2']).toMatchObject({ declarerCount: 0, contractsMade: 0, contractsFailed: 0 });
    expect(s.handsPlayed).toBe(3);
  });

  it('produces score-only rounds (per-player team delta, bid/trump label, NO cards)', () => {
    const s = summarizeFinishedTarneebGame(finished());
    expect(s.rounds).toHaveLength(3);
    // Hand 2: team A +4, team B -9 → seats 0,2 get +4; seats 1,3 get -9.
    expect(s.rounds[1].scoreByPlayer).toEqual({
      'player-0': 4, 'player-1': -9, 'player-2': 4, 'player-3': -9,
    });
    expect(s.rounds[1].modeId).toBe('9S'); // bid 9, spades — word-free contract label
    // A JSON scan of the whole summary must not contain any card rank/suit key.
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/"rank"|"handsBySeat"|"currentTrick"/);
  });

  it('propagates an exact-bid double delta into rounds (score-only, Stage 13.4)', () => {
    // A single exact-bid hand: bid 8 made with exactly 8 → doubled to +16 for the
    // declarer team. The aggregator reads deltaByTeam, so the double flows through.
    const s = summarizeFinishedTarneebGame(finished({
      handHistory: [hand({ bid: 8, made: true, exactBidDouble: true, deltaByTeam: { A: 16, B: 0 } })],
      scoresByTeam: { A: 16, B: 0 },
    }));
    expect(s.rounds).toHaveLength(1);
    expect(s.rounds[0].scoreByPlayer).toEqual({
      'player-0': 16, 'player-1': 0, 'player-2': 16, 'player-3': 0, // both partners get +16
    });
    expect(s.rounds[0].modeId).toBe('8S');
    // The flag itself is NOT persisted in the score-only round record (delta suffices).
    expect(JSON.stringify(s.rounds)).not.toContain('exactBidDouble');
  });
});

describe('computeTarneebStatDeltas', () => {
  it('emits per-player win/score/contract deltas (one per seat)', () => {
    const deltas = computeTarneebStatDeltas(summarizeFinishedTarneebGame(finished()));
    const byId = Object.fromEntries(deltas.map((d) => [d.playerId, d]));
    expect(byId['player-0']).toMatchObject({
      won: true, teamFinalScore: 45, handsPlayed: 3, declarerCount: 2, contractsMade: 2, contractsFailed: 0,
    });
    expect(byId['player-1']).toMatchObject({
      won: false, teamFinalScore: 20, declarerCount: 1, contractsMade: 0, contractsFailed: 1,
    });
  });
});

describe('tarneebFinishSignature', () => {
  it('is stable for the same outcome and differs for a different winner/score', () => {
    const a = tarneebFinishSignature(finished());
    expect(a).toBe(tarneebFinishSignature(finished()));
    expect(tarneebFinishSignature(finished({ winnerTeam: 'B', scoresByTeam: { A: 20, B: 45 } }))).not.toBe(a);
    expect(tarneebFinishSignature(finished({ scoresByTeam: { A: 50, B: 20 } }))).not.toBe(a);
  });
});

// A finished match with negative team scores is representable (set-heavy game).
describe('negative scores', () => {
  it('carries a negative team final score through the summary', () => {
    const s = summarizeFinishedTarneebGame(finished({
      scoresByTeam: { A: 42, B: -13 } as Record<Team, number>,
    }));
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    expect(byId['player-1'].teamFinalScore).toBe(-13);
  });
});
