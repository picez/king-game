// Behavioural guard for БЕЗ-2 (room leak) + БЕЗ-1 (create throttle): drives the
// real handleClientMessage with a minimal in-memory context and asserts that a
// single connection creating/joining a second room abandons the first instead of
// leaking it, and that CREATE_ROOM is rate-limited.
import { describe, it, expect } from 'vitest';
import { handleClientMessage, type WsContext, type SessionRef } from '../../server/wsHandlers';
import { removeMember, type ServerRoom } from './serverCore';
import { RoomSocialStore } from '../../server/roomSocial';
import { ConnectionLimiter, DEFAULT_RATE_LIMITS, type RateLimitConfig } from './rateLimit';
import type { ClientMessage } from './messages';

const socket = {} as never; // handlers pass it through to ctx.send (a no-op here)

function makeCtx(): { ctx: WsContext; rooms: Map<string, ServerRoom>; codes: string[] } {
  const rooms = new Map<string, ServerRoom>();
  let n = 0;
  const ctx: WsContext = {
    rooms,
    sockets: new Map(),
    social: new RoomSocialStore(),
    send: () => {},
    sendError: () => {},
    broadcastRoom: () => {},
    broadcastToRoom: () => {},
    broadcastAndAdvance: () => {},
    sendChatHistory: () => {},
    persistRoom: () => {},
    welcome: () => {},
    // Mirrors server/index.ts handleLeave: drop the seat, delete the room once no
    // humans remain. This is the behaviour the leak fix relies on.
    handleLeave: (room, clientId) => {
      const { empty } = removeMember(room, clientId);
      const hasHuman = [...room.members.values()].some((m) => m.type === 'human');
      if (empty || !hasHuman) rooms.delete(room.code);
    },
    makeRoomCode: () => `R${++n}`,
    logRoomEvent: () => {},
    logLatestDeal: () => {},
  };
  return { ctx, rooms, codes: [] };
}

const createMsg = (name: string): ClientMessage =>
  ({ t: 'CREATE_ROOM', name, modeSelectionType: 'fixed' } as ClientMessage);

describe('handleClientMessage — no room leak across CREATE (БЕЗ-2)', () => {
  it('leaves the first room when the same connection creates a second', () => {
    const { ctx, rooms } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, createMsg('Host'), limiter);
    const firstCode = sessionRef.value!.room.code;
    expect(rooms.has(firstCode)).toBe(true);
    expect(rooms.size).toBe(1);

    handleClientMessage(ctx, socket, sessionRef, () => {}, createMsg('Host'), limiter);
    const secondCode = sessionRef.value!.room.code;

    expect(secondCode).not.toBe(firstCode);
    expect(rooms.has(firstCode)).toBe(false); // first room did NOT leak
    expect(rooms.size).toBe(1);               // exactly one room held per connection
  });
});

describe('handleClientMessage — CREATE_ROOM throttle (БЕЗ-1)', () => {
  it('rejects creates past the burst without leaving the current room', () => {
    const { ctx, rooms } = makeCtx();
    const sessionRef: SessionRef = { value: null };
    // Tight config: burst of 2 creates, no refill within the test instant.
    const cfg: RateLimitConfig = { message: { capacity: 100, refillPerSec: 0 }, createRoom: { capacity: 2, refillPerSec: 0 } };
    const limiter = new ConnectionLimiter(cfg, 0);

    handleClientMessage(ctx, socket, sessionRef, () => {}, createMsg('H'), limiter);
    handleClientMessage(ctx, socket, sessionRef, () => {}, createMsg('H'), limiter);
    const heldCode = sessionRef.value!.room.code;
    expect(rooms.size).toBe(1);

    // Third create is throttled: session + room unchanged (throttle checked before leave).
    handleClientMessage(ctx, socket, sessionRef, () => {}, createMsg('H'), limiter);
    expect(sessionRef.value!.room.code).toBe(heldCode);
    expect(rooms.size).toBe(1);
  });
});
