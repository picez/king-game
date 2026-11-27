// Pile-game board (S2): Klondike, Spider, FreeCell, Yukon, Forty Thieves.
// A top row (stock / waste / cells / foundations) and the tableau; every card is
// absolutely placed so long columns compress to fit the screen height.

import type { CSSProperties } from 'react';
import type { Rank } from '../../models/types';
import CardView from '../components/CardView';
import { toViewCard, type SCard } from '../../solitaire/cards';
import type { PileMove, VariantKey } from '../../solitaire/engine';
import type { PileState } from '../../solitaire/pileKit';
import type { Selection, TapTarget } from '../../solitaire/tap';

export interface PileLayout { top: (string | null)[]; tableau: string[]; cols: number; wasteFan: number }

export function pileLayout(key: VariantKey): PileLayout {
  const f = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
  const t = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
  if (key.startsWith('klondike')) return { top: ['s', 'w', null, ...f(4)], tableau: t(7), cols: 7, wasteFan: key === 'klondike-3' ? 3 : 1 };
  if (key.startsWith('spider')) return { top: ['s', null, ...f(8)], tableau: t(10), cols: 10, wasteFan: 1 };
  if (key === 'freecell') return { top: ['c0', 'c1', 'c2', 'c3', ...f(4)], tableau: t(8), cols: 8, wasteFan: 1 };
  if (key === 'yukon') return { top: [null, null, null, ...f(4)], tableau: t(7), cols: 7, wasteFan: 1 };
  return { top: ['s', 'w', ...f(8)], tableau: t(10), cols: 10, wasteFan: 1 }; // forty-thieves
}

export const HIDDEN = { suit: 'spades', rank: '?' as Rank, value: 0 } as const;
export const GAP = 4;

/** Card width for a board of `cols` columns in a w × h box (art ratio 1.59). */
export function cardWidth(w: number, h: number, cols: number, rowsOfCards: number): number {
  const byW = (w - GAP * (cols - 1)) / cols;
  const byH = h / (rowsOfCards * 1.59);
  return Math.max(26, Math.floor(Math.min(byW, byH, 104)));
}

interface Props {
  variant: VariantKey;
  state: PileState;
  selection: Selection;
  hint: PileMove | null;
  onTap: (t: TapTarget) => void;
  width: number;
  height: number;
}

export default function PileBoard({ variant, state, selection, hint, onTap, width, height }: Props) {
  const L = pileLayout(variant);
  const cw = cardWidth(width, height, L.cols, 3.2);
  const ch = Math.round(cw * 1.59);
  const step = cw + GAP;
  const boardW = step * L.cols - GAP;
  const tabTop = ch + GAP * 3;
  const tabH = Math.max(ch, height - tabTop - GAP);
  const style = { '--sol-cw': `${cw}px`, '--sol-ch': `${ch}px`, width: boardW, height: tabTop + tabH } as CSSProperties;

  const hintFrom = hint && hint.t === 'move' ? hint.from : null;
  const hintN = hint && hint.t === 'move' ? hint.n : 0;
  const hintTo = hint && hint.t === 'move' ? hint.to : hint?.t === 'stock' ? 's' : null;
  const selected = (pile: string, i: number, len: number) => selection?.kind === 'pile' && selection.pile === pile && i >= len - selection.n;
  const hinted = (pile: string, i: number, len: number) => hintFrom === pile && i >= len - hintN;

  const card = (c: SCard, pile: string, i: number, len: number, pos: CSSProperties, clickable = true) => (
    <div key={c.id} className="sol-slot" style={pos}>
      <CardView
        card={c.up ? toViewCard(c) : (HIDDEN as never)}
        size="table"
        selected={selected(pile, i, len)}
        highlight={hinted(pile, i, len)}
        onClick={clickable ? () => onTap(pile === 's' ? { kind: 'stock' } : { kind: 'pile', pile, index: i }) : undefined}
      />
    </div>
  );

  const base = (pile: string, x: number, y: number, label: string) => (
    <button key={`base-${pile}`} type="button" aria-label={label}
      className={`sol-base${hintTo === pile ? ' sol-base--hint' : ''}${selection?.kind === 'pile' && pile !== selection.pile ? ' sol-base--target' : ''}`}
      style={{ left: x, top: y }} onClick={() => onTap(pile === 's' ? { kind: 'stock' } : { kind: 'pile', pile, index: null })}>
      {pile === 's' ? (variant.startsWith('klondike') ? '↻' : '') : pile.startsWith('f') && !variant.startsWith('spider') ? 'A' : ''}
    </button>
  );

  const out: JSX.Element[] = [];
  L.top.forEach((pile, col) => {
    if (!pile) return;
    const x = col * step;
    const cards = state.piles[pile] ?? [];
    out.push(base(pile, x, 0, pile));
    if (pile === 'w' && cards.length) {
      const fan = cards.slice(-L.wasteFan);
      fan.forEach((c, k) => {
        const isTop = k === fan.length - 1;
        out.push(card(c, 'w', cards.length - fan.length + k, cards.length, { left: x + k * Math.round(cw * 0.32), top: 0, zIndex: k + 1 }, isTop));
      });
      return;
    }
    if (pile === 's' && cards.length) {
      out.push(card(cards[cards.length - 1], 's', cards.length - 1, cards.length, { left: x, top: 0 }));
      out.push(<span key="s-count" className="sol-count" style={{ left: x, top: ch - 18 }}>{variant.startsWith('spider') ? Math.ceil(cards.length / 10) : cards.length}</span>);
      return;
    }
    if (cards.length) out.push(card(cards[cards.length - 1], pile, cards.length - 1, cards.length, { left: x, top: 0 }, !pile.startsWith('f') || !variant.startsWith('spider')));
  });

  L.tableau.forEach((pile, col) => {
    const x = col * step;
    const cards = state.piles[pile];
    out.push(base(pile, x, tabTop, pile));
    if (!cards.length) return;
    // Offsets: closed cards show a thin strip, open ones their corner; compress to fit.
    // Generous when there is room (the corner index is easy to read), compressed when not.
    const down = ch * 0.12;
    const up = ch * 0.36;
    const need = cards.slice(0, -1).reduce((n, c) => n + (c.up ? up : down), 0);
    const k = need > 0 ? Math.min(1, (tabH - ch) / need) : 1;
    let y = tabTop;
    cards.forEach((c, i) => {
      out.push(card(c, pile, i, cards.length, { left: x, top: Math.round(y), zIndex: i + 1 }, c.up));
      y += (c.up ? up : down) * Math.max(k, 0.35);
    });
  });

  return <div className="sol-board sol-board--piles" style={style}>{out}</div>;
}
