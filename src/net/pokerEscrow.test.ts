import { describe, it, expect } from 'vitest';
import { isBankrollRoom, validateBankrollSeats, bankrollParticipants, hasUnsettledEscrow } from '../../server/pokerEscrow';
import type { ServerRoom, ServerMember, PokerEscrow } from './serverCore';

// Pure (no-DB) coverage of the bankroll escrow guards (§16 E/F/G): human-only + signed-in
// enforcement, no duplicate account, ≥2 players, deterministic lock order, and the
// unsettled-escrow predicate that gates room deletion. The DB debit/payout/refund
// transactions are covered by the wallet integration test (NOT RUN without a test DB).

function member(over: Partial<ServerMember>): ServerMember {
  return {
    clientId: over.clientId ?? 'c', reconnectToken: 't', name: over.name ?? 'P',
    role: over.role ?? 'player', seatIndex: over.seatIndex ?? 0, isHost: false, connected: true,
    type: over.type ?? 'human', avatar: '🙂', userId: over.userId ?? null,
  } as ServerMember;
}

function room(members: ServerMember[], over: Partial<ServerRoom> = {}): ServerRoom {
  return {
    code: 'ROOM1', gameType: 'poker', pokerBuyIn: 5000,
    members: new Map(members.map((m) => [m.clientId, m])),
    ...over,
  } as unknown as ServerRoom;
}

describe('isBankrollRoom', () => {
  it('true only for poker rooms with a positive buy-in', () => {
    expect(isBankrollRoom(room([], { pokerBuyIn: 5000 }))).toBe(true);
    expect(isBankrollRoom(room([], { pokerBuyIn: undefined }))).toBe(false);
    expect(isBankrollRoom(room([], { gameType: 'king', pokerBuyIn: 5000 } as Partial<ServerRoom>))).toBe(false);
  });
});

describe('validateBankrollSeats', () => {
  const humans = () => [
    member({ clientId: 'a', seatIndex: 0, userId: 'u-bbb', type: 'human' }),
    member({ clientId: 'b', seatIndex: 1, userId: 'u-aaa', type: 'human' }),
  ];

  it('accepts ≥2 distinct signed-in humans', () => {
    const r = validateBankrollSeats(room(humans()));
    expect(r.ok).toBe(true);
  });

  it('rejects a table with any bot', () => {
    const r = validateBankrollSeats(room([...humans(), member({ clientId: 'z', seatIndex: 2, type: 'ai' })]));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/human-only/i) });
  });

  it('rejects an unsigned (guest) seat', () => {
    const r = validateBankrollSeats(room([member({ clientId: 'a', seatIndex: 0, userId: 'u1' }), member({ clientId: 'b', seatIndex: 1, userId: null })]));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/signed in/i) });
  });

  it('rejects one account taking two seats', () => {
    const r = validateBankrollSeats(room([member({ clientId: 'a', seatIndex: 0, userId: 'dup' }), member({ clientId: 'b', seatIndex: 1, userId: 'dup' })]));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/two seats/i) });
  });

  it('rejects fewer than 2 players', () => {
    const r = validateBankrollSeats(room([member({ clientId: 'a', seatIndex: 0, userId: 'u1' })]));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/at least 2/i) });
  });
});

describe('bankrollParticipants', () => {
  it('returns human seats in DETERMINISTIC userId order (the wallet lock order)', () => {
    const r = room([
      member({ clientId: 'a', seatIndex: 0, userId: 'u-ccc' }),
      member({ clientId: 'b', seatIndex: 1, userId: 'u-aaa' }),
      member({ clientId: 'c', seatIndex: 2, userId: 'u-bbb' }),
    ]);
    expect(bankrollParticipants(r).map((p) => p.userId)).toEqual(['u-aaa', 'u-bbb', 'u-ccc']);
  });
  it('excludes bots and unsigned seats', () => {
    const r = room([
      member({ clientId: 'a', seatIndex: 0, userId: 'u1' }),
      member({ clientId: 'z', seatIndex: 1, type: 'ai' }),
      member({ clientId: 'g', seatIndex: 2, userId: null }),
    ]);
    expect(bankrollParticipants(r).map((p) => p.userId)).toEqual(['u1']);
  });
});

describe('hasUnsettledEscrow', () => {
  const esc = (status: PokerEscrow['status']): PokerEscrow => ({ matchId: 'm', buyIn: 5000, status, seats: [] });
  it('true while pending/funded/settling, false once settled/cancelled/absent', () => {
    expect(hasUnsettledEscrow(room([], { pokerEscrow: esc('pending') }))).toBe(true);
    expect(hasUnsettledEscrow(room([], { pokerEscrow: esc('funded') }))).toBe(true);
    expect(hasUnsettledEscrow(room([], { pokerEscrow: esc('settling') }))).toBe(true);
    expect(hasUnsettledEscrow(room([], { pokerEscrow: esc('settled') }))).toBe(false);
    expect(hasUnsettledEscrow(room([], { pokerEscrow: esc('cancelled') }))).toBe(false);
    expect(hasUnsettledEscrow(room([], { pokerEscrow: undefined }))).toBe(false);
  });
});
