// ---------------------------------------------------------------------------
// Deberc — trick play rules: legal moves and trick resolution.
// See DEBERC_RULES.md §5. Pure, no state mutation.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { trickStrength } from './deck';
import type { DebercPlay } from './types';

export function isTrump(card: Card, trumpSuit: Suit | null): boolean {
  return trumpSuit != null && card.suit === trumpSuit;
}

/** Same suit and rank identifies a card (a 36-card deck has no duplicates). */
export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/**
 * The cards `hand` may legally play, given the led suit and trump (DEBERC_RULES
 * §5):
 *  - leading (no led suit): any card;
 *  - holding the led suit: must follow it (any led-suit card — over-trumping the
 *    led trump is NOT required);
 *  - void in the led suit but holding trump: must play a trump (any — raising an
 *    existing trump is NOT required);
 *  - void in both: any card.
 */
export function legalPlays(hand: Card[], ledSuit: Suit | null, trumpSuit: Suit | null): Card[] {
  if (ledSuit == null) return hand.slice();

  const ofLed = hand.filter((c) => c.suit === ledSuit);
  if (ofLed.length > 0) return ofLed;

  if (trumpSuit != null) {
    const trumps = hand.filter((c) => c.suit === trumpSuit);
    if (trumps.length > 0) return trumps;
  }
  return hand.slice();
}

/** Whether `card` is a legal play for `hand` in the current trick. */
export function isLegalPlay(
  card: Card,
  hand: Card[],
  ledSuit: Suit | null,
  trumpSuit: Suit | null,
): boolean {
  return legalPlays(hand, ledSuit, trumpSuit).some((c) => cardEquals(c, card));
}

/**
 * The winning seat of a completed (or partial) trick: the strongest trump if any
 * trump was played, otherwise the strongest card of the led suit. Off-suit,
 * non-trump discards can never win.
 */
export function resolveTrick(plays: DebercPlay[], ledSuit: Suit, trumpSuit: Suit | null): number {
  const trumpPlays = trumpSuit != null ? plays.filter((p) => p.card.suit === trumpSuit) : [];
  const pool = trumpPlays.length > 0
    ? trumpPlays
    : plays.filter((p) => p.card.suit === ledSuit);

  let best = pool[0];
  for (const p of pool) {
    if (trickStrength(p.card, trumpSuit) > trickStrength(best.card, trumpSuit)) best = p;
  }
  return best.seatIndex;
}
