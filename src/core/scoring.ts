import type { Card, GameModeId, ScoringConfig, Trick } from '../models/types';

/**
 * Canonical penalty-card predicate for the four card-targeting negative modes
 * (No Hearts / No Queens / No Jacks / King of Hearts). Returns false for the
 * positional/per-trick modes (No Tricks, Last Two Tricks, Trump) — those never
 * classify an individual card as a penalty. This is the single source of truth
 * shared by the reducer (early-end + surrender accounting) and the AI.
 */
export function isPerCardPenaltyCard(card: Card, modeId: GameModeId): boolean {
  switch (modeId) {
    case 'no_hearts':      return card.suit === 'hearts';
    case 'no_queens':      return card.rank === 'Q';
    case 'no_jacks':       return card.rank === 'J';
    case 'king_of_hearts': return card.suit === 'hearts' && card.rank === 'K';
    default:               return false;
  }
}

/**
 * Calculates each player's score for a completed round.
 * All values come from the config — nothing is hardcoded here.
 */
export function calculateRoundScore(
  modeId: GameModeId,
  tricks: Trick[],
  collectedCards: Record<string, Card[]>,
  playerIds: string[],
  scoring: ScoringConfig,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const pid of playerIds) result[pid] = 0;

  switch (modeId) {
    case 'no_tricks':
      for (const trick of tricks) {
        if (trick.winnerId) result[trick.winnerId] += scoring.perTrick;
      }
      break;

    case 'no_hearts':
      for (const pid of playerIds) {
        result[pid] = collectedCards[pid].filter((c) => c.suit === 'hearts').length
          * scoring.perHeart;
      }
      break;

    case 'no_queens':
      for (const pid of playerIds) {
        result[pid] = collectedCards[pid].filter((c) => c.rank === 'Q').length
          * scoring.perQueen;
      }
      break;

    case 'no_jacks':
      for (const pid of playerIds) {
        result[pid] = collectedCards[pid].filter((c) => c.rank === 'J').length
          * scoring.perJack;
      }
      break;

    case 'king_of_hearts':
      for (const pid of playerIds) {
        const has = collectedCards[pid].some(
          (c) => c.suit === 'hearts' && c.rank === 'K',
        );
        result[pid] = has ? scoring.kingOfHearts : 0;
      }
      break;

    case 'last_two_tricks': {
      const lastTwo = tricks.slice(-2);
      for (const trick of lastTwo) {
        if (trick.winnerId) result[trick.winnerId] += scoring.perLastTrick;
      }
      break;
    }

    case 'trump':
      for (const trick of tricks) {
        if (trick.winnerId) result[trick.winnerId] += scoring.trumpRewardPerTrick;
      }
      break;
  }

  return result;
}

// NOTE: There is no kitty penalty. Per KING_RULES.md, cards the dealer discards
// to the kitty leave the game entirely and are scored to nobody. The dealer is
// forbidden from discarding the current mode's penalty cards in the first place
// (see core/kitty.ts → canDiscardToKitty).
