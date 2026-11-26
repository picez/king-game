import type { FiftyOneState } from '../../games/fiftyOne/types';
import { groupIndex } from '../components/matchResultModel';

/**
 * Final-standings order for 51 (Stage 43.1), as a comparator over seats (negative =
 * `a` ranks higher):
 *  1. the match winner;
 *  2. seats never eliminated (only on a freak simultaneous wipe);
 *  3. the eliminated, the LATER knocked out ranking higher — a seat out in round 9
 *     beats one out in round 5, whatever the scores;
 *  4. within the same elimination round, the lower running penalty; equal = tie.
 * A state from before the engine kept `eliminationOrder` falls back to the penalty.
 */
export function fiftyOneStandingsCompare(state: FiftyOneState): (a: number, b: number) => number {
  const winner = state.winnerSeat;
  const out = (seat: number) => !!state.eliminatedSeats[seat];
  const outRound = (seat: number) => groupIndex(state.eliminationOrder, seat);
  return (a, b) =>
    Number(b === winner) - Number(a === winner)
    || Number(out(a)) - Number(out(b))
    || outRound(b) - outRound(a)
    || state.scoresBySeat[a] - state.scoresBySeat[b];
}
