/**
 * Pure online-adaptor helpers (no React, no I/O — unit-testable).
 *
 * These bridge the lobby/room model and the pure game reducer for the shipped
 * relay / host-authoritative server (see ONLINE_ARCHITECTURE.md §4a):
 *  - the host turns a started room into the initial GameState, and
 *  - the host authorises and applies each forwarded action request.
 */

import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import { gameReducer } from '../core/gameEngine';
import type { ClientMessage, ErrorCode, RoomSnapshot } from './messages';
import type { GameType } from '../games/catalog';
import type { DurakVariant } from '../games/durak/types';
import type { DebercMatchSize } from '../games/deberc/types';
import type { TarneebVariant } from '../games/tarneeb/types';

/** Human-readable text for a server error code (used by the join UI). */
export function humanError(code: ErrorCode | null | undefined): string {
  switch (code) {
    case 'BAD_PASSWORD':         return 'Wrong room password';
    case 'ROOM_FULL':            return 'Room is full';
    case 'ROOM_NOT_FOUND':       return 'Room not found';
    case 'GAME_ALREADY_STARTED': return 'Game already started';
    case 'NAME_TAKEN':           return 'This name is already used in this room. Please choose another name.';
    default:                     return 'Could not join room';
  }
}

/** True for errors that mean "the join attempt was rejected" (vs a connection drop). */
export function isJoinError(code: ErrorCode | null | undefined): boolean {
  return code === 'BAD_PASSWORD' || code === 'ROOM_FULL' || code === 'ROOM_NOT_FOUND'
    || code === 'GAME_ALREADY_STARTED' || code === 'NAME_TAKEN';
}

/** What the user chose on the start menu — the single intent for a session. */
export type OnlineIntent =
  | { kind: 'create'; name: string; modeSelectionType: 'fixed' | 'dealer_choice'; password?: string; avatar?: string; turnTimerSec?: number; gameType?: GameType; variant?: DurakVariant; matchSize?: DebercMatchSize; playerCount?: 2 | 3 | 4 | 5 | 6; tarneebVariant?: TarneebVariant; tarneebTargetScore?: number; fiftyOneEliminationScore?: number }
  | { kind: 'join'; code: string; name: string; password?: string; avatar?: string }
  /** Resume a saved session after a tab reload (sends RECONNECT). */
  | { kind: 'resume'; code: string; reconnectToken: string; name: string }
  /** Cross-device reclaim (Stage 36.0): resume this signed-in account's own seat in
   *  `code` from ANOTHER device — no token (the server matches the session userId). */
  | { kind: 'reclaim'; code: string };

/**
 * The one message a fresh connection sends to realise the user's intent.
 * Pure so it can be unit-tested and so the hook sends it in exactly one place
 * (idempotency is enforced by the connection guard, not by re-deriving this).
 */
export function firstConnectMessage(intent: OnlineIntent): ClientMessage {
  if (intent.kind === 'create') {
    return {
      t: 'CREATE_ROOM',
      name: intent.name,
      // Player-count is sent ONLY when the host explicitly chose it (Stage 28.2 —
      // Deberc Solo 3 / Pairs 4). Omitted for every other game, so the server keeps
      // capping the room at the game's catalog maxPlayers exactly as before.
      modeSelectionType: intent.modeSelectionType,
      ...(intent.gameType ? { gameType: intent.gameType } : {}),
      ...(intent.variant ? { variant: intent.variant } : {}),
      ...(intent.matchSize ? { matchSize: intent.matchSize } : {}),
      ...(intent.playerCount ? { playerCount: intent.playerCount } : {}),
      ...(intent.tarneebVariant ? { tarneebVariant: intent.tarneebVariant } : {}),
      ...(intent.tarneebTargetScore ? { tarneebTargetScore: intent.tarneebTargetScore } : {}),
      ...(intent.fiftyOneEliminationScore ? { fiftyOneEliminationScore: intent.fiftyOneEliminationScore } : {}),
      ...(intent.password ? { password: intent.password } : {}),
      ...(intent.avatar ? { avatar: intent.avatar } : {}),
      ...(intent.turnTimerSec ? { turnTimerSec: intent.turnTimerSec } : {}),
    };
  }
  if (intent.kind === 'resume') {
    // Resume relies on the reconnect token — never the password.
    return { t: 'RECONNECT', code: intent.code, reconnectToken: intent.reconnectToken };
  }
  if (intent.kind === 'reclaim') {
    // Cross-device: no token; the server authoritatively matches the session userId.
    return { t: 'RECLAIM_ROOM', code: intent.code };
  }
  return {
    t: 'JOIN_ROOM',
    code: intent.code,
    name: intent.name,
    ...(intent.password ? { password: intent.password } : {}),
    ...(intent.avatar ? { avatar: intent.avatar } : {}),
  };
}

/** Cross-device discovery (Stage 36.0): ask the server which rooms this signed-in
 *  account has a seat in (server replies MY_ROOMS). Guests get an empty list. */
export function findMyRoomsMessage(): ClientMessage {
  return { t: 'FIND_MY_ROOMS' };
}

/** A seated member's seat index maps to the engine's player id. */
export function seatToPlayerId(seat: number): string {
  return `player-${seat}`;
}

/**
 * Builds the START_GAME action from a started room: seated players in seat
 * order. Human seats are real clients; AI seats are server-side bots (their
 * engine player gets `type: 'ai'` so the server drives them). The resulting
 * player ids (`player-0..n`) line up with `seatToPlayerId`, so the server's
 * per-seat redaction targets the right hand.
 */
export function buildStartAction(room: RoomSnapshot): GameAction {
  const players = room.members
    .filter((m) => m.role === 'player')
    .slice()
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0));
  return {
    type: 'START_GAME',
    playerNames: players.map((m) => m.name),
    playerTypes: players.map((m) => (m.type === 'ai' ? 'ai' : 'human') as 'human' | 'ai'),
    playerAvatars: players.map((m) => m.avatar),
    modeSelectionType: room.modeSelectionType,
  };
}

/**
 * Authorises a forwarded action against the authoritative state. This prevents
 * a tampered client from acting as another player or out of turn (beyond what
 * the reducer already rejects). NEXT_TRICK / NEXT_ROUND / START_GAME / RESET
 * are host-internal and never accepted from a client request.
 */
export function authorizeAction(
  state: GameState,
  action: GameAction,
  fromSeat: number | null,
): boolean {
  if (fromSeat == null) return false; // spectators cannot act
  const actorId = seatToPlayerId(fromSeat);
  switch (action.type) {
    case 'PLAY_CARD':
      // Must claim to be the seat that sent it; the reducer enforces turn order.
      return action.playerId === actorId;
    case 'SURRENDER_ROUND':
      // You may only concede for yourself; the reducer also checks it's your turn.
      return action.playerId === actorId;
    case 'SELECT_TRUMP':
    case 'EXCHANGE_KITTY':
    case 'CHOOSE_MODE':
      // Only the dealer may run the round-setup steps.
      return state.players[state.dealerIndex]?.id === actorId;
    default:
      return false;
  }
}

/**
 * LEGACY (host-authoritative relay only). The server-authoritative path uses
 * `authorizeAction` + `gameReducer` directly in `serverCore.ts`; this helper is
 * retained for the deprecated relay server and its tests.
 *
 * Applies a forwarded action on the host: rejects unauthorised requests by
 * returning the state unchanged; otherwise runs the pure reducer (which itself
 * rejects illegal moves by returning the same state).
 */
export function applyForward(
  state: GameState | null,
  action: GameAction,
  fromSeat: number | null,
): GameState | null {
  if (!state) return state;
  if (!authorizeAction(state, action, fromSeat)) return state;
  return gameReducer(state, action);
}

interface PageLocation {
  protocol: string;
  hostname: string;
}

function currentLocation(): PageLocation | null {
  if (typeof window === 'undefined') return null;
  return { protocol: window.location.protocol, hostname: window.location.hostname };
}

/**
 * Default WebSocket URL for the server.
 *
 *  - An explicit `envUrl` (build-time `VITE_WS_URL`) always wins — the way to
 *    point a production build at a specific `wss://` host/path.
 *  - On an HTTPS page → `wss://<host>/ws` (same host/origin, 443) so a single
 *    service can host both the client and the WS, and we NEVER suggest an
 *    insecure `ws://` that the browser would block as mixed content.
 *  - Otherwise (HTTP / LAN / dev) → `ws://<host>:3001/ws`.
 *
 * The `/ws` path matches the server's WebSocket route (works on Render and any
 * single-origin reverse proxy). `loc`/`envUrl` are injectable for unit tests.
 */
export function defaultServerUrl(loc?: PageLocation | null, envUrl?: string): string {
  if (envUrl) return envUrl;
  const l = loc === undefined ? currentLocation() : loc;
  if (!l) return 'ws://localhost:3001/ws';
  const host = l.hostname || 'localhost';
  return l.protocol === 'https:' ? `wss://${host}/ws` : `ws://${host}:3001/ws`;
}

/**
 * True when the page is HTTPS but the chosen WS URL is insecure `ws://` — the
 * browser will block this as mixed content. Used to warn the user in the UI.
 */
export function isInsecureWsOnSecurePage(url: string, loc?: PageLocation | null): boolean {
  const l = loc === undefined ? currentLocation() : loc;
  if (!l) return false;
  return l.protocol === 'https:' && /^ws:\/\//i.test(url.trim());
}
