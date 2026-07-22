import { describe, it, expect } from 'vitest';
import { validatePayoutConservation, withRoomLock, isRoomBusy, clearRoomLock } from '../../server/pokerEscrow';
import { resolveSettlementOutcome, SettlementConflictError } from '../../server/db/pokerWallet';
import type { PokerEscrow } from './serverCore';
import type { PokerState } from '../games/poker/types';

// Stage 37.7.1 deterministic (no-DB) coverage: payout conservation (FAIL 7), the DB
// settlement gate's mutual-exclusion DECISION (FAIL 2), and the per-room lifecycle
// serialization (FAIL 6). The concurrent DB behavior is covered by the integration suite.

const esc = (seats: Array<[number, string, number]>): PokerEscrow => ({
  matchId: 'm1', buyIn: seats[0]?.[2] ?? 0, status: 'funded',
  seats: seats.map(([seat, userId, amount]) => ({ seat, userId, amount })),
});
const stateWith = (stacks: number[]): PokerState => ({ stacksBySeat: stacks } as PokerState);

describe('validatePayoutConservation (FAIL 7)', () => {
  it('accepts when Σ final stacks == Σ buy-ins', () => {
    // Two seats bought in 5000 each (10000 escrow); winner has 10000, other 0 → conserves.
    expect(validatePayoutConservation(esc([[0, 'a', 5000], [1, 'b', 5000]]), stateWith([10000, 0]))).toEqual({ ok: true });
  });
  it('rejects a payout/escrow mismatch (fails closed)', () => {
    expect(validatePayoutConservation(esc([[0, 'a', 5000], [1, 'b', 5000]]), stateWith([9999, 0])).ok).toBe(false);
    expect(validatePayoutConservation(esc([[0, 'a', 5000], [1, 'b', 5000]]), stateWith([6000, 5000])).ok).toBe(false);
  });
  it('rejects a negative / fractional / non-finite final stack', () => {
    for (const bad of [[-1, 10001], [5000.5, 4999.5], [NaN, 0], [Infinity, 0]]) {
      expect(validatePayoutConservation(esc([[0, 'a', 5000], [1, 'b', 5000]]), stateWith(bad as number[])).ok).toBe(false);
    }
  });
  it('rejects a duplicate escrow seat', () => {
    expect(validatePayoutConservation(esc([[0, 'a', 5000], [0, 'b', 5000]]), stateWith([10000, 0])).ok).toBe(false);
  });
});

describe('resolveSettlementOutcome (FAIL 2 — mutual exclusion decision)', () => {
  it('a fresh claim wins its requested outcome', () => {
    expect(resolveSettlementOutcome('m', true, null, 'payout')).toBe('payout');
    expect(resolveSettlementOutcome('m', true, null, 'cancel_refund')).toBe('cancel_refund');
  });
  it('a repeat of the SAME outcome is idempotent', () => {
    expect(resolveSettlementOutcome('m', false, 'payout', 'payout')).toBe('payout');
    expect(resolveSettlementOutcome('m', false, 'cancel_refund', 'cancel_refund')).toBe('cancel_refund');
  });
  it('the OPPOSITE outcome after resolution THROWS (no wallet change)', () => {
    expect(() => resolveSettlementOutcome('m', false, 'payout', 'cancel_refund')).toThrow(SettlementConflictError);
    expect(() => resolveSettlementOutcome('m', false, 'cancel_refund', 'payout')).toThrow(SettlementConflictError);
  });
});

describe('withRoomLock / isRoomBusy (FAIL 6 — per-room serialization)', () => {
  it('serializes ops for the same room and reports busy in between', async () => {
    clearRoomLock('R');
    const order: string[] = [];
    let releaseA!: () => void;
    const gateA = new Promise<void>((r) => { releaseA = r; });
    const p1 = withRoomLock('R', async () => { order.push('a-start'); await gateA; order.push('a-end'); });
    const p2 = withRoomLock('R', async () => { order.push('b-start'); });
    expect(isRoomBusy('R')).toBe(true);        // two ops pending
    releaseA();
    await Promise.all([p1, p2]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start']); // b ran only after a finished
    expect(isRoomBusy('R')).toBe(false);
  });
  it('an op that throws still releases the lock for the next op', async () => {
    clearRoomLock('R2');
    await withRoomLock('R2', async () => { throw new Error('boom'); }).catch(() => {});
    const r = await withRoomLock('R2', async () => 'ok');
    expect(r).toBe('ok');
    expect(isRoomBusy('R2')).toBe(false);
  });
  it('different rooms do not block each other', async () => {
    clearRoomLock('X'); clearRoomLock('Y');
    let done = false;
    const px = withRoomLock('X', async () => { await new Promise((r) => setTimeout(r, 20)); });
    const py = withRoomLock('Y', async () => { done = true; });
    await py;
    expect(done).toBe(true); // Y finished without waiting for X
    await px;
  });
});
