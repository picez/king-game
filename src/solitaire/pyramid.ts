// Pyramid (Піраміда). 28 cards in a 7-row pyramid, the other 24 in the stock.
// Remove a King alone, or two available cards whose ranks add up to 13
// (A=1, J=11, Q=12). Available = a pyramid card with nothing on top of it, and
// the top of the waste. The stock turns one card onto the waste; the waste may
// be turned back into the stock twice (three passes in all). Won when the
// pyramid is cleared.

import { buildDeck, shuffle, type SCard } from './cards';
import type { Engine, PairMove } from './engine';

export interface PyramidState {
  /** 28 positions, row-major: row r holds r+1 cards. null = removed. */
  board: (SCard | null)[];
  stock: SCard[];
  waste: SCard[];
  /** Recycles used (max 2). */
  passes: number;
}

export const PYRAMID_ROWS = 7;
export const PYRAMID_MAX_PASSES = 2;
const rowStart = (r: number) => (r * (r + 1)) / 2;
export const pyramidPos = (i: number): { row: number; col: number } => {
  let r = 0;
  while (rowStart(r + 1) <= i) r++;
  return { row: r, col: i - rowStart(r) };
};

/** Positions sitting on top of position i (the two below it in the picture). */
export function pyramidCovers(i: number): number[] {
  const { row, col } = pyramidPos(i);
  if (row === PYRAMID_ROWS - 1) return [];
  return [rowStart(row + 1) + col, rowStart(row + 1) + col + 1];
}

export function pyramidExposed(s: PyramidState, i: number): boolean {
  return s.board[i] !== null && pyramidCovers(i).every((j) => s.board[j] === null);
}

export function dealPyramid(seed: number): PyramidState {
  const deck = shuffle(buildDeck(1), seed).map((c) => ({ ...c, up: true }));
  return { board: deck.slice(0, 28), stock: deck.slice(28).map((c) => ({ ...c, up: false })), waste: [], passes: 0 };
}

/** id → where it is, when it is available to play. */
function available(s: PyramidState): Map<number, { card: SCard; where: 'board' | 'waste'; index: number }> {
  const out = new Map<number, { card: SCard; where: 'board' | 'waste'; index: number }>();
  s.board.forEach((c, i) => { if (c && pyramidExposed(s, i)) out.set(c.id, { card: c, where: 'board', index: i }); });
  const w = s.waste[s.waste.length - 1];
  if (w) out.set(w.id, { card: w, where: 'waste', index: s.waste.length - 1 });
  return out;
}

function stockStep(s: PyramidState): PyramidState | null {
  if (s.stock.length > 0) {
    const c = { ...s.stock[s.stock.length - 1], up: true };
    return { ...s, stock: s.stock.slice(0, -1), waste: [...s.waste, c] };
  }
  if (s.waste.length > 0 && s.passes < PYRAMID_MAX_PASSES) {
    return { ...s, passes: s.passes + 1, waste: [], stock: [...s.waste].reverse().map((c) => ({ ...c, up: false })) };
  }
  return null;
}

function legal(s: PyramidState): PairMove[] {
  const av = [...available(s).values()];
  const out: PairMove[] = [];
  for (const a of av) if (a.card.rank === 13) out.push({ t: 'remove', ids: [a.card.id] });
  for (let i = 0; i < av.length; i++) {
    for (let j = i + 1; j < av.length; j++) {
      if (av[i].card.rank + av[j].card.rank === 13) out.push({ t: 'remove', ids: [av[i].card.id, av[j].card.id] });
    }
  }
  if (stockStep(s)) out.push({ t: 'stock' });
  return out;
}

function apply(s: PyramidState, m: PairMove): PyramidState | null {
  if (m.t === 'stock') return stockStep(s);
  if (!Array.isArray(m.ids) || m.ids.length < 1 || m.ids.length > 2 || new Set(m.ids).size !== m.ids.length) return null;
  const av = available(s);
  const picked = m.ids.map((id) => av.get(id));
  if (picked.some((p) => !p)) return null;
  const sum = picked.reduce((n, p) => n + p!.card.rank, 0);
  if (sum !== 13) return null; // a King alone, or a pair adding up to 13
  const board = [...s.board];
  let waste = s.waste;
  for (const p of picked) {
    if (p!.where === 'board') board[p!.index] = null;
    else waste = waste.slice(0, -1);
  }
  return { ...s, board, waste };
}

const won = (s: PyramidState) => s.board.every((c) => c === null);

export const pyramid: Engine<PyramidState, PairMove> = {
  key: 'pyramid',
  deal: dealPyramid,
  legal,
  apply,
  won,
  hint(s) {
    const moves = legal(s);
    // Prefer clearing the pyramid itself (board-only), then pairs using the waste, then the stock.
    const boardOnly = (m: PairMove) => m.t === 'remove' && m.ids.every((id) => s.board.some((c) => c?.id === id));
    return moves.find(boardOnly) ?? moves.find((m) => m.t === 'remove') ?? moves.find((m) => m.t === 'stock') ?? null;
  },
  canAutoFinish: () => false,
  finishStep: () => null,
  cardsLeft: (s) => s.board.filter(Boolean).length,
};
