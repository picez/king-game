// ---------------------------------------------------------------------------
// WebSocket client-message dispatch (extracted from server/index.ts, Stage 8.1).
//
// `handleClientMessage` is the same big switch as before — moved verbatim into a
// function that receives a context (`WsContext`) of the server-state operations
// that still live in index.ts (broadcast/persist/timers/lifecycle), plus a
// per-connection `sessionRef` and `attachIdentity`. NO protocol, gameplay,
// rules, scoring, persistence, auth, or chat/reaction behaviour changes — every
// branch does exactly what it did inline.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, ErrorCode } from '../src/net/messages';
import {
  createRoom, addMember, reconnectMember, kickMember, addBot, setTimer,
  startGame, applyActionRequest, listRoomSummaries, sanitizedStateFor,
  type ServerRoom, type ServerMember,
} from '../src/net/serverCore';
import { isGameType, getGameCatalogEntry } from '../src/games/catalog';
import { RoomSocialStore, handleReaction, handleChat, type SocialIO } from './roomSocial';

/** One connection's room session (mutable; set on CREATE/JOIN/RECONNECT). */
export interface Session { room: ServerRoom; clientId: string }
export interface SessionRef { value: Session | null }

/** Server-state operations that remain in index.ts and the WS dispatch needs. */
export interface WsContext {
  rooms: Map<string, ServerRoom>;
  sockets: Map<string, WebSocket>;
  social: RoomSocialStore;
  send(socket: WebSocket, msg: ServerMessage): void;
  sendError(socket: WebSocket, code: ErrorCode, message: string): void;
  broadcastRoom(room: ServerRoom): void;
  broadcastToRoom(room: ServerRoom, msg: ServerMessage): void;
  broadcastAndAdvance(room: ServerRoom): void;
  sendChatHistory(socket: WebSocket, code: string): void;
  persistRoom(room: ServerRoom): void;
  welcome(socket: WebSocket, member: ServerMember, room: ServerRoom): void;
  handleLeave(room: ServerRoom, clientId: string): void;
  makeRoomCode(): string;
  logRoomEvent(event: string, code: string, room: ServerRoom | null, errorCode?: string): void;
  logLatestDeal(room: ServerRoom): void;
}

/**
 * Routes one parsed client message. `sessionRef.value` is read/assigned here (so
 * the connection's close handler sees the current session); `attachIdentity`
 * stamps the resolved userId onto the seated member after CREATE/JOIN/RECONNECT.
 */
export function handleClientMessage(
  ctx: WsContext, socket: WebSocket, sessionRef: SessionRef, attachIdentity: () => void, msg: ClientMessage,
): void {
  const { send, sendError } = ctx;
  const socialIO: SocialIO = {
    sendError: ctx.sendError, broadcastToRoom: ctx.broadcastToRoom, newId: randomUUID,
  };

  switch (msg.t) {
    case 'CREATE_ROOM': {
      // Resolve & validate the game type (default King). Unknown / not-online → reject.
      if (msg.gameType !== undefined && !isGameType(msg.gameType)) {
        return sendError(socket, 'BAD_MESSAGE', 'Unknown game type');
      }
      const gameType = msg.gameType ?? 'king';
      const entry = getGameCatalogEntry(gameType)!;
      if (!entry.supportsOnline) {
        return sendError(socket, 'BAD_MESSAGE', 'Game is not available online');
      }
      // No player-count picker (Stage 9.10): the room caps at the catalog max and
      // the host starts once >= minPlayers are seated. Capacity is server-enforced.
      const playerCount = entry.maxPlayers as 2 | 3 | 4;
      const variant = gameType === 'durak' ? (msg.variant === 'transfer' ? 'transfer' : 'simple') : undefined;
      const code = ctx.makeRoomCode();
      const clientId = randomUUID();
      const room = createRoom({
        code,
        gameType,
        variant,
        playerCount,
        modeSelectionType: msg.modeSelectionType === 'dealer_choice' ? 'dealer_choice' : 'fixed',
        host: { clientId, reconnectToken: randomUUID(), name: msg.name, avatar: msg.avatar },
        // Optional join password — hashed with a fresh salt inside serverCore.
        password: msg.password,
        salt: randomUUID(),
        turnTimerSec: msg.turnTimerSec,
      });
      ctx.rooms.set(code, room);
      ctx.sockets.set(clientId, socket);
      sessionRef.value = { room, clientId };
      attachIdentity();
      ctx.welcome(socket, room.members.get(clientId)!, room);
      ctx.broadcastRoom(room);
      ctx.persistRoom(room);
      ctx.logRoomEvent('CREATE_ROOM', code, room);
      break;
    }

    case 'JOIN_ROOM': {
      const reqCode = String(msg.code || '').toUpperCase();
      const room = ctx.rooms.get(reqCode);
      if (!room) {
        ctx.logRoomEvent('JOIN_ROOM', reqCode, null, 'ROOM_NOT_FOUND');
        return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
      }
      const clientId = randomUUID();
      const res = addMember(room, {
        clientId, reconnectToken: randomUUID(), name: msg.name, role: msg.role, password: msg.password, avatar: msg.avatar,
      });
      if (!res.ok) {
        ctx.logRoomEvent('JOIN_ROOM', reqCode, room, res.error);
        const message = res.error === 'BAD_PASSWORD' ? 'Wrong or missing room password' : 'Cannot join room';
        return sendError(socket, res.error!, message);
      }
      ctx.sockets.set(clientId, socket);
      sessionRef.value = { room, clientId };
      attachIdentity();
      ctx.welcome(socket, room.members.get(clientId)!, room);
      ctx.broadcastRoom(room);
      if (room.gameState) send(socket, { t: 'STATE_UPDATE', state: sanitizedStateFor(room, clientId) });
      ctx.sendChatHistory(socket, room.code);
      ctx.persistRoom(room);
      ctx.logRoomEvent('JOIN_ROOM', reqCode, room);
      break;
    }

    case 'RECONNECT': {
      const reqCode = String(msg.code || '').toUpperCase();
      const room = ctx.rooms.get(reqCode);
      if (!room) {
        ctx.logRoomEvent('RECONNECT', reqCode, null, 'ROOM_NOT_FOUND');
        return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
      }
      const member = reconnectMember(room, msg.reconnectToken);
      if (!member) {
        ctx.logRoomEvent('RECONNECT', reqCode, room, 'UNKNOWN_TOKEN');
        return sendError(socket, 'ROOM_NOT_FOUND', 'Unknown reconnect token');
      }
      ctx.sockets.set(member.clientId, socket);
      sessionRef.value = { room, clientId: member.clientId };
      attachIdentity();
      ctx.welcome(socket, member, room);
      ctx.broadcastRoom(room);
      // Reconnecting client immediately gets the current sanitized state.
      if (room.gameState) send(socket, { t: 'STATE_UPDATE', state: sanitizedStateFor(room, member.clientId) });
      ctx.sendChatHistory(socket, room.code);
      ctx.persistRoom(room);
      // Re-evaluate timers: the player is connected again, so a pending AI
      // substitute for their turn is cancelled (clearRoomTimers) and only the
      // normal turn timer (if any) is rescheduled.
      if (room.gameState) ctx.broadcastAndAdvance(room);
      break;
    }

    case 'START_GAME': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      if (!room.members.get(clientId)?.isHost) return sendError(socket, 'NOT_HOST', 'Only the host may start');
      const res = startGame(room, { now: Date.now() });
      if (!res.ok) return sendError(socket, res.error!, 'Cannot start game');
      ctx.logLatestDeal(room);
      ctx.broadcastRoom(room);
      ctx.broadcastAndAdvance(room);
      ctx.persistRoom(room);
      break;
    }

    case 'ACTION_REQUEST': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      const res = applyActionRequest(room, clientId, msg.action);
      if (!res.ok) return sendError(socket, res.error!, 'Action rejected');
      ctx.broadcastAndAdvance(room);
      ctx.persistRoom(room);
      break;
    }

    case 'LIST_ROOMS': {
      // Discovery: public summaries only (no session required).
      send(socket, { t: 'ROOMS_LIST', rooms: listRoomSummaries(ctx.rooms.values()) });
      break;
    }

    // Legacy host-authoritative messages — ignored in server-authoritative mode.
    case 'HOST_STATE':
      break;

    case 'KICK_MEMBER': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      const target = String(msg.clientId || '');
      const res = kickMember(room, clientId, target);
      if (!res.ok) return sendError(socket, res.error!, 'Cannot remove member');
      // Tell the kicked client, then drop its socket. Its membership (and
      // reconnect token) is already gone, so it cannot RECONNECT.
      const targetSocket = ctx.sockets.get(target);
      if (targetSocket) {
        send(targetSocket, { t: 'KICKED', reason: 'HOST_REMOVED' });
        try { targetSocket.close(); } catch { /* already closing */ }
      }
      ctx.sockets.delete(target);
      ctx.broadcastRoom(room);
      ctx.persistRoom(room);
      break;
    }

    case 'ADD_BOT': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      // addBot itself rejects non-host / started / full.
      const res = addBot(room, clientId, { clientId: randomUUID(), reconnectToken: randomUUID() });
      if (!res.ok) return sendError(socket, res.error!, 'Cannot add bot');
      ctx.broadcastRoom(room);
      ctx.persistRoom(room);
      ctx.logRoomEvent('ADD_BOT', room.code, room);
      break;
    }

    case 'SET_TIMER': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      const res = setTimer(room, clientId, Number(msg.turnTimerSec));
      if (!res.ok) return sendError(socket, res.error!, 'Cannot set timer');
      ctx.broadcastRoom(room);
      ctx.persistRoom(room);
      break;
    }

    case 'LEAVE_ROOM': {
      if (sessionRef.value) ctx.handleLeave(sessionRef.value.room, sessionRef.value.clientId);
      sessionRef.value = null;
      break;
    }

    // ── Room social (Stage 7): reactions + chat. EPHEMERAL — never touches the
    //    reducer/GameState/persistence; server is authoritative on the whitelist,
    //    the 30s reaction cooldown, the 3s chat rate limit, the length cap, and
    //    the profanity/URL filter. No userId/token is exposed.
    case 'SEND_REACTION': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      handleReaction(ctx.social, socialIO, socket, sessionRef.value.room, sessionRef.value.clientId, msg.emoji);
      break;
    }

    case 'SEND_CHAT': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      handleChat(ctx.social, socialIO, socket, sessionRef.value.room, sessionRef.value.clientId, msg.text);
      break;
    }

    case 'PING':
      send(socket, { t: 'PONG' });
      break;

    default:
      sendError(socket, 'BAD_MESSAGE', `Unknown message: ${(msg as { t: string }).t}`);
  }
}
