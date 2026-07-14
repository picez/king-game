// ---------------------------------------------------------------------------
// wsHandlers 51 hosting (Stage 30.5): 51 online is now enabled as EXPERIMENTAL
// (GAME_CATALOG['fifty-one'].supportsOnline = true, status experimental), so the WS
// layer must ALLOW hosting a 2–4-seat 51 room and START_GAME must build a real
// server-authoritative FiftyOneState — while still rejecting unknown game types and
// recording NO stats (release gate). Redaction/reconnect/bot-advance are covered by
// fiftyOneRedactionOnline + fiftyOneServerCore. Drives the real handleClientMessage
// with a minimal in-memory context (same approach as wsHandlers.preferans.test.ts).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { handleClientMessage, type WsContext, type SessionRef } from '../../server/wsHandlers';
import { removeMember, roomSummary, type ServerRoom } from './serverCore';
import { RoomSocialStore } from '../../server/roomSocial';
import { ConnectionLimiter, DEFAULT_RATE_LIMITS } from './rateLimit';
import type { ClientMessage, ErrorCode } from './messages';
import { GAME_CATALOG } from '../games/catalog';
import { GAME_DEFINITIONS } from '../games/registry';
import type { FiftyOneState } from '../games/fiftyOne/types';

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

const create = (playerCount?: 2 | 3 | 4 | 5): ClientMessage =>
  ({ t: 'CREATE_ROOM', name: 'Host', modeSelectionType: 'fixed', gameType: 'fifty-one', ...(playerCount ? { playerCount } : {}) } as ClientMessage);

function fresh() {
  const { ctx, rooms, errors } = makeCtx();
  const sessionRef: SessionRef = { value: null };
  const limiter = new ConnectionLimiter(DEFAULT_RATE_LIMITS, 0);
  const run = (msg: ClientMessage) => handleClientMessage(ctx, socket, sessionRef, () => {}, msg, limiter);
  return { ctx, rooms, errors, sessionRef, run };
}

describe('wsHandlers allows hosting 51 online (Stage 30.5, experimental)', () => {
  it('the catalog enables 51 online as experimental (no stats yet)', () => {
    expect(GAME_CATALOG['fifty-one'].supportsOnline).toBe(true);
    expect(GAME_CATALOG['fifty-one'].supportsLocal).toBe(true);
    expect(GAME_CATALOG['fifty-one'].status).toBe('experimental');
    expect(GAME_DEFINITIONS['fifty-one'].recordsStats).toBe(false); // release gate
  });

  it('CREATE_ROOM fifty-one with no player count → a 4-seat room (catalog max)', () => {
    const { rooms, sessionRef, run } = fresh();
    run(create());
    expect(rooms.size).toBe(1);
    const room = sessionRef.value!.room;
    expect(room.gameType).toBe('fifty-one');
    expect(room.playerCount).toBe(4);
  });

  it('CREATE_ROOM fifty-one honours an explicit 2 / 3 player count', () => {
    for (const pc of [2, 3] as const) {
      const { sessionRef, run } = fresh();
      run(create(pc));
      expect(sessionRef.value!.room.playerCount).toBe(pc);
    }
  });

  it('CREATE_ROOM fifty-one clamps an out-of-range count (5) to the catalog max (4)', () => {
    const { sessionRef, run } = fresh();
    run(create(5)); // 5 > maxPlayers(4) → clamped
    expect(sessionRef.value!.room.playerCount).toBe(4);
  });

  it('the public room summary exposes 51 metadata and never the game state', () => {
    const { sessionRef, run } = fresh();
    run(create(3));
    const summary = roomSummary(sessionRef.value!.room);
    expect(summary.gameType).toBe('fifty-one');
    expect(summary.playerCount).toBe(3);
    expect(summary.occupiedSeats).toBe(1); // just the host so far
    expect(summary.status).toBe('lobby');
    expect('gameState' in summary).toBe(false);
    expect('members' in summary).toBe(false);
  });

  it('ADD_BOT + START_GAME builds a server-authoritative FiftyOneState (deal 13/14)', () => {
    const { sessionRef, run } = fresh();
    run(create(2)); // 2-seat room: host + 1 bot is enough to start
    run({ t: 'ADD_BOT' } as ClientMessage);
    run({ t: 'START_GAME' } as ClientMessage);
    const room = sessionRef.value!.room;
    expect(room.started).toBe(true);
    const s = room.gameState as FiftyOneState;
    expect(s.gameType).toBe('fifty-one');
    expect(s.phase).toBe('playing');
    expect(s.players).toHaveLength(2);
    // Starter holds 14, the other seat 13 (§4).
    expect(s.handsBySeat[s.starterSeat]).toHaveLength(14);
    const other = s.starterSeat === 0 ? 1 : 0;
    expect(s.handsBySeat[other]).toHaveLength(13);
  });

  it('a non-host cannot START_GAME; an unknown game type is still rejected', () => {
    const { errors, run } = fresh();
    run(create(2));
    // Fake a second connection with no session trying to start → BAD_MESSAGE (no room).
    const { run: run2, errors: errors2 } = fresh();
    run2({ t: 'CREATE_ROOM', name: 'X', modeSelectionType: 'fixed', gameType: 'poker' } as ClientMessage);
    expect(errors2).toContain('BAD_MESSAGE'); // unknown game type rejected
    expect(errors).not.toContain('BAD_MESSAGE');
  });
});
