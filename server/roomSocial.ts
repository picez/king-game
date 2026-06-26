// ---------------------------------------------------------------------------
// Room social: reactions + chat (extracted from server/index.ts, Stage 8.1).
//
// EPHEMERAL, in-memory only — NOT game state: never touches the reducer, the
// GameState, or persistence (no DB, no rooms.json). Per room we keep last-action
// timestamps (server-side cooldown / rate limit) and a small ring buffer of
// recent chat. All of it is dropped when the room is removed and lost on restart.
//
// Behaviour is byte-for-byte the same as the previous inline implementation:
// whitelist check, 30s reaction cooldown, 3s chat rate limit, length cap, and the
// profanity/URL filter (all from src/net/chatFilter). No userId/token is exposed.
// ---------------------------------------------------------------------------

import type { WebSocket } from 'ws';
import type { ChatMessage, ServerMessage, ErrorCode } from '../src/net/messages';
import type { ServerRoom } from '../src/net/serverCore';
import {
  isValidReaction, filterChat, cooldownRemainingMs,
  REACTION_COOLDOWN_MS, CHAT_RATE_MS,
} from '../src/net/chatFilter';

export const CHAT_HISTORY_MAX = 50;

export interface RoomSocialState {
  reactionAt: Map<string, number>; // clientId → last reaction time (ms)
  chatAt: Map<string, number>;     // clientId → last chat time (ms)
  history: ChatMessage[];          // recent messages (capped)
}

/** Per-room social state, keyed by room code. Lazily created; explicitly purged. */
export class RoomSocialStore {
  private readonly map = new Map<string, RoomSocialState>();

  /** The room's social state, created on first use. */
  for(code: string): RoomSocialState {
    let s = this.map.get(code);
    if (!s) { s = { reactionAt: new Map(), chatAt: new Map(), history: [] }; this.map.set(code, s); }
    return s;
  }

  /** The room's recent chat (empty array when none). */
  history(code: string): ChatMessage[] {
    return this.map.get(code)?.history ?? [];
  }

  /** Drop a room's social state (on room delete / cleanup). */
  delete(code: string): void {
    this.map.delete(code);
  }
}

/** The I/O the social handlers need — supplied by the WS layer. */
export interface SocialIO {
  sendError(socket: WebSocket, code: ErrorCode, message: string): void;
  broadcastToRoom(room: ServerRoom, msg: ServerMessage): void;
  newId(): string;
}

/**
 * Handle SEND_REACTION: whitelist + 30s server-side cooldown, then broadcast a
 * transient REACTION to everyone in the room. Caller has already verified the
 * sender is in this room (member resolved here for name/avatar/seat).
 */
export function handleReaction(
  store: RoomSocialStore, io: SocialIO, socket: WebSocket, room: ServerRoom, clientId: string, emoji: unknown,
): void {
  const member = room.members.get(clientId);
  if (!member) return io.sendError(socket, 'BAD_MESSAGE', 'Not in this room');
  if (!isValidReaction(emoji)) return io.sendError(socket, 'BAD_MESSAGE', 'Unknown reaction');
  const social = store.for(room.code);
  const now = Date.now();
  const remaining = cooldownRemainingMs(social.reactionAt.get(clientId), now, REACTION_COOLDOWN_MS);
  if (remaining > 0) return io.sendError(socket, 'RATE_LIMITED', `Wait ${Math.ceil(remaining / 1000)}s`);
  social.reactionAt.set(clientId, now);
  io.broadcastToRoom(room, {
    t: 'REACTION', clientId, name: member.name, avatar: member.avatar,
    emoji, seatIndex: member.seatIndex, at: now,
  });
}

/**
 * Handle SEND_CHAT: 3s server-side rate limit, profanity/URL filter + length cap,
 * append to the capped ring buffer, then broadcast the sanitised CHAT. Never logs
 * chat text (privacy; no profanity in logs).
 */
export function handleChat(
  store: RoomSocialStore, io: SocialIO, socket: WebSocket, room: ServerRoom, clientId: string, text: unknown,
): void {
  const member = room.members.get(clientId);
  if (!member) return io.sendError(socket, 'BAD_MESSAGE', 'Not in this room');
  const social = store.for(room.code);
  const now = Date.now();
  const remaining = cooldownRemainingMs(social.chatAt.get(clientId), now, CHAT_RATE_MS);
  if (remaining > 0) return io.sendError(socket, 'RATE_LIMITED', `Wait ${Math.ceil(remaining / 1000)}s`);
  const filtered = filterChat(text);
  if (!filtered.ok) return io.sendError(socket, 'MESSAGE_BLOCKED', 'Message blocked');
  social.chatAt.set(clientId, now);
  const message: ChatMessage = {
    id: io.newId(), clientId, name: member.name, avatar: member.avatar,
    text: filtered.text, seatIndex: member.seatIndex, createdAt: now,
  };
  social.history.push(message);
  if (social.history.length > CHAT_HISTORY_MAX) {
    social.history.splice(0, social.history.length - CHAT_HISTORY_MAX);
  }
  io.broadcastToRoom(room, { t: 'CHAT', message });
}
