// ---------------------------------------------------------------------------
// Stage 38.0.5 — the FROZEN online-match metadata (pure).
//
// This is the record that makes an AI seat takeover safe: it decides ONCE whether a
// match started `human_only` or `with_bots`, remembers exactly who its starting humans
// were, and accumulates permanent departures. Everything the finish path and the
// permanent-leave orchestration rely on is asserted here without any I/O.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  buildOnlineMatchMeta, deserializeOnlineMatch, serializeOnlineMatch,
  finishSeatUsers, ratedByFrozenCategory, startingHumanSeats,
  isSeatForfeited, markSeatForfeited, seatOf,
  type OnlineMatchMeta, type OnlineMatchSeat,
} from './onlineMatch';

const human = (seat: number, userId: string | null = `u${seat}`): OnlineMatchSeat => ({ seat, type: 'human', userId });
const ai = (seat: number): OnlineMatchSeat => ({ seat, type: 'ai', userId: null });

function meta(seats: OnlineMatchSeat[]): OnlineMatchMeta {
  return buildOnlineMatchMeta({
    matchId: 'm-1', gameType: 'king', roomCode: 'AB12', startedAt: 1_700_000_000_000, seats,
  });
}

describe('frozen category', () => {
  it('is human_only only when EVERY starting seat was a human', () => {
    expect(meta([human(0), human(1), human(2)]).category).toBe('human_only');
    expect(meta([human(0), human(1), ai(2)]).category).toBe('with_bots');
    expect(meta([ai(0), ai(1), ai(2)]).category).toBe('with_bots');
  });

  it('a guest (no account) is still a HUMAN seat — it does not make the table with_bots', () => {
    const m = meta([human(0), human(1, null), human(2)]);
    expect(m.category).toBe('human_only');
    expect(startingHumanSeats(m)).toHaveLength(3);
  });

  it('sorts the roster by seat and counts the players', () => {
    const m = meta([human(2), ai(0), human(1)]);
    expect(m.roster.map((s) => s.seat)).toEqual([0, 1, 2]);
    expect(m.playerCount).toBe(3);
    expect(seatOf(m, 0)?.type).toBe('ai');
  });

  it('never stores an account on a bot seat, whatever the caller passes', () => {
    const m = meta([human(0), human(1), { seat: 2, type: 'ai', userId: null }]);
    expect(seatOf(m, 2)?.userId).toBeNull();
  });
});

describe('forfeits are append-only and idempotent', () => {
  it('marks a seat once; a repeat changes nothing', () => {
    const m = meta([human(0), human(1), human(2)]);
    expect(isSeatForfeited(m, 1)).toBe(false);
    expect(markSeatForfeited(m, 1, 5)).toBe(true);
    const snapshot = JSON.stringify(m);
    expect(markSeatForfeited(m, 1, 9)).toBe(false);
    expect(JSON.stringify(m)).toBe(snapshot);   // byte-identical after the repeat
    expect(m.forfeits).toEqual([{ seat: 1, at: 5 }]);
  });

  it('never changes the category or the roster', () => {
    const m = meta([human(0), human(1), human(2)]);
    markSeatForfeited(m, 0, 5);
    markSeatForfeited(m, 2, 6);
    expect(m.category).toBe('human_only');       // a takeover does NOT make it with_bots
    expect(m.roster.map((s) => s.type)).toEqual(['human', 'human', 'human']);
  });
});

describe('finish attribution uses the immutable roster', () => {
  it('drops forfeited seats and bots, keeps the remaining starting humans', () => {
    const m = meta([human(0), human(1), human(2), ai(3)]);
    markSeatForfeited(m, 1, 5);
    const users = finishSeatUsers(m);
    expect([...users.entries()]).toEqual([[0, 'u0'], [2, 'u2']]);
  });

  it('fills in a starting human whose account resolved only AFTER the start', () => {
    const m = meta([human(0), human(1, null), human(2)]);
    const users = finishSeatUsers(m, (seat) => (seat === 1 ? 'late-user' : null));
    expect(users.get(1)).toBe('late-user');
  });

  it('never lets a late lookup resurrect a FORFEITED seat', () => {
    const m = meta([human(0), human(1), human(2)]);
    markSeatForfeited(m, 1, 5);
    const users = finishSeatUsers(m, () => 'someone');
    expect(users.has(1)).toBe(false);
  });

  it('never attributes a bot seat, even if a late lookup offers an account', () => {
    const m = meta([human(0), human(1), ai(2)]);
    expect(finishSeatUsers(m, () => 'bot-account').has(2)).toBe(false);
  });
});

describe('the frozen rating policy', () => {
  it('rates a human_only match — even after a takeover', () => {
    const m = meta([human(0), human(1), human(2)]);
    expect(ratedByFrozenCategory(m)).toBe(true);
    markSeatForfeited(m, 0, 5);
    expect(ratedByFrozenCategory(m)).toBe(true);   // the category never moved
  });

  it('never rates a match that STARTED with a bot', () => {
    const m = meta([human(0), human(1), ai(2)]);
    expect(ratedByFrozenCategory(m)).toBe(false);
  });

  it('needs at least two starting humans', () => {
    expect(ratedByFrozenCategory(meta([human(0), human(1)]))).toBe(true);
    // A 2-seat table where one seat was a bot is with_bots anyway.
    expect(ratedByFrozenCategory(meta([human(0), ai(1)]))).toBe(false);
  });
});

describe('persistence round-trip is strict', () => {
  it('round-trips a match with forfeits', () => {
    const m = meta([human(0), human(1), ai(2)]);
    markSeatForfeited(m, 1, 77);
    m.durable = true;
    const back = deserializeOnlineMatch(JSON.parse(JSON.stringify(serializeOnlineMatch(m))));
    expect(back).toEqual(m);
  });

  it('serialize produces a DEEP copy (no aliasing with the live metadata)', () => {
    const m = meta([human(0), human(1)]);
    const copy = serializeOnlineMatch(m);
    markSeatForfeited(m, 0, 1);
    expect(copy.forfeits).toEqual([]);
    expect(copy.roster).not.toBe(m.roster);
  });

  const bad: Array<[string, unknown]> = [
    ['not an object', 42],
    ['no matchId', { gameType: 'king', roomCode: 'A', category: 'human_only', startedAt: 1, roster: [human(0), human(1)] }],
    ['unknown gameType', { matchId: 'm', gameType: 'chess', roomCode: 'A', category: 'human_only', startedAt: 1, playerCount: 2, roster: [human(0), human(1)] }],
    ['a single seat', { matchId: 'm', gameType: 'king', roomCode: 'A', category: 'human_only', startedAt: 1, playerCount: 1, roster: [human(0)] }],
    ['duplicate seats', { matchId: 'm', gameType: 'king', roomCode: 'A', category: 'human_only', startedAt: 1, playerCount: 2, roster: [human(0), human(0)] }],
    ['seat out of range', { matchId: 'm', gameType: 'king', roomCode: 'A', category: 'human_only', startedAt: 1, playerCount: 2, roster: [human(0), human(9)] }],
    ['a bot holding an account', { matchId: 'm', gameType: 'king', roomCode: 'A', category: 'with_bots', startedAt: 1, playerCount: 2, roster: [human(0), { seat: 1, type: 'ai', userId: 'u1' }] }],
    ['a category that contradicts the roster', { matchId: 'm', gameType: 'king', roomCode: 'A', category: 'human_only', startedAt: 1, playerCount: 2, roster: [human(0), ai(1)] }],
    ['playerCount that contradicts the roster', { matchId: 'm', gameType: 'king', roomCode: 'A', category: 'human_only', startedAt: 1, playerCount: 4, roster: [human(0), human(1)] }],
    ['a forfeit on a bot seat', { matchId: 'm', gameType: 'king', roomCode: 'A', category: 'with_bots', startedAt: 1, playerCount: 2, roster: [human(0), ai(1)], forfeits: [{ seat: 1, at: 1 }] }],
    ['a forfeit on an unknown seat', { matchId: 'm', gameType: 'king', roomCode: 'A', category: 'human_only', startedAt: 1, playerCount: 2, roster: [human(0), human(1)], forfeits: [{ seat: 5, at: 1 }] }],
    ['two forfeits for the same seat', { matchId: 'm', gameType: 'king', roomCode: 'A', category: 'human_only', startedAt: 1, playerCount: 2, roster: [human(0), human(1)], forfeits: [{ seat: 0, at: 1 }, { seat: 0, at: 2 }] }],
  ];
  it.each(bad)('rejects %s', (_label, raw) => {
    expect(deserializeOnlineMatch(raw)).toBeNull();
  });

  it('drops a non-true `durable` flag rather than trusting it', () => {
    const raw = JSON.parse(JSON.stringify(serializeOnlineMatch(meta([human(0), human(1)]))));
    raw.durable = 'yes';
    expect(deserializeOnlineMatch(raw)?.durable).toBeUndefined();
  });
});
