// ---------------------------------------------------------------------------
// wsHandlers Preferans gate (Stage 19.4): Preferans is playable LOCALLY only
// (GAME_CATALOG.preferans.supportsOnline = false, status experimental). The WS
// layer MUST reject CREATE_ROOM preferans so it can never be hosted/joined online,
// even though its serverCore seam is otherwise ready (see preferansServerCore.test).
// Drives the real handleClientMessage with the same minimal in-memory context as
// wsHandlers.tarneeb.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { handleClientMessage, type WsContext, type SessionRef } from '../../server/wsHandlers';
import { removeMember, type ServerRoom } from './serverCore';
import { RoomSocialStore } from '../../server/roomSocial';
import { ConnectionLimiter, DEFAULT_RATE_LIMITS } from './rateLimit';
import type { ClientMessage, ErrorCode } from './messages';
import { GAME_CATALOG } from '../games/catalog';

const socket = {} as never;

function makeCtx(): { ctx: WsContext; rooms: Map<string, ServerRoom>; errors: ErrorCode[] } {
  const rooms = new Map<string, ServerRoom>();
  const errors: ErrorCode[] = [];
  let n = 0;
  const ctx: WsContext = {
    rooms,
    sockets: new Map(),
    social: new RoomSocialStore(),
    send: () => {},
    sendError: (_s, code) => { errors.push(code); },
    broadcastRoom: () => {},
    broadcastToRoom: () => {},
    broadcastAndAdvance: () => {},
    sendChatHistory: () => {},
    persistRoom: () => {},
    welcome: () => {},
    handleLeave: (room, clientId) => {
      const { empty } = removeMember(room, clientId);
      const hasHuman = [...room.members.values()].some((m) => m.type === 'human');
      if (empty || !hasHuman) rooms.delete(room.code);
    },
    makeRoomCode: () => `R${++n}`,
    logRoomEvent: () => {},
    logLatestDeal: () => {},
  };
  return { ctx, rooms, errors };
}

const create = (gameType: string): ClientMessage =>
  ({ t: 'CREATE_ROOM', name: 'Host', modeSelectionType: 'fixed', gameType } as ClientMessage);

describe('wsHandlers rejects hosting Preferans online (Stage 19.4)', () => {
  it('the catalog keeps Preferans local-only (experimental, no online)', () => {
    expect(GAME_CATALOG.preferans.supportsOnline).toBe(false);
    expect(GAME_CATALOG.preferans.status).toBe('experimental');
    expect(GAME_CATALOG.preferans.supportsLocal).toBe(true);
  });

  it('CREATE_ROOM preferans is rejected (BAD_MESSAGE) and creates no room', () => {
    const { ctx, rooms, errors } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, create('preferans'), limiter);

    expect(errors).toContain('BAD_MESSAGE');
    expect(rooms.size).toBe(0);
    expect(sessionRef.value).toBeNull();
  });
});
