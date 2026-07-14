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
import { normalizeTargetScore } from '../src/games/tarneeb/rules';
import { RoomSocialStore, handleReaction, handleChat, handleChatMedia, type SocialIO } from './roomSocial';
import type { ConnectionLimiter } from '../src/net/rateLimit';
import { scryptPasswordHasher } from './roomPassword';
import { hashReconnectToken } from './reconnectToken';

/** One connection's room session (mutable; set on CREATE/JOIN/RECONNECT). */
export interface Session { room: ServerRoom; clientId: string }
export interface SessionRef { value: Session | null }

/**
 * If this connection already holds a room session, leave it before establishing a
 * new one. Without this, a socket that CREATEs/JOINs a second room silently
 * abandons the first — its seat stays `connected:true` forever (the close handler
 * only ever sees the *latest* session), leaking the room until its hard TTL (БЕЗ-2).
 */
function leaveCurrentSession(ctx: WsContext, sessionRef: SessionRef): void {
  if (sessionRef.value) {
    ctx.handleLeave(sessionRef.value.room, sessionRef.value.clientId);
    sessionRef.value = null;
  }
}

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
  welcome(socket: WebSocket, member: ServerMember, room: ServerRoom, reconnectToken: string): void;
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
  ctx: WsContext, socket: WebSocket, sessionRef: SessionRef, attachIdentity: () => void,
  msg: ClientMessage, limiter: ConnectionLimiter,
): void {
  const { send, sendError } = ctx;
  const socialIO: SocialIO = {
    sendError: ctx.sendError, broadcastToRoom: ctx.broadcastToRoom, newId: randomUUID,
  };

  // Per-connection message throttle (БЕЗ-1): reject before doing any work so a
  // flood costs the server ~nothing. Generous burst → normal play never trips it.
  const now = Date.now();
  if (!limiter.allowMessage(now)) {
    return sendError(socket, 'RATE_LIMITED', 'Too many requests — slow down');
  }

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
      // Room capacity (Stage 9.10; Deberc Solo/Pairs added Stage 28.2). Honor an
      // explicit host player-count when it is within the game's catalog range — this
      // is how a Deberc host picks Solo (3 seats) vs Pairs (4 seats). Otherwise fall
      // back to the catalog max, so older clients that send no playerCount behave
      // exactly as before (backward compatible). Capacity stays server-enforced.
      const requested = msg.playerCount;
      const playerCount = (
        typeof requested === 'number' && requested >= entry.minPlayers && requested <= entry.maxPlayers
          ? requested
          : entry.maxPlayers
      ) as 2 | 3 | 4 | 5;
      const variant = gameType === 'durak' ? (msg.variant === 'transfer' ? 'transfer' : 'simple') : undefined;
      const matchSize = gameType === 'deberc' ? (msg.matchSize === 'big' ? 'big' : 'small') : undefined;
      // Tarneeb Solo/Pairs (Stage 28.4). Default Pairs; anything but 'solo' → pairs.
      const tarneebVariant = gameType === 'tarneeb' ? (msg.tarneebVariant === 'solo' ? 'solo' : 'pairs') : undefined;
      // Tarneeb match target (Stage 29.8): normalised to a safe integer here (a missing/invalid
      // value → the default 41), so the room stores a sane value the lobby can display pre-start.
      const tarneebTargetScore = gameType === 'tarneeb' ? normalizeTargetScore(msg.tarneebTargetScore) : undefined;
      // Bound room churn (БЕЗ-1): stricter than the general message limit. Checked
      // after validation, before we leave the current room, so a throttled create
      // leaves the connection's existing room intact.
      if (!limiter.allowCreateRoom(now)) {
        return sendError(socket, 'RATE_LIMITED', 'Creating rooms too fast — slow down');
      }
      // Abandon any room this connection was already in (else it leaks — БЕЗ-2).
      leaveCurrentSession(ctx, sessionRef);
      const code = ctx.makeRoomCode();
      const clientId = randomUUID();
      // Generate the plaintext token here; the room stores only its hash (БЕЗ-4).
      const reconnectToken = randomUUID();
      const room = createRoom({
        code,
        gameType,
        variant,
        matchSize,
        tarneebVariant,
        tarneebTargetScore,
        playerCount,
        modeSelectionType: msg.modeSelectionType === 'dealer_choice' ? 'dealer_choice' : 'fixed',
        host: { clientId, reconnectToken: hashReconnectToken(reconnectToken), name: msg.name, avatar: msg.avatar },
        // Optional join password — hashed with a fresh salt via the strong
        // server-side scrypt KDF (БЕЗ-3).
        password: msg.password,
        salt: randomUUID(),
        hasher: scryptPasswordHasher,
        turnTimerSec: msg.turnTimerSec,
      });
      ctx.rooms.set(code, room);
      ctx.sockets.set(clientId, socket);
      sessionRef.value = { room, clientId };
      attachIdentity();
      ctx.welcome(socket, room.members.get(clientId)!, room, reconnectToken);
      ctx.broadcastRoom(room);
      ctx.persistRoom(room);
      ctx.logRoomEvent('CREATE_ROOM', code, room);
      break;
    }

    case 'JOIN_ROOM': {
      // Brute-force gate (БЕЗ-6): checked before the room lookup so a wrong code
      // and a wrong password are throttled uniformly (no timing oracle on which
      // codes exist). Only FAILED joins spend the budget, so real users are
      // unaffected; a guesser is capped once they burn through it.
      if (!limiter.canAttemptJoin(now)) {
        return sendError(socket, 'RATE_LIMITED', 'Too many failed join attempts — wait a moment');
      }
      const reqCode = String(msg.code || '').toUpperCase();
      const room = ctx.rooms.get(reqCode);
      if (!room) {
        limiter.recordJoinFailure(now);
        ctx.logRoomEvent('JOIN_ROOM', reqCode, null, 'ROOM_NOT_FOUND');
        return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
      }
      const clientId = randomUUID();
      // Plaintext token minted here; only its hash is stored (БЕЗ-4).
      const reconnectToken = randomUUID();
      const res = addMember(room, {
        clientId, reconnectToken: hashReconnectToken(reconnectToken), name: msg.name, role: msg.role, password: msg.password, avatar: msg.avatar,
      }, scryptPasswordHasher);
      if (!res.ok) {
        // Only a wrong password counts as a guessing attempt; full/name-taken/
        // already-started are legitimate outcomes and must not penalise the user.
        if (res.error === 'BAD_PASSWORD') limiter.recordJoinFailure(now);
        ctx.logRoomEvent('JOIN_ROOM', reqCode, room, res.error);
        const message = res.error === 'BAD_PASSWORD' ? 'Wrong or missing room password' : 'Cannot join room';
        return sendError(socket, res.error!, message);
      }
      // Joined successfully — abandon any previous room this connection held so it
      // doesn't leak with a stuck-connected seat (БЕЗ-2).
      leaveCurrentSession(ctx, sessionRef);
      ctx.sockets.set(clientId, socket);
      sessionRef.value = { room, clientId };
      attachIdentity();
      ctx.welcome(socket, room.members.get(clientId)!, room, reconnectToken);
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
      // Match against the stored hash (БЕЗ-4). Fall back to a raw match for rooms
      // persisted before the upgrade (their token is still plaintext at rest);
      // such rooms are ephemeral and re-hash on the next persisted change.
      const member = reconnectMember(room, hashReconnectToken(msg.reconnectToken))
        ?? reconnectMember(room, msg.reconnectToken);
      if (!member) {
        ctx.logRoomEvent('RECONNECT', reqCode, room, 'UNKNOWN_TOKEN');
        return sendError(socket, 'ROOM_NOT_FOUND', 'Unknown reconnect token');
      }
      ctx.sockets.set(member.clientId, socket);
      sessionRef.value = { room, clientId: member.clientId };
      attachIdentity();
      // Echo back the plaintext the client already holds (never the stored hash).
      ctx.welcome(socket, member, room, msg.reconnectToken);
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
      // addBot itself rejects non-host / started / full. A bot never reconnects,
      // but we still store only a hashed token so no plaintext lives at rest (БЕЗ-4).
      const res = addBot(room, clientId, { clientId: randomUUID(), reconnectToken: hashReconnectToken(randomUUID()) });
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

    case 'SEND_CHAT_MEDIA': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      handleChatMedia(ctx.social, socialIO, socket, sessionRef.value.room, sessionRef.value.clientId, msg.mediaId);
      break;
    }

    case 'PING':
      send(socket, { t: 'PONG' });
      break;

    default:
      sendError(socket, 'BAD_MESSAGE', `Unknown message: ${(msg as { t: string }).t}`);
  }
}
