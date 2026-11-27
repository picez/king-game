// Spider (Павук), 1 / 2 / 4 suits, two decks (104 cards).
// 10 tableau piles: 6,6,6,6,5,5,5,5,5,5 (54), top face up; the stock (50) deals
// one card onto every pile — only when no pile is empty. Any card goes on a card
// one rank higher; only a same-suit descending run moves together; anything goes
// into an empty pile. A full King→Ace run of one suit leaves for a foundation.

import type { Suit } from '../models/types';
import { buildDeck, shuffle, type SCard } from './cards';
import { countCards, flipTops, ids, makePileEngine, top, type PileState } from './pileKit';

const T = ids('t', 10);
const F = ids('f', 8);

const SUIT_SETS: Record<1 | 2 | 4, Suit[]> = {
  1: ['spades'],
  2: ['spades', 'hearts'],
  4: ['spades', 'hearts', 'diamonds', 'clubs'],
};

export function dealSpider(suits: 1 | 2 | 4, seed: number): PileState {
  const deck = shuffle(buildDeck(2, SUIT_SETS[suits]), seed);
  const piles: PileState['piles'] = { s: [] };
  for (const f of F) piles[f] = [];
  let k = 0;
  T.forEach((t, i) => {
    const n = i < 4 ? 6 : 5;
    piles[t] = deck.slice(k, k + n).map((c, j) => ({ ...c, up: j === n - 1 }));
    k += n;
  });
  piles.s = deck.slice(k);
  return { piles, passes: 0 };
}

/** Same-suit descending run of face-up cards. */
export function isSuitRun(cards: readonly SCard[]): boolean {
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i].up) return false;
    if (i > 0 && (cards[i].suit !== cards[i - 1].suit || cards[i].rank !== cards[i - 1].rank - 1)) return false;
  }
  return true;
}

/** Moves every complete K→A same-suit run to the next empty foundation. */
export function removeRuns(s: PileState): PileState {
  let next = s;
  for (const t of T) {
    const p = next.piles[t];
    if (p.length < 13) continue;
    const run = p.slice(p.length - 13);
    if (run[0].rank !== 13 || !isSuitRun(run)) continue;
    const f = F.find((id) => next.piles[id].length === 0);
    if (!f) continue;
    next = { ...next, piles: { ...next.piles, [t]: p.slice(0, p.length - 13), [f]: run } };
  }
  return next === s ? s : flipTops(next);
}

export function makeSpider(suits: 1 | 2 | 4) {
  return makePileEngine({
    key: `spider-${suits}` as 'spider-1' | 'spider-2' | 'spider-4',
    deal: (seed) => dealSpider(suits, seed),
    sources: () => T,
    targets: () => T,
    canPick(s, from, n) {
      const p = s.piles[from];
      return isSuitRun(p.slice(p.length - n));
    },
    canDrop(s, cards, to) {
      const t = top(s.piles[to]);
      return !t || (t.up && t.rank === cards[0].rank + 1);
    },
    stock(s) {
      const stock = s.piles.s;
      if (stock.length === 0) return null;
      if (T.some((t) => s.piles[t].length === 0)) return null;
      const piles = { ...s.piles };
      const deal = stock.slice(stock.length - T.length);
      T.forEach((t, i) => { piles[t] = [...piles[t], { ...deal[i], up: true }]; });
      piles.s = stock.slice(0, stock.length - T.length);
      return { ...s, piles, passes: s.passes + 1 };
    },
    after: removeRuns,
    won: (s) => countCards(s, 'f') === 104,
    // No foundation step-by-step in Spider: finishing = the runs are already gone.
    canAutoFinish: () => false,
  });
}

