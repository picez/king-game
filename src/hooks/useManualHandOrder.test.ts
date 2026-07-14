// Pure-logic tests for the manual hand-order helper (Stage 30.12). The React
// hook is a thin wrapper over these pure functions (env is node — no renderer).
import { describe, it, expect } from 'vitest';
import { reconcileManualOrder, computeHandOrder, moveInOrder } from './useManualHandOrder';

const idOf = (c: { id: string }) => c.id;
const cards = (...ids: string[]) => ids.map((id) => ({ id }));

describe('computeHandOrder — display order', () => {
  it('returns the DEFAULT hand order untouched when no manual order is set', () => {
    const hand = cards('a', 'b', 'c');
    expect(computeHandOrder(hand, [], idOf)).toEqual(hand); // same reference-order
  });

  it('applies a saved manual order to the current hand', () => {
    const hand = cards('a', 'b', 'c');
    expect(computeHandOrder(hand, ['c', 'a', 'b'], idOf).map(idOf)).toEqual(['c', 'a', 'b']);
  });

  it('prepends a not-yet-tracked (freshly drawn) card on the LEFT', () => {
    // manual order is [b, a]; the hand now also holds a fresh 'x' → x on the left.
    const hand = cards('a', 'b', 'x');
    expect(computeHandOrder(hand, ['b', 'a'], idOf).map(idOf)).toEqual(['x', 'b', 'a']);
  });

  it('drops manual ids no longer in hand', () => {
    const hand = cards('a', 'c'); // 'b' was played
    expect(computeHandOrder(hand, ['b', 'a', 'c'], idOf).map(idOf)).toEqual(['a', 'c']);
  });

  it('keeps duplicate-looking cards distinct by id (two-deck / joker safe)', () => {
    const hand = cards('0-9h', '1-9h', 'joker-0');
    const order = computeHandOrder(hand, ['joker-0', '1-9h', '0-9h'], idOf).map(idOf);
    expect(order).toEqual(['joker-0', '1-9h', '0-9h']);
  });
});

describe('reconcileManualOrder — hand changes', () => {
  it('keeps chosen order, drops removed, prepends fresh on the left', () => {
    // chosen [c,a,b]; 'b' left, 'x' arrived → [x, c, a]
    expect(reconcileManualOrder(['c', 'a', 'b'], ['c', 'a', 'x'])).toEqual(['x', 'c', 'a']);
  });

  it('returns [] on a full turnover (new deal — nothing retained) → default order', () => {
    expect(reconcileManualOrder(['a', 'b', 'c'], ['d', 'e', 'f'])).toEqual([]);
  });

  it('prepends multiple fresh cards on the left in default order', () => {
    expect(reconcileManualOrder(['b', 'a'], ['x', 'y', 'a', 'b'])).toEqual(['x', 'y', 'b', 'a']);
  });
});

describe('moveInOrder — reorder one slot', () => {
  it('moves a card left / right by one', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveInOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op (same reference) at the edges or for a missing id', () => {
    const order = ['a', 'b', 'c'];
    expect(moveInOrder(order, 'a', -1)).toBe(order); // already leftmost
    expect(moveInOrder(order, 'c', 1)).toBe(order);  // already rightmost
    expect(moveInOrder(order, 'z', -1)).toBe(order); // not present
  });

  it('reset semantics: an empty manual order means default (computeHandOrder returns hand)', () => {
    const hand = cards('a', 'b', 'c');
    expect(computeHandOrder(hand, [], idOf)).toEqual(hand);
  });
});
