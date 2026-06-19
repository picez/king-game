import type { Round, Trick } from '../models/types';

/** A trick's plays in the order they were played (lead first). */
export function playsInOrder(trick: Trick): Trick['plays'] {
  return [...trick.plays].sort((a, b) => a.playOrder - b.playOrder);
}

/**
 * The completed tricks `playerId` WON this round, ordered by trick number, each
 * with its plays in play order.
 *
 * Privacy: this reads only `round.tricks` — the public, completed-trick history
 * (every card here was visible to all players when it was played) — and filters
 * to the viewer's OWN wins. It never reveals which cards another player privately
 * collected; an opponent's collectedCards stay redacted online.
 */
export function wonTrickGroups(round: Round, playerId: string): Trick[] {
  return round.tricks
    .filter((tr) => tr.winnerId === playerId)
    .slice()
    .sort((a, b) => a.trickNumber - b.trickNumber)
    .map((tr) => ({ ...tr, plays: playsInOrder(tr) }));
}
