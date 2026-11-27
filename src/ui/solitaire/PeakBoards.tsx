// Pyramid and TriPeaks boards (S2): positional layouts where cards overlap the
// row above by half a card; the stock and waste sit underneath.

import type { CSSProperties } from 'react';
import CardView from '../components/CardView';
import { toViewCard, type SCard } from '../../solitaire/cards';
import type { PairMove } from '../../solitaire/engine';
import { pyramidExposed, pyramidPos, PYRAMID_MAX_PASSES, type PyramidState } from '../../solitaire/pyramid';
import { triPeaksExposed, triPeaksRow, type TriPeaksState } from '../../solitaire/triPeaks';
import { DROP_WASTE, dropCard, type Selection } from '../../solitaire/tap';
import { GAP, HIDDEN, cardWidth } from './PileBoard';
import { useCardDrag, type BoardInput } from './useCardDrag';

interface Common {
  /** Guide only: a card picked by taps (the game itself is played by dragging). */
  selection?: Selection;
  hint: PairMove | null;
  input: BoardInput;
  width: number;
  height: number;
}
type Drag = ReturnType<typeof useCardDrag>;

function useMarks(selection: Selection, hint: PairMove | null) {
  const hinted = new Set(hint && hint.t === 'remove' ? hint.ids : []);
  return {
    hinted: (id: number) => hinted.has(id),
    selected: (id: number) => selection?.kind === 'card' && selection.id === id,
    stockHint: hint?.t === 'stock',
  };
}

/** A layout card: `active` ones can be dragged; every card can be dropped on (`drop`). */
function Card({ c, pos, drag, selected, highlight, active, drop }: {
  c: SCard; pos: CSSProperties; drag: Drag; selected: boolean; highlight: boolean; active: boolean; drop?: string;
}) {
  return (
    <div className={`sol-slot${active ? ' sol-slot--drag' : ' sol-slot--covered'}`} style={drag.dragStyle(c.id, pos)} data-drop={drop}
      onPointerDown={active ? (e) => drag.start(e, { kind: 'card', id: c.id, ids: [c.id] }) : undefined}>
      <CardView card={c.up ? toViewCard(c) : (HIDDEN as never)} size="table" selected={selected} highlight={highlight} />
    </div>
  );
}

/** Stock + waste row under the layout. */
function StockRow({ stock, waste, y, cw, onStock, stockHint, recycle, wasteCard, wasteDrop }: {
  stock: SCard[]; waste: SCard[]; y: number; cw: number; onStock: () => void; stockHint: boolean; recycle: boolean;
  wasteCard: (c: SCard, x: number) => JSX.Element; wasteDrop?: string;
}) {
  const step = cw + GAP;
  const top = stock[stock.length - 1];
  const w = waste[waste.length - 1];
  return (
    <>
      <button type="button" className={`sol-base${stockHint ? ' sol-base--hint' : ''}`} style={{ left: 0, top: y }} onClick={onStock} aria-label="stock">
        {recycle ? '↻' : ''}
      </button>
      {top && (
        <div className="sol-slot" style={{ left: 0, top: y }}>
          <CardView card={HIDDEN as never} size="table" highlight={stockHint} onClick={onStock} />
        </div>
      )}
      {top && <span className="sol-count" style={{ left: 0, top: y + Math.round(cw * 1.59) - 18 }}>{stock.length}</span>}
      <div className="sol-base sol-base--static" style={{ left: step, top: y }} data-drop={wasteDrop} />
      {w && wasteCard(w, step)}
    </>
  );
}

export function PyramidBoard({ state, selection = null, hint, input, width, height }: Common & { state: PyramidState }) {
  const drag = useCardDrag(input);
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
    const open = pyramidExposed(state, i);
    out.push(<Card key={c.id} c={c} pos={{ left: x, top: row * dy, zIndex: row + 1 }} active={open} drag={drag} drop={open ? dropCard(c.id) : undefined}
      selected={m.selected(c.id)} highlight={m.hinted(c.id)} />);
  });
  const recycle = state.stock.length === 0 && state.waste.length > 0 && state.passes < PYRAMID_MAX_PASSES;
  return (
    <div className="sol-board sol-board--peaks" style={{ '--sol-cw': `${cw}px`, '--sol-ch': `${ch}px`, width: boardW, height: stockY + ch } as CSSProperties}>
      {out}
      <StockRow stock={state.stock} waste={state.waste} y={stockY} cw={cw} onStock={input.onStock} stockHint={m.stockHint} recycle={recycle}
        wasteCard={(w, x) => <Card key={w.id} c={w} pos={{ left: x, top: stockY }} active drag={drag} drop={dropCard(w.id)} selected={m.selected(w.id)} highlight={m.hinted(w.id)} />} />
      <span className="sol-passes" style={{ left: step * 2 + GAP, top: stockY + ch / 2 - 10 }}>↻ {PYRAMID_MAX_PASSES - state.passes}</span>
    </div>
  );
}

export function TriPeaksBoard({ state, selection = null, hint, input, width, height }: Common & { state: TriPeaksState }) {
  const drag = useCardDrag(input);
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
      active={triPeaksExposed(state, i)} drag={drag} selected={false} highlight={m.hinted(c.id)} />);
  });
  return (
    <div className="sol-board sol-board--peaks" style={{ '--sol-cw': `${cw}px`, '--sol-ch': `${ch}px`, width: boardW, height: stockY + ch } as CSSProperties}>
      {out}
      <StockRow stock={state.stock} waste={state.waste} y={stockY} cw={cw} onStock={input.onStock} stockHint={m.stockHint} recycle={false} wasteDrop={DROP_WASTE}
        wasteCard={(w, x) => <Card key={w.id} c={w} pos={{ left: x, top: stockY }} active={false} drag={drag} drop={DROP_WASTE} selected={false} highlight={drag.dragging} />} />
    </div>
  );
}
