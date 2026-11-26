import { describe, expect, it } from 'vitest';
import { fiftyOneReducer } from '../../games/fiftyOne/engine';
import type { FiftyOneState } from '../../games/fiftyOne/types';
import { competitionPlaces } from '../components/matchResultModel';
import { fiftyOneStandingsCompare } from './fiftyOneStandings';

function places(state: FiftyOneState): number[] {
  const cmp = fiftyOneStandingsCompare(state);
  return competitionPlaces(state.players, (a, b) => cmp(a.seatIndex, b.seatIndex));
}

function finished(scores: number[], winner: number, order: number[][] | undefined): FiftyOneState {
  const s = fiftyOneReducer(null, {
    type: 'START_GAME', playerNames: scores.map((_, i) => `P${i}`), playerCount: scores.length, dealerSeat: 0,
  })!;
  return {
    ...s,
    phase: 'game_finished',
    scoresBySeat: scores,
    eliminatedSeats: scores.map((_, i) => i !== winner),
    winnerSeat: winner,
    eliminationOrder: order,
  };
}

describe('51 final standings (Stage 43.1)', () => {
  it('the owner case: two out early at 230, the last one out at 280 is 2nd, not 4th', () => {
    // seat 0 = winner, seats 1+2 out in round 1 with 230, seat 3 out later with 280.
    const s = finished([150, 230, 230, 280], 0, [[1, 2], [3]]);
    expect(places(s)).toEqual([1, 3, 3, 2]);
  });

  it('within the same elimination round the lower penalty ranks higher', () => {
    const s = finished([90, 240, 300, 215], 0, [[3], [1, 2]]);
    expect(places(s)).toEqual([1, 2, 3, 4]);
  });

  it('a legacy state without eliminationOrder falls back to the penalty', () => {
    const s = finished([150, 230, 230, 280], 0, undefined);
    expect(places(s)).toEqual([1, 2, 2, 4]);
  });

  it('START_GAME starts an empty elimination order', () => {
    const s = fiftyOneReducer(null, { type: 'START_GAME', playerNames: ['a', 'b', 'c', 'd', 'e', 'f'], playerCount: 6 })!;
    expect(s.eliminationOrder).toEqual([]);
    expect(s.playerCount).toBe(6);
    expect(s.handsBySeat.flat().length + s.drawPile.length).toBe(159);
  });
});
