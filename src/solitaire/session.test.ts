// S2 — session (undo/restart/save), local stats, tap-to-play.
import { describe, expect, it } from 'vitest';
import { autoFinish, current, fromSaved, hint, newSession, play, restart, tick, toSaved, undo } from './session';
import { emptyStats, parseStats, recordResult, totals, variantStats } from './stats';
import { DROP_TRICK, DROP_WASTE, autoMove, bestMove, dropCard, dropMove, tap, tapPile, tapPyramid } from './tap';
import { engineFor } from './registry';
import type { PileState } from './pileKit';
import type { PyramidState } from './pyramid';
import type { SCard } from './cards';
import { SOLITAIRES, infoOfVariant, variantLabelKeys } from './catalog';
import { VARIANT_KEYS, SOLITAIRE_IDS } from './engine';

const c = (suit: SCard['suit'], rank: number, id: number, up = true): SCard => ({ id, suit, rank, up });

describe('session', () => {
  it('plays, undoes, restarts and ignores illegal moves', () => {
    let s = newSession('klondike-1', 5);
    const illegal = play(s, { t: 'move', from: 't0', n: 9, to: 'f0' });
    expect(illegal).toBe(s);
    s = play(s, { t: 'stock' });
    s = play(s, { t: 'stock' });
    expect(s.moves.length).toBe(2);
    s = undo(s);
    expect(s.moves.length).toBe(1);
    expect(s.undos).toBe(1);
    expect(current(s)).toEqual(engineFor('klondike-1').apply(s.states[0], { t: 'stock' }));
    s = restart(s);
    expect(s.moves.length).toBe(0);
    expect(s.undos).toBe(2);
  });

  it('the clock only runs once the game has started', () => {
    let s = newSession('freecell', 1);
    expect(tick(s, 1000).elapsedMs).toBe(0);
    const h = hint(s);
    s = play(h.session, h.move!);
    expect(s.hints).toBe(1);
    expect(tick(s, 1000).elapsedMs).toBe(1000);
  });

  it('round-trips through storage and rejects a corrupt save', () => {
    let s = newSession('spider-1', 77, '2026-11-27');
    for (let i = 0; i < 10; i++) { const h = hint(s); if (!h.move) break; s = play(h.session, h.move); }
    s = tick(s, 4321);
    const back = fromSaved(JSON.parse(JSON.stringify(toSaved(s))));
    expect(back && current(back)).toEqual(current(s));
    expect(back?.elapsedMs).toBe(4321);
    expect(back?.daily).toBe('2026-11-27');
    expect(fromSaved({ ...toSaved(s), moves: [{ t: 'move', from: 'x', n: 1, to: 'y' }] })).toBeNull();
    expect(fromSaved({ v: 2 })).toBeNull();
  });

  it('auto-finish wins and marks the session finished', () => {
    const base = newSession('klondike-1', 1);
    const st = current(base) as PileState;
    const piles: PileState['piles'] = { s: [], w: [] };
    const suits = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
    let id = 0;
    for (let i = 0; i < 7; i++) piles[`t${i}`] = [];
    suits.forEach((suit, i) => {
      piles[`f${i}`] = Array.from({ length: 12 }, (_, r) => c(suit, r + 1, id++));
      piles[`t${i}`] = [c(suit, 13, id++)];
    });
    const s = { ...base, states: [{ ...st, piles }] };
    const done = autoFinish(s);
    expect(done.finished).toBe('won');
    expect(done.moves.length).toBe(4);
    expect(play(done, { t: 'stock' })).toBe(done); // nothing after the win
  });
});

describe('local stats', () => {
  it('counts wins, streaks, bests, clean and daily wins', () => {
    let st = emptyStats();
    const r = { key: 'klondike-3' as const, ms: 90_000, moves: 120, undos: 0, hints: 0, daily: null };
    st = recordResult(st, { ...r, won: true });
    st = recordResult(st, { ...r, won: true, ms: 80_000, moves: 140, undos: 2, daily: '2026-11-27' });
    st = recordResult(st, { ...r, won: false });
    const v = variantStats(st, 'klondike-3');
    expect(v).toMatchObject({ played: 3, won: 2, streak: 0, bestStreak: 2, bestMs: 80_000, bestMoves: 120, cleanWins: 1, noHintWins: 2, dailyWins: 1 });
    expect(st.daily['klondike-3']).toEqual({ day: '2026-11-27', won: true, ms: 80_000, moves: 140 });
    expect(totals(st)).toEqual({ played: 3, won: 2, variantsWon: 1, bestStreak: 2 });
    expect(parseStats(JSON.parse(JSON.stringify(st)))).toEqual(st);
    expect(parseStats({ v: 9 })).toEqual(emptyStats());
  });
});

describe('tap-to-play', () => {
  const e = engineFor('klondike-1') as never;
  const base = (): PileState => ({ passes: 0, piles: { s: [], w: [], f0: [], f1: [], f2: [], f3: [], t0: [], t1: [], t2: [], t3: [], t4: [], t5: [], t6: [] } });

  it('sends an Ace to the foundation in one tap', () => {
    const s = base();
    s.piles.t0 = [c('hearts', 1, 1)];
    expect(tapPile(e, s, null, { kind: 'pile', pile: 't0', index: 0 }).move).toEqual({ t: 'move', from: 't0', n: 1, to: 'f0' });
  });

  it('prefers a card over an empty pile; asks when two cards fit', () => {
    const s = base();
    s.piles.t0 = [c('hearts', 12, 1)];
    s.piles.t1 = [c('spades', 13, 2)];
    s.piles.t2 = [c('clubs', 13, 3)];
    const r = tapPile(e, s, null, { kind: 'pile', pile: 't0', index: 0 });
    expect(r.move).toBeNull();
    expect(r.selection).toEqual({ kind: 'pile', pile: 't0', n: 1 });
    const drop = tapPile(e, s, r.selection, { kind: 'pile', pile: 't2', index: 0 });
    expect(drop.move).toEqual({ t: 'move', from: 't0', n: 1, to: 't2' });
    s.piles.t2 = [];
    expect(tapPile(e, s, null, { kind: 'pile', pile: 't0', index: 0 }).move).toEqual({ t: 'move', from: 't0', n: 1, to: 't1' });
  });

  it('a face-down card does nothing; the stock draws', () => {
    const s = base();
    s.piles.t0 = [c('hearts', 5, 1, false), c('spades', 9, 2)];
    s.piles.s = [c('clubs', 2, 3, false)];
    expect(tapPile(e, s, null, { kind: 'pile', pile: 't0', index: 0 })).toEqual({ move: null, selection: null });
    expect(tapPile(e, s, null, { kind: 'stock' }).move).toEqual({ t: 'stock' });
  });

  it('bestMove orders foundation, card, empty pile, cell', () => {
    const s = base();
    s.piles.t1 = [c('spades', 3, 9)];
    const m = (to: string) => ({ t: 'move' as const, from: 't0', n: 1, to });
    expect(bestMove(s, [m('t2'), m('t1'), m('f0')])!.to).toBe('f0');
    expect(bestMove(s, [m('t2'), m('t1')])!.to).toBe('t1');
  });

  it('Pyramid: a King goes in one tap, a pair in two', () => {
    const board: (SCard | null)[] = Array(28).fill(null);
    board[27] = c('spades', 13, 1);
    board[26] = c('hearts', 6, 2);
    board[25] = c('clubs', 7, 3);
    const s: PyramidState = { board, stock: [], waste: [], passes: 0 };
    const pe = engineFor('pyramid') as never;
    expect(tapPyramid(pe, s, null, { kind: 'card', id: 1 }).move).toEqual({ t: 'remove', ids: [1] });
    const first = tapPyramid(pe, s, null, { kind: 'card', id: 2 });
    expect(first.selection).toEqual({ kind: 'card', id: 2 });
    expect(tapPyramid(pe, s, first.selection, { kind: 'card', id: 3 }).move).toEqual({ t: 'remove', ids: [3, 2] });
  });

  it('every variant answers a stock tap without throwing', () => {
    for (const k of VARIANT_KEYS) {
      const id = infoOfVariant(k).id;
      const s = engineFor(k).deal(3);
      expect(() => tap(id, engineFor(k), s, null, { kind: 'stock' })).not.toThrow();
    }
  });
});

describe('catalog', () => {
  it('lists every solitaire and every variant exactly once', () => {
    expect(SOLITAIRES.map((s) => s.id).sort()).toEqual([...SOLITAIRE_IDS].sort());
    expect(SOLITAIRES.flatMap((s) => s.variants.map((v) => v.key)).sort()).toEqual([...VARIANT_KEYS].sort());
    expect(variantLabelKeys('spider-2')).toEqual({ title: 'sol.spider.title', variant: 'sol.spider.suits2' });
  });
});

describe('drag & drop / double tap', () => {
  const e = engineFor('klondike-1') as never;
  const base = (): PileState => ({ passes: 0, piles: { s: [], w: [], f0: [], f1: [], f2: [], f3: [], t0: [], t1: [], t2: [], t3: [], t4: [], t5: [], t6: [] } });

  it('drops a run on the pile it lands on; an illegal drop or its own pile snaps back', () => {
    const s = base();
    s.piles.t0 = [c('hearts', 12, 1)];
    s.piles.t1 = [c('spades', 13, 2)];
    s.piles.t2 = [c('clubs', 13, 3)];
    s.piles.t3 = [c('diamonds', 4, 4)];
    const from = { kind: 'pile' as const, pile: 't0', n: 1 };
    expect(dropMove('klondike', e, s, from, 't2')).toEqual({ t: 'move', from: 't0', n: 1, to: 't2' });
    expect(dropMove('klondike', e, s, from, 't1')).toEqual({ t: 'move', from: 't0', n: 1, to: 't1' });
    expect(dropMove('klondike', e, s, from, 't3')).toBeNull();
    expect(dropMove('klondike', e, s, from, 't0')).toBeNull();
    expect(dropMove('klondike', e, s, from, null)).toBeNull();
  });

  it('double tap sends a card to its best place', () => {
    const s = base();
    s.piles.t0 = [c('hearts', 1, 1)];
    s.piles.t1 = [c('spades', 13, 2)];
    s.piles.t2 = [c('clubs', 12, 3)];
    expect(autoMove('klondike', e, s, { kind: 'pile', pile: 't0', n: 1 })).toEqual({ t: 'move', from: 't0', n: 1, to: 'f0' });
    expect(autoMove('klondike', e, s, { kind: 'pile', pile: 't2', n: 1 })).toBeNull();
  });

  it('Pyramid: a card dropped on its partner pairs; a King leaves on any drop off itself', () => {
    const board: (SCard | null)[] = Array(28).fill(null);
    board[27] = c('spades', 13, 1);
    board[26] = c('hearts', 6, 2);
    board[25] = c('clubs', 7, 3);
    const s: PyramidState = { board, stock: [], waste: [], passes: 0 };
    const pe = engineFor('pyramid') as never;
    expect(dropMove('pyramid', pe, s, { kind: 'card', id: 2 }, dropCard(3))).toEqual({ t: 'remove', ids: [3, 2] });
    expect(dropMove('pyramid', pe, s, { kind: 'card', id: 2 }, dropCard(1))).toBeNull();
    expect(dropMove('pyramid', pe, s, { kind: 'card', id: 1 }, null)).toEqual({ t: 'remove', ids: [1] });
    expect(dropMove('pyramid', pe, s, { kind: 'card', id: 1 }, dropCard(1))).toBeNull();
    expect(autoMove('pyramid', pe, s, { kind: 'card', id: 1 })).toEqual({ t: 'remove', ids: [1] });
    expect(autoMove('pyramid', pe, s, { kind: 'card', id: 2 })).toBeNull();
  });

  it('TriPeaks plays onto the waste; Hearts onto the trick', () => {
    const te = engineFor('tripeaks');
    const ts = te.deal(11);
    const m = te.legal(ts).find((x) => x.t === 'remove');
    if (m && m.t === 'remove') {
      expect(dropMove('tripeaks', te, ts, { kind: 'card', id: m.ids[0] }, DROP_WASTE)).toEqual(m);
      expect(dropMove('tripeaks', te, ts, { kind: 'card', id: m.ids[0] }, 't0')).toBeNull();
    }
    const he = engineFor('hearts');
    let hs = he.deal(5);
    const pass = he.legal(hs).find((x) => x.t === 'pass');
    if (pass) hs = he.apply(hs, pass)!;
    const p = he.legal(hs).find((x) => x.t === 'play');
    if (p && p.t === 'play') {
      expect(dropMove('hearts', he, hs, { kind: 'card', id: p.id }, DROP_TRICK)).toEqual(p);
      expect(dropMove('hearts', he, hs, { kind: 'card', id: p.id }, null)).toBeNull();
      expect(autoMove('hearts', he, hs, { kind: 'card', id: p.id })).toEqual(p);
    }
  });
});
