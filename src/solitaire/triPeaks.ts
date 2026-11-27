// TriPeaks (Три вершини). 28 cards in three overlapping peaks (rows of 3, 6, 9,
// 10); the bottom row is face up, a card turns up once nothing covers it. One
// card starts the waste, the other 23 are the stock (one at a time, no redeal).
// Play an uncovered card onto the waste when it is one rank higher or lower
// (King and Ace connect). Won when all three peaks are cleared.

import { buildDeck, shuffle, type SCard } from './cards';
import type { Engine, PairMove } from './engine';

export interface TriPeaksState {
  /** 28 positions: 0–2 peak tops, 3–8 row 2, 9–17 row 3, 18–27 bottom row. */
  board: (SCard | null)[];
  stock: SCard[];
  waste: SCard[];
}

export const TRIPEAKS_ROWS = [3, 6, 9, 10] as const;

export function triPeaksRow(i: number): { row: number; col: number } {
  if (i < 3) return { row: 0, col: i };
  if (i < 9) return { row: 1, col: i - 3 };
  if (i < 18) return { row: 2, col: i - 9 };
  return { row: 3, col: i - 18 };
}

/** Positions lying on top of position i. */
export function triPeaksCovers(i: number): number[] {
  const { row, col } = triPeaksRow(i);
  if (row === 0) return [3 + 2 * col, 4 + 2 * col];
  if (row === 1) { const p = Math.floor(col / 2); return [9 + col + p, 10 + col + p]; }
  if (row === 2) return [18 + col, 19 + col];
  return [];
}

export const triPeaksExposed = (s: TriPeaksState, i: number): boolean =>
  s.board[i] !== null && triPeaksCovers(i).every((j) => s.board[j] === null);

/** Turns up every board card that nothing covers any more. */
function reveal(board: (SCard | null)[]): (SCard | null)[] {
  const tmp: TriPeaksState = { board, stock: [], waste: [] };
  return board.map((c, i) => (c && !c.up && triPeaksExposed(tmp, i) ? { ...c, up: true } : c));
}

export function dealTriPeaks(seed: number): TriPeaksState {
  const deck = shuffle(buildDeck(1), seed);
  const board = reveal(deck.slice(0, 28).map((c) => ({ ...c, up: false })));
  return { board, waste: [{ ...deck[28], up: true }], stock: deck.slice(29).map((c) => ({ ...c, up: false })) };
}

export const connects = (a: number, b: number): boolean => Math.abs(a - b) === 1 || Math.abs(a - b) === 12;

function legal(s: TriPeaksState): PairMove[] {
  const w = s.waste[s.waste.length - 1];
  const out: PairMove[] = [];
  s.board.forEach((c, i) => {
    if (c && triPeaksExposed(s, i) && w && connects(c.rank, w.rank)) out.push({ t: 'remove', ids: [c.id] });
  });
  if (s.stock.length > 0) out.push({ t: 'stock' });
  return out;
}

function apply(s: TriPeaksState, m: PairMove): TriPeaksState | null {
  if (m.t === 'stock') {
    if (s.stock.length === 0) return null;
    const c = { ...s.stock[s.stock.length - 1], up: true };
    return { ...s, stock: s.stock.slice(0, -1), waste: [...s.waste, c] };
  }
  if (!Array.isArray(m.ids) || m.ids.length !== 1) return null;
  const i = s.board.findIndex((c) => c?.id === m.ids[0]);
  const w = s.waste[s.waste.length - 1];
  if (i < 0 || !triPeaksExposed(s, i) || !w || !connects(s.board[i]!.rank, w.rank)) return null;
  const card = s.board[i]!;
  const board = [...s.board];
  board[i] = null;
  return { ...s, board: reveal(board), waste: [...s.waste, { ...card, up: true }] };
}

const won = (s: TriPeaksState) => s.board.every((c) => c === null);

export const triPeaks: Engine<TriPeaksState, PairMove> = {
  key: 'tripeaks',
  deal: dealTriPeaks,
  legal,
  apply,
  won,
  hint(s) {
    const moves = legal(s).filter((m) => m.t === 'remove');
    if (moves.length === 0) return s.stock.length ? { t: 'stock' } : null;
    // Prefer the move that keeps a chain going: the played card has a follow-up on the board.
    const score = (m: PairMove) => {
      if (m.t !== 'remove') return 0;
      const next = apply(s, m)!;
      return legal(next).filter((x) => x.t === 'remove').length;
    };
    return [...moves].sort((a, b) => score(b) - score(a))[0];
  },
  canAutoFinish: () => false,
  finishStep: () => null,
  cardsLeft: (s) => s.board.filter(Boolean).length,
};
