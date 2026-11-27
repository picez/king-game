// S1 — solitaire engines: deals, rules, invariants under random play, replay.
import { describe, expect, it } from 'vitest';
import { makeRng } from '../core/rng';
import type { SCard } from './cards';
import { VARIANT_KEYS, isStuck, replay, type Move, type PileMove, type VariantKey } from './engine';
import { engineFor } from './registry';
import type { PileState } from './pileKit';
import { makeKlondike } from './klondike';
import { makeSpider, removeRuns } from './spider';
import { freecell, freeCellCapacity } from './freecell';
import { yukon } from './yukon';
import { fortyThieves } from './fortyThieves';
import { pyramid, pyramidCovers, type PyramidState } from './pyramid';
import { triPeaks, triPeaksCovers, connects, type TriPeaksState } from './triPeaks';
import { dailySeed, isUtcDay, utcDay } from './daily';

/** Hearts has its own suite (hearts.test.ts): the pile/board invariants below do not apply. */
const PATIENCES = VARIANT_KEYS.filter((k) => k !== 'hearts');

const TOTAL: Record<Exclude<VariantKey, 'hearts'>, number> = {
  'klondike-1': 52, 'klondike-3': 52, 'spider-1': 104, 'spider-2': 104, 'spider-4': 104,
  freecell: 52, pyramid: 52, tripeaks: 52, yukon: 52, 'forty-thieves': 104,
};

/** Every card of a state, wherever it is. */
function allCards(s: unknown): SCard[] {
  const st = s as Partial<PileState & PyramidState & TriPeaksState>;
  if (st.piles) return Object.values(st.piles).flat();
  return [...(st.board ?? []).filter((c): c is SCard => c !== null), ...(st.stock ?? []), ...(st.waste ?? [])];
}
/** Cards removed from play in Pyramid / TriPeaks are not in the state; count them back. */
function conserved(key: Exclude<VariantKey, 'hearts'>, s0: unknown, s: unknown): boolean {
  const ids = allCards(s).map((c) => c.id);
  if (new Set(ids).size !== ids.length) return false;
  if (key === 'pyramid') return ids.length <= TOTAL[key];
  if (key === 'tripeaks') return ids.length === TOTAL[key];
  return ids.length === allCards(s0).length;
}

const c = (suit: SCard['suit'], rank: number, up = true, id = Math.floor(Math.random() * 1e9)): SCard => ({ id, suit, rank, up });

describe('deals', () => {
  it.each(PATIENCES)('%s: right card count, deterministic, seed-sensitive', (key) => {
    const e = engineFor(key);
    const a = e.deal(42);
    expect(allCards(a).length).toBe(TOTAL[key]);
    expect(new Set(allCards(a).map((x) => x.id)).size).toBe(TOTAL[key]);
    expect(e.deal(42)).toEqual(a);
    expect(e.deal(43)).not.toEqual(a);
    expect(e.won(a)).toBe(false);
  });

  it('Klondike: 1…7 cards, only the top face up, 24 in the stock', () => {
    const s = makeKlondike(1).deal(1);
    for (let i = 0; i < 7; i++) {
      expect(s.piles[`t${i}`].length).toBe(i + 1);
      expect(s.piles[`t${i}`].map((x) => x.up)).toEqual([...Array(i).fill(false), true]);
    }
    expect(s.piles.s.length).toBe(24);
  });

  it('Spider: 54 dealt (6×4 + 5×6), 50 in the stock; 1 suit uses only spades', () => {
    const s = makeSpider(1).deal(5);
    expect(Array.from({ length: 10 }, (_, i) => s.piles[`t${i}`].length)).toEqual([6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
    expect(s.piles.s.length).toBe(50);
    expect(new Set(allCards(s).map((x) => x.suit))).toEqual(new Set(['spades']));
    expect(new Set(allCards(makeSpider(2).deal(5)).map((x) => x.suit))).toEqual(new Set(['spades', 'hearts']));
  });

  it('FreeCell: 7,7,7,7,6,6,6,6 all face up', () => {
    const s = freecell.deal(9);
    expect(Array.from({ length: 8 }, (_, i) => s.piles[`t${i}`].length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
    expect(allCards(s).every((x) => x.up)).toBe(true);
  });

  it('Yukon: 1, then i face-down + 5 face-up', () => {
    const s = yukon.deal(3);
    expect(s.piles.t0.map((x) => x.up)).toEqual([true]);
    for (let i = 1; i < 7; i++) expect(s.piles[`t${i}`].filter((x) => !x.up).length).toBe(i);
    for (let i = 1; i < 7; i++) expect(s.piles[`t${i}`].filter((x) => x.up).length).toBe(5);
  });

  it('Forty Thieves: 10×4 face up, 64 in the stock', () => {
    const s = fortyThieves.deal(3);
    for (let i = 0; i < 10; i++) expect(s.piles[`t${i}`].length).toBe(4);
    expect(s.piles.s.length).toBe(64);
  });

  it('Pyramid / TriPeaks geometry', () => {
    expect(pyramidCovers(0)).toEqual([1, 2]);
    expect(pyramidCovers(27)).toEqual([]);
    expect(triPeaksCovers(0)).toEqual([3, 4]);
    expect(triPeaksCovers(2)).toEqual([7, 8]);
    expect(triPeaksCovers(4)).toEqual([10, 11]);
    expect(triPeaksCovers(5)).toEqual([12, 13]);
    expect(triPeaksCovers(17)).toEqual([26, 27]);
    const t = triPeaks.deal(2);
    expect(t.board.filter((x) => x?.up).length).toBe(10); // bottom row only
    expect(t.waste.length).toBe(1);
    expect(t.stock.length).toBe(23);
  });
});

describe('random play keeps every invariant and replays exactly', () => {
  it.each(PATIENCES)('%s over 40 seeds', (key) => {
    const e = engineFor(key);
    for (let seed = 1; seed <= 40; seed++) {
      const rng = makeRng(seed * 7919);
      const s0 = e.deal(seed);
      let s = s0;
      const moves: Move[] = [];
      for (let step = 0; step < 300 && !e.won(s); step++) {
        const legal = e.legal(s);
        if (legal.length === 0) { expect(isStuck(e, s)).toBe(true); break; }
        const m = legal[Math.floor(rng() * legal.length)];
        const frozen = JSON.stringify(s);
        const next = e.apply(s, m);
        expect(next, `${key} seed ${seed} step ${step} ${JSON.stringify(m)}`).not.toBeNull();
        expect(JSON.stringify(s)).toBe(frozen); // never mutates
        expect(conserved(key, s0, next)).toBe(true);
        s = next!;
        moves.push(m);
      }
      const r = replay(e, seed, moves);
      expect(r.ok && JSON.stringify(r.state)).toBe(JSON.stringify(s));
    }
  });

  it.each(PATIENCES)('%s: hints are always legal', (key) => {
    const e = engineFor(key);
    for (let seed = 1; seed <= 15; seed++) {
      let s = e.deal(seed);
      for (let step = 0; step < 200; step++) {
        const h = e.hint(s);
        if (!h) break;
        const next = e.apply(s, h);
        expect(next).not.toBeNull();
        s = next!;
      }
    }
  });

  it('replay rejects a forged move and names its index', () => {
    const e = engineFor('klondike-1');
    const r = replay(e, 1, [{ t: 'stock' }, { t: 'move', from: 't0', n: 5, to: 'f0' }]);
    expect(r).toEqual({ ok: false, at: 1 });
  });
});

describe('Klondike rules', () => {
  const k1 = makeKlondike(1);
  const k3 = makeKlondike(3);
  const empty = (): PileState => ({ passes: 0, piles: { s: [], w: [], f0: [], f1: [], f2: [], f3: [], t0: [], t1: [], t2: [], t3: [], t4: [], t5: [], t6: [] } });

  it('draws 1 or 3 and recycles the waste', () => {
    const s = k3.deal(1);
    const d = k3.apply(s, { t: 'stock' })!;
    expect(d.piles.w.length).toBe(3);
    expect(d.piles.s.length).toBe(21);
    let x = k1.deal(1);
    for (let i = 0; i < 24; i++) x = k1.apply(x, { t: 'stock' })!;
    expect(x.piles.s.length).toBe(0);
    const back = k1.apply(x, { t: 'stock' })!;
    expect(back.piles.s.length).toBe(24);
    expect(back.passes).toBe(1);
    expect(back.piles.s.every((q) => !q.up)).toBe(true);
  });

  it('alternating colours, King on empty, Ace on foundation, auto-flip', () => {
    const s = empty();
    s.piles.t0 = [c('clubs', 5, false, 1), c('hearts', 8, true, 2)];
    s.piles.t1 = [c('spades', 7, true, 3)];
    s.piles.t2 = [c('diamonds', 7, true, 4)];
    s.piles.t3 = [c('clubs', 13, true, 5)];
    s.piles.w = [c('hearts', 1, true, 6)];
    expect(k1.apply(s, { t: 'move', from: 't1', n: 1, to: 't0' })).not.toBeNull();
    expect(k1.apply(s, { t: 'move', from: 't2', n: 1, to: 't0' })).toBeNull(); // red on red
    expect(k1.apply(s, { t: 'move', from: 't1', n: 1, to: 't4' })).toBeNull(); // 7 on empty
    expect(k1.apply(s, { t: 'move', from: 't3', n: 1, to: 't4' })).not.toBeNull();
    expect(k1.apply(s, { t: 'move', from: 'w', n: 1, to: 'f0' })).not.toBeNull();
    const moved = k1.apply(s, { t: 'move', from: 't0', n: 1, to: 't3' });
    expect(moved).toBeNull(); // 8 on K
    const two = { ...s, piles: { ...s.piles, t5: [c('spades', 9, true, 7)] } };
    const after = k1.apply(two, { t: 'move', from: 't0', n: 1, to: 't5' })!;
    expect(after.piles.t0[0].up).toBe(true); // flipped
  });

  it('auto-finish plays everything once all is open', () => {
    const s = empty();
    const suits = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
    let id = 0;
    suits.forEach((suit, i) => {
      s.piles[`f${i}`] = Array.from({ length: 11 }, (_, r) => c(suit, r + 1, true, id++));
      s.piles[`t${i}`] = [c(suit, 13, true, id++), c(suit, 12, true, id++)].filter(() => true);
    });
    // Q on K of the same suit is not a legal tableau but is fine for the finish test.
    expect(k1.canAutoFinish(s)).toBe(true);
    let x = s;
    for (let i = 0; i < 8; i++) x = k1.apply(x, k1.finishStep(x)!)!;
    expect(k1.won(x)).toBe(true);
  });
});

describe('Spider rules', () => {
  const sp = makeSpider(4);
  const base = (): PileState => {
    const piles: PileState['piles'] = { s: [] };
    for (let i = 0; i < 8; i++) piles[`f${i}`] = [];
    for (let i = 0; i < 10; i++) piles[`t${i}`] = [c('clubs', 1, true, 900 + i)];
    return { piles, passes: 0 };
  };

  it('moves only same-suit runs, any card on one rank higher', () => {
    const s = base();
    s.piles.t0 = [c('hearts', 9, true, 1), c('spades', 8, true, 2), c('spades', 7, true, 3)];
    s.piles.t1 = [c('diamonds', 9, true, 4)];
    s.piles.t2 = [c('hearts', 8, true, 5), c('clubs', 7, true, 6)];
    expect(sp.apply(s, { t: 'move', from: 't0', n: 2, to: 't1' })).not.toBeNull();
    expect(sp.apply(s, { t: 'move', from: 't2', n: 2, to: 't1' })).toBeNull(); // mixed suits
    expect(sp.apply(s, { t: 'move', from: 't2', n: 1, to: 't0' })).toBeNull(); // 7 on 7
  });

  it('cannot deal with an empty pile; a full run leaves the table', () => {
    const s = base();
    s.piles.s = Array.from({ length: 10 }, (_, i) => c('clubs', 2, false, 500 + i));
    s.piles.t9 = [];
    expect(sp.apply(s, { t: 'stock' })).toBeNull();
    const run = Array.from({ length: 13 }, (_, i) => c('spades', 13 - i, true, 100 + i));
    const r = removeRuns({ ...s, piles: { ...s.piles, t3: [c('hearts', 5, false, 99), ...run] } });
    expect(r.piles.f0.length).toBe(13);
    expect(r.piles.t3.length).toBe(1);
    expect(r.piles.t3[0].up).toBe(true);
  });
});

describe('FreeCell rules', () => {
  const s0 = (): PileState => {
    const piles: PileState['piles'] = {};
    for (const p of ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 'f0', 'f1', 'f2', 'f3', 'c0', 'c1', 'c2', 'c3']) piles[p] = [];
    return { piles, passes: 0 };
  };

  it('capacity = (cells+1) × 2^(empty columns), the target column excluded', () => {
    const s = s0();
    for (let i = 0; i < 8; i++) s.piles[`t${i}`] = [c('clubs', 13, true, i)];
    expect(freeCellCapacity(s, 't0')).toBe(5);
    s.piles.t7 = [];
    expect(freeCellCapacity(s, 't0')).toBe(10);
    expect(freeCellCapacity(s, 't7')).toBe(5);
    s.piles.c0 = [c('hearts', 1, true, 50)];
    expect(freeCellCapacity(s, 't0')).toBe(8);
  });

  it('one card per cell; a 6-run cannot move with only 4 free cells and no empty column', () => {
    const s = s0();
    s.piles.t0 = [c('spades', 9, true, 1)];
    s.piles.t1 = [8, 7, 6, 5, 4, 3].map((r, i) => c(i % 2 ? 'clubs' : 'hearts', r, true, 10 + i));
    for (let i = 2; i < 8; i++) s.piles[`t${i}`] = [c('diamonds', 13, true, 30 + i)];
    expect(freecell.apply(s, { t: 'move', from: 't1', n: 6, to: 't0' })).toBeNull();
    expect(freecell.apply(s, { t: 'move', from: 't1', n: 5, to: 't0' })).toBeNull(); // 7 is not a run start onto 9
    s.piles.c0 = [c('hearts', 2, true, 60)];
    expect(freecell.apply(s, { t: 'move', from: 't1', n: 1, to: 'c0' })).toBeNull(); // cell taken
  });
});

describe('Yukon & Forty Thieves rules', () => {
  it('Yukon moves any face-up card with its load', () => {
    const s = yukon.deal(11);
    const legalBig = yukon.legal(s).filter((m): m is Extract<PileMove, { t: 'move' }> => m.t === 'move' && m.n > 1);
    expect(legalBig.length).toBeGreaterThan(0);
    for (const m of legalBig) expect(yukon.apply(s, m)).not.toBeNull();
  });
  it('Forty Thieves builds by suit, one card at a time', () => {
    const s = fortyThieves.deal(4);
    for (const m of fortyThieves.legal(s)) if (m.t === 'move') expect(m.n).toBe(1);
    const t = { ...s, piles: { ...s.piles, t0: [c('hearts', 9, true, 1)], t1: [c('diamonds', 8, true, 2)], t2: [c('hearts', 8, true, 3)] } };
    expect(fortyThieves.apply(t, { t: 'move', from: 't1', n: 1, to: 't0' })).toBeNull();
    expect(fortyThieves.apply(t, { t: 'move', from: 't2', n: 1, to: 't0' })).not.toBeNull();
  });
});

describe('Pyramid & TriPeaks rules', () => {
  it('Pyramid removes a King or a 13-pair of exposed cards, three passes', () => {
    const s = pyramid.deal(7);
    for (const m of pyramid.legal(s)) {
      if (m.t !== 'remove') continue;
      const ranks = m.ids.map((id) => allCards(s).find((x) => x.id === id)!.rank);
      expect(ranks.reduce((a, b) => a + b, 0)).toBe(13);
    }
    // A covered card can never be played.
    expect(pyramid.apply(s, { t: 'remove', ids: [s.board[0]!.id] })).toBeNull();
    let x = s;
    let passes = 0;
    for (let i = 0; i < 200; i++) {
      const n = pyramid.apply(x, { t: 'stock' });
      if (!n) break;
      if (n.passes > x.passes) passes++;
      x = n;
    }
    expect(passes).toBe(2);
  });

  it('TriPeaks: ±1 with K–A wrap, reveals covered cards', () => {
    expect(connects(13, 1)).toBe(true);
    expect(connects(5, 7)).toBe(false);
    let s = triPeaks.deal(3);
    for (let i = 0; i < 60; i++) {
      const h = triPeaks.hint(s);
      if (!h) break;
      s = triPeaks.apply(s, h)!;
    }
    s.board.forEach((card, i) => {
      if (card && triPeaksCovers(i).every((j) => s.board[j] === null)) expect(card.up).toBe(true);
    });
  });
});

describe('greedy hint play actually wins some deals', () => {
  it.each(['klondike-1', 'freecell', 'tripeaks', 'pyramid', 'spider-1'] as VariantKey[])('%s', (key) => {
    const e = engineFor(key);
    let wins = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let s = e.deal(seed);
      const seen = new Set<string>();
      for (let step = 0; step < 1500 && !e.won(s); step++) {
        if (e.canAutoFinish(s)) { while (!e.won(s)) s = e.apply(s, e.finishStep(s)!)!; break; }
        const h = e.hint(s);
        if (!h) break;
        const next = e.apply(s, h)!;
        const k = JSON.stringify(next);
        if (seen.has(k)) break; // loop guard (stock cycling)
        seen.add(k);
        s = next;
      }
      if (e.won(s)) wins++;
    }
    expect(wins).toBeGreaterThan(0);
  });
});

describe('deal of the day', () => {
  it('same seed for everyone on a day, different per variant and day', () => {
    expect(dailySeed('klondike-1', '2026-11-27')).toBe(dailySeed('klondike-1', '2026-11-27'));
    expect(dailySeed('klondike-1', '2026-11-27')).not.toBe(dailySeed('klondike-3', '2026-11-27'));
    expect(dailySeed('klondike-1', '2026-11-27')).not.toBe(dailySeed('klondike-1', '2026-11-28'));
    expect(utcDay(new Date('2026-11-27T23:59:59Z'))).toBe('2026-11-27');
    expect(isUtcDay('2026-11-27')).toBe(true);
    expect(isUtcDay('2026-13-40')).toBe(false);
  });
});
