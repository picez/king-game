// Forty Thieves (Сорок розбійників). Two decks; 10 tableau piles of 4 face-up
// cards (40); the stock (64) turns one card at a time onto the waste, no
// redeal. Tableau builds down BY SUIT, one card at a time; any card fills an
// empty pile. 8 foundations build up by suit from the Ace.

import { buildDeck, shuffle } from './cards';
import { countCards, foundationAccepts, ids, isFoundation, makePileEngine, top, type PileState } from './pileKit';

const T = ids('t', 10);
const F = ids('f', 8);

export function dealFortyThieves(seed: number): PileState {
  const deck = shuffle(buildDeck(2), seed);
  const piles: PileState['piles'] = { s: [], w: [] };
  for (const f of F) piles[f] = [];
  T.forEach((t, i) => { piles[t] = deck.slice(i * 4, i * 4 + 4).map((c) => ({ ...c, up: true })); });
  piles.s = deck.slice(40);
  return { piles, passes: 0 };
}

export const fortyThieves = makePileEngine({
  key: 'forty-thieves',
  deal: dealFortyThieves,
  sources: () => ['w', ...T],
  targets: () => [...T, ...F],
  canPick: (s, from, n) => n === 1 && s.piles[from].length > 0,
  canDrop(s, cards, to) {
    const c = cards[0];
    if (isFoundation(to)) return foundationAccepts(s.piles[to], c);
    const t = top(s.piles[to]);
    return !t || (t.suit === c.suit && t.rank === c.rank + 1);
  },
  stock(s) {
    const stock = s.piles.s;
    if (stock.length === 0) return null;
    const c = { ...stock[stock.length - 1], up: true };
    return { ...s, piles: { ...s.piles, s: stock.slice(0, -1), w: [...s.piles.w, c] } };
  },
  won: (s) => countCards(s, 'f') === 104,
  canAutoFinish: (s) => s.piles.s.length === 0 && s.piles.w.length === 0,
});
