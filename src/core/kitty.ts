import type { Card, GameModeId } from '../models/types';

/**
 * Kitty discard legality (KING_RULES.md → Kitty / Прикуп).
 *
 * The dealer takes the kitty and discards the same number of cards; those
 * cards leave the game and are scored to nobody. The dealer may NOT discard a
 * penalty card of the current mode. In King of Hearts ALL hearts are forbidden
 * (not just K♥) so the King can never be discarded out of the game indirectly.
 *
 * This is the single source of truth used by the UI (to dim illegal cards),
 * the reducer (to reject illegal discards — server-authoritative online), and
 * the AI (to never pick an illegal discard).
 */
export function canDiscardToKitty(card: Card, modeId: GameModeId): boolean {
  switch (modeId) {
    case 'no_hearts':      return card.suit !== 'hearts';
    case 'no_queens':      return card.rank !== 'Q';
    case 'no_jacks':       return card.rank !== 'J';
    case 'king_of_hearts': return card.suit !== 'hearts'; // no hearts at all
    // No Tricks / Last Two Tricks / Trump: anything may be discarded.
    case 'no_tricks':
    case 'last_two_tricks':
    case 'trump':
    default:
      return true;
  }
}

/** The subset of a hand that may legally be discarded to the kitty. */
export function getValidKittyDiscards(hand: Card[], modeId: GameModeId): Card[] {
  return hand.filter((c) => canDiscardToKitty(c, modeId));
}
