// ---------------------------------------------------------------------------
// Durak — minimal AI (Stage 9.1). Enough to drive a legal game to completion;
// smarter heuristics (transfer, throw-in piling) come in Stage 9.4/9.5.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import type { DurakAction, DurakState } from './types';
import {
  getValidAttackCards, getValidDefenseCards, unbeatenAttacks,
  canTransfer, getValidTransferCards,
} from './rules';

/** Lowest-value card, preferring non-trumps (keep trumps for later). */
function pickLowest(cards: Card[], trumpSuit: Suit): Card | null {
  if (cards.length === 0) return null;
  return cards.slice().sort((a, b) =>
    (a.suit === trumpSuit ? 1 : 0) - (b.suit === trumpSuit ? 1 : 0) || a.value - b.value)[0];
}

/**
 * A legal action for the acting player, or null. As the current thrower it opens
 * with the cheapest card and throws in only CHEAP non-trump matches (then passes,
 * so bouts stay short and games terminate); as defender it beats with the cheapest
 * card or takes. The priority/eligibility is enforced by the reducer.
 */
export function durakBotAction(state: DurakState): DurakAction | null {
  if (state.status === 'finished') return null;

  if (state.status === 'attack' || state.status === 'taking') {
    const valid = getValidAttackCards(state); // the current thrower's legal cards
    if (state.status === 'attack' && state.table.length === 0) {
      const card = pickLowest(valid, state.trumpSuit);
      return card ? { type: 'ATTACK_CARD', card } : { type: 'PASS_ATTACK' };
    }
    // Throw in a cheap, non-trump matching card (also when the defender is taking);
    // otherwise pass.
    const cheap = valid.filter((c) => c.suit !== state.trumpSuit && c.value <= 9);
    const card = pickLowest(cheap, state.trumpSuit);
    return card ? { type: 'ATTACK_CARD', card } : { type: 'PASS_ATTACK' };
  }

  // defense
  // Transfer variant: rather than commit a defending card, pass the whole bout to
  // the next player with a CHEAP NON-TRUMP same-rank card (keep trumps in reserve).
  // canTransfer/getValidTransferCards enforce rank/capacity/next-player legality;
  // the fixed attack rank + capacity cap make any chain terminate.
  if (canTransfer(state)) {
    const transfer = pickLowest(getValidTransferCards(state), state.trumpSuit);
    if (transfer && transfer.suit !== state.trumpSuit) {
      return { type: 'TRANSFER_ATTACK', card: transfer };
    }
  }

  const unbeaten = unbeatenAttacks(state)[0];
  if (!unbeaten) return null;
  const card = pickLowest(getValidDefenseCards(state, unbeaten), state.trumpSuit);
  if (card) return { type: 'DEFEND_CARD', attack: unbeaten, card };
  return { type: 'TAKE_CARDS' };
}
