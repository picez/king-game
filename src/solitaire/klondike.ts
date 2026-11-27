// Klondike (Косинка), draw 1 or draw 3, unlimited redeals.
// 7 tableau piles (1…7 cards, top face up), the rest in the stock. Tableau builds
// down in alternating colours, a King (or a run from one) fills an empty pile;
// foundations build up by suit from the Ace.

import { buildDeck, isRed, shuffle } from './cards';
import { countCards, foundationAccepts, ids, isFoundation, isTableau, makePileEngine, top, type PileState } from './pileKit';

const T = ids('t', 7);
const F = ids('f', 4);

export function dealKlondike(seed: number): PileState {
  const deck = shuffle(buildDeck(1), seed);
  const piles: PileState['piles'] = { s: [], w: [] };
  for (const f of F) piles[f] = [];
  let k = 0;
  T.forEach((t, i) => {
    piles[t] = deck.slice(k, k + i + 1).map((c, j) => ({ ...c, up: j === i }));
    k += i + 1;
  });
  piles.s = deck.slice(k);
  return { piles, passes: 0 };
}

/** Alternating-colour descending run of face-up cards. */
export function isAltRun(cards: readonly { up: boolean; rank: number; suit: string }[]): boolean {
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i].up) return false;
    if (i > 0) {
      const a = cards[i - 1];
      const b = cards[i];
      if (b.rank !== a.rank - 1 || isRed(a as never) === isRed(b as never)) return false;
    }
  }
  return true;
}

export function makeKlondike(draw: 1 | 3) {
  return makePileEngine({
    key: draw === 1 ? 'klondike-1' : 'klondike-3',
    deal: dealKlondike,
    sources: () => ['w', ...T, ...F],
    targets: () => [...T, ...F],
    canPick(s, from, n) {
      const p = s.piles[from];
      if (from === 'w' || isFoundation(from)) return n === 1 && p.length > 0;
      return isAltRun(p.slice(p.length - n));
    },
    canDrop(s, cards, to) {
      const c = cards[0];
      if (isFoundation(to)) return cards.length === 1 && foundationAccepts(s.piles[to], c);
      const t = top(s.piles[to]);
      if (!t) return c.rank === 13;
      return t.up && t.rank === c.rank + 1 && isRed(t) !== isRed(c);
    },
    stock(s) {
      const stock = s.piles.s;
      const waste = s.piles.w;
      if (stock.length === 0) {
        if (waste.length === 0) return null;
        // Recycle: the waste turns over back into the stock.
        return { ...s, passes: s.passes + 1, piles: { ...s.piles, w: [], s: [...waste].reverse().map((c) => ({ ...c, up: false })) } };
      }
      const k = Math.min(draw, stock.length);
      const drawn = stock.slice(stock.length - k).reverse().map((c) => ({ ...c, up: true }));
      return { ...s, piles: { ...s.piles, s: stock.slice(0, stock.length - k), w: [...waste, ...drawn] } };
    },
    won: (s) => countCards(s, 'f') === 52,
    canAutoFinish: (s) => s.piles.s.length === 0 && s.piles.w.length === 0
      && Object.entries(s.piles).every(([id, p]) => !isTableau(id) || p.every((c) => c.up)),
  });
}
