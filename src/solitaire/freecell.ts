// FreeCell. All 52 cards face up in 8 columns (7,7,7,7,6,6,6,6); 4 free cells
// hold one card each; foundations build up by suit. Tableau builds down in
// alternating colours; any card fills an empty column. A run moves as a unit when
// there is room to shuffle it through the free cells and empty columns:
// (free cells + 1) × 2^(empty columns), counting the target column only if it
// is not itself the empty one.

import { buildDeck, isRed, shuffle } from './cards';
import { isAltRun } from './klondike';
import { countCards, foundationAccepts, ids, isCell, isFoundation, makePileEngine, top, type PileState } from './pileKit';

const T = ids('t', 8);
const F = ids('f', 4);
const C = ids('c', 4);

export function dealFreeCell(seed: number): PileState {
  const deck = shuffle(buildDeck(1), seed).map((c) => ({ ...c, up: true }));
  const piles: PileState['piles'] = {};
  for (const id of [...T, ...F, ...C]) piles[id] = [];
  deck.forEach((c, i) => { piles[T[i % 8]].push(c); });
  return { piles, passes: 0 };
}

export function freeCellCapacity(s: PileState, to: string): number {
  const cells = C.filter((c) => s.piles[c].length === 0).length;
  const empty = T.filter((t) => t !== to && s.piles[t].length === 0).length;
  return (cells + 1) * 2 ** empty;
}

export const freecell = makePileEngine({
  key: 'freecell',
  deal: dealFreeCell,
  sources: () => [...T, ...C, ...F],
  targets: () => [...T, ...C, ...F],
  canPick(s, from, n) {
    const p = s.piles[from];
    if (isCell(from) || isFoundation(from)) return n === 1 && p.length > 0;
    return isAltRun(p.slice(p.length - n));
  },
  maxMove: (s, to) => (isCell(to) || isFoundation(to) ? 1 : freeCellCapacity(s, to)),
  canDrop(s, cards, to) {
    const c = cards[0];
    if (isFoundation(to)) return cards.length === 1 && foundationAccepts(s.piles[to], c);
    if (isCell(to)) return cards.length === 1 && s.piles[to].length === 0;
    const t = top(s.piles[to]);
    return !t || (t.rank === c.rank + 1 && isRed(t) !== isRed(c));
  },
  stock: () => null,
  won: (s) => countCards(s, 'f') === 52,
  // Every column already in order (descending alternating runs) → nothing can block.
  canAutoFinish: (s) => T.every((t) => isAltRun(s.piles[t])),
});
