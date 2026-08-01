import { describe, it, expect } from 'vitest';
import type { PokerEscrow } from './serverCore';
import type { PokerState, PokerPlayer } from '../games/poker/types';
import { validatePaidMatchParticipants, isBankrollRoomShape } from '../../server/pokerParticipants';
import { validatePayoutConservation } from '../../server/pokerEscrow';

// Stage 37.7.11 FAIL 2 (pure): the ONE shared strict validator for a PAID match's escrow ↔ finished
// state participant identity. Both the payout path and the stats path go through it, so a malformed
// settled escrow can never reach a wallet mutation OR a durable stats row.

const P = (seat: number, type: 'human' | 'ai' = 'human'): PokerPlayer =>
  ({ id: `p${seat}`, name: `P${seat}`, seatIndex: seat, type } as PokerPlayer);

/** A canonical finished heads-up state: seats 0/1, 5000 buy-in each, seat 1 took everything. */
function finished(over: Partial<Record<string, unknown>> = {}): PokerState {
  return {
    phase: 'game_finished', playerCount: 2, players: [P(0), P(1)],
    stacksBySeat: [0, 10000], winnerSeat: 1, ...over,
  } as unknown as PokerState;
}
const seats = (list: Array<[number, string, number]>): PokerEscrow['seats'] =>
  list.map(([seat, userId, amount]) => ({ seat, userId, amount }));
const esc = (over: Partial<PokerEscrow> = {}): PokerEscrow => ({
  matchId: 'm1', buyIn: 5000, status: 'settled',
  seats: seats([[0, 'u1', 5000], [1, 'u2', 5000]]), ...over,
});

describe('validatePaidMatchParticipants — accepts a canonical paid match', () => {
  it('returns the immutable seat → userId snapshot + matchId', () => {
    const res = validatePaidMatchParticipants(esc(), finished());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.participants.matchId).toBe('m1');
    expect([...res.participants.seatUsers.entries()]).toEqual([[0, 'u1'], [1, 'u2']]);
    expect(res.participants.seatCount).toBe(2);
  });
  it('accepts a full 6-max table', () => {
    const players = Array.from({ length: 6 }, (_, s) => P(s));
    const state = finished({ playerCount: 6, players, stacksBySeat: [30000, 0, 0, 0, 0, 0], winnerSeat: 0 });
    const e = esc({ seats: seats(players.map((_, s) => [s, `u${s}`, 5000])) });
    expect(validatePaidMatchParticipants(e, state).ok).toBe(true);
  });
});

describe('validatePaidMatchParticipants — the malformed matrix fails CLOSED', () => {
  const cases: Array<[string, PokerEscrow, PokerState]> = [
    ['no escrow', undefined as unknown as PokerEscrow, finished()],
    ['empty matchId', esc({ matchId: '' }), finished()],
    ['bad buyIn', esc({ buyIn: 0 }), finished()],
    ['fractional buyIn', esc({ buyIn: 5000.5 }), finished()],
    ['only 1 seat', esc({ seats: seats([[0, 'u1', 5000]]) }), finished()],
    ['more than 6 seats', esc({ seats: seats(Array.from({ length: 7 }, (_, s) => [s, `u${s}`, 5000])) }), finished()],
    ['duplicate seat', esc({ seats: seats([[0, 'u1', 5000], [0, 'u2', 5000]]) }), finished()],
    ['duplicate userId', esc({ seats: seats([[0, 'dup', 5000], [1, 'dup', 5000]]) }), finished()],
    ['empty userId', esc({ seats: seats([[0, '', 5000], [1, 'u2', 5000]]) }), finished()],
    ['seat out of range (high)', esc({ seats: seats([[0, 'u1', 5000], [9, 'u2', 5000]]) }), finished()],
    ['seat out of range (negative)', esc({ seats: seats([[-1, 'u1', 5000], [1, 'u2', 5000]]) }), finished()],
    ['fractional seat index', esc({ seats: seats([[0.5, 'u1', 5000], [1, 'u2', 5000]]) }), finished()],
    ['amount != buyIn', esc({ seats: seats([[0, 'u1', 4999], [1, 'u2', 5000]]) }), finished()],
    ['escrow seats [0,1] vs player seats [0,2]', esc(), finished({ players: [P(0), P(2)], stacksBySeat: [0, 0, 10000], winnerSeat: 2 })],
    ['playerCount != players', esc(), finished({ playerCount: 3 })],
    ['stacks shorter than playerCount', esc(), finished({ stacksBySeat: [10000] })],
    ['a bot seat in a bankroll match', esc(), finished({ players: [P(0), P(1, 'ai')] })],
    ['winnerSeat outside the participant set', esc(), finished({ winnerSeat: 5 })],
    ['no state', esc(), null as unknown as PokerState],
    ['no players', esc(), finished({ players: undefined })],
  ];

  for (const [name, e, state] of cases) {
    it(`rejects: ${name}`, () => {
      const res = validatePaidMatchParticipants(e, state);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(typeof res.error).toBe('string');
      // The reason must never carry identity/economy detail (it is logged).
      expect(res.error).not.toContain('u1');
      expect(res.error).not.toContain('m1');
      // The payout path fails on exactly the same input (one shared validator, no weaker copy).
      expect(validatePayoutConservation(e, state).ok).toBe(false);
    });
  }
});

describe('isBankrollRoomShape', () => {
  it('is true only for online poker with a positive buy-in', () => {
    expect(isBankrollRoomShape({ gameType: 'poker', pokerBuyIn: 5000 } as never)).toBe(true);
    expect(isBankrollRoomShape({ gameType: 'poker', pokerBuyIn: 0 } as never)).toBe(false);
    expect(isBankrollRoomShape({ gameType: 'poker' } as never)).toBe(false);
    expect(isBankrollRoomShape({ gameType: 'king', pokerBuyIn: 5000 } as never)).toBe(false);
  });
});
