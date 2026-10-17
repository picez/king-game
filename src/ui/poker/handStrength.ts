// ---------------------------------------------------------------------------
// Poker table helpers for the viewer's own seat (Stage 41.1). Pure + unit-tested.
//
// `myHandCategory` names what the viewer's hole cards make RIGHT NOW with the public
// board — the same evaluator the engine scores showdowns with, so the label can never
// disagree with the result. It only ever reads the viewer's own (unredacted) cards, so
// it reveals nothing the viewer cannot already see.
// ---------------------------------------------------------------------------

import { bestHand } from '../../games/poker/handEval';
import type { HandCategory, PokerCard } from '../../games/poker/types';

/** i18n key of each hand category (shared by the seat label and the showdown review). */
export const CATEGORY_KEY: Record<HandCategory, string> = {
  high_card: 'poker.cat.highCard', one_pair: 'poker.cat.onePair', two_pair: 'poker.cat.twoPair',
  three_of_a_kind: 'poker.cat.trips', straight: 'poker.cat.straight', flush: 'poker.cat.flush',
  full_house: 'poker.cat.fullHouse', four_of_a_kind: 'poker.cat.quads',
  straight_flush: 'poker.cat.straightFlush', royal_flush: 'poker.cat.royalFlush',
};

const isFace = (c: PokerCard) => c.suit != null && c.rank != null;

/**
 * The category the viewer currently holds, or null when there is nothing to name
 * (no hole cards, or they are face-down backs). Preflop only a pocket pair or a high
 * card is possible; from the flop on the best five of hole + board decides.
 */
export function myHandCategory(hole: PokerCard[], board: PokerCard[]): HandCategory | null {
  if (hole.length !== 2 || !hole.every(isFace)) return null;
  const visibleBoard = board.filter(isFace);
  if (visibleBoard.length < 3) return hole[0].rank === hole[1].rank ? 'one_pair' : 'high_card';
  return bestHand([...hole, ...visibleBoard]).category;
}

/**
 * A chip amount short enough for a seat plate: exact below 10,000, then 12.5K / 250K /
 * 1.2M. The pot and the bet controls keep exact numbers; only the plates abbreviate.
 */
export function compactChips(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, unit: string) => `${Number(v.toFixed(v < 100 ? 1 : 0))}${unit}`;
  if (abs < 10_000) return String(n);
  if (abs < 1_000_000) return fmt(n / 1000, 'K');
  return fmt(n / 1_000_000, 'M');
}
