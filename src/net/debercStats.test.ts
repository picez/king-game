import { describe, it, expect } from 'vitest';
import {
  isFinishedDebercGame, summarizeFinishedDebercGame, computeDebercStatDeltas, debercFinishSignature,
} from './debercStats';
import type { DebercHandResult, DebercMeldKind, DebercPlayer, DebercState } from '../games/deberc/types';

/** A minimal score-only hand result carrying an aggregate meld tally (no cards). */
const hand = (meldTally: { seat: number; kind: DebercMeldKind }[]): DebercHandResult => ({
  teamPoints: [0, 0], cardPoints: [0, 0], meldPoints: [0, 0],
  hvTeam: null, beitTeams: [], topScorerTeam: 0, objazSeat: 0, dealerSeat: 0, meldTally,
});

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

describe('Stage 37.3 telemetry — final score / no-meld / won-without-Бейт', () => {
  // «Бейт» (об'яз under-score) is stored on DebercHandResult.hvTeam (labels swapped
  // vs internal names — DEBERC_RULES §7). A hand with hvTeam=t means team t was Бейт.
  const beytHand = (hvTeam: number | null): DebercHandResult => ({
    teamPoints: [0, 0], cardPoints: [0, 0], meldPoints: [0, 0],
    hvTeam, beitTeams: [], topScorerTeam: 0, objazSeat: 0, dealerSeat: 0, meldTally: [],
  });

  it('carries each seat\'s team final match score (can be negative) into the delta', () => {
    const deltas = computeDebercStatDeltas(summarizeFinishedDebercGame(finished4p({ matchScore: [-30, 100], winnerTeam: 1 })));
    const byId = Object.fromEntries(deltas.map((d) => [d.playerId, d]));
    expect(byId['player-0'].finalTeamScore).toBe(-30); // team 0 (seats 0 & 2)
    expect(byId['player-2'].finalTeamScore).toBe(-30);
    expect(byId['player-1'].finalTeamScore).toBe(100); // team 1 (seats 1 & 3)
    expect(byId['player-0'].won).toBe(false);          // team 1 won
  });

  it('flags noMeldGame only for a seat that scored no combination all match', () => {
    const deltas = computeDebercStatDeltas(summarizeFinishedDebercGame(finished4p({
      handHistory: [hand([{ seat: 1, kind: 'terz' }])], // only seat 1 melds
    })));
    const byId = Object.fromEntries(deltas.map((d) => [d.playerId, d]));
    expect(byId['player-0'].noMeldGame).toBe(true);
    expect(byId['player-2'].noMeldGame).toBe(true);
    expect(byId['player-1'].noMeldGame).toBe(false);
  });

  it('won-without-Бейт: true when the winning team never took a «Бейт» mark', () => {
    // Team 0 wins; a Бейт fell on team 1 (the losers) → winners are Бейт-free.
    const clean = computeDebercStatDeltas(summarizeFinishedDebercGame(finished4p({ handHistory: [beytHand(1)] })));
    const cById = Object.fromEntries(clean.map((d) => [d.playerId, d]));
    expect(cById['player-0']).toMatchObject({ won: true, wonNoBeyt: true });
    expect(cById['player-1'].wonNoBeyt).toBe(false); // lost → not a "won without" credit

    // Same win, but this time the winning team 0 DID take a Бейт in some hand.
    const dirty = computeDebercStatDeltas(summarizeFinishedDebercGame(finished4p({ handHistory: [beytHand(0)] })));
    expect(Object.fromEntries(dirty.map((d) => [d.playerId, d]))['player-0'].wonNoBeyt).toBe(false);
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

describe('combination stats (Stage 13.8)', () => {
  it('counts each scoring meld kind per seat from the score-only handHistory', () => {
    const s = summarizeFinishedDebercGame(finished4p({
      handHistory: [
        hand([{ seat: 0, kind: 'terz' }, { seat: 1, kind: 'platina' }]),
        hand([{ seat: 0, kind: 'terz' }, { seat: 0, kind: 'bella' }]),
        hand([]), // a hand with no melds
      ],
    }));
    expect(s.handsPlayed).toBe(3);
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p.melds]));
    expect(byId['player-0']).toEqual({ terz: 2, platina: 0, bella: 1, total: 3, handsWithMeld: 2 });
    expect(byId['player-1']).toEqual({ terz: 0, platina: 1, bella: 0, total: 1, handsWithMeld: 1 });
    expect(byId['player-3']).toEqual({ terz: 0, platina: 0, bella: 0, total: 0, handsWithMeld: 0 });
  });

  it('a деберц (jackpot) meld is NOT counted as a per-hand meld (tracked as jackpot)', () => {
    const s = summarizeFinishedDebercGame(finished4p({
      handHistory: [hand([{ seat: 0, kind: 'deberc' }, { seat: 0, kind: 'terz' }])],
    }));
    const p0 = s.players.find((p) => p.seatIndex === 0)!;
    expect(p0.melds).toEqual({ terz: 1, platina: 0, bella: 0, total: 1, handsWithMeld: 1 });
  });

  it('legacy hands with no meldTally contribute zeros (graceful)', () => {
    const legacyHand = { ...hand([]) } as DebercHandResult;
    delete (legacyHand as { meldTally?: unknown }).meldTally;
    const s = summarizeFinishedDebercGame(finished4p({ handHistory: [legacyHand, legacyHand] }));
    expect(s.handsPlayed).toBe(2);
    for (const p of s.players) expect(p.melds.total).toBe(0);
  });

  it('deltas carry the per-seat meld counts + hands played denominator', () => {
    const summary = summarizeFinishedDebercGame(finished4p({
      handHistory: [hand([{ seat: 0, kind: 'terz' }]), hand([{ seat: 0, kind: 'bella' }])],
    }));
    const deltas = computeDebercStatDeltas(summary);
    const d0 = deltas.find((d) => d.playerId === 'player-0')!;
    expect(d0.handsPlayed).toBe(2);
    expect(d0.melds).toEqual({ terz: 1, platina: 0, bella: 1, total: 2, handsWithMeld: 2 });
  });

  it('PRIVACY: neither the summary nor the deltas carry any card/rank/suit', () => {
    const summary = summarizeFinishedDebercGame(finished4p({
      handHistory: [hand([{ seat: 0, kind: 'terz' }, { seat: 1, kind: 'bella' }])],
    }));
    const deltas = computeDebercStatDeltas(summary);
    const json = JSON.stringify({ summary, deltas });
    expect(json).not.toMatch(/"rank"|"suit"|"cards"|"hand"\s*:/);
    expect(/spades|hearts|diamonds|clubs/.test(json)).toBe(false);
  });
});
