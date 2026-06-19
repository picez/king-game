import type { ModeQueueEntry } from '../models/types';
import { DEALER_MODE_ORDER, GAMES_PER_DEALER } from '../config/gameModes';

/**
 * Generates the full per-game queue.
 *
 * The dealer rotates in turn every round (round-robin), and each dealer plays
 * their own personal set of 9 games (6 negatives + Trump ×3). Total rounds:
 *   GAMES_PER_DEALER × playerCount = 9 × playerCount
 *   → 27 rounds for 3 players, 36 rounds for 4 players.
 *
 * `dealerIdx` drives the rotation for both fixed and Dealer's-Choice modes.
 * `modeId` is the fixed-order mode for that dealer's nth turn; it is used in
 * fixed mode and ignored in Dealer's Choice (where the dealer picks).
 *
 * firstDealerIdx: the randomly selected starting dealer.
 */
export function generateModeQueue(
  playerCount: number,
  firstDealerIdx = 0,
): ModeQueueEntry[] {
  const queue: ModeQueueEntry[] = [];
  const totalRounds = GAMES_PER_DEALER * playerCount;
  for (let round = 0; round < totalRounds; round++) {
    const dealerIdx = (firstDealerIdx + round) % playerCount;
    const turnIndex = Math.floor(round / playerCount); // 0..(GAMES_PER_DEALER-1)
    queue.push({ modeId: DEALER_MODE_ORDER[turnIndex], dealerIdx });
  }
  return queue;
}
