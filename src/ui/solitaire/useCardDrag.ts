// Drag-and-drop for the solitaire boards. A card (or the run under it) follows
// the finger; on release the pile under the finger — any element marked
// `data-drop="<pile id>"` — is the target. A press without a drag is a tap; two
// taps on the same card within DOUBLE_MS are a double tap (send to the best place).

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { DragFrom } from '../../solitaire/tap';

/** What is picked up, with the ids of every card that moves with it. */
export type DragSource = DragFrom & { ids: number[] };

/** How a board reports the player's input. */
export interface BoardInput {
  /** The stock was tapped. */
  onStock: () => void;
  /** Released over `target` (a data-drop value, or null over nothing); an illegal drop just snaps back. */
  onDrop: (from: DragFrom, target: string | null) => void;
  /** A press without movement; `double` on the second tap of a double tap. */
  onTap: (from: DragFrom, double: boolean) => void;
}
type DragHandlers = Pick<BoardInput, 'onDrop' | 'onTap'>;

const MOVE_PX = 6;
const DOUBLE_MS = 350;

interface Live { ids: number[]; dx: number; dy: number }

const keyOf = (s: DragSource) => (s.kind === 'pile' ? `p:${s.pile}:${s.n}` : `c:${s.id}`);

/** The drop target under a viewport point (dragged cards are pointer-events: none). */
export function dropTargetAt(x: number, y: number): string | null {
  if (typeof document === 'undefined' || !document.elementsFromPoint) return null;
  for (const el of document.elementsFromPoint(x, y)) {
    const hit = (el as HTMLElement).closest?.('[data-drop]');
    if (hit) return hit.getAttribute('data-drop');
  }
  return null;
}

export function useCardDrag(handlers: DragHandlers) {
  const [live, setLive] = useState<Live | null>(null);
  const lastTap = useRef<{ key: string; at: number } | null>(null);
  const h = useRef(handlers);
  h.current = handlers;

  function start(e: ReactPointerEvent, src: DragSource) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); // no text selection / native image drag
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!moved && Math.hypot(dx, dy) < MOVE_PX) return;
      moved = true;
      setLive({ ids: src.ids, dx, dy });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const up = (ev: PointerEvent) => {
      stop();
      if (moved) {
        const target = dropTargetAt(ev.clientX, ev.clientY);
        setLive(null);
        lastTap.current = null;
        h.current.onDrop(src, target);
        return;
      }
      const key = keyOf(src);
      const now = Date.now();
      const double = !!lastTap.current && lastTap.current.key === key && now - lastTap.current.at < DOUBLE_MS;
      lastTap.current = double ? null : { key, at: now };
      h.current.onTap(src, double);
    };
    const cancel = () => { stop(); setLive(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  /** Extra style for a card slot: dragged cards follow the finger above everything. */
  function dragStyle(id: number, base: CSSProperties): CSSProperties {
    if (!live || !live.ids.includes(id)) return base;
    const z = typeof base.zIndex === 'number' ? base.zIndex : 0;
    return { ...base, transform: `translate(${live.dx}px, ${live.dy}px)`, zIndex: 1000 + z, pointerEvents: 'none' };
  }

  return { start, dragStyle, dragging: live !== null, draggingIds: live?.ids ?? [] };
}
