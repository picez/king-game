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
}

export interface RoomSnapshot {
  code: RoomCode;
  members: RoomMember[];
  /** Game settings chosen by the host before Start. */
  playerCount: 3 | 4;
  modeSelectionType: 'fixed' | 'dealer_choice';
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
 * hands, dealLog or seeds.
 */
export interface RoomSummary {
  code: RoomCode;
  hostName: string;
  playerCount: 3 | 4;
  occupiedSeats: number;
  hasPassword: boolean;
  /** lobby = joinable; full = lobby with no free seats; in_game = started. */
  status: 'lobby' | 'full' | 'in_game';
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { t: 'CREATE_ROOM'; name: string; playerCount: 3 | 4; modeSelectionType: 'fixed' | 'dealer_choice'; password?: string }
  | { t: 'JOIN_ROOM'; code: RoomCode; name: string; role?: SeatRole; password?: string }
  | { t: 'RECONNECT'; code: RoomCode; reconnectToken: string }
  /** Discovery: request the public room list (no session required). */
  | { t: 'LIST_ROOMS' }
  | { t: 'LEAVE_ROOM' }
  /** Host-only: remove another member from the room before the game starts. */
  | { t: 'KICK_MEMBER'; clientId: string }
  | { t: 'UPDATE_SETTINGS'; playerCount?: 3 | 4; modeSelectionType?: 'fixed' | 'dealer_choice' }
  | { t: 'START_GAME' }
  /** A request to mutate game state; the authority validates and applies it. */
  | { t: 'ACTION_REQUEST'; action: GameAction }
  /**
   * Host-authoritative relay mode (the shipped server): the host applies the
   * reducer locally and pushes the new authoritative state for the server to
   * redact and broadcast. Ignored from non-host members. In the fully
   * server-authoritative target this message disappears — the server owns the
   * reducer and derives state from ACTION_REQUESTs itself.
   */
  | { t: 'HOST_STATE'; state: GameState | null }
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
  | { t: 'STATE_UPDATE'; state: GameState | null }
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
    },
  };
}
