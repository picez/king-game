// Pyramid and TriPeaks boards (S2): positional layouts where cards overlap the
// row above by half a card; the stock and waste sit underneath.

import type { CSSProperties } from 'react';
import CardView from '../components/CardView';
import { toViewCard, type SCard } from '../../solitaire/cards';
import type { PairMove } from '../../solitaire/engine';
import { pyramidExposed, pyramidPos, PYRAMID_MAX_PASSES, type PyramidState } from '../../solitaire/pyramid';
import { triPeaksExposed, triPeaksRow, type TriPeaksState } from '../../solitaire/triPeaks';
import type { Selection, TapTarget } from '../../solitaire/tap';
import { GAP, HIDDEN, cardWidth } from './PileBoard';

interface Common { selection: Selection; hint: PairMove | null; onTap: (t: TapTarget) => void; width: number; height: number }

function useMarks(selection: Selection, hint: PairMove | null) {
  const hinted = new Set(hint && hint.t === 'remove' ? hint.ids : []);
  return {
    hinted: (id: number) => hinted.has(id),
    selected: (id: number) => selection?.kind === 'card' && selection.id === id,
    stockHint: hint?.t === 'stock',
  };
}

function Card({ c, pos, onTap, selected, highlight, active }: { c: SCard; pos: CSSProperties; onTap: () => void; selected: boolean; highlight: boolean; active: boolean }) {
  return (
    <div className={`sol-slot${active ? '' : ' sol-slot--covered'}`} style={pos}>
      <CardView card={c.up ? toViewCard(c) : (HIDDEN as never)} size="table" selected={selected} highlight={highlight}
        onClick={active ? onTap : undefined} />
    </div>
  );
}

/** Stock + waste row under the layout. */
function StockRow({ stock, waste, y, cw, onTap, stockHint, recycle, wasteCard }: {
  stock: SCard[]; waste: SCard[]; y: number; cw: number; onTap: (t: TapTarget) => void; stockHint: boolean; recycle: boolean;
  wasteCard: (c: SCard, x: number) => JSX.Element;
}) {
  const step = cw + GAP;
  const top = stock[stock.length - 1];
  const w = waste[waste.length - 1];
  return (
    <>
      <button type="button" className={`sol-base${stockHint ? ' sol-base--hint' : ''}`} style={{ left: 0, top: y }} onClick={() => onTap({ kind: 'stock' })} aria-label="stock">
        {recycle ? '↻' : ''}
      </button>
      {top && (
        <div className="sol-slot" style={{ left: 0, top: y }}>
          <CardView card={HIDDEN as never} size="table" highlight={stockHint} onClick={() => onTap({ kind: 'stock' })} />
        </div>
      )}
      {top && <span className="sol-count" style={{ left: 0, top: y + Math.round(cw * 1.59) - 18 }}>{stock.length}</span>}
      <div className="sol-base sol-base--static" style={{ left: step, top: y }} />
      {w && wasteCard(w, step)}
    </>
  );
}

export function PyramidBoard({ state, selection, hint, onTap, width, height }: Common & { state: PyramidState }) {
  const cw = cardWidth(width, height, 7, 5.2);
  const ch = Math.round(cw * 1.59);
  const step = cw + GAP;
  const dy = Math.round(ch * 0.5);
  const m = useMarks(selection, hint);
  const boardW = step * 7 - GAP;
  const stockY = dy * 6 + ch + GAP * 4;
  const out: JSX.Element[] = [];
  state.board.forEach((c, i) => {
    if (!c) return;
    const { row, col } = pyramidPos(i);
    const x = Math.round(((6 - row) / 2) * step + col * step);
    out.push(<Card key={c.id} c={c} pos={{ left: x, top: row * dy, zIndex: row + 1 }} active={pyramidExposed(state, i)}
      selected={m.selected(c.id)} highlight={m.hinted(c.id)} onTap={() => onTap({ kind: 'card', id: c.id })} />);
  });
  const recycle = state.stock.length === 0 && state.waste.length > 0 && state.passes < PYRAMID_MAX_PASSES;
  return (
    <div className="sol-board sol-board--peaks" style={{ '--sol-cw': `${cw}px`, '--sol-ch': `${ch}px`, width: boardW, height: stockY + ch } as CSSProperties}>
      {out}
      <StockRow stock={state.stock} waste={state.waste} y={stockY} cw={cw} onTap={onTap} stockHint={m.stockHint} recycle={recycle}
        wasteCard={(w, x) => <Card key={w.id} c={w} pos={{ left: x, top: stockY }} active selected={m.selected(w.id)} highlight={m.hinted(w.id)} onTap={() => onTap({ kind: 'card', id: w.id })} />} />
      <span className="sol-passes" style={{ left: step * 2 + GAP, top: stockY + ch / 2 - 10 }}>↻ {PYRAMID_MAX_PASSES - state.passes}</span>
    </div>
  );
}

export function TriPeaksBoard({ state, selection, hint, onTap, width, height }: Common & { state: TriPeaksState }) {
  const cw = cardWidth(width, height, 10, 3.8);
  const ch = Math.round(cw * 1.59);
  const step = cw + GAP;
  const dy = Math.round(ch * 0.5);
  const m = useMarks(selection, hint);
  const boardW = step * 10 - GAP;
  const stockY = dy * 3 + ch + GAP * 5;
  const xOf = (i: number): number => {
    const { row, col } = triPeaksRow(i);
    if (row === 3) return col * step;
    if (row === 2) return (col + 0.5) * step;
    if (row === 1) return (col + Math.floor(col / 2) + 1) * step;
    return (3 * col + 1.5) * step;
  };
  const out: JSX.Element[] = [];
  state.board.forEach((c, i) => {
    if (!c) return;
    out.push(<Card key={c.id} c={c} pos={{ left: Math.round(xOf(i)), top: triPeaksRow(i).row * dy, zIndex: triPeaksRow(i).row + 1 }}
      active={triPeaksExposed(state, i)} selected={false} highlight={m.hinted(c.id)} onTap={() => onTap({ kind: 'card', id: c.id })} />);
  });
  return (
    <div className="sol-board sol-board--peaks" style={{ '--sol-cw': `${cw}px`, '--sol-ch': `${ch}px`, width: boardW, height: stockY + ch } as CSSProperties}>
      {out}
      <StockRow stock={state.stock} waste={state.waste} y={stockY} cw={cw} onTap={onTap} stockHint={m.stockHint} recycle={false}
        wasteCard={(w, x) => <Card key={w.id} c={w} pos={{ left: x, top: stockY }} active={false} selected={false} highlight={false} onTap={() => {}} />} />
    </div>
  );
}
