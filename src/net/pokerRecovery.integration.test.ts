import { describe, it, expect } from 'vitest';
import type { WsContext, SessionRef } from '../../server/wsHandlers';
import { RoomSocialStore } from '../../server/roomSocial';
import { ConnectionLimiter, DEFAULT_RATE_LIMITS } from './rateLimit';
import type { ClientMessage } from './messages';
import type { ServerRoom } from './serverCore';
import type { PokerState } from '../games/poker/types';

// Stage 37.7.4 FAIL 1 (integration, real Postgres): a recovery-CANCELLED bankroll lobby must
// become a fully playable NEW paid match on START_GAME — the buy-in is debited exactly once,
// the cancelled flag is cleared atomically, gameplay/advance are unblocked, and the new match
// settles at finish. SKIPPED without TEST_DATABASE_URL.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
const socket = {} as never;
const flush = () => new Promise((r) => setTimeout(r, 20));

describe.skipIf(!TEST_DATABASE_URL)('recovery-cancelled lobby → new paid match is playable (FAIL 1)', () => {
  it('START clears the flag, debits once, unblocks actions/advance; the new match pays out', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { handleClientMessage } = await import('../../server/wsHandlers');
    const { createRoom, addMember } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();

    const U1 = await users.createAccountUser({ email: null, name: 'RecA', emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: 'RecB', emailVerified: false });
    await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);

    // A restored, recovery-CANCELLED bankroll lobby (previous match refunded → clean lobby).
    const room = createRoom({ code: 'RECOV1', playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'host', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(room, { clientId: 'p2', reconnectToken: 't', name: 'B', userId: U2 });
    room.pokerMatchCancelled = true; room.gameState = null; room.started = false;

    const rooms = new Map<string, ServerRoom>([[room.code, room]]);
    let advanceTurns = 0;
    const ctx: WsContext = {
      rooms, sockets: new Map(), social: new RoomSocialStore(),
      send: () => {}, sendError: () => {}, broadcastRoom: () => {}, broadcastToRoom: () => {},
      broadcastAndAdvance: (_r, opts) => { if (opts?.turnAdvanced) advanceTurns++; },
      sendChatHistory: () => {}, persistRoom: () => {}, welcome: () => {},
      handleLeave: () => {}, makeRoomCode: () => 'X', logRoomEvent: () => {}, logLatestDeal: () => {},
    };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
    const hostRef: SessionRef = { value: { room, clientId: 'host' } };
    const run = (ref: SessionRef, msg: ClientMessage, uid: string) =>
      handleClientMessage(ctx, socket, ref, () => {}, msg, limiter, () => uid, async () => uid);

    // START the new paid match.
    run(hostRef, { t: 'START_GAME' } as ClientMessage, U1);
    await flush();

    // New buy-in debited EXACTLY once from each participant.
    expect((await wallet.getWalletView(U1, DAY)).balance).toBe(995_000);
    expect((await wallet.getWalletView(U2, DAY)).balance).toBe(995_000);
    // Recovery flag cleared, game live, advance NOT blocked.
    expect(room.pokerMatchCancelled).toBeUndefined();
    expect(room.gameState).not.toBeNull();
    expect(room.started).toBe(true);
    expect(room.pokerEscrow?.status).toBe('funded');
    expect(advanceTurns).toBeGreaterThanOrEqual(1);
    const newMatchId = room.pokerEscrow!.matchId;

    // The first valid poker action is ACCEPTED (the stale cancelled guard no longer blocks it).
    const state = room.gameState as PokerState;
    const actorSeat = state.toActSeat;
    const actor = [...room.members.values()].find((m) => m.seatIndex === actorSeat)!;
    const before = advanceTurns;
    run({ value: { room, clientId: actor.clientId } }, { t: 'ACTION_REQUEST', action: { type: 'FOLD' } } as ClientMessage, actor.userId!);
    await flush();
    expect(advanceTurns).toBeGreaterThan(before); // action applied → advanced (not rejected)

    // The NEW match settles: pay out final stacks (winner takes the escrow). Conserves.
    await escrow.payoutStacks(room, { stacksBySeat: [10000, 0], playerCount: 2 } as PokerState);
    expect(room.pokerEscrow?.status).toBe('settled');
    expect(room.pokerEscrow!.matchId).toBe(newMatchId);
    // U1 (seat 0) paid the 10000 escrow: 995,000 + 10,000 = 1,005,000.
    expect((await wallet.getWalletView(U1, DAY)).balance).toBe(1_005_000);

    await conn!.sql`DELETE FROM poker_matches WHERE match_id = ${newMatchId}`;
    await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });
});

describe.skipIf(!TEST_DATABASE_URL)('START over a REAL terminal escrow + concurrent duplicates (FAIL 1/4)', () => {
  async function setup(code: string, cancelledLobby: boolean) {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const wallet = await import('../../server/db/pokerWallet');
    const escrow = await import('../../server/pokerEscrow');
    const { handleClientMessage } = await import('../../server/wsHandlers');
    const { createRoom, addMember } = await import('./serverCore');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const U1 = await users.createAccountUser({ email: null, name: `${code}A`, emailVerified: false });
    const U2 = await users.createAccountUser({ email: null, name: `${code}B`, emailVerified: false });
    await wallet.dailyClaim(U1, DAY); await wallet.dailyClaim(U2, DAY);
    const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'host', reconnectToken: 't', name: 'A', userId: U1 }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
    addMember(room, { clientId: 'p2', reconnectToken: 't', name: 'B', userId: U2 });
    if (cancelledLobby) {
      // A REAL terminal escrow: fund then refund → escrow.status='cancelled' (not a hand-set flag).
      await escrow.debitBuyIns(room);
      await escrow.refundBuyIns(room);
      expect(room.pokerEscrow?.status).toBe('cancelled');
      room.pokerMatchCancelled = true; room.gameState = null; room.started = false;
    }
    const rooms = new Map([[room.code, room]]);
    let advanceTurns = 0;
    const ctx = {
      rooms, sockets: new Map(), social: new RoomSocialStore(),
      send: () => {}, sendError: () => {}, broadcastRoom: () => {}, broadcastToRoom: () => {},
      broadcastAndAdvance: (_r: unknown, opts?: { turnAdvanced?: boolean }) => { if (opts?.turnAdvanced) advanceTurns++; },
      sendChatHistory: () => {}, persistRoom: () => {}, welcome: () => {}, handleLeave: () => {},
      makeRoomCode: () => 'X', logRoomEvent: () => {}, logLatestDeal: () => {},
    } as unknown as import('../../server/wsHandlers').WsContext;
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
    const hostRef: SessionRef = { value: { room, clientId: 'host' } };
    const start = () => handleClientMessage(ctx, socket, hostRef, () => {}, { t: 'START_GAME' } as ClientMessage, limiter, () => U1, async () => U1);
    return { wallet, conn, U1, U2, room, start, advance: () => advanceTurns };
  }

  it('a cancelled lobby with a REAL terminal escrow starts a NEW paid match on START (flag cleared)', async () => {
    const { wallet, conn, U1, U2, room, start } = await setup('REALTERM', true);
    const oldMatch = room.pokerEscrow!.matchId; // cancelled match id
    start(); await flush();
    expect(room.pokerEscrow!.matchId).not.toBe(oldMatch);   // brand-new match
    expect(room.pokerEscrow!.status).toBe('funded');
    expect(room.pokerMatchCancelled).toBeUndefined();       // cleared only after success
    expect(room.gameState).not.toBeNull();
    // Each debited exactly ONE new buy-in over the (already-refunded) prior match.
    expect((await wallet.getWalletView(U1, DAY)).balance).toBe(995_000);
    expect((await wallet.getWalletView(U2, DAY)).balance).toBe(995_000);
    await conn!.sql`DELETE FROM poker_matches WHERE match_id IN (${oldMatch}, ${room.pokerEscrow!.matchId})`;
    await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });

  it('concurrent duplicate START_GAME creates ONE match and one debit', async () => {
    const { wallet, conn, U1, U2, room, start } = await setup('CONC', false);
    start(); start(); // two rapid STARTs (serialized by withRoomLock; 2nd sees started/gameState → no-op)
    await flush(); await flush();
    expect(room.gameState).not.toBeNull();
    expect(room.pokerEscrow!.status).toBe('funded');
    // Debited exactly once per player.
    expect((await wallet.getWalletView(U1, DAY)).balance).toBe(995_000);
    expect((await wallet.getWalletView(U2, DAY)).balance).toBe(995_000);
    // Exactly one buy-in ledger row for this match per user.
    const n = await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${room.pokerEscrow!.matchId} AND reason = 'table_buy_in'`;
    expect((n as Array<{ n: number }>)[0].n).toBe(2);
    await conn!.sql`DELETE FROM poker_matches WHERE match_id = ${room.pokerEscrow!.matchId}`;
    await conn!.sql`DELETE FROM users WHERE id IN (${U1}, ${U2})`;
  });
});
