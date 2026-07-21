import { describe, it, expect } from 'vitest';
import {
  isFinishedPokerGame, summarizeFinishedPokerGame, computePokerStatDeltas, pokerFinishSignature,
} from './pokerStats';
import type { PokerPlayer, PokerState, PokerTelemetry } from '../games/poker/types';

const P = (seat: number, ai = false): PokerPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: ai ? 'ai' : 'human' });

function tel(over: Partial<Record<keyof PokerTelemetry, number[]>> = {}, n = 3): PokerTelemetry {
  const z = () => Array.from({ length: n }, () => 0);
  return {
    handsPlayedBySeat: over.handsPlayedBySeat ?? z(),
    handsWonBySeat: over.handsWonBySeat ?? z(),
    showdownsWonBySeat: over.showdownsWonBySeat ?? z(),
    potsWonBySeat: over.potsWonBySeat ?? z(),
    biggestPotBySeat: over.biggestPotBySeat ?? z(),
    allInsWonBySeat: over.allInsWonBySeat ?? z(),
    royalFlushBySeat: over.royalFlushBySeat ?? z(),
  };
}

/** A FINISHED poker match; seat 1 holds all the chips. Cards intentionally omitted. */
function finished(over: Partial<PokerState> = {}): PokerState {
  const n = 3;
  const falses = () => Array.from({ length: n }, () => false);
  const zeros = () => Array.from({ length: n }, () => 0);
  return {
    gameType: 'poker', phase: 'game_finished', playerCount: n, players: [P(0), P(1), P(2, true)],
    options: { startingStack: 1000, smallBlind: 10, bigBlind: 20 },
    buttonSeat: 0, handNumber: 12, street: 'river',
    stacksBySeat: [0, 3000, 0], holeCardsBySeat: [[], [], []], board: [], deck: [], burned: [],
    committedBySeat: zeros(), contributedBySeat: zeros(), foldedBySeat: falses(),
    allInBySeat: falses(), wasAllInBySeat: falses(), actedBySeat: falses(), eliminatedBySeat: [true, false, true],
    currentBet: 0, minRaise: 20, toActSeat: 1, revealedBySeat: falses(),
    lastHand: null, winnerSeat: 1,
    telemetry: tel({
      handsPlayedBySeat: [12, 12, 12], handsWonBySeat: [3, 8, 1], showdownsWonBySeat: [1, 4, 0],
      potsWonBySeat: [3, 9, 1], biggestPotBySeat: [400, 1200, 150], allInsWonBySeat: [0, 2, 0],
      royalFlushBySeat: [0, 1, 0],
    }),
    ...over,
  };
}

describe('poker stats — finished-game summarizer (pure, score-level)', () => {
  it('isFinishedPokerGame gates on the finished phase', () => {
    expect(isFinishedPokerGame(finished())).toBe(true);
    expect(isFinishedPokerGame(finished({ phase: 'betting' }))).toBe(false);
    expect(isFinishedPokerGame(null)).toBe(false);
  });

  it('summarises the winner + per-seat telemetry counters', () => {
    const sum = summarizeFinishedPokerGame(finished());
    expect(sum.winnerSeat).toBe(1);
    expect(sum.winners).toEqual(['player-1']);
    expect(sum.handsPlayed).toBe(12);
    const byId = Object.fromEntries(sum.players.map((p) => [p.playerId, p]));
    expect(byId['player-1']).toMatchObject({ isWinner: true, handsWon: 8, showdownsWon: 4, biggestPot: 1200, allInsWon: 2, royalFlushes: 1 });
    expect(byId['player-0']).toMatchObject({ isWinner: false, handsWon: 3 });
    // No card vocabulary ever leaks into the summary.
    expect(JSON.stringify(sum)).not.toMatch(/"rank"|"suit"|holeCards|deck|burn/);
  });

  it('computes per-seat deltas (exactly one winner)', () => {
    const deltas = computePokerStatDeltas(summarizeFinishedPokerGame(finished()));
    expect(deltas.filter((d) => d.won)).toHaveLength(1);
    const byId = Object.fromEntries(deltas.map((d) => [d.playerId, d]));
    expect(byId['player-1']).toMatchObject({ won: true, lost: false, biggestPot: 1200, royalFlushes: 1 });
    expect(byId['player-0']).toMatchObject({ won: false, lost: true });
  });

  it('finish signature is stable for the same outcome and carries no card data', () => {
    const a = pokerFinishSignature(finished());
    expect(a).toBe(pokerFinishSignature(finished()));
    expect(pokerFinishSignature(finished({ winnerSeat: 0 }))).not.toBe(a);
    expect(a).not.toMatch(/rank|suit|hearts|spades/);
    expect(a.startsWith('poker|3|1|12|')).toBe(true);
  });
});
