// ---------------------------------------------------------------------------
// Tarneeb — seats/teams, bidding legality, trump legality, trick play rules,
// and trick resolution. Pure, no state mutation. See TARNEEB_RULES.md §2, §5–7.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { rankValue, TARNEEB_SUITS } from './deck';
import type { TarneebPlay, TarneebState, TarneebVariant, Team } from './types';

export const NUM_SEATS = 4;

// --- Variant (Stage 28.1) ---------------------------------------------------

/**
 * Backward-compatible variant read: anything that is not EXACTLY 'solo' — a
 * legacy/restored state with no `variant` field, or `'pairs'` — is the released
 * pairs game. This is the single fallback point, so pairs snapshots restore
 * unchanged and every reducer branch keys off it. See TARNEEB_SOLO_PLAN.md.
 */
export function tarneebVariant(state: Pick<TarneebState, 'variant'>): TarneebVariant {
  return state.variant === 'solo' ? 'solo' : 'pairs';
}

/** True only for a 4-player cutthroat (every-player-for-self) solo match. */
export function isSoloTarneeb(state: Pick<TarneebState, 'variant'>): boolean {
  return tarneebVariant(state) === 'solo';
}
// Bids are a trick target (out of 13). Minimum lowered to 3 (Stage 27.0, owner rule); a pass is
// still final and bids must strictly rise. Scoring is unchanged — a made/failed bid scores exactly
// as before, just over a wider legal range.
export const MIN_BID = 3;
export const MAX_BID = 13;
export const HAND_TRICKS = 13;

// --- Seats / teams (§2) -----------------------------------------------------

/** Counter-clockwise successor — the seat that acts after `seat` (0→3→2→1→0). */
export function nextSeatCounterClockwise(seat: number): number {
  return (seat + 3) % NUM_SEATS;
}

/** Fixed partnership of a seat: A = seats 0 & 2, B = seats 1 & 3. */
export function teamOfSeat(seat: number): Team {
  return seat % 2 === 0 ? 'A' : 'B';
}

/** The partner sitting opposite `seat`. */
export function partnerOfSeat(seat: number): number {
  return (seat + 2) % NUM_SEATS;
}

/** The other team. */
export function otherTeam(team: Team): Team {
  return team === 'A' ? 'B' : 'A';
}

// --- Card identity / trump --------------------------------------------------

/** Same suit and rank identifies a card (a 52-card deck has no duplicates). */
export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function isTrump(card: Card, trumpSuit: Suit | null): boolean {
  return trumpSuit != null && card.suit === trumpSuit;
}

// --- Trick play (§7) --------------------------------------------------------

/**
 * The cards `hand` may legally play, given the led suit and trump (§7, Stage 27.0 owner rule):
 *  - leading (no led suit): any card;
 *  - holding the led suit: must follow it;
 *  - void in the led suit but holding trump: MUST play a trump;
 *  - void in both the led suit and trump: any card.
 */
export function legalPlays(hand: Card[], ledSuit: Suit | null, trumpSuit: Suit | null): Card[] {
  if (ledSuit == null) return hand.slice();               // leading → any card
  const ofLed = hand.filter((c) => c.suit === ledSuit);
  if (ofLed.length > 0) return ofLed;                     // must follow the led suit
  // Void in the led suit: obliged to trump if able (unless trump IS the led suit, handled above).
  if (trumpSuit != null && trumpSuit !== ledSuit) {
    const ofTrump = hand.filter((c) => c.suit === trumpSuit);
    if (ofTrump.length > 0) return ofTrump;
  }
  return hand.slice();                                    // void in led suit AND trump → any card
}

/**
 * The winning seat of a completed 4-card trick (§7): the highest trump if any
 * trump was played, otherwise the highest card of the led suit. Off-suit,
 * non-trump discards can never win.
 */
export function determineTrickWinner(
  plays: TarneebPlay[],
  ledSuit: Suit,
  trumpSuit: Suit | null,
): number {
  const trumps = trumpSuit != null ? plays.filter((p) => p.card.suit === trumpSuit) : [];
  const pool = trumps.length > 0 ? trumps : plays.filter((p) => p.card.suit === ledSuit);
  let best = pool[0];
  for (const p of pool) {
    if (rankValue(p.card) > rankValue(best.card)) best = p;
  }
  return best.seat;
}

// --- Bidding legality (§5) --------------------------------------------------

/** Whether `bid` is a legal bid by `seat` right now. */
export function canBid(state: TarneebState, seat: number, bid: number): boolean {
  if (state.phase !== 'bidding') return false;
  if (seat !== state.currentSeat) return false;
  if (state.passed[seat]) return false;
  if (!Number.isInteger(bid)) return false;
  if (bid < MIN_BID || bid > MAX_BID) return false;
  const floor = state.highestBid ? state.highestBid.amount : MIN_BID - 1;
  return bid > floor;
}

/** All legal bid amounts for `seat` right now (empty if it is not their turn). */
export function getValidBids(state: TarneebState, seat: number): number[] {
  const bids: number[] = [];
  for (let b = MIN_BID; b <= MAX_BID; b++) {
    if (canBid(state, seat, b)) bids.push(b);
  }
  return bids;
}

/** Whether `seat` may pass right now. */
export function canPassBid(state: TarneebState, seat: number): boolean {
  return state.phase === 'bidding' && seat === state.currentSeat && !state.passed[seat];
}

/** Seats still in the auction (have not passed). */
export function activeBidders(state: TarneebState): number[] {
  const seats: number[] = [];
  for (let s = 0; s < NUM_SEATS; s++) {
    if (!state.passed[s]) seats.push(s);
  }
  return seats;
}

// --- Trump legality (§6) ----------------------------------------------------

/** Whether `seat` may name `suit` as trump right now (declarer only, no No-Trump). */
export function canChooseTrump(state: TarneebState, seat: number, suit: Suit): boolean {
  return (
    state.phase === 'choosing_trump' &&
    seat === state.currentSeat &&
    seat === state.declarerSeat &&
    TARNEEB_SUITS.includes(suit)
  );
}

// --- Play legality (§7) -----------------------------------------------------

/** The legal cards `seat` may play right now (empty unless it is their turn). */
export function getValidPlayableCards(state: TarneebState, seat: number): Card[] {
  if (state.phase !== 'playing') return [];
  if (seat !== state.currentSeat) return [];
  const ledSuit = state.currentTrick ? state.currentTrick.ledSuit : null;
  return legalPlays(state.handsBySeat[seat], ledSuit, state.trumpSuit);
}

/** Whether `seat` may play `card` right now. */
export function canPlayCard(state: TarneebState, seat: number, card: Card): boolean {
  if (state.phase !== 'playing') return false;
  if (seat !== state.currentSeat) return false;
  return getValidPlayableCards(state, seat).some((c) => cardEquals(c, card));
}

// --- Acting seat / status ---------------------------------------------------

/** The seat that must act now, or null if the match is between hands / finished. */
export function getActingTarneebSeat(state: TarneebState): number | null {
  switch (state.phase) {
    case 'bidding':
    case 'choosing_trump':
    case 'playing':
      return state.currentSeat;
    default:
      return null;
  }
}

/** The player id that must act now, or null. */
export function getActingTarneebPlayerId(state: TarneebState): string | null {
  const seat = getActingTarneebSeat(state);
  return seat == null ? null : state.players[seat].id;
}

export function isTarneebFinished(state: TarneebState): boolean {
  return state.phase === 'game_finished';
}
