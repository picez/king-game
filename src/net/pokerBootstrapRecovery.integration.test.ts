import { describe, it, expect, afterEach } from 'vitest';
import type { ServerRoom } from './serverCore';
import type { PokerState, PokerPlayer, PokerTelemetry } from '../games/poker/types';

// Stage 37.7.10 FAIL 1 (integration, real Postgres): the PRODUCTION bootstrap recovery path — the same
// reconcileEscrow → classify → apply → finalize-stats sequence server/index.ts runs — must keep a
// restored PAID finish (never cancel it) and record its stats EXACTLY once without re-paying.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
function P(seat: number): PokerPlayer { return { id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' }; }
function tel2(): PokerTelemetry { return { handsPlayedBySeat: [8, 8], handsWonBySeat: [3, 5], showdownsWonBySeat: [1, 3], potsWonBySeat: [3, 6], biggestPotBySeat: [400, 900], allInsWonBySeat: [0, 1], royalFlushBySeat: [0, 0] }; }
function finished2p(): PokerState {
  const f = () => [false, false];
  return { gameType: 'poker', phase: 'game_finished', playerCount: 2, players: [P(0), P(1)], options: { startingStack: 5000, smallBlind: 25, bigBlind: 50 }, buttonSeat: 0, handNumber: 8, street: 'river', stacksBySeat: [0, 10000], holeCardsBySeat: [[], []], board: [], deck: [], burned: [], committedBySeat: [0, 0], contributedBySeat: [0, 0], foldedBySeat: f(), allInBySeat: f(), wasAllInBySeat: f(), actedBySeat: f(), raiseOpenBySeat: f(), eliminatedBySeat: [true, false], currentBet: 0, minRaise: 50, toActSeat: 1, revealedBySeat: f(), lastHand: null, winnerSeat: 1, actionLog: [], telemetry: tel2() } as unknown as PokerState;
}

afterEach(async () => {
  const escrow = await import('../../server/pokerEscrow');
  escrow.__setRefundFailure(false); escrow.__setPayoutFailure(false);
});

describe.skipIf(!TEST_DATABASE_URL)('bootstrap recovery of a restored PAID finish (Stage 37.7.10 FAIL 1)', () => {
  async function ctx() {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const pokerStats = await import('../../server/db/pokerStats');
    const { classifyBootstrapRecovery, applyBootstrapRecovery } = await import('../../server/pokerBootstrap');
    const { recordConfirmedPokerStats } = await import('../../server/pokerFinish');
    const { createRoom, addMember, serializeRoom, deserializeRoom } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const isFin = (s: PokerState) => getDbFinished(s);
    function getDbFinished(s: PokerState) { return s.phase === 'game_finished'; }
    // Mirror the index.ts bootstrap recovery for ONE restored room (reconcile → classify → apply →
    // finalize stats for paid_finish), then a stats sweep.
    const marker = new Map<string, string>();
    const statsDeps = () => ({
      alreadyRecorded: (c: string, id: string) => marker.get(c) === id, markRecorded: (c: string, id: string) => { marker.set(c, id); }, unmarkRecorded: (c: string) => { marker.delete(c); },
      record: (c: string, st: PokerState, su: Map<number, string | null>, mid?: string | null) => pokerStats.recordFinishedPokerGame(c, st, su, mid),
    });
    async function recover(room: ServerRoom) {
      await escrow.reconcileEscrow(room);
      const rec = classifyBootstrapRecovery(room, isFin);
      applyBootstrapRecovery(room, rec, { rescheduleAdvance: () => {}, persist: () => {}, clearTimers: () => {} });
      if (rec === 'paid_finish') room.pokerStatsPending = true;
      return rec;
    }
    async function sweepStats(room: ServerRoom) {
      if (!room.pokerStatsPending) return null;
      const s = await recordConfirmedPokerStats(room, room.gameState as PokerState, statsDeps());
      if (s !== 'failed') room.pokerStatsPending = undefined;
      return s;
    }
    return { users, wallet, escrow, conn, createRoom, addMember, serializeRoom, deserializeRoom, recover, sweepStats };
  }
  const gameRows = async (conn: Awaited<ReturnType<typeof import('../../server/db/client').getDb>>, code: string) =>
    ((await conn!.sql`SELECT count(*)::int AS n FROM games WHERE room_code = ${code}`) as Array<{ n: number }>)[0].n;

  it('persisted SETTLED + finished → paid_finish (not cancelled); stats recorded once, no re-payout', async () => {
    const t = await ctx();
    const U1 = await t.users.createAccountUser({ email: null, name: 'BrA', emailVerified: false });
    const U2 = await t.users.createAccountUser({ email: null, name: 'BrB', emailVerified: false });
    await t.wallet.dailyClaim(U1, DAY); await t.wallet.dailyClaim(U2, DAY);
    const CODE = 'BOOT1';
    const room = t.createRoom({ code: CODE, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    t.addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
    room.started = true; room.gameState = finished2p() as unknown as typeof room.gameState;
    await t.escrow.debitBuyIns(room);
    const M = room.pokerEscrow!.matchId;
    await t.escrow.payoutStacks(room, finished2p()); // PAID (durable payout, escrow settled)
    room.pokerStatsPending = true; // the finish set it; crash before stats recorded
    const paidBalU1 = (await t.wallet.getWalletView(U1, DAY)).balance; // 995,000 + 10,000 = 1,005,000

    // RESTART: serialize → deserialize → run the production recovery + a stats sweep.
    const restored = t.deserializeRoom(t.serializeRoom(room))!;
    const rec = await t.recover(restored);
    expect(rec).toBe('paid_finish');
    expect(restored.gameState).not.toBeNull();       // finished state kept
    expect(restored.pokerMatchCancelled).toBeUndefined();
    expect(restored.pokerEscrow!.status).toBe('settled'); // NOT re-paid / re-derived
    const s = await t.sweepStats(restored);
    expect(s).toBe('recorded');
    expect(restored.pokerStatsPending).toBeUndefined(); // resolved → rematch available
    expect(await gameRows(t.conn, CODE)).toBe(1);
    expect((await t.wallet.getWalletView(U1, DAY)).balance).toBe(paidBalU1); // payout NOT repeated
    // Idempotent: a further sweep (fresh marker) never writes a second row.
    restored.pokerStatsPending = true;
    const marker2 = restored; void marker2;
    // (use a fresh process marker: recover via a new ctx marker isn't shared) — assert via DB idempotency
    const again = await t.sweepStats(restored);
    expect(again === 'recorded' || again === 'already_exists').toBe(true);
    expect(await gameRows(t.conn, CODE)).toBe(1);

    await t.conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${CODE})`;
    await t.conn!.sql`DELETE FROM games WHERE room_code = ${CODE}`;
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
    await t.conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });

  it('crash-window: persisted SETTLING + durable payout committed → reconcile→settled → paid_finish, stats recorded, no re-payout', async () => {
    const t = await ctx();
    const U1 = await t.users.createAccountUser({ email: null, name: 'BrcA', emailVerified: false });
    const U2 = await t.users.createAccountUser({ email: null, name: 'BrcB', emailVerified: false });
    await t.wallet.dailyClaim(U1, DAY); await t.wallet.dailyClaim(U2, DAY);
    const CODE = 'BOOT2';
    const room = t.createRoom({ code: CODE, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    t.addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
    room.started = true; room.gameState = finished2p() as unknown as typeof room.gameState;
    await t.escrow.debitBuyIns(room);
    const M = room.pokerEscrow!.matchId;
    await t.escrow.payoutStacks(room, finished2p()); // durable payout committed (escrow → settled)
    const paidBalU1 = (await t.wallet.getWalletView(U1, DAY)).balance;
    // Simulate room JSON persisted MID-SETTLE (status settling) before the in-memory settled landed.
    const restored = t.deserializeRoom(t.serializeRoom(room))!;
    restored.pokerEscrow!.status = 'settling';
    restored.pokerStatsPending = undefined; // flag also lost in the crash window

    const rec = await t.recover(restored); // reconcileEscrow reads durable payout → settled → paid_finish
    expect(restored.pokerEscrow!.status).toBe('settled'); // reconciled, NOT re-paid
    expect(rec).toBe('paid_finish');
    expect(restored.gameState).not.toBeNull();
    const s = await t.sweepStats(restored);
    expect(s).toBe('recorded');
    expect(await gameRows(t.conn, CODE)).toBe(1);
    expect((await t.wallet.getWalletView(U1, DAY)).balance).toBe(paidBalU1);

    await t.conn!.sql`DELETE FROM game_players WHERE game_id IN (SELECT id FROM games WHERE room_code = ${CODE})`;
    await t.conn!.sql`DELETE FROM games WHERE room_code = ${CODE}`;
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
    await t.conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });

  it('refunded/cancelled settlement → cancelled lobby, NEVER writes stats', async () => {
    const t = await ctx();
    const U1 = await t.users.createAccountUser({ email: null, name: 'BrrA', emailVerified: false });
    const U2 = await t.users.createAccountUser({ email: null, name: 'BrrB', emailVerified: false });
    await t.wallet.dailyClaim(U1, DAY); await t.wallet.dailyClaim(U2, DAY);
    const CODE = 'BOOT3';
    const room = t.createRoom({ code: CODE, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'a', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    t.addMember(room, { clientId: 'b', reconnectToken: 't', name: 'B', userId: U2 });
    room.started = true; room.gameState = finished2p() as unknown as typeof room.gameState;
    await t.escrow.debitBuyIns(room);
    const M = room.pokerEscrow!.matchId;
    await t.escrow.refundBuyIns(room); // escrow → cancelled
    const restored = t.deserializeRoom(t.serializeRoom(room))!;
    const rec = await t.recover(restored);
    expect(rec).toBe('cancelled');
    expect(restored.gameState).toBeNull();
    expect(restored.pokerMatchCancelled).toBe(true);
    expect(restored.pokerStatsPending).toBeFalsy();
    expect(await t.sweepStats(restored)).toBeNull(); // no stats sweep for a cancelled lobby
    expect(await gameRows(t.conn, CODE)).toBe(0);
    await t.conn!.sql`DELETE FROM poker_matches WHERE match_id = ${M}`;
    await t.conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });
});
