// ---------------------------------------------------------------------------
// 51 — meld validation and valuation (the crux of the game). Pure. See
// 51_RULES.md §6 (runs & sets), §8 (jokers) and §10 (card values).
//
// A meld is a RUN (3+ consecutive same-suit cards) or a SET (3+ same-rank
// cards, no duplicate identical suit+rank). Jokers are wild and stand in for a
// single clear missing card:
//   • MVP joker cap: AT MOST ONE joker per meld (§8 / §16 Q10 — the conservative
//     documented default; keeps the represented card unambiguous). Two or more
//     jokers in one meld is rejected.
//   • In a run, a joker may only fill an INTERNAL gap (between two present
//     cards) — a joker at either END of a run is ambiguous (could extend up OR
//     down) and is rejected, honouring the "clear, unambiguous card" rule.
//
// Ace handling (§6, §10):
//   • Ace is HIGH by default (… Q K A). `Q-K-A` is a valid run worth 30.
//   • `A-2-3` is the ONLY Ace-low run, worth 6 (A=1, 2, 3).
//   • `K-A-2` is NOT allowed (a run may not wrap around the Ace).
// ---------------------------------------------------------------------------

import type { Rank, Suit } from '../../models/types';
import type { FiftyOneCard, FiftyOneMeldType, JokerRepresentation } from './types';

export const MAX_JOKERS_PER_MELD = 1;

const ALL_SUITS: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

/**
 * Card point value (§10), used for both the 51 opening total and hand
 * penalties: 2–9 face value; 10/J/Q/K/A = 10. (The Ace-as-1 special case only
 * ever occurs INSIDE an `A-2-3` run — handled in run valuation, never here.)
 */
export function rankValue(rank: Rank): number {
  switch (rank) {
    case 'A':
    case 'K':
    case 'Q':
    case 'J':
    case '10':
      return 10;
    default:
      return Number(rank); // '2'..'9'
  }
}

/** Ace-HIGH run position: 2→2 … 10→10, J→11, Q→12, K→13, A→14. */
function runPositionHigh(rank: Rank): number {
  switch (rank) {
    case 'J': return 11;
    case 'Q': return 12;
    case 'K': return 13;
    case 'A': return 14;
    case '10': return 10;
    default: return Number(rank);
  }
}

/** Ace-LOW run position (only meaningful for A-2-3): A→1, 2→2, 3→3. */
function runPositionLow(rank: Rank): number {
  return rank === 'A' ? 1 : Number(rank);
}

/** The rank occupying a run position, under the chosen Ace mapping. */
function rankAtPosition(pos: number, aceLow: boolean): Rank {
  if (aceLow && pos === 1) return 'A';
  if (pos === 14) return 'A';
  if (pos === 13) return 'K';
  if (pos === 12) return 'Q';
  if (pos === 11) return 'J';
  return String(pos) as Rank; // 2..10
}

/** The point value contributed by a run position (Ace = 1 only when aceLow). */
function positionValue(pos: number, aceLow: boolean): number {
  if (aceLow && pos === 1) return 1; // Ace low inside A-2-3
  if (pos >= 2 && pos <= 9) return pos;
  return 10; // 10, J, Q, K, and Ace-high all score 10
}

/** The outcome of interpreting a set of cards as a meld. */
export interface ResolvedMeld {
  type: FiftyOneMeldType;
  /** Cards in canonical order (runs low→high; sets keep input order). */
  cards: FiftyOneCard[];
  jokerRepresents: Record<number, JokerRepresentation>;
  value: number;
}

function jokerCount(cards: FiftyOneCard[]): number {
  return cards.reduce((n, c) => n + (c.joker ? 1 : 0), 0);
}

/** Try to interpret `cards` as a valid RUN; null if it is not one. */
export function resolveRun(cards: FiftyOneCard[]): ResolvedMeld | null {
  if (cards.length < 3) return null;
  const jokers = cards.filter((c) => c.joker);
  const normals = cards.filter((c) => !c.joker);
  if (jokers.length > MAX_JOKERS_PER_MELD) return null;
  if (normals.length === 0) return null; // an all-joker meld is never clear

  const suit = normals[0].suit as Suit;
  if (!normals.every((c) => c.suit === suit)) return null; // runs are one suit

  // Try Ace-high first, then the Ace-low special case (only A-2-3 qualifies).
  for (const aceLow of [false, true]) {
    const positions = normals.map((c) => (aceLow ? runPositionLow(c.rank as Rank) : runPositionHigh(c.rank as Rank)));
    if (new Set(positions).size !== positions.length) continue; // duplicate rank ⇒ not a run

    const min = Math.min(...positions);
    const max = Math.max(...positions);
    if (aceLow) {
      // Ace-low permits ONLY the A-2-3 window (positions within [1, 3]).
      if (min < 1 || max > 3) continue;
    } else {
      if (min < 2 || max > 14) continue; // 2..A(14)
    }

    // The window is exactly [min, max]; jokers fill the internal holes. This
    // rejects jokers at the ends (ambiguous) and enforces length = card count.
    const windowLen = max - min + 1;
    if (windowLen !== cards.length) continue;
    const occupied = new Set(positions);
    const holes: number[] = [];
    for (let p = min; p <= max; p++) if (!occupied.has(p)) holes.push(p);
    if (holes.length !== jokers.length) continue;

    // Build the canonical low→high ordering and joker representations + value.
    const byPosition = new Map<number, FiftyOneCard>();
    for (let i = 0; i < normals.length; i++) byPosition.set(positions[i], normals[i]);
    const orderedCards: FiftyOneCard[] = [];
    const jokerRepresents: Record<number, JokerRepresentation> = {};
    let value = 0;
    let jokerIdx = 0;
    for (let p = min; p <= max; p++) {
      value += positionValue(p, aceLow);
      const present = byPosition.get(p);
      if (present) {
        orderedCards.push(present);
      } else {
        // A joker fills this hole; record what it represents.
        const joker = jokers[jokerIdx++];
        const slot = orderedCards.length;
        orderedCards.push(joker);
        jokerRepresents[slot] = { suit, rank: rankAtPosition(p, aceLow) };
      }
    }
    return { type: 'run', cards: orderedCards, jokerRepresents, value };
  }
  return null;
}

/** Try to interpret `cards` as a valid SET (group); null if it is not one. */
export function resolveSet(cards: FiftyOneCard[]): ResolvedMeld | null {
  if (cards.length < 3) return null;
  if (cards.length > 4) return null; // at most one card per suit ⇒ max 4
  const jokers = cards.filter((c) => c.joker);
  const normals = cards.filter((c) => !c.joker);
  if (jokers.length > MAX_JOKERS_PER_MELD) return null;
  if (normals.length === 0) return null;

  const rank = normals[0].rank as Rank;
  if (!normals.every((c) => c.rank === rank)) return null; // one rank only

  const usedSuits = normals.map((c) => c.suit as Suit);
  if (new Set(usedSuits).size !== usedSuits.length) return null; // no duplicate identical card
  const available = ALL_SUITS.filter((s) => !usedSuits.includes(s));
  if (jokers.length > available.length) return null; // no clear suit for the joker

  const jokerRepresents: Record<number, JokerRepresentation> = {};
  const orderedCards: FiftyOneCard[] = [];
  let jokerIdx = 0;
  for (const c of cards) {
    const slot = orderedCards.length;
    if (c.joker) {
      jokerRepresents[slot] = { suit: available[jokerIdx++], rank };
    }
    orderedCards.push(c);
  }
  const value = rankValue(rank) * cards.length;
  return { type: 'set', cards: orderedCards, jokerRepresents, value };
}

/**
 * Resolve `cards` as a meld — a run takes precedence over a set (a valid run is
 * never also a valid set for the same cards). Returns null if it is neither.
 */
export function resolveMeld(cards: FiftyOneCard[]): ResolvedMeld | null {
  return resolveRun(cards) ?? resolveSet(cards);
}

export function isValidMeld(cards: FiftyOneCard[]): boolean {
  return resolveMeld(cards) !== null;
}

/** Convenience: the point value of a set of cards read as a meld (0 if invalid). */
export function meldValue(cards: FiftyOneCard[]): number {
  return resolveMeld(cards)?.value ?? 0;
}

export { jokerCount };
