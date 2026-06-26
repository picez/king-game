// ---------------------------------------------------------------------------
// Durak — minimal AI (Stage 9.1). Enough to drive a legal game to completion;
// smarter heuristics (transfer, throw-in piling) come in Stage 9.4/9.5.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import type { DurakAction, DurakState } from './types';
import { getValidAttackCards, getValidDefenseCards, unbeatenAttacks } from './rules';

/** Lowest-value card, preferring non-trumps (keep trumps for later). */
function pickLowest(cards: Card[], trumpSuit: Suit): Card | null {
  if (cards.length === 0) return null;
  return cards.slice().sort((a, b) =>
    (a.suit === trumpSuit ? 1 : 0) - (b.suit === trumpSuit ? 1 : 0) || a.value - b.value)[0];
}

/**
 * A legal action for the acting player, or null. Conservative: opens with the
 * cheapest card, defends with the cheapest beating card, never piles on throw-ins
 * (ends the attack), takes when it cannot beat.
 */
export function durakBotAction(state: DurakState): DurakAction | null {
  if (state.status === 'finished') return null;

  if (state.status === 'attack') {
    if (state.table.length === 0) {
      const card = pickLowest(getValidAttackCards(state), state.trumpSuit);
      return card ? { type: 'ATTACK_CARD', card } : null;
    }
    return { type: 'END_ATTACK' }; // don't pile on (MVP bot)
  }

  // defense
  const unbeaten = unbeatenAttacks(state)[0];
  if (!unbeaten) return null;
  const card = pickLowest(getValidDefenseCards(state, unbeaten), state.trumpSuit);
  if (card) return { type: 'DEFEND_CARD', attack: unbeaten, card };
  return { type: 'TAKE_CARDS' };
}
