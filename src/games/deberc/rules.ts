// ---------------------------------------------------------------------------
// Deberc — trick play rules: legal moves and trick resolution.
// See DEBERC_RULES.md §5. Pure, no state mutation.
// ---------------------------------------------------------------------------

import type { Card, Suit, Rank } from '../../models/types';
import { trickStrength } from './deck';
import type { DebercPlay, DebercState } from './types';

/** The lowest trump card's rank by table size (Stage 27.2): 3p uses a 32-card deck (low = 7),
 *  4p a 36-card deck (low = 6). */
export function lowTrumpRank(playerCount: number): Rank {
  return playerCount === 4 ? '6' : '7';
}

/**
 * Whether the CURRENT declarer (`seat`) may exchange its lowest trump for the face-up table trump
 * right now (Stage 27.2, §6a — "the low trump"). Turn-gated to the declarer so it works over the
 * turn-based online authorization; the low trump is held by exactly one player, who reaches their
 * own declaring turn. Allowed once per hand, before that seat declares (and, for 4p, before the
 * dealer — whose hand holds the exposed trump — declares, so no meld is invalidated).
 */
export function canExchangeTrump(state: DebercState, seat: number): boolean {
  if (state.phase !== 'declaring' || state.trumpSuit == null || state.trumpExchanged) return false;
  if (seat !== state.meldTurnSeat || state.meldsDone[seat]) return false;
  const n = state.players.length;
  const trump = state.trumpSuit;
  const lowRank = lowTrumpRank(n);
  const hand = state.players[seat].hand;
  if (!hand.some((c) => c.suit === trump && c.rank === lowRank)) return false;
  const exposed = state.tableTrumpCard;
  // v1.6 (§3a): the exposed table card must itself be a TRUMP — i.e. the trump was
  // taken from the table (round 1), not declared as a free suit (round 2). Swapping
  // the low trump for an off-suit exposed card is not allowed.
  if (exposed.suit !== trump) return false;
  // v1.6 (§3a): the low trump must have been in the seat's ORIGINAL 6-card hand — a
  // low trump drawn from the прикуп (talon) can never be exchanged.
  if (!(state.lowTrumpFromHand?.[seat] ?? false)) return false;
  if (exposed.suit === trump && exposed.rank === lowRank) return false; // already the low trump
  if (n === 4) {
    if (state.meldsDone[state.dealerSeat]) return false;                // dealer's melds must stay valid
    if (hand.some((c) => cardEquals(c, exposed))) return false;         // can't swap the exposed with itself
  }
  return true;
}

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
