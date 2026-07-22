import { describe, it, expect } from 'vitest';
import { parseDurableMatch } from '../../server/db/pokerWallet';
import { escrowMatchesRoomSeats, validatePayoutConservation } from '../../server/pokerEscrow';
import { createRoom, addMember, type ServerRoom, type PokerEscrow } from './serverCore';
import type { PokerState } from '../games/poker/types';

// Stage 37.7.3 deterministic coverage: all-or-nothing durable parse (FAIL 3/6), the
// start-time composition check (FAIL 1), and payout conservation seat-set validation.

const goodRow = () => ({
  matchId: 'm1', roomCode: 'ROOM1', buyIn: 5000,
  seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }],
});

describe('parseDurableMatch is all-or-nothing (FAIL 3/6)', () => {
  it('parses a fully valid record', () => {
    expect(parseDurableMatch(goodRow())).toEqual(goodRow());
  });
  const bad: Array<[string, (r: ReturnType<typeof goodRow>) => unknown]> = [
    ['one malformed seat drops the WHOLE match (no partial)', (r) => ({ ...r, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: -1, userId: 'u2', amount: 5000 }, { seat: 2, userId: 'u3', amount: 5000 }] })],
    ['duplicate seat', (r) => ({ ...r, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 0, userId: 'u2', amount: 5000 }] })],
    ['duplicate user', (r) => ({ ...r, seats: [{ seat: 0, userId: 'dup', amount: 5000 }, { seat: 1, userId: 'dup', amount: 5000 }] })],
    ['amount != buyIn', (r) => ({ ...r, seats: [{ seat: 0, userId: 'u1', amount: 4999 }, { seat: 1, userId: 'u2', amount: 5000 }] })],
    ['empty userId', (r) => ({ ...r, seats: [{ seat: 0, userId: '', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] })],
    ['seat above 5 (6-max upper bound)', (r) => ({ ...r, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 6, userId: 'u2', amount: 5000 }] })],
    ['seat 999', (r) => ({ ...r, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 999, userId: 'u2', amount: 5000 }] })],
    ['single seat', (r) => ({ ...r, seats: [{ seat: 0, userId: 'u1', amount: 5000 }] })],
    ['seven seats', (r) => ({ ...r, seats: Array.from({ length: 7 }, (_, i) => ({ seat: i, userId: `u${i}`, amount: 5000 })) })],
    ['bad buyIn', (r) => ({ ...r, buyIn: -1 })],
    ['empty matchId', (r) => ({ ...r, matchId: '' })],
    ['non-array seats', (r) => ({ ...r, seats: 'nope' })],
  ];
  for (const [label, mutate] of bad) {
    it(`returns null (corrupt) on ${label}`, () => {
      expect(parseDurableMatch(mutate(goodRow()) as ReturnType<typeof goodRow>)).toBeNull();
    });
  }
  it('rejects an overflowing total', () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(parseDurableMatch({ matchId: 'm', roomCode: 'R', buyIn: big, seats: [{ seat: 0, userId: 'a', amount: big }, { seat: 1, userId: 'b', amount: big }] })).toBeNull();
  });
});

function bankrollRoom(): ServerRoom {
  const r = createRoom({ code: 'PKR', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'h', reconnectToken: 't', name: 'Host', userId: 'acc-h' }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
  addMember(r, { clientId: 'c2', reconnectToken: 't', name: 'B', userId: 'acc-b' });
  return r;
}

describe('escrowMatchesRoomSeats (FAIL 1)', () => {
  it('true when the escrow seats == the current seated players', () => {
    const r = bankrollRoom();
    // Host seat 0 (acc-h), B seat 1 (acc-b) — matches an escrow over the same pairs.
    r.pokerEscrow = { matchId: 'm', buyIn: 5000, status: 'funded', seats: [{ seat: 0, userId: 'acc-h', amount: 5000 }, { seat: 1, userId: 'acc-b', amount: 5000 }] };
    expect(escrowMatchesRoomSeats(r)).toBe(true);
  });
  it('false when a NEW player joined after the escrow was formed', () => {
    const r = bankrollRoom();
    r.pokerEscrow = { matchId: 'm', buyIn: 5000, status: 'funded', seats: [{ seat: 0, userId: 'acc-h', amount: 5000 }] }; // escrow of 1, room has 2
    expect(escrowMatchesRoomSeats(r)).toBe(false);
  });
  it('false when a different account occupies a seat', () => {
    const r = bankrollRoom();
    r.pokerEscrow = { matchId: 'm', buyIn: 5000, status: 'funded', seats: [{ seat: 0, userId: 'acc-h', amount: 5000 }, { seat: 1, userId: 'someone-else', amount: 5000 }] };
    expect(escrowMatchesRoomSeats(r)).toBe(false);
  });
});

describe('validatePayoutConservation seat-set match (FAIL 5 strengthening)', () => {
  const state = (stacks: number[], playerCount: number): PokerState => ({ stacksBySeat: stacks, playerCount } as PokerState);
  it('rejects when the escrow is missing a player seat (seat set != player set)', () => {
    const esc: PokerEscrow = { matchId: 'm', buyIn: 5000, status: 'funded', seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] };
    // 3-player state but escrow only covers 2 seats → fail closed.
    expect(validatePayoutConservation(esc, state([5000, 5000, 5000], 3)).ok).toBe(false);
  });
  it('rejects a seat index out of stack range', () => {
    const esc: PokerEscrow = { matchId: 'm', buyIn: 5000, status: 'funded', seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 9, userId: 'u2', amount: 5000 }] };
    expect(validatePayoutConservation(esc, state([10000, 0], 2)).ok).toBe(false);
  });
  it('accepts an exact match (2 seats, 2 players, conserved)', () => {
    const esc: PokerEscrow = { matchId: 'm', buyIn: 5000, status: 'funded', seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] };
    expect(validatePayoutConservation(esc, state([10000, 0], 2))).toEqual({ ok: true });
  });
});
