// ---------------------------------------------------------------------------
// wsHandlers Preferans hosting (Stage 19.5): Preferans online is now enabled as
// experimental (GAME_CATALOG.preferans.supportsOnline = true, status experimental),
// so the WS layer must ALLOW hosting a 3-seat Preferans room — while still rejecting
// unknown game types. Start-gating (needs 3 seats), room-full, redaction, reconnect
// and social are exercised end-to-end by scripts/e2e-online.mjs + preferansServerCore.
// Drives the real handleClientMessage with a minimal in-memory context (same
// approach as wsHandlers.tarneeb.test.ts).
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

describe('wsHandlers allows hosting Preferans online (Stage 19.7, released)', () => {
  it('the catalog enables Preferans online (available, with stats)', () => {
    expect(GAME_CATALOG.preferans.supportsOnline).toBe(true);
    expect(GAME_CATALOG.preferans.status).toBe('available');
    expect(GAME_CATALOG.preferans.supportsLocal).toBe(true);
  });

  it('CREATE_ROOM preferans creates a 3-seat Preferans room', () => {
    const { ctx, rooms } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, create('preferans'), limiter);

    expect(rooms.size).toBe(1);
    const room = sessionRef.value!.room;
    expect(room.gameType).toBe('preferans');
    expect(room.playerCount).toBe(3); // catalog min = max = 3
  });

  it('CREATE_ROOM with an unknown game type is still rejected', () => {
    const { ctx, rooms, errors } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, create('chess'), limiter);

    expect(errors).toContain('BAD_MESSAGE');
    expect(rooms.size).toBe(0);
  });
});
