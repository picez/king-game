// ---------------------------------------------------------------------------
// HandReorderTray (Stage 30.12b) — the shared, DRAGGABLE hand row used by every
// game. Cards can be dragged (pointer events: touch / mouse / pen) into any order;
// a quick tap still plays/selects the card. It is purely a CLIENT display-order
// editor driven by useManualHandOrder — the reducer/server hand arrays are never
// reordered and nothing is sent to the wire (no net/db imports).
//
// Each card sits in a slot that owns the pointer gesture (`touch-action: none`);
// the rendered card has pointer-events disabled so the slot always wins. Dragging
// starts only after a small movement threshold, so tapping to play is unaffected.
// The row wraps (no horizontal scroll to fight the drag) and is sized for touch.
//
// `layout="fan"` (table redesign, stage 1) is the same tray as ONE overlapped row —
// or two when the row would squeeze a card's visible strip below a thumb — so a full
// hand costs a fixed, small height instead of one wrapped row per four cards. The
// gesture model is untouched: the slot still owns tap + drag, and a slot is exactly
// the VISIBLE strip of its card, so a tap always lands on the card you can see.
// ---------------------------------------------------------------------------

import { useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useI18n } from '../../i18n';
import type { ManualHandOrder } from '../../hooks/useManualHandOrder';

const DRAG_THRESHOLD = 8; // px of movement before a press becomes a drag (vs a tap)
/** Fan layout: the narrowest visible strip of a card we accept before adding a row. */
const FAN_MIN_STRIP = 30;
/** Fan layout: a viewport shorter than this never gets a second row (phone landscape). */
const FAN_TWO_ROW_MIN_HEIGHT = 480;

/** How many cards fit ONE fan row of `width` px while each keeps a `FAN_MIN_STRIP` strip. */
export function fanRowCapacity(width: number, cardWidth: number): number {
  if (!(width > 0) || !(cardWidth > 0)) return Infinity;
  return Math.max(1, Math.floor((width - cardWidth) / FAN_MIN_STRIP) + 1);
}

/** Split a hand into fan rows: one row while it fits, else two balanced rows (never more). */
export function fanRows<T>(items: T[], capacity: number, allowTwo: boolean): T[][] {
  if (!allowTwo || items.length <= capacity) return [items];
  const first = Math.ceil(items.length / 2);
  return [items.slice(0, first), items.slice(first)];
}

interface Props<T> {
  items: T[]; // the hand in display order (from useManualHandOrder.ordered)
  cardId: (c: T) => string;
  order: ManualHandOrder<T>;
  /** Draw one card (visuals only — the slot owns tap + drag). */
  renderCard: (card: T, dragging: boolean) => ReactNode;
  /** Play / select on a quick tap (not fired after a drag). */
  onTap?: (card: T) => void;
  /** Whether a tap is allowed for this card (drag always works). */
  canTap?: (card: T) => boolean;
  /** Extra class on the row (kept for per-game spacing hooks). */
  className?: string;
  ariaLabel?: string;
  /** `wrap` (default): roomy wrapping rows. `fan`: overlapped, fixed-height rows. */
  layout?: 'wrap' | 'fan';
}

/** Which card the drop should land BEFORE, given the pointer, or null for the end. */
function dropTargetId(container: HTMLElement, draggedId: string, px: number, py: number): string | null {
  const slots = [...container.querySelectorAll<HTMLElement>('[data-card-id]')]
    .filter((el) => el.dataset.cardId !== draggedId);
  if (slots.length === 0) return null;
  // Nearest slot by centre distance (handles wrapped rows), then before/after by x.
  let best: HTMLElement | null = null;
  let bestD = Infinity;
  for (const el of slots) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = (px - cx) ** 2 + (py - cy) ** 2;
    if (d < bestD) { bestD = d; best = el; }
  }
  if (!best) return null;
  const r = best.getBoundingClientRect();
  const beforeBest = px < r.left + r.width / 2;
  if (beforeBest) return best.dataset.cardId ?? null;
  // After `best` → before the next slot in DOM order, or the end.
  const idx = slots.indexOf(best);
  return idx + 1 < slots.length ? slots[idx + 1].dataset.cardId ?? null : null;
}

export default function HandReorderTray<T>({
  items, cardId, order, renderCard, onTap, canTap, className = '', ariaLabel, layout = 'wrap',
}: Props<T>) {
  const { t } = useI18n();
  const rowRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  // Fan layout only: what one row can hold at the current width. Measured, because the
  // card size is a CSS decision (it follows the viewport) the component must not restate.
  const fan = layout === 'fan';
  const [fanShape, setFanShape] = useState<{ capacity: number; allowTwo: boolean }>({ capacity: Infinity, allowTwo: false });
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!fan || !row) return;
    const measure = () => {
      const card = row.querySelector<HTMLElement>('.hand-reorder__card > *');
      const capacity = fanRowCapacity(row.clientWidth, card?.offsetWidth ?? 0);
      const allowTwo = window.innerHeight >= FAN_TWO_ROW_MIN_HEIGHT;
      setFanShape((cur) => (cur.capacity === capacity && cur.allowTwo === allowTwo ? cur : { capacity, allowTwo }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
  }, [fan, items.length]);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (e.button !== 0 && e.pointerType === 'mouse') return; // primary button only
    drag.current = { id, x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDraggingId(d.id); // begin the drag (past the threshold)
    }
    e.preventDefault();
    const target = rowRef.current ? dropTargetId(rowRef.current, d.id, e.clientX, e.clientY) : null;
    setDropBefore(target);
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>, card: T) {
    const d = drag.current;
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (d?.moved) {
      order.moveCard(d.id, dropBefore); // committed reorder (activates manual mode)
    } else if (onTap && (!canTap || canTap(card))) {
      onTap(card); // a quick tap → play / select
    }
    setDraggingId(null);
    setDropBefore(null);
  }

  function onPointerCancel() {
    drag.current = null;
    setDraggingId(null);
    setDropBefore(null);
  }

  const rows = fan ? fanRows(items, fanShape.capacity, fanShape.allowTwo) : [items];

  return (
    <div className={`hand-reorder-wrap${fan ? ' hand-reorder-wrap--fan' : ''}`}>
      <div
        ref={rowRef}
        className={`hand-reorder ${fan ? 'hand-reorder--fan ' : ''}${className}`.trim()}
        data-rows={fan ? rows.length : undefined}
        role="list"
        aria-label={ariaLabel ?? t('hand.arrangeTitle')}
      >
        {rows.map((row, ri) => {
          const slots = row.map((c) => {
          const id = cardId(c);
          const isDragging = draggingId === id;
          return (
            <div
              key={id}
              data-card-id={id}
              role="listitem"
              className={
                'hand-reorder__slot'
                + (isDragging ? ' hand-reorder__slot--dragging' : '')
                + (dropBefore === id ? ' hand-reorder__slot--drop-before' : '')
              }
              onPointerDown={(e) => onPointerDown(e, id)}
              onPointerMove={onPointerMove}
              onPointerUp={(e) => endDrag(e, c)}
              onPointerCancel={onPointerCancel}
            >
              <div className="hand-reorder__card">{renderCard(c, isDragging)}</div>
            </div>
          );
          });
          return fan
            ? <div key={ri} className="hand-reorder__fanrow" role="presentation">{slots}</div>
            : slots;
        })}
      </div>
      {order.manual && (
        <button type="button" className="btn btn--ghost btn--small hand-reorder__reset"
          onClick={order.reset}>↺ {t('hand.autoSort')}</button>
      )}
    </div>
  );
}
