// ---------------------------------------------------------------------------
// Preferans — pure rules: the bidding ladder, legal-move predicates, and trick
// resolution. See PREFERANS_RULES.md §5 (bidding), §6 (talon), §7 (contracts),
// §8 (play), §9 (defenders). No state mutation here — the engine owns transitions.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { rankValue, TALON_SIZE } from './deck';
import type { Bid, ContractSuit, PreferansPlay, PreferansState } from './types';

export const MIN_LEVEL = 6;
export const MAX_LEVEL = 10;

/** Suit order for the auction + trump strength (low→high), §3/§5. */
export const CONTRACT_SUIT_ORDER: ContractSuit[] = ['spades', 'clubs', 'diamonds', 'hearts', 'NT'];

export function suitIndex(suit: ContractSuit): number {
  return CONTRACT_SUIT_ORDER.indexOf(suit);
}

/** True when (level, suit) is a legal contract shape (level 6–10, known suit/NT). */
export function isValidBidShape(level: number, suit: ContractSuit): boolean {
  return Number.isInteger(level) && level >= MIN_LEVEL && level <= MAX_LEVEL && suitIndex(suit) >= 0;
}

/** A single ascending rank for a contract: 6♠=0, 6♣=1 … 6NT=4, 7♠=5 … 10NT=24. */
export function bidRank(bid: Bid): number {
  return (bid.level - MIN_LEVEL) * CONTRACT_SUIT_ORDER.length + suitIndex(bid.suit);
}

/** The trump suit of a contract, or null for No-Trump. */
export function trumpSuitOf(contract: Bid): Suit | null {
  return contract.suit === 'NT' ? null : contract.suit;
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Seats still in the auction (not yet passed). */
export function activeBidders(s: PreferansState): number[] {
  const out: number[] = [];
  for (let seat = 0; seat < s.passed.length; seat++) if (!s.passed[seat]) out.push(seat);
  return out;
}

// ── Bidding ──────────────────────────────────────────────────────────────────

export function canBid(s: PreferansState, seat: number, level: number, suit: ContractSuit): boolean {
  if (s.phase !== 'bidding' || seat !== s.currentSeat || s.passed[seat]) return false;
  if (!isValidBidShape(level, suit)) return false;
  const rank = bidRank({ level, suit });
  return s.highBid ? rank > bidRank(s.highBid) : true; // strictly above the current high bid
}

export function canPassBid(s: PreferansState, seat: number): boolean {
  return s.phase === 'bidding' && seat === s.currentSeat && !s.passed[seat];
}

// ── Talon / discard / declare ─────────────────────────────────────────────────

export function canTakeTalon(s: PreferansState, seat: number): boolean {
  return s.phase === 'talon' && seat === s.declarerSeat && s.currentSeat === seat
    && s.talon.length === TALON_SIZE;
}

/** Discard exactly 2 DISTINCT cards, both currently in the declarer's (12-card) hand. */
export function canDiscard(s: PreferansState, seat: number, cards: readonly Card[]): boolean {
  if (s.phase !== 'talon' || seat !== s.declarerSeat || s.currentSeat !== seat) return false;
  if (s.talon.length !== 0 || s.discards.length !== 0) return false; // must have taken the talon, not yet discarded
  if (cards.length !== TALON_SIZE) return false;
  if (cardEquals(cards[0], cards[1])) return false; // two distinct cards
  const hand = s.handsBySeat[seat];
  return cards.every((c) => hand.some((h) => cardEquals(h, c)));
}

/** The final contract must be a legal shape AND at least the winning bid (§6). */
export function canDeclareContract(s: PreferansState, seat: number, level: number, suit: ContractSuit): boolean {
  if (s.phase !== 'talon' || seat !== s.declarerSeat || s.currentSeat !== seat) return false;
  if (s.discards.length !== TALON_SIZE || s.contract !== null) return false; // discarded, not yet declared
  if (!isValidBidShape(level, suit)) return false;
  const min = s.highBid ? bidRank(s.highBid) : bidRank({ level: MIN_LEVEL, suit: 'spades' });
  return bidRank({ level, suit }) >= min;
}

// ── Trick play ────────────────────────────────────────────────────────────────

/**
 * Legal cards a seat may play right now (§8): follow the led suit if able; when
 * void, any card is legal (trump or discard in a suit contract; anything in NT).
 */
export function getValidPlayableCards(s: PreferansState, seat: number): Card[] {
  const hand = s.handsBySeat[seat];
  const trick = s.currentTrick;
  if (!trick || trick.ledSuit === null) return hand.slice(); // leading → any card
  const ofLed = hand.filter((c) => c.suit === trick.ledSuit);
  return ofLed.length > 0 ? ofLed : hand.slice();
}

export function canPlayCard(s: PreferansState, seat: number, card: Card): boolean {
  if (s.phase !== 'playing' || seat !== s.currentSeat || !s.currentTrick) return false;
  return getValidPlayableCards(s, seat).some((c) => cardEquals(c, card));
}

// ── Acting seat / status (for the GameDefinition seam) ────────────────────────

/** The seat that must act now, or null between hands / when finished. */
export function getActingPreferansSeat(state: PreferansState): number | null {
  switch (state.phase) {
    case 'bidding':
    case 'talon':
    case 'playing':
      return state.currentSeat;
    default:
      return null;
  }
}

/** The player id that must act now, or null. */
export function getActingPreferansPlayerId(state: PreferansState): string | null {
  const seat = getActingPreferansSeat(state);
  return seat == null ? null : state.players[seat].id;
}

export function isPreferansFinished(state: PreferansState): boolean {
  return state.phase === 'game_finished';
}

/**
 * The winning seat of a completed/partial trick: the highest trump if any trump was
 * played, otherwise the highest card of the led suit. `trumpSuit` null = No-Trump.
 */
export function determineTrickWinner(plays: PreferansPlay[], ledSuit: Suit, trumpSuit: Suit | null): number {
  let best = plays[0];
  for (const p of plays) {
    const bTrump = trumpSuit !== null && best.card.suit === trumpSuit;
    const pTrump = trumpSuit !== null && p.card.suit === trumpSuit;
    if (pTrump && !bTrump) { best = p; continue; }
    if (pTrump && bTrump) { if (rankValue(p.card) > rankValue(best.card)) best = p; continue; }
    if (!pTrump && !bTrump) {
      // Only the led suit can win when no trump is in play.
      if (p.card.suit === ledSuit && (best.card.suit !== ledSuit || rankValue(p.card) > rankValue(best.card))) best = p;
    }
  }
  return best.seat;
}
