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
//   • In a run, a joker may sit at ANY position — the beginning, the middle, or
//     the end (§8, owner rule 30.9). The card it represents is fixed by its slot
//     in the run sequence, so `7♠ 8♠ [joker]` = 7-8-9, `[joker] 8♠ 9♠` = 7-8-9,
//     `Q♠ K♠ [joker]` = Q-K-A, `[joker] 2♠ 3♠` = A-2-3. Run resolution is a two
//     pass affair: first an ORDER-INDEPENDENT pass fills internal gaps only (so a
//     lay-off card extending either end always resolves regardless of input
//     order); if that fails, an INPUT-ORDER pass reads the cards left→low /
//     right→high so an end joker's direction is taken from where the player put
//     it (removing the old "internal gap only" ambiguity restriction).
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

/** Ace-LOW run position: A→1, then every other rank keeps its high position
 *  (2→2 … 10→10, J→11, Q→12, K→13). An Ace-low run therefore runs A(1)-2-3-… up to
 *  K(13) — so `A-2-3`, `A-2-3-4`, … are all valid (§6, owner rule 30.10). */
function runPositionLow(rank: Rank): number {
  return rank === 'A' ? 1 : runPositionHigh(rank);
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

/** The point value contributed by a run position (Ace = 1 only when aceLow, at the
 *  low end of an Ace-low run — so `A-2-3` = 6, `A-2-3-4` = 10, …). */
function positionValue(pos: number, aceLow: boolean): number {
  if (aceLow && pos === 1) return 1; // Ace low at the bottom of an Ace-low run
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

/**
 * Pass 1 — ORDER-INDEPENDENT. The run window is exactly the normals' [min, max];
 * jokers may only fill INTERNAL holes. This resolves every joker-free run and
 * every internal-joker run regardless of the input order, so a lay-off card that
 * extends either end always resolves (the reducer appends it, then re-resolves).
 * A joker that would sit at an END is NOT handled here — pass 2 does that.
 */
function resolveRunInternal(cards: FiftyOneCard[]): ResolvedMeld | null {
  if (cards.length < 3) return null;
  const jokers = cards.filter((c) => c.joker);
  const normals = cards.filter((c) => !c.joker);
  if (jokers.length > MAX_JOKERS_PER_MELD) return null;
  if (normals.length === 0) return null; // an all-joker meld is never clear

  const suit = normals[0].suit as Suit;
  if (!normals.every((c) => c.suit === suit)) return null; // runs are one suit

  // Try Ace-high first, then Ace-low (A at position 1: A-2-3, A-2-3-4, … up to K).
  for (const aceLow of [false, true]) {
    const positions = normals.map((c) => (aceLow ? runPositionLow(c.rank as Rank) : runPositionHigh(c.rank as Rank)));
    if (positions.some((p) => !Number.isFinite(p))) continue; // e.g. K under Ace-low
    if (new Set(positions).size !== positions.length) continue; // duplicate rank ⇒ not a run

    const min = Math.min(...positions);
    const max = Math.max(...positions);
    if (aceLow) {
      // Ace-low anchors A at position 1 and may extend UP to K(13): A-2-3, A-2-3-4, …
      // (30.10). The Ace is the low end, so min must be 1; K-A-2 fails the windowLen check.
      if (min < 1 || max > 13) continue;
    } else {
      if (min < 2 || max > 14) continue; // 2..A(14)
    }

    // The window is exactly [min, max]; jokers fill the internal holes only.
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

/**
 * Pass 2 — INPUT-ORDER. Reads the cards as the run sequence left→low / right→high,
 * so a joker at either END resolves to the card its slot implies (30.9 owner rule:
 * a joker may sit at any position). The run start is fixed by the first normal
 * card's index, then every normal card must sit at its slot and every position
 * must stay in range — genuinely-invalid arrangements (e.g. `K-A-2`) still fail.
 * Kept ordered because an end joker's direction is otherwise ambiguous; the
 * order-independent pass 1 already covers internal jokers and lay-offs.
 */
function resolveRunOrdered(cards: FiftyOneCard[]): ResolvedMeld | null {
  if (cards.length < 3) return null;
  const jokers = cards.filter((c) => c.joker);
  const normals = cards.filter((c) => !c.joker);
  if (jokers.length > MAX_JOKERS_PER_MELD) return null;
  if (normals.length === 0) return null;

  const suit = normals[0].suit as Suit;
  if (!normals.every((c) => c.suit === suit)) return null;

  for (const aceLow of [false, true]) {
    const pos = (r: Rank): number => (aceLow ? runPositionLow(r) : runPositionHigh(r));
    const firstNormalIdx = cards.findIndex((c) => !c.joker);
    const start = pos(cards[firstNormalIdx].rank as Rank) - firstNormalIdx;
    if (!Number.isFinite(start)) continue; // e.g. a K read Ace-low

    // Every card's position is its slot; each normal must actually sit there.
    let ok = true;
    for (let k = 0; k < cards.length; k++) {
      const card = cards[k];
      if (!card.joker && pos(card.rank as Rank) !== start + k) { ok = false; break; }
    }
    if (!ok) continue;

    const min = start;
    const max = start + cards.length - 1;
    if (aceLow) { if (min < 1 || max > 13) continue; } // Ace-low: A(1)-2-3-… up to K(13)
    else if (min < 2 || max > 14) continue;           // 2..A(14)

    const jokerRepresents: Record<number, JokerRepresentation> = {};
    let value = 0;
    for (let k = 0; k < cards.length; k++) {
      const p = start + k;
      value += positionValue(p, aceLow);
      if (cards[k].joker) jokerRepresents[k] = { suit, rank: rankAtPosition(p, aceLow) };
    }
    return { type: 'run', cards: cards.slice(), jokerRepresents, value };
  }
  return null;
}

/**
 * Try to interpret `cards` as a valid RUN; null if it is not one. Pass 1 is
 * order-independent (internal jokers / lay-offs); pass 2 falls back to the input
 * order so an END joker resolves by where the player placed it (30.9).
 */
export function resolveRun(cards: FiftyOneCard[]): ResolvedMeld | null {
  return resolveRunInternal(cards) ?? resolveRunOrdered(cards);
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
