// ---------------------------------------------------------------------------
// 51 — a PURE "count cards" calculator (Stage 36.0). Display-only helpers so the
// player can, at ANY time (even on someone else's turn), preview what a selected
// set of cards is worth and the penalty value their whole hand is carrying. It
// dispatches nothing and reuses the existing rules (resolveMeld / handPenalty) —
// never re-implements meld or value logic in the UI.
// ---------------------------------------------------------------------------

import type { FiftyOneCard } from './types';
import { resolveMeld, type ResolvedMeld } from './melds';
import { handPenalty } from './rules';

export interface SelectionResult {
  count: number;
  /** Whether the selection is a valid 51 meld (run or set). */
  valid: boolean;
  type: ResolvedMeld['type'] | null;
  /** Meld value when valid; otherwise the raw penalty value of the picked cards
   *  (normals by §10 value, each joker 25) so a preview always shows a number. */
  value: number;
  jokerRepresents: ResolvedMeld['jokerRepresents'] | null;
}

/**
 * Preview a selected set of cards as a possible meld — PURE, no state change. Under
 * 3 cards can never be a meld; otherwise `resolveMeld` decides. The selection ORDER
 * is honoured (it fixes a joker's position), exactly like the real meld builder.
 */
export function calcSelection(cards: FiftyOneCard[]): SelectionResult {
  const resolved = cards.length >= 3 ? resolveMeld(cards) : null;
  if (resolved) {
    return {
      count: cards.length, valid: true, type: resolved.type,
      value: resolved.value, jokerRepresents: resolved.jokerRepresents,
    };
  }
  // Not a valid meld → show the raw carried value (same basis as an opened hand penalty).
  return { count: cards.length, valid: false, type: null, value: handPenalty(cards, true), jokerRepresents: null };
}

/** The penalty value the whole hand carries right now (opened basis: normals by
 *  value, each held joker 25) — what you'd score if the round ended with this hand. */
export function calcHandTotal(hand: FiftyOneCard[]): number {
  return handPenalty(hand, true);
}
