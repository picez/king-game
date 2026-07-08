// ---------------------------------------------------------------------------
// wsHandlers guard (Stage 10.4): the WS layer must still REJECT hosting Tarneeb
// online while GAME_CATALOG.tarneeb.supportsOnline is false — even though the
// serverCore path is technically ready (tarneebServerCore.test.ts). Also proves an
// unknown game type is rejected. Drives the real handleClientMessage with a
// minimal in-memory context (same approach as wsHandlers.leak.test.ts).
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

describe('wsHandlers still blocks hosting Tarneeb online (Stage 10.4)', () => {
  it('the catalog keeps Tarneeb online disabled', () => {
    expect(GAME_CATALOG.tarneeb.supportsOnline).toBe(false);
  });

  it('CREATE_ROOM tarneeb is rejected and creates no room', () => {
    const { ctx, rooms, errors } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, create('tarneeb'), limiter);

    expect(errors).toContain('BAD_MESSAGE'); // "Game is not available online"
    expect(rooms.size).toBe(0);
    expect(sessionRef.value).toBeNull();
  });

  it('CREATE_ROOM with an unknown game type is rejected too', () => {
    const { ctx, rooms, errors } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, create('poker'), limiter);

    expect(errors).toContain('BAD_MESSAGE');
    expect(rooms.size).toBe(0);
  });

  it('positive control: an online-enabled game (King) still creates a room', () => {
    const { ctx, rooms } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, create('king'), limiter);

    expect(rooms.size).toBe(1);
    expect(sessionRef.value?.room.gameType).toBe('king');
  });
});
