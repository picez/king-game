// ---------------------------------------------------------------------------
// wsHandlers Tarneeb hosting (Stage 10.5): Tarneeb online is now enabled
// (GAME_CATALOG.tarneeb.supportsOnline = true, status experimental), so the WS
// layer must ALLOW hosting a Tarneeb room — while still rejecting unknown game
// types. Drives the real handleClientMessage with a minimal in-memory context
// (same approach as wsHandlers.leak.test.ts).
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

describe('wsHandlers now allows hosting Tarneeb online (Stage 10.5)', () => {
  it('the catalog enables Tarneeb online (available)', () => {
    expect(GAME_CATALOG.tarneeb.supportsOnline).toBe(true);
    expect(GAME_CATALOG.tarneeb.status).toBe('available');
  });

  it('CREATE_ROOM tarneeb creates a 4-seat Tarneeb room', () => {
    const { ctx, rooms } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, create('tarneeb'), limiter);

    expect(rooms.size).toBe(1);
    const room = sessionRef.value!.room;
    expect(room.gameType).toBe('tarneeb');
    expect(room.playerCount).toBe(4); // catalog max = 4
  });

  it('CREATE_ROOM honors the Tarneeb variant (Solo) and defaults to Pairs (Stage 28.4/28.5)', () => {
    const host = (tarneebVariant?: string): ClientMessage =>
      ({ t: 'CREATE_ROOM', name: 'Host', modeSelectionType: 'fixed', gameType: 'tarneeb', tarneebVariant } as ClientMessage);

    const solo = makeCtx();
    handleClientMessage(solo.ctx, socket, { value: null } as SessionRef, () => {}, host('solo'), new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0));
    expect([...solo.rooms.values()][0].tarneebVariant).toBe('solo');

    const pairs = makeCtx();
    handleClientMessage(pairs.ctx, socket, { value: null } as SessionRef, () => {}, host('pairs'), new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0));
    expect([...pairs.rooms.values()][0].tarneebVariant).toBe('pairs');

    // Omitted (legacy client) → pairs.
    const def = makeCtx();
    handleClientMessage(def.ctx, socket, { value: null } as SessionRef, () => {}, host(undefined), new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0));
    expect([...def.rooms.values()][0].tarneebVariant).toBe('pairs');
  });

  it('CREATE_ROOM with an unknown game type is still rejected', () => {
    const { ctx, rooms, errors } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, create('poker'), limiter);

    expect(errors).toContain('BAD_MESSAGE');
    expect(rooms.size).toBe(0);
  });
});
