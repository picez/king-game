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

export function tap(id: SolitaireId, e: Engine<unknown, Move>, s: unknown, sel: Selection, t: TapTarget): TapResult {
  if (id === 'pyramid') return tapPyramid(e as unknown as Engine<PyramidState, PairMove>, s as PyramidState, sel, t);
  if (id === 'tripeaks') return tapTriPeaks(e as unknown as Engine<unknown, PairMove>, s, t);
  return tapPile(e as unknown as Engine<PileState, PileMove>, s as PileState, sel, t);
}
