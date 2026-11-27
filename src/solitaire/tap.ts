// ---------------------------------------------------------------------------
// Tap-to-play (S2), pure. One tap on a card sends it to its best destination;
// when there is a real choice (or no destination), the card is selected and the
// next tap on a pile drops it there. Pyramid pairs two taps; TriPeaks plays one.
// ---------------------------------------------------------------------------

import type { Engine, Move, PairMove, PileMove, SolitaireId } from './engine';
import { isCell, isFoundation, type PileState } from './pileKit';
import { pyramidExposed, type PyramidState } from './pyramid';

/** What is selected between two taps. */
export type Selection =
  | { kind: 'pile'; pile: string; n: number }
  | { kind: 'card'; id: number }
  | null;

export type TapTarget =
  | { kind: 'pile'; pile: string; index: number | null }   // index null = the empty pile / its base
  | { kind: 'card'; id: number }                            // Pyramid / TriPeaks
  | { kind: 'stock' };

export interface TapResult { move: Move | null; selection: Selection }

const rank = (to: string, s: PileState): number => {
  if (isFoundation(to)) return 0;
  if (isCell(to)) return 3;
  return s.piles[to].length === 0 ? 2 : 1;
};

/** Best destination among `moves` (foundation, then a card, then an empty pile, then a cell). */
export function bestMove(s: PileState, moves: Extract<PileMove, { t: 'move' }>[]): Extract<PileMove, { t: 'move' }> | null {
  if (moves.length === 0) return null;
  return [...moves].sort((a, b) => rank(a.to, s) - rank(b.to, s))[0];
}

export function tapPile(e: Engine<PileState, PileMove>, s: PileState, sel: Selection, t: TapTarget): TapResult {
  if (t.kind === 'stock') return { move: e.legal(s).some((m) => m.t === 'stock') ? { t: 'stock' } : null, selection: null };
  if (t.kind !== 'pile') return { move: null, selection: null };
  const pile = s.piles[t.pile];
  const moves = e.legal(s).filter((m): m is Extract<PileMove, { t: 'move' }> => m.t === 'move');

  // A selection is waiting: drop it on the tapped pile when that is legal.
  if (sel && sel.kind === 'pile' && sel.pile !== t.pile) {
    const drop = moves.find((m) => m.from === sel.pile && m.n === sel.n && m.to === t.pile);
    if (drop) return { move: drop, selection: null };
  }
  if (t.index === null || !pile || t.index >= pile.length || !pile[t.index].up) return { move: null, selection: null };
  // Tapping the selected card again clears the selection.
  const n = pile.length - t.index;
  if (sel && sel.kind === 'pile' && sel.pile === t.pile && sel.n === n) return { move: null, selection: null };

  const mine = moves.filter((m) => m.from === t.pile && m.n === n);
  const best = bestMove(s, mine);
  if (!best) return { move: null, selection: { kind: 'pile', pile: t.pile, n } };
  // Several equally good card destinations (two tableau piles) → let the player choose.
  const sameRank = mine.filter((m) => rank(m.to, s) === rank(best.to, s));
  if (sameRank.length > 1 && rank(best.to, s) === 1) return { move: null, selection: { kind: 'pile', pile: t.pile, n } };
  return { move: best, selection: null };
}

export function tapPyramid(e: Engine<PyramidState, PairMove>, s: PyramidState, sel: Selection, t: TapTarget): TapResult {
  if (t.kind === 'stock') return { move: e.legal(s).some((m) => m.t === 'stock') ? { t: 'stock' } : null, selection: null };
  if (t.kind !== 'card') return { move: null, selection: null };
  const removes = e.legal(s).filter((m): m is Extract<PairMove, { t: 'remove' }> => m.t === 'remove');
  const king = removes.find((m) => m.ids.length === 1 && m.ids[0] === t.id);
  if (king) return { move: king, selection: null };
  if (sel && sel.kind === 'card' && sel.id !== t.id) {
    const pair = removes.find((m) => m.ids.length === 2 && m.ids.includes(sel.id) && m.ids.includes(t.id));
    if (pair) return { move: pair, selection: null };
  }
  if (sel && sel.kind === 'card' && sel.id === t.id) return { move: null, selection: null };
  // Only an available card can be selected.
  const available = removes.some((m) => m.ids.includes(t.id)) || isAvailablePyramidCard(s, t.id);
  return { move: null, selection: available ? { kind: 'card', id: t.id } : null };
}

function isAvailablePyramidCard(s: PyramidState, id: number): boolean {
  if (s.waste[s.waste.length - 1]?.id === id) return true;
  const i = s.board.findIndex((c) => c?.id === id);
  return i >= 0 && pyramidExposed(s, i);
}

export function tapTriPeaks(e: Engine<unknown, PairMove>, s: unknown, t: TapTarget): TapResult {
  if (t.kind === 'stock') return { move: e.legal(s).some((m) => m.t === 'stock') ? { t: 'stock' } : null, selection: null };
  if (t.kind !== 'card') return { move: null, selection: null };
  const m = e.legal(s).find((x) => x.t === 'remove' && x.ids[0] === t.id);
  return { move: m ?? null, selection: null };
}

/** Hearts: a tap plays a legal card from your hand (passing is chosen with the pass button). */
export function tapHearts(e: Engine<unknown, Move>, s: unknown, t: TapTarget): TapResult {
  if (t.kind !== 'card') return { move: null, selection: null };
  const m = e.legal(s).find((x) => x.t === 'play' && x.id === t.id);
  return { move: m ?? null, selection: null };
}

export function tap(id: SolitaireId, e: Engine<unknown, Move>, s: unknown, sel: Selection, t: TapTarget): TapResult {
  if (id === 'hearts') return tapHearts(e, s, t);
  if (id === 'pyramid') return tapPyramid(e as unknown as Engine<PyramidState, PairMove>, s as PyramidState, sel, t);
  if (id === 'tripeaks') return tapTriPeaks(e as unknown as Engine<unknown, PairMove>, s, t);
  return tapPile(e as unknown as Engine<PileState, PileMove>, s as PileState, sel, t);
}

// ── drag & drop / double tap ────────────────────────────────────────────────
// The boards are played by dragging: a run of cards from a pile is dropped on
// another pile; a Pyramid card on its partner (a King anywhere off itself); a
// TriPeaks card on the waste; a Hearts card on the trick. A double tap sends a
// card to its best place (the old one-tap behaviour).

/** What is dragged: `n` cards from a pile, or one positional card. */
export type DragFrom = { kind: 'pile'; pile: string; n: number } | { kind: 'card'; id: number };

/** Drop targets of the positional games (piles use their own ids). */
export const DROP_WASTE = 'waste';
export const DROP_TRICK = 'trick';
export const dropCard = (id: number) => `card:${id}`;

/** The move a drop makes, or null when it is not legal (the card snaps back). */
export function dropMove(id: SolitaireId, e: Engine<unknown, Move>, s: unknown, from: DragFrom, target: string | null): Move | null {
  const legal = e.legal(s);
  if (from.kind === 'pile') {
    if (!target || target === from.pile) return null;
    return legal.find((m) => m.t === 'move' && m.from === from.pile && m.n === from.n && m.to === target) ?? null;
  }
  if (id === 'hearts') return target === DROP_TRICK ? legal.find((m) => m.t === 'play' && m.id === from.id) ?? null : null;
  if (id === 'tripeaks') return target === DROP_WASTE ? legal.find((m) => m.t === 'remove' && m.ids[0] === from.id) ?? null : null;
  // Pyramid: a King leaves on any drop off itself; a card pairs with the card it lands on.
  if (target === dropCard(from.id)) return null;
  const king = legal.find((m) => m.t === 'remove' && m.ids.length === 1 && m.ids[0] === from.id);
  if (king) return king;
  const other = target?.startsWith('card:') ? Number(target.slice(5)) : NaN;
  return legal.find((m) => m.t === 'remove' && m.ids.length === 2 && m.ids.includes(from.id) && m.ids.includes(other)) ?? null;
}

/** Double tap: the best single move for that card (none for a Pyramid card that needs a partner). */
export function autoMove(id: SolitaireId, e: Engine<unknown, Move>, s: unknown, from: DragFrom): Move | null {
  if (from.kind === 'pile') {
    const moves = e.legal(s).filter((m): m is Extract<PileMove, { t: 'move' }> => m.t === 'move' && m.from === from.pile && m.n === from.n);
    return bestMove(s as PileState, moves);
  }
  if (id === 'hearts') return e.legal(s).find((m) => m.t === 'play' && m.id === from.id) ?? null;
  return e.legal(s).find((m) => m.t === 'remove' && m.ids.length === 1 && m.ids[0] === from.id) ?? null;
}
