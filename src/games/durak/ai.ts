// ---------------------------------------------------------------------------
// Durak — bot AI. Returns ONE legal action per turn; the reducer validates.
// Pure + deterministic (decisions depend only on the state, no randomness).
//
// Heuristics (DURAK_RULES.md): trump conservation is the main lever.
//  • Attack: open with the lowest non-trump; throw in cheap matching cards; when
//    the defender is TAKING, offload more junk (they collect it), but never give
//    away trumps or aces.
//  • Defend: beat with the cheapest legal card (non-trump before trump). TAKE
//    instead of spending a trump to beat a low non-trump early (deep draw pile) —
//    a saved trump is worth more than one cheap card. Never over-commit trumps.
//  • Transfer variant: pass the bout on with a cheap non-trump same-rank card.
//
// `legacyDurakBotAction` preserves the previous minimal heuristic as a baseline
// for scripts/durak-ai-eval.mjs (head-to-head), and is otherwise unused.
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

const isTrump = (c: Card, t: Suit): boolean => c.suit === t;

/**
 * A legal action for the acting player, or null. Trump-conserving heuristic — see
 * the file header. The reducer enforces priority/eligibility and legality.
 */
export function durakBotAction(state: DurakState): DurakAction | null {
  if (state.status === 'finished') return null;
  const trump = state.trumpSuit;

  // --- Attacking (open a bout, or throw in / pile onto a taker) --------------
  if (state.status === 'attack' || state.status === 'taking') {
    const valid = getValidAttackCards(state); // the current thrower's legal cards

    // Opening the bout: lead the lowest card (non-trump first) — shed weak cards,
    // keep trumps and high cards back.
    if (state.status === 'attack' && state.table.length === 0) {
      const card = pickLowest(valid, trump);
      return card ? { type: 'ATTACK_CARD', card } : { type: 'PASS_ATTACK' };
    }

    // Throw-in / pile-on. Never feed the defender a trump or an ace (both are
    // strong cards worth keeping). When the defender is TAKING they collect
    // whatever we add, so offload more junk (up to Q); when they are still
    // defending, keep the bout short with only cheap cards (≤ 9).
    const taking = state.status === 'taking';
    const maxDump = taking ? 12 : 9; // 12 = Q; keep K(13)/A(14) and all trumps
    const dumpable = valid.filter((c) => !isTrump(c, trump) && c.value <= maxDump);
    const card = pickLowest(dumpable, trump);
    return card ? { type: 'ATTACK_CARD', card } : { type: 'PASS_ATTACK' };
  }

  // --- Defending -------------------------------------------------------------
  // Transfer variant: pass the whole bout to the next player with a CHEAP
  // NON-TRUMP same-rank card (keep trumps in reserve); the rules enforce legality.
  if (canTransfer(state)) {
    const transfer = pickLowest(getValidTransferCards(state), trump);
    if (transfer && !isTrump(transfer, trump)) {
      return { type: 'TRANSFER_ATTACK', card: transfer };
    }
  }

  const unbeaten = unbeatenAttacks(state);
  const first = unbeaten[0];
  if (!first) return null; // nothing to answer (shouldn't happen in 'defense')

  // Cheapest legal beat for each unbeaten attack; if any is unbeatable → take.
  const beats = unbeaten.map((a) => ({ a, best: pickLowest(getValidDefenseCards(state, a), trump) }));
  if (beats.some((b) => !b.best)) return { type: 'TAKE_CARDS' };

  // Trump conservation: if the only way to beat is to spend a TRUMP on a low
  // NON-TRUMP attack, and the deck is still deep (early), and the intake is
  // small, TAKE instead — a kept trump wins more than one cheap card costs.
  const defenderTrumps = state.players[state.defenderIndex].hand.filter((c) => isTrump(c, trump)).length;
  const wouldBurnTrump = beats.every((b) => isTrump(b.best!, trump)) && unbeaten.every((a) => !isTrump(a, trump));
  const deep = state.drawPile.length >= state.players.length * 4; // plenty still to draw
  const smallIntake = state.table.length <= 2;
  if (wouldBurnTrump && deep && smallIntake && defenderTrumps <= 3) {
    return { type: 'TAKE_CARDS' };
  }

  // Otherwise beat the first unbeaten attack with the cheapest legal card.
  return { type: 'DEFEND_CARD', attack: first, card: beats[0].best! };
}

// ---------------------------------------------------------------------------
// Baseline (previous minimal heuristic) — kept only for the head-to-head eval.
// ---------------------------------------------------------------------------

/** The shipped pre-improvement bot, preserved as an evaluation baseline. */
export function legacyDurakBotAction(state: DurakState): DurakAction | null {
  if (state.status === 'finished') return null;

  if (state.status === 'attack' || state.status === 'taking') {
    const valid = getValidAttackCards(state);
    if (state.status === 'attack' && state.table.length === 0) {
      const card = pickLowest(valid, state.trumpSuit);
      return card ? { type: 'ATTACK_CARD', card } : { type: 'PASS_ATTACK' };
    }
    const cheap = valid.filter((c) => c.suit !== state.trumpSuit && c.value <= 9);
    const card = pickLowest(cheap, state.trumpSuit);
    return card ? { type: 'ATTACK_CARD', card } : { type: 'PASS_ATTACK' };
  }

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
