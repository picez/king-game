import { describe, it, expect } from 'vitest';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 37.7.10 FAIL 3 (integration, real Postgres): a finished PAID match's stats are attributed from
// the IMMUTABLE persisted escrow.seats (seat → authenticated userId), NOT the current room membership —
// which handleLeave empties BEFORE teardown. Removing members must not turn a valid match into a
// `skipped` (which would drop owed stats). A malformed escrow fails (retryable), never silently skips.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
function P(seat: number): PokerPlayer { return { id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' }; }
function tel2(): PokerTelemetry { return { handsPlayedBySeat: [8, 8], handsWonBySeat: [3, 5], showdownsWonBySeat: [1, 3], potsWonBySeat: [3, 6], biggestPotBySeat: [400, 900], allInsWonBySeat: [0, 1], royalFlushBySeat: [0, 0] }; }
function finished2p(): PokerState {
  const f = () => [false, false];
  return { gameType: 'poker', phase: 'game_finished', playerCount: 2, players: [P(0), P(1)], options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 }, buttonSeat: 0, handNumber: 8, street: 'river', stacksBySeat: [0, 10000], holeCardsBySeat: [[], []], board: [], deck: [], burned: [], committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(), wasAllInBySeat: f(), actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: [true, false], currentBet: 0, minRaise: 50, toActSeat: 1, revealedBySeat: f(), lastHand: null, winnerSeat: 1, actionLog: [], telemetry: tel2() } as unknown as PokerState;
}

describe.skipIf(!TEST_DATABASE_URL)('stats attribution survives members leaving (Stage 37.7.10 FAIL 3)', () => {
  it('records both players from escrow.seats after ALL members leave; idempotent; no raw id leak', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const { createRoom, addMember, removeMember, snapshot } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const DAY = new Date(Date.UTC(2026, 6, 21, 12));
    const U1 = await users.createAccountUser({ email: null, name: 'AtA', emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: 'AtB', emailVerified: false });
    await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
    const CODE = 'ATTR1';
    const room = createRoom({ code: CODE, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
    room.started = true; room.gameState = finished2p() as unknown as typeof room.gameState;
    await escrow.debitBuyIns(room);
    const M = room.pokerEscrow!.matchId;
    await escrow.payoutStacks(room, finished2p()); // paid; escrow settled + escrow.seats = [U1@0, U2@1]

    // The public snapshot must leak neither the raw matchId nor the seat userIds.
    const snap = JSON.stringify(snapshot(room));
    expect(snap).not.toContain(M);
    expect(snap).not.toContain(U1);
    expect(snap).not.toContain(U2);

    // Both players LEAVE (handleLeave removes members BEFORE teardown) — current membership is now empty.
    removeMember(room, 'a'); removeMember(room, 'b');
    expect([...room.members.values()].filter((m) => m.role === 'player').length).toBe(0);

    const marker = new Map<string, string>();
    const deps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); },
      record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });

    const res = await recordConfirmedPokerStats(room, finished2p(), deps());
    expect(res).toBe('recorded'); // NOT skipped — attributed from escrow.seats

    // Correct seat → userId attribution for BOTH players.
    const gp = (await conn!.sql`SELECT user_id, seat_index, is_winner FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${CODE}) ORDER BY seat_index`) as Array<{ user_id: string; seat_index: number; is_winner: boolean }>;
    expect(gp.map((r) => r.user_id)).toEqual([U1, U2]);
    expect(gp.find((r) => r.seat_index === 1)!.is_winner).toBe(true); // seat 1 won
    // Both users' poker stats cache updated.
    const us = (await conn!.sql`SELECT count(*)::int AS n FROM user_stats WHERE user_id IN (${U1}, ${U2}) AND game_type = 'poker'`) as Array<{ n: number }>;
    expect(us[0].n).toBe(2);

    // Idempotent with a FRESH marker (process restart): the durable game_key guards exactly-once.
    const again = await recordConfirmedPokerStats(room, finished2p(), deps());
    expect(again).toBe('already_exists');
    const rows = (await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${CODE}`) as Array<{ n: number }>;
    expect(rows[0].n).toBe(1);

    await conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${CODE})`;
    await conn!.sql`DELETE FROM games WHERE room_code = ${CODE}`;
    await conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
    await conn!.sql`DELETE FROM user_stats WHERE user_id IN (${U1}, ${U2})`;
    await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });

  it('a bankroll room with a malformed/absent escrow FAILS (retryable), never silently skips owed stats', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const deps = { alreadyRecorded: () => false, markRecorded: () => {}, unmarkRecorded: () => {}, record: async () => ({ recorded: true }) };
    const base = { code: 'ATTR2', gameType: 'poker', pokerBuyIn: 5000, members: new Map() } as unknown as ServerRoom;
    // No escrow at all.
    expect(await recordConfirmedPokerStats(base, finished2p(), deps)).toBe('failed');
    // Escrow with <2 seats.
    const oneSeat = { ...base, pokerEscrow: { matchId: 'm', buyIn: 5000, status: 'settled', seats: [{ seat: 0, userId: 'u1', amount: 5000 }] } } as unknown as ServerRoom;
    expect(await recordConfirmedPokerStats(oneSeat, finished2p(), deps)).toBe('failed');
    // Escrow seat with an empty userId.
    const badUser = { ...base, pokerEscrow: { matchId: 'm', buyIn: 5000, status: 'settled', seats: [{ seat: 0, userId: '', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] } } as unknown as ServerRoom;
    expect(await recordConfirmedPokerStats(badUser, finished2p(), deps)).toBe('failed');
  });
});
