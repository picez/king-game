// ---------------------------------------------------------------------------
// useManualHandOrder — a CLIENT-ONLY hand display-order hook (Stage 30.12).
//
// The reducer/server hand arrays are the single source of truth and are NEVER
// reordered — this hook only decides the ORDER the local viewer SEES their own
// hand in. By default it returns the hand exactly as the game handed it in (the
// game's usual sort). The moment the player reorders a card it flips to MANUAL
// mode: their chosen order is preserved as cards come and go, and any NEWLY
// arriving card is prepended to the LEFT. A full hand turnover (a new deal — no
// retained cards) falls back to the default order. `reset()` returns to default.
//
// Everything is keyed by a stable card id string, so duplicate rank/suit copies
// (two-deck games / jokers) stay distinct. Nothing here is persisted or sent to
// the server — no net/db imports, no protocol change.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';

/** Stable card id for a SINGLE-DECK game card ({suit, rank}) — unique per hand. */
export function singleDeckCardId(c: { suit: string | null; rank: string | null }): string {
  return `${c.suit}-${c.rank}`;
}

/**
 * Reconcile a saved manual order against the hand's CURRENT ids (used when the
 * hand changes): keep chosen cards in their order, drop cards no longer held,
 * and PREPEND freshly-arrived ids on the left. Returns `[]` when nothing is
 * retained (a full turnover), signalling a fall back to the default order.
 */
export function reconcileManualOrder(prev: string[], currentIds: string[]): string[] {
  const cur = new Set(currentIds);
  const retained = prev.filter((id) => cur.has(id));
  if (retained.length === 0) return []; // full turnover → default order
  const prevSet = new Set(prev);
  const fresh = currentIds.filter((id) => !prevSet.has(id)); // new cards, in default order
  return [...fresh, ...retained]; // fresh on the LEFT
}

/**
 * The display order for `hand` given a saved manual order. Manual ids that are
 * still held keep their order; anything not yet in the manual order (a card that
 * just arrived, before the reconcile effect runs) is prepended on the left. An
 * empty manual order means "use the hand's default order untouched".
 */
export function computeHandOrder<T>(hand: T[], manualOrder: string[], idOf: (c: T) => string): T[] {
  if (manualOrder.length === 0) return hand;
  const byId = new Map(hand.map((c) => [idOf(c), c] as const));
  const inManual = manualOrder.filter((id) => byId.has(id));
  const manualSet = new Set(manualOrder);
  const fresh = hand.filter((c) => !manualSet.has(idOf(c))).map(idOf); // not-yet-tracked → left
  return [...fresh, ...inManual].map((id) => byId.get(id) as T);
}

/** Swap the card `id` with its neighbour in `order` (dir -1 = left, +1 = right).
 *  Returns the same array reference when the move is a no-op (edge / missing). */
export function moveInOrder(order: string[], id: string, dir: -1 | 1): string[] {
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export interface ManualHandOrder<T> {
  /** The hand in the order the local viewer should SEE it. */
  ordered: T[];
  /** True once the player has manually reordered (default order otherwise). */
  manual: boolean;
  /** Move a card one slot left / right (activates manual mode). */
  moveLeft: (id: string) => void;
  moveRight: (id: string) => void;
  /** Return to the game's default sort (manual mode off). */
  reset: () => void;
}

/**
 * @param hand  the hand ALREADY in the game's default display order (its usual sort).
 * @param idOf  a stable unique id per card (e.g. `${suit}-${rank}` single-deck, `card.id` for 51).
 */
export function useManualHandOrder<T>(hand: T[], idOf: (c: T) => string): ManualHandOrder<T> {
  const [manualOrder, setManualOrder] = useState<string[]>([]);
  const currentIds = useMemo(() => hand.map(idOf), [hand, idOf]);
  const currentKey = currentIds.join('|');

  // Keep the saved order in sync as the hand changes (draw / play / new deal).
  useEffect(() => {
    setManualOrder((prev) => {
      if (prev.length === 0) return prev; // default mode → nothing to track
      const next = reconcileManualOrder(prev, currentIds);
      const same = next.length === prev.length && next.every((id, i) => id === prev[i]);
      return same ? prev : next;
    });
    // currentKey captures the id set + order; currentIds is derived from it.
  }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ordered = useMemo(
    () => computeHandOrder(hand, manualOrder, idOf),
    [hand, manualOrder, idOf],
  );

  const move = useCallback((id: string, dir: -1 | 1) => {
    setManualOrder((prev) => {
      // Seed from the current DISPLAY order the first time (default sort), so the
      // swap matches what the player sees; then swap the neighbour.
      const seed = prev.length > 0 ? computeHandOrderIds(currentIds, prev) : currentIds.slice();
      const next = moveInOrder(seed, id, dir);
      return next === seed && prev.length > 0 ? prev : next;
    });
  }, [currentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveLeft = useCallback((id: string) => move(id, -1), [move]);
  const moveRight = useCallback((id: string) => move(id, 1), [move]);
  const reset = useCallback(() => setManualOrder([]), []);

  return { ordered, manual: manualOrder.length > 0, moveLeft, moveRight, reset };
}

/** The display id order (fresh-left) for a saved manual order — mirror of
 *  computeHandOrder but on ids only (used to seed a move). */
function computeHandOrderIds(currentIds: string[], manualOrder: string[]): string[] {
  const manualSet = new Set(manualOrder);
  const cur = new Set(currentIds);
  const fresh = currentIds.filter((id) => !manualSet.has(id));
  const inManual = manualOrder.filter((id) => cur.has(id));
  return [...fresh, ...inManual];
}
