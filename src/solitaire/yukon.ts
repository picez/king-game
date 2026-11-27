// Yukon (Юкон). Klondike-shaped tableau with no stock: pile 1 has one face-up
// card, piles 2–7 have 1…6 face-down cards under 5 face-up ones (52 in total).
// ANY face-up card moves together with everything on top of it — no run needed —
// onto a card one rank higher of the other colour; only a King (with its load)
// fills an empty pile. Foundations build up by suit.

import { buildDeck, isRed, shuffle } from './cards';
import { countCards, foundationAccepts, ids, isFoundation, isTableau, makePileEngine, top, type PileState } from './pileKit';

const T = ids('t', 7);
const F = ids('f', 4);

export function dealYukon(seed: number): PileState {
  const deck = shuffle(buildDeck(1), seed);
  const piles: PileState['piles'] = {};
  for (const f of F) piles[f] = [];
  let k = 0;
  T.forEach((t, i) => {
    const down = i;
    const n = i === 0 ? 1 : down + 5;
    piles[t] = deck.slice(k, k + n).map((c, j) => ({ ...c, up: j >= down }));
    k += n;
  });
  return { piles, passes: 0 };
}

export const yukon = makePileEngine({
  key: 'yukon',
  deal: dealYukon,
  sources: () => [...T, ...F],
  targets: () => [...T, ...F],
  canPick(s, from, n) {
    const p = s.piles[from];
    if (isFoundation(from)) return n === 1 && p.length > 0;
    return n <= p.length && p[p.length - n].up;
  },
  canDrop(s, cards, to) {
    const c = cards[0];
    if (isFoundation(to)) return cards.length === 1 && foundationAccepts(s.piles[to], c);
    const t = top(s.piles[to]);
    if (!t) return c.rank === 13;
    return t.up && t.rank === c.rank + 1 && isRed(t) !== isRed(c);
  },
  stock: () => null,
  won: (s) => countCards(s, 'f') === 52,
  canAutoFinish: (s) => Object.entries(s.piles).every(([id, p]) => !isTableau(id) || p.every((c) => c.up)),
});
