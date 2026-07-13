/**
 * Network protocol for online King.
 *
 * Design goals (see ONLINE_ARCHITECTURE.md):
 *  - The SAME `gameReducer` runs locally and across the wire — only the
 *    transport differs.
 *  - The authority applies a `GameAction` and emits a `STATE_UPDATE`.
 *  - Clients never trust each other: they send `ACTION_REQUEST`s and render
 *    whatever authoritative state they receive.
 *
 * All messages are JSON objects with a `t` (type) discriminator so they can
 * be sent verbatim over a WebSocket (`JSON.stringify` / `JSON.parse`).
 */

import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import type { GameType } from '../games/catalog';
import type { AnyGameState, AnyGameAction } from '../games/anyGame';
import type { DurakVariant } from '../games/durak/types';
import type { DebercMatchSize } from '../games/deberc/types';
import type { TarneebVariant } from '../games/tarneeb/types';

// ---------------------------------------------------------------------------
// Lobby / room model
// ---------------------------------------------------------------------------

export type RoomCode = string; // e.g. "KQJ7" — short, human-shareable

export type SeatRole = 'player' | 'spectator';

export interface RoomMember {
  /** Stable per-connection identity, survives reconnects via `reconnectToken`. */
  clientId: string;
  /** Display name shown in the lobby and at the table. */
  name: string;
  role: SeatRole;
  /** Seat index once the game starts; null while in the lobby / spectating. */
  seatIndex: number | null;
  /** True for the member who controls game settings and the Start button. */
  isHost: boolean;
  connected: boolean;
  /** 'ai' for a server-side bot occupying a seat; 'human' for real clients. */
  type: 'human' | 'ai';
  /** Whitelisted emoji avatar id (see core/avatars). */
  avatar?: string;
  /**
   * Uploaded server avatar (Stage 17.3): a SAME-ORIGIN, versioned URL
   * (`/api/avatar/<id>.webp?v=<n>`) for a signed-in human with a stored avatar, or
   * absent. Never encoded image bytes, never a remote URL, never the OAuth picture,
   * never the local-only image. The client validates it (`isSafeAvatarImageUrl`)
   * before use and falls back to `avatar` (emoji) on any miss/404.
   */
  avatarImageUrl?: string | null;
}

export interface RoomSnapshot {
  code: RoomCode;
  members: RoomMember[];
  /** Which game this room runs (default 'king'). Lets the client pick the UI. */
  gameType: GameType;
  /** Durak variant ('simple' | 'transfer'); undefined for King. */
  variant?: DurakVariant;
  /** Deberc match target ('small' 510 | 'big' 1020); undefined for King/Durak. */
  matchSize?: DebercMatchSize;
  /** Tarneeb variant ('pairs' | 'solo'); undefined (→ pairs) for other games. */
  tarneebVariant?: TarneebVariant;
  /** Game settings chosen by the host before Start. (Durak allows 2.) */
  playerCount: 2 | 3 | 4 | 5;
  modeSelectionType: 'fixed' | 'dealer_choice';
  /** Per-turn timer in seconds (0 = off). Host-set in the lobby. */
  turnTimerSec: number;
  /** True once the host has started the game. */
  started: boolean;
  /**
   * Whether the room requires a join password. The password itself (and its
   * hash/salt) is NEVER included in a snapshot — only this boolean flag.
   */
  hasPassword: boolean;
}

/**
 * Public, privacy-safe summary of a room for the discovery list. Contains ONLY
 * non-sensitive fields — never reconnectToken, password/hash/salt, gameState,
 * hands, dealLog or seeds. `hostAvatar` is a whitelisted emoji id (sanitized at
 * the source, never free text), so it can never carry HTML/script.
 */
export interface RoomSummary {
  code: RoomCode;
  hostName: string;
  /** Whitelisted emoji avatar id of the host (sanitized; safe to render). */
  hostAvatar: string;
  /** Whether the host currently has a live socket (MVP connection-quality cue). */
  hostConnected: boolean;
  /** Which card game this room runs (King, Durak, Deberc, or Tarneeb). */
  gameType: GameType;
  /** Durak variant ('simple' | 'transfer'); undefined for King. */
  variant?: DurakVariant;
  /** Deberc match target ('small' | 'big'); undefined for King/Durak. */
  matchSize?: DebercMatchSize;
  /** Tarneeb variant ('pairs' | 'solo'); undefined (→ pairs) for other games. */
  tarneebVariant?: TarneebVariant;
  playerCount: 2 | 3 | 4 | 5;
  occupiedSeats: number;
  hasPassword: boolean;
  /** lobby = joinable; full = lobby with no free seats; in_game = started. */
  status: 'lobby' | 'full' | 'in_game';
  updatedAt: number;
}

/**
 * One room chat message (Stage 7). EPHEMERAL room-social state — NOT part of the
 * game reducer/state and NOT persisted long-term (kept only in a small per-room
 * in-memory ring buffer). `clientId` identifies the sender's connection for the
 * UI; it is NOT a userId/session/token. `text` is already sanitised + censored
 * by the server before broadcast.
 */
/**
 * A whitelisted chat sticker attached to a message. The server ALWAYS fills this
 * from `chatMediaCatalog` (by the client-sent `mediaId`) — the client never
 * supplies `src`/`type`/`label`. `src` is a same-origin `/chat-media/…` path
 * (no data:/external URL, no HTML).
 */
export interface ChatMedia {
  id: string;
  src: string;
  type: 'gif' | 'image';
  label: string;
}

export interface ChatMessage {
  id: string;
  clientId: string;
  name: string;
  avatar: string;
  text: string;
  seatIndex: number | null;
  createdAt: number;
  /** Present on a sticker message; `text` is then empty. Server-approved only. */
  media?: ChatMedia;
}

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'CREATE_ROOM'; name: string; playerCount?: 2 | 3 | 4 | 5; modeSelectionType: 'fixed' | 'dealer_choice'; password?: string; avatar?: string; turnTimerSec?: number; gameType?: GameType; variant?: DurakVariant; matchSize?: DebercMatchSize; tarneebVariant?: TarneebVariant }
  | { t: 'JOIN_ROOM'; code: RoomCode; name: string; role?: SeatRole; password?: string; avatar?: string }
  | { t: 'RECONNECT'; code: RoomCode; reconnectToken: string }
  /** Host-only: set the per-turn timer (seconds; 0 = off) before the game starts. */
  | { t: 'SET_TIMER'; turnTimerSec: number }
  /** Discovery: request the public room list (no session required). */
  | { t: 'LIST_ROOMS' }
  | { t: 'LEAVE_ROOM' }
  /** Host-only: remove another member (human or bot) before the game starts. */
  | { t: 'KICK_MEMBER'; clientId: string }
  /** Host-only: add a server-side AI bot to a free player seat before start. */
  | { t: 'ADD_BOT' }
  | { t: 'UPDATE_SETTINGS'; playerCount?: 3 | 4; modeSelectionType?: 'fixed' | 'dealer_choice' }
  | { t: 'START_GAME' }
  /** A request to mutate game state; the authority validates and applies it. */
  | { t: 'ACTION_REQUEST'; action: AnyGameAction }
  /**
   * Host-authoritative relay mode (the shipped server): the host applies the
   * reducer locally and pushes the new authoritative state for the server to
   * redact and broadcast. Ignored from non-host members. In the fully
   * server-authoritative target this message disappears — the server owns the
   * reducer and derives state from ACTION_REQUESTs itself.
   */
  | { t: 'HOST_STATE'; state: GameState | null }
  /** Room-social (Stage 7): send a whitelisted emoji reaction (server cooldown). */
  | { t: 'SEND_REACTION'; emoji: string }
  /** Room-social (Stage 7): send a chat message (server filters + rate-limits). */
  | { t: 'SEND_CHAT'; text: string }
  /** Room-social (Stage 11): send a whitelisted sticker by catalog id (server
   *  resolves the id → approved media; rejects unknown ids; same chat rate limit). */
  | { t: 'SEND_CHAT_MEDIA'; mediaId: string }
  /**
   * Friends (Stage 25.2): invite an ONLINE friend to MY CURRENT room. Carries only the
   * target userId — the room code is derived SERVER-side from the sender's own room (so
   * a client can never invite to an arbitrary room). The server verifies the sender is
   * authenticated, in a room, and an accepted friend of the target. NEVER sends audio.
   */
  | { t: 'FRIEND_INVITE'; toUserId: string }
  /**
   * Voice chat SIGNALING (Stage 25.3) — the server is a room-scoped RELAY only; NO audio,
   * NO SDP/ICE inspection beyond a size cap, NO persistence. Voice membership = being a
   * member of the socket's current room (guests allowed); the room is derived server-side.
   * SDP/ICE are opaque strings the peers exchange to open a direct WebRTC connection (25.4).
   */
  | { t: 'VOICE_JOIN' }
  | { t: 'VOICE_LEAVE' }
  | { t: 'VOICE_SIGNAL_OFFER'; toClientId: string; sdp: string }
  | { t: 'VOICE_SIGNAL_ANSWER'; toClientId: string; sdp: string }
  | { t: 'VOICE_SIGNAL_ICE'; toClientId: string; candidate: string }
  | { t: 'VOICE_MUTE_STATE'; muted: boolean }
  /**
   * Rematch / "Play again" for an ONLINE room (Stage 25.9). After the game finishes, a seated
   * human presses Play again → READY. When ALL connected humans are ready (bots are always
   * ready), the server restarts the SAME game (same gameType/options/seats) in the SAME room.
   * DECLINE clears the pending readiness. No payload beyond the type — the server derives the
   * room + sender from the socket; carries no token/session/email.
   */
  | { t: 'REMATCH_READY' }
  | { t: 'REMATCH_DECLINE' }
  | { t: 'PING' };

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

export type ServerMessage =
  /** Sent right after CREATE/JOIN/RECONNECT — carries the caller's identity. */
  | { t: 'WELCOME'; clientId: string; reconnectToken: string; room: RoomSnapshot }
  /** Lobby changed (someone joined/left, settings changed). */
  | { t: 'ROOM_UPDATE'; room: RoomSnapshot }
  /** Reply to LIST_ROOMS — public summaries only. */
  | { t: 'ROOMS_LIST'; rooms: RoomSummary[] }
  /**
   * Authoritative game state. `state` is already redacted for the recipient
   * (only their own hand is populated) — see `redactStateFor`.
   */
  | { t: 'STATE_UPDATE'; state: AnyGameState | null }
  /**
   * Relay mode only: the server forwards another member's ACTION_REQUEST to
   * the host (the authority), tagged with the requesting seat so the host can
   * verify it was that player's turn before applying the reducer.
   */
  | { t: 'ACTION_FORWARD'; action: GameAction; fromSeat: number | null }
  /** A request was rejected (not your turn, illegal move, room full, …). */
  | { t: 'ERROR'; code: ErrorCode; message: string }
  /** The host removed this client from the room (before game start). */
  | { t: 'KICKED'; reason: 'HOST_REMOVED' }
  /** Room-social broadcast: a member sent a whitelisted reaction (transient UI). */
  | { t: 'REACTION'; clientId: string; name: string; avatar: string; emoji: string; seatIndex: number | null; at: number }
  /** Room-social broadcast: a new (sanitised) chat message for everyone in room. */
  | { t: 'CHAT'; message: ChatMessage }
  /** Recent chat for a freshly joined/reconnected client (last N, server-capped). */
  | { t: 'CHAT_HISTORY'; messages: ChatMessage[] }
  /**
   * Friends (Stage 25.2): a friend invited you to their room. Delivered to the target's
   * live sockets. Carries ONLY public routing info — the room code (already the public
   * join secret), the inviter's display name + userId, and the game type. NEVER an email,
   * session, token, or reconnect token. The client shows a Join / Dismiss toast; Join
   * opens the EXISTING Join flow prefilled — it never auto-joins.
   */
  | { t: 'FRIEND_INVITE_RECEIVED'; fromUserId: string; fromName: string; code: RoomCode; gameType: GameType; at: number }
  /** Friends (Stage 25.2): a friend's presence changed (online/offline) — public only. */
  | { t: 'FRIEND_PRESENCE'; updates: Array<{ userId: string; online: boolean }> }
  /**
   * Rematch progress (Stage 25.9) — broadcast to the room while a rematch is pending. `ready` is
   * the list of member clientIds (public routing ids, already in the room snapshot) who pressed
   * Play again; `needed` is the count of connected human players whose consent is required. When
   * `ready.length >= needed` the server restarts the game (clients then receive a fresh state).
   * No token/session/email. */
  | { t: 'REMATCH_STATE'; ready: string[]; needed: number }
  /**
   * Voice signaling relay (Stage 25.3) — public routing fields only (clientId, display
   * name, muted). The OFFER/ANSWER/ICE relays are delivered ONLY to the single target peer
   * (never broadcast); mute state broadcasts to the room's voice peers. No email/token/audio.
   */
  | { t: 'VOICE_PEERS'; peers: Array<{ clientId: string; name: string; muted: boolean }> }
  | { t: 'VOICE_PEER_JOINED'; clientId: string; name: string; muted: boolean }
  | { t: 'VOICE_PEER_LEFT'; clientId: string }
  | { t: 'VOICE_SIGNAL_OFFER'; fromClientId: string; sdp: string }
  | { t: 'VOICE_SIGNAL_ANSWER'; fromClientId: string; sdp: string }
  | { t: 'VOICE_SIGNAL_ICE'; fromClientId: string; candidate: string }
  | { t: 'VOICE_MUTE_STATE'; clientId: string; muted: boolean }
  | { t: 'PONG' };

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NAME_TAKEN'
  | 'BAD_PASSWORD'
  | 'GAME_ALREADY_STARTED'
  | 'NOT_YOUR_TURN'
  | 'ILLEGAL_ACTION'
  | 'NOT_HOST'
  /** The client was removed from the room by the host (UI message key). */
  | 'KICKED_BY_HOST'
  /** Reaction cooldown / chat rate limit not elapsed yet (Stage 7). */
  | 'RATE_LIMITED'
  /** Chat message had nothing safe to send after filtering (Stage 7). */
  | 'MESSAGE_BLOCKED'
  /** Friend room-invite failed: the target has no live socket (Stage 25.7). */
  | 'FRIEND_NOT_ONLINE'
  /** Friend room-invite failed: the two users are not accepted friends (Stage 25.7). */
  | 'NOT_FRIENDS'
  /** Friend room-invite failed: the sender is not currently in a room (Stage 25.7). */
  | 'NOT_IN_ROOM'
  | 'BAD_MESSAGE';

// ---------------------------------------------------------------------------
// Privacy: redact hands the recipient is not allowed to see
// ---------------------------------------------------------------------------

/**
 * Returns a copy of `state` where every hand except `viewerPlayerId`'s is
 * replaced by an array of face-down placeholders of the same length. Card
 * counts stay visible (needed for the UI) but ranks/suits are hidden.
 *
 * The authority must call this before sending STATE_UPDATE to each client so
 * a tampered client can never read an opponent's hand off the wire.
 */
export function redactStateFor(
  state: GameState | null,
  viewerPlayerId: string | null,
): GameState | null {
  if (!state) return null;
  const hidden = { suit: 'spades', rank: '?', value: 0 } as unknown as GameState['players'][number]['hand'][number];
  const dealerId = state.players[state.dealerIndex]?.id ?? null;
  const isDealer = viewerPlayerId != null && viewerPlayerId === dealerId;
  // Collected (won) cards are revealed to everyone only once the round is over.
  const roundOver = state.status === 'round_scoring' || state.status === 'game_finished';

  // Each player only sees their OWN collected cards during the round; everyone
  // sees all collected cards once the round is scored.
  const collectedCards: Record<string, typeof state.currentRound.collectedCards[string]> = {};
  for (const [pid, cards] of Object.entries(state.currentRound.collectedCards)) {
    collectedCards[pid] = (roundOver || pid === viewerPlayerId) ? cards : [];
  }

  return {
    ...state,
    players: state.players.map((p) =>
      p.id === viewerPlayerId
        ? p
        : { ...p, hand: p.hand.map(() => hidden) },
    ),
    // The dealer's kitty-exchange working set is private to the dealer.
    kittyForExchange: isDealer ? state.kittyForExchange : state.kittyForExchange.map(() => hidden),
    currentRound: {
      ...state.currentRound,
      collectedCards,
      // The discard is private to the dealer (others get an empty array).
      discard: isDealer ? state.currentRound.discard : [],
      // The kitty is never shown directly — and during Trump it stays pending
      // (untaken) until the suit is chosen, so it must not leak to anyone,
      // including the dealer, before then. The dealer interacts with it via
      // `kittyForExchange` once taken. Redact it for every viewer.
      kitty: [],
    },
  };
}
