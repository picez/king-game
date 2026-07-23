import { describe, it, expect, vi } from 'vitest';
import type { ClientMessage } from './messages';
import type { SessionRef } from '../../server/wsHandlers';
import { handleClientMessage } from '../../server/wsHandlers';
import { RoomSocialStore } from '../../server/roomSocial';
import { ConnectionLimiter, DEFAULT_RATE_LIMITS } from './rateLimit';
import { createRoom, addMember, snapshot, serializeRoom, deserializeRoom } from './serverCore';
import { settlementPending, payoutPending, pokerRecoveryBlocked } from '../../server/pokerEscrow';
import { handleRematchRequest } from '../../server/pokerRematch';
import type { PokerState } from '../games/poker/types';

// Stage 37.7.8 FAIL 2: an `invalid` payout is a PERMANENT operator FREEZE (not a transient retry).
// A frozen bankroll room: is skipped by the settlement sweep, blocks START/ACTION/REMATCH, exposes
// ONLY the public `frozen` recovery status (no escrow/economy leak), and survives serialize/restore.
// These are pure (no DB): the room is hand-built as if `invalid` already froze it.

const socket = {} as never;
const FINISHED = { phase: 'game_finished', stacksBySeat: [10000, 0], playerCount: 2 } as unknown as PokerState;

function frozenRoom(code = 'FRZ1') {
  const room = createRoom({ code, playerCount: 2, modeSelectionType: 'fixed', gameType: 'poker', host: { clientId: 'host', reconnectToken: 't', name: 'A', userId: 'u1' }, pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: 5000 });
  addMember(room, { clientId: 'p2', reconnectToken: 't', name: 'B', userId: 'u2' });
  room.started = true;
  room.gameState = FINISHED as unknown as typeof room.gameState;
  room.pokerEscrow = { matchId: 'm-frozen', buyIn: 5000, status: 'funded', seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] };
  room.pokerFrozen = true; // invalid payout froze it
  return room;
}

describe('FAIL 2 — a frozen (invalid-payout) room is never auto-retried by the sweep', () => {
  it('payoutPending / settlementPending are FALSE for a frozen room', () => {
    const room = frozenRoom();
    expect(payoutPending(room)).toBe(false);     // sweep skips it → no 45s payout re-attempt
    expect(settlementPending(room)).toBe(false);
    expect(pokerRecoveryBlocked(room)).toBe(true); // still blocks rematch/actions
  });
});

describe('FAIL 2 — the public snapshot exposes ONLY `frozen` (no economy leak)', () => {
  it('snapshot recovery is frozen and carries no escrow/matchId/seats', () => {
    const snap = snapshot(frozenRoom()) as unknown as Record<string, unknown>;
    expect(snap.pokerRecovery).toBe('frozen');
    expect(snap.pokerEscrow).toBeUndefined();
    expect(JSON.stringify(snap)).not.toMatch(/m-frozen|"seats"|userId|buyIn/);
  });
});

describe('FAIL 2 — the frozen flag survives serialize → restore', () => {
  it('a persisted+restored room stays frozen and still snapshots as frozen', () => {
    const persisted = serializeRoom(frozenRoom());
    expect((persisted as unknown as { pokerFrozen?: boolean }).pokerFrozen).toBe(true);
    const restored = deserializeRoom(persisted)!;
    expect(restored).not.toBeNull();
    expect(restored.pokerFrozen).toBe(true);
    expect((snapshot(restored) as unknown as { pokerRecovery?: string }).pokerRecovery).toBe('frozen');
  });
});

describe('FAIL 2 — a frozen room rejects START / ACTION / REMATCH', () => {
  function ctxFor(room: ReturnType<typeof frozenRoom>, errors: string[]) {
    return {
      rooms: new Map([[room.code, room]]), sockets: new Map(), social: new RoomSocialStore(),
      send: () => {}, sendError: (_s: unknown, code: string) => { errors.push(code); },
      broadcastRoom: () => {}, broadcastToRoom: () => {}, broadcastAndAdvance: () => {},
      sendChatHistory: () => {}, persistRoom: () => {}, welcome: () => {}, handleLeave: () => {},
      makeRoomCode: () => 'X', logRoomEvent: () => {}, logLatestDeal: () => {},
    } as unknown as import('../../server/wsHandlers').WsContext;
  }
  const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

  it('START_GAME on a frozen room is rejected (ILLEGAL_ACTION), never debits', () => {
    const room = frozenRoom('FRZ_ST'); room.started = false; room.gameState = null; // a frozen lobby
    const errors: string[] = [];
    const ref: SessionRef = { value: { room, clientId: 'host' } };
    handleClientMessage(ctxFor(room, errors), socket, ref, () => {}, { t: 'START_GAME' } as ClientMessage, limiter, () => 'u1', async () => 'u1');
    expect(errors).toContain('ILLEGAL_ACTION');
  });

  it('ACTION_REQUEST on a frozen room is rejected', () => {
    const room = frozenRoom('FRZ_AC');
    const errors: string[] = [];
    const ref: SessionRef = { value: { room, clientId: 'host' } };
    handleClientMessage(ctxFor(room, errors), socket, ref, () => {}, { t: 'ACTION_REQUEST', action: { type: 'FOLD' } } as ClientMessage, limiter, () => 'u1', async () => 'u1');
    expect(errors).toContain('ILLEGAL_ACTION');
  });

  it('REMATCH on a frozen room does NOT run the lifecycle (recovery snapshot instead)', () => {
    const room = frozenRoom('FRZ_RM');
    const runRematch = vi.fn(async () => {});
    const broadcastRoom = vi.fn();
    const out = handleRematchRequest({ value: { room, clientId: 'host' } }, false, {
      isRoomFinished: () => true, pokerRecoveryBlocked, isBankrollRoom: () => true,
      broadcastRoom, broadcastRematch: () => {}, markReady: () => {}, removeReady: () => {},
      allHumansReady: () => true, withRoomLock: async (_c, fn) => fn(), runRematch,
      restartNonBankroll: () => {},
    });
    expect(out).toBe('recovery_broadcast');
    expect(runRematch).not.toHaveBeenCalled();
    expect(broadcastRoom).toHaveBeenCalledOnce(); // honest recovery snapshot
  });
});
