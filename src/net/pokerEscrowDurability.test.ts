import { describe, it, expect } from 'vitest';
import { createRoom, serializeRoom, deserializeRoom, addMember, type ServerRoom } from './serverCore';
import { validatePayoutConservation } from '../../server/pokerEscrow';
import type { PokerEscrow } from './serverCore';
import type { PokerState } from '../games/poker/types';

// Stage 37.7.2 deterministic (no-DB) coverage: strict persisted-escrow validation (FAIL 5),
// the bankroll JOIN account gate (FAIL 2), and payout conservation including escrow validity.

function bankrollRoom(): ServerRoom {
  return createRoom({
    code: 'PKR', playerCount: 4, modeSelectionType: 'fixed', gameType: 'poker',
    host: { clientId: 'h', reconnectToken: 'tok', name: 'Host', avatar: '🙂' },
    pokerSmallBlind: 100, pokerBigBlind: 200, pokerBuyIn: 20000, pokerBlindGrowth: 0,
  });
}

const goodEscrow = (): PokerEscrow => ({
  matchId: 'm1', buyIn: 20000, status: 'funded',
  seats: [{ seat: 0, userId: 'u1', amount: 20000 }, { seat: 1, userId: 'u2', amount: 20000 }],
});

/** Round-trip a room whose persisted escrow JSON has been tampered with `mutate`. */
function restoreWithEscrow(mutate: (esc: Record<string, unknown>) => unknown): ServerRoom | null {
  const room = bankrollRoom();
  room.pokerEscrow = goodEscrow();
  const json = JSON.parse(JSON.stringify(serializeRoom(room))) as Record<string, unknown>;
  json.pokerEscrow = mutate(JSON.parse(JSON.stringify(json.pokerEscrow)) as Record<string, unknown>);
  return deserializeRoom(json);
}

describe('deserializePokerEscrow strict validation (FAIL 5)', () => {
  it('a fully valid escrow round-trips and is NOT corrupt', () => {
    const r = restoreWithEscrow((e) => e)!;
    expect(r.pokerEscrow).toEqual(goodEscrow());
    expect(r.pokerEscrowCorrupt).toBeFalsy();
  });

  const bad: Array<[string, (e: Record<string, unknown>) => unknown]> = [
    ['negative seat', (e) => ({ ...e, seats: [{ seat: -1, userId: 'u1', amount: 20000 }, { seat: 1, userId: 'u2', amount: 20000 }] })],
    ['seat out of range', (e) => ({ ...e, seats: [{ seat: 9, userId: 'u1', amount: 20000 }, { seat: 1, userId: 'u2', amount: 20000 }] })],
    ['empty userId', (e) => ({ ...e, seats: [{ seat: 0, userId: '', amount: 20000 }, { seat: 1, userId: 'u2', amount: 20000 }] })],
    ['zero amount', (e) => ({ ...e, seats: [{ seat: 0, userId: 'u1', amount: 0 }, { seat: 1, userId: 'u2', amount: 20000 }] })],
    ['amount != buyIn', (e) => ({ ...e, seats: [{ seat: 0, userId: 'u1', amount: 19999 }, { seat: 1, userId: 'u2', amount: 20000 }] })],
    ['duplicate seat', (e) => ({ ...e, seats: [{ seat: 0, userId: 'u1', amount: 20000 }, { seat: 0, userId: 'u2', amount: 20000 }] })],
    ['duplicate user', (e) => ({ ...e, seats: [{ seat: 0, userId: 'u1', amount: 20000 }, { seat: 1, userId: 'u1', amount: 20000 }] })],
    ['empty seat list', (e) => ({ ...e, seats: [] })],
    ['single seat', (e) => ({ ...e, seats: [{ seat: 0, userId: 'u1', amount: 20000 }] })],
    ['bad matchId', (e) => ({ ...e, matchId: '' })],
    ['bad buyIn', (e) => ({ ...e, buyIn: -1 })],
    ['bad status', (e) => ({ ...e, status: 'weird' })],
  ];
  for (const [label, mutate] of bad) {
    it(`fails closed on ${label} → corrupt flag set, escrow dropped (room NOT lost)`, () => {
      const r = restoreWithEscrow(mutate);
      expect(r, label).not.toBeNull();
      expect(r!.pokerEscrow, label).toBeUndefined();
      expect(r!.pokerEscrowCorrupt, label).toBe(true);
    });
  }

  it('a legitimately ABSENT escrow is not corrupt', () => {
    const room = bankrollRoom();
    const r = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))))!;
    expect(r.pokerEscrow).toBeUndefined();
    expect(r.pokerEscrowCorrupt).toBeFalsy();
  });
});

describe('addMember bankroll account gate (FAIL 2)', () => {
  it('rejects a guest / no-userId player seat', () => {
    const r = bankrollRoom();
    expect(addMember(r, { clientId: 'c1', reconnectToken: 't', name: 'Guest' })).toEqual({ ok: false, error: 'NOT_SIGNED_IN' });
  });
  it('accepts a signed-in player and stamps the userId ATOMICALLY at join', () => {
    const r = bankrollRoom();
    expect(addMember(r, { clientId: 'c1', reconnectToken: 't', name: 'Alice', userId: 'acc-1' })).toEqual({ ok: true });
    expect(r.members.get('c1')!.userId).toBe('acc-1'); // not deferred to attachIdentity
  });
  it('rejects a second player seat for the SAME account', () => {
    const r = bankrollRoom();
    addMember(r, { clientId: 'c1', reconnectToken: 't', name: 'Alice', userId: 'acc-1' });
    expect(addMember(r, { clientId: 'c2', reconnectToken: 't', name: 'Alice2', userId: 'acc-1' })).toEqual({ ok: false, error: 'NOT_SIGNED_IN' });
  });
  it('allows a guest SPECTATOR (no private cards via seat redaction)', () => {
    const r = bankrollRoom();
    expect(addMember(r, { clientId: 'c1', reconnectToken: 't', name: 'Watcher', role: 'spectator' })).toEqual({ ok: true });
    expect(r.members.get('c1')!.role).toBe('spectator');
  });
  it('does NOT gate a non-bankroll (free) poker or other game', () => {
    const king = createRoom({ code: 'K', playerCount: 4, modeSelectionType: 'fixed', gameType: 'king', host: { clientId: 'h', reconnectToken: 't', name: 'H' } });
    expect(addMember(king, { clientId: 'c1', reconnectToken: 't', name: 'Guest' })).toEqual({ ok: true });
  });
});

describe('validatePayoutConservation checks escrow validity too (FAIL 5)', () => {
  const state = (stacks: number[]): PokerState => ({ stacksBySeat: stacks } as PokerState);
  it('rejects a structurally invalid escrow (amount != buyIn) even if stacks look fine', () => {
    const esc: PokerEscrow = { matchId: 'm', buyIn: 20000, status: 'funded', seats: [{ seat: 0, userId: 'u1', amount: 19999 }, { seat: 1, userId: 'u2', amount: 20000 }] };
    expect(validatePayoutConservation(esc, state([40000, 0])).ok).toBe(false);
  });
  it('rejects a duplicate-user escrow', () => {
    const esc: PokerEscrow = { matchId: 'm', buyIn: 20000, status: 'funded', seats: [{ seat: 0, userId: 'dup', amount: 20000 }, { seat: 1, userId: 'dup', amount: 20000 }] };
    expect(validatePayoutConservation(esc, state([40000, 0])).ok).toBe(false);
  });
});
