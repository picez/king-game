// ---------------------------------------------------------------------------
// Poker — hand evaluator. Pure, deterministic, suit-blind for ties (§9). Finds
// the best 5-card poker hand from up to 7 cards and produces a fully-ordered,
// comparable score so any two hands compare correctly (equal only when every
// tie-break rank matches). Ace is high, except in the A-2-3-4-5 "wheel" straight.
// See POKER_RULES.md §9.
// ---------------------------------------------------------------------------

import type { Rank } from '../../models/types';
import type { HandCategory, PokerCard } from './types';

/** Numeric rank (2..14, Ace high). The wheel treats the Ace as 1 separately. */
export function rankValue(rank: Rank): number {
  switch (rank) {
    case 'A': return 14;
    case 'K': return 13;
    case 'Q': return 12;
    case 'J': return 11;
    case '10': return 10;
    default: return Number(rank); // '2'..'9'
  }
}

/** Category → its base weight (higher = stronger). Royal is a labelled straight flush. */
const CATEGORY_WEIGHT: Record<HandCategory, number> = {
  high_card: 0,
  one_pair: 1,
  two_pair: 2,
  three_of_a_kind: 3,
  straight: 4,
  flush: 5,
  full_house: 6,
  four_of_a_kind: 7,
  straight_flush: 8,
  royal_flush: 9,
};

export interface HandScore {
  category: HandCategory;
  /** Fully-ordered comparison key: [categoryWeight, ...tie-break ranks]. */
  key: number[];
}

/** Compare two hand scores. >0 → a wins, <0 → b wins, 0 → exact tie (split). */
export function compareHands(a: HandScore, b: HandScore): number {
  const n = Math.max(a.key.length, b.key.length);
  for (let i = 0; i < n; i++) {
    const av = a.key[i] ?? 0;
    const bv = b.key[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/**
 * Score exactly 5 cards. Returns the category and an ordered tie-break key. The
 * key always starts with the category weight, then the discriminating ranks in
 * priority order (e.g. two pair → [weight, highPair, lowPair, kicker]).
 */
export function scoreFive(cards: PokerCard[]): HandScore {
  const values = cards
    .map((c) => rankValue(c.rank as Rank))
    .sort((x, y) => y - x); // desc
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  // Straight detection (supports the wheel A-2-3-4-5). `straightHigh` is the top
  // card of the straight (5 for the wheel), or 0 if not a straight.
  const distinct = Array.from(new Set(values)).sort((x, y) => y - x);
  let straightHigh = 0;
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) straightHigh = distinct[0];
    // Wheel: A,5,4,3,2 → treat the ace as low, high card = 5.
    else if (distinct[0] === 14 && distinct[1] === 5 && distinct[4] === 2) straightHigh = 5;
  }

  // Rank multiplicities, sorted by (count desc, rank desc).
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
  const shape = groups.map((g) => g[1]).join(''); // e.g. '32', '221', '2111'
  const byGroup = groups.map((g) => g[0]);        // ranks in group-priority order

  const make = (category: HandCategory, ...tie: number[]): HandScore => ({
    category,
    key: [CATEGORY_WEIGHT[category], ...tie],
  });

  if (isFlush && straightHigh) {
    return straightHigh === 14
      ? make('royal_flush', straightHigh)
      : make('straight_flush', straightHigh);
  }
  if (shape === '41') return make('four_of_a_kind', byGroup[0], byGroup[1]);
  if (shape === '32') return make('full_house', byGroup[0], byGroup[1]);
  if (isFlush) return make('flush', ...values);
  if (straightHigh) return make('straight', straightHigh);
  if (shape === '311') return make('three_of_a_kind', byGroup[0], byGroup[1], byGroup[2]);
  if (shape === '221') return make('two_pair', byGroup[0], byGroup[1], byGroup[2]);
  if (shape === '2111') return make('one_pair', byGroup[0], byGroup[1], byGroup[2], byGroup[3]);
  return make('high_card', ...values);
}

/** All k-combinations of the array indices [0..n). */
function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const n = items.length;
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k > n) return out;
  while (true) {
    out.push(idx.map((i) => items[i]));
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}

/**
 * The best 5-card hand from up to 7 cards (2 hole + up to 5 board). Evaluates all
 * C(n,5) 5-card subsets and returns the maximum. Deterministic. Requires ≥5 cards.
 */
export function bestHand(cards: PokerCard[]): HandScore {
  if (cards.length < 5) throw new Error('bestHand needs at least 5 cards');
  if (cards.length === 5) return scoreFive(cards);
  let best: HandScore | null = null;
  for (const combo of combinations(cards, 5)) {
    const s = scoreFive(combo);
    if (best === null || compareHands(s, best) > 0) best = s;
  }
  return best!;
}

/** Convenience: best hand from a seat's hole cards + the community board. */
export function evaluateSeat(hole: PokerCard[], board: PokerCard[]): HandScore {
  return bestHand([...hole, ...board]);
}
