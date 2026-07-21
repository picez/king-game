/**
 * Server-authoritative room core (pure, framework-free, unit-testable).
 *
 * The SERVER owns the GameState: it builds the initial deal, applies the same
 * `gameReducer` to every ACTION_REQUEST, authorises the sender, and produces a
 * per-viewer redacted state. The WebSocket layer (`server/index.ts`) only does
 * I/O and delegates every game decision here.
 *
 * No Node or browser APIs are used, so this runs in Vitest and (via tsx) in
 * Node, and is tree-shaken out of the client bundle.
 */

import type { GameModeId, GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import { gameReducer } from '../core/gameEngine';
import { sanitizeAvatar } from '../core/avatars';
import { isSafeAvatarImageUrl } from './avatarImage';
import { nextBotIdentity } from '../games/botIdentities';
import { makeRng, randomSeed, hashString } from '../core/rng';
import { DEFAULT_GAME_TYPE, getGameCatalogEntry, isGameType, type GameType } from '../games/catalog';
import { getGameDefinition } from '../games/registry';
import type { AnyGameState, AnyGameAction } from '../games/anyGame';
import type { DurakVariant } from '../games/durak/types';
import type { DebercMatchSize, DebercState } from '../games/deberc/types';
import type { TarneebVariant } from '../games/tarneeb/types';
import type { TarneebState } from '../games/tarneeb/types';
import { normalizeTargetScore } from '../games/tarneeb/rules';
import { normalizeEliminationScore } from '../games/fiftyOne/rules';
import type { PreferansState } from '../games/preferans/types';
import type { FiftyOneState } from '../games/fiftyOne/types';
import type { PokerState } from '../games/poker/types';
import type { ErrorCode, RoomSnapshot, RoomSummary, SeatRole } from './messages';
import { authorizeAction, seatToPlayerId } from './online';
// botAction now lives in ./botAction (Stage 8.5 — breaks the registry import
// cycle). Re-exported here so existing importers keep working unchanged.
export { botAction } from './botAction';

export type ServerMode = 'server_authoritative';

/**
 * Private, server-side audit record of one deal. Lives in ServerRoom only —
 * NEVER sent to clients (it could reveal the full deck). `seed` reproduces the
 * deal: re-run the reducer for that round with `makeRng(seed)`. `deckHash` is a
 * fingerprint of the dealt hands for quick integrity comparison in a dispute.
 */
export interface DealRecord {
  roundIndex: number;
  dealerIndex: number;
  dealerId: string;
  modeId: GameModeId | null; // null until chosen (Dealer's Choice)
  seed: number;
  deckHash: string;
  timestamp: number;
}

/** Optional per-deal context (seed/timestamp injected by the I/O layer). */
export interface DealContext {
  seed?: number;
  now?: number;
}

export interface ServerMember {
  clientId: string;
  /**
   * Reconnect credential AT REST — a one-way hash of the plaintext token, not the
   * token itself (БЕЗ-4; the server hashes before storing, see
   * server/reconnectToken.ts). The plaintext is sent to the client once (WELCOME)
   * and never kept here. `reconnectMember` compares the hashed presented token.
   */
  reconnectToken: string;
  name: string;
  role: SeatRole;
  seatIndex: number | null;
  isHost: boolean;
  connected: boolean;
  /** 'ai' for a server-side bot (no socket, never reconnects); else 'human'. */
  type: 'human' | 'ai';
  /** Whitelisted emoji avatar id (sanitized on entry; never free text). */
  avatar: string;
  /**
   * Resolved account id for a logged-in/guest human (Stage 5), set by the I/O
   * layer from the session cookie on the WS upgrade — NEVER from a client-sent
   * value. Null for bots, anonymous players, and any no-DB/cross-origin session.
   * Used only to attribute finished-game stats; seat/reconnect authority still
   * flows through clientId + reconnectToken (auth only NAMES the player).
   */
  userId?: string | null;
  /**
   * Uploaded server avatar URL (Stage 17.3) — a SAME-ORIGIN, versioned
   * `/api/avatar/<id>.webp?v=<n>`, stamped by the I/O layer from the authenticated
   * user's avatar row (never a client-sent value, never encoded bytes / a remote URL /
   * the OAuth picture / the local-only image). Undefined/null for bots, guests, anyone with
   * no uploaded avatar → seats fall back to the emoji. A public URL only, so it is
   * safe to include in snapshots + persistence.
   */
  avatarImageUrl?: string | null;
}

export interface ServerRoom {
  code: string;
  mode: ServerMode;
  /**
   * Which game this room runs (Stage 8.5). 'king' today; the server resolves a
   * GameDefinition from it (registry). Legacy rooms persisted before this field
   * existed deserialize as 'king' (DEFAULT_GAME_TYPE), so behaviour is unchanged.
   */
  gameType: GameType;
  /** Durak variant ('simple' | 'transfer'); undefined for King. */
  variant?: DurakVariant;
  /** Deberc match target ('small' | 'big'); undefined for King/Durak. */
  matchSize?: DebercMatchSize;
  /** Tarneeb variant ('pairs' | 'solo'); undefined (→ pairs) for other games. */
  tarneebVariant?: TarneebVariant;
  /** Tarneeb match target score (Stage 29.8); undefined (→ 41) for other games / legacy rooms. */
  tarneebTargetScore?: number;
  /** 51 elimination score (Stage 30.15); undefined (→ 510) for other games / legacy rooms. */
  fiftyOneEliminationScore?: number;
  members: Map<string, ServerMember>; // keyed by clientId, insertion-ordered
  /** Seat target. King is 3|4; Durak allows 2. */
  playerCount: 2 | 3 | 4 | 5 | 6;
  modeSelectionType: 'fixed' | 'dealer_choice';
  /** Per-turn timer in seconds (0 = off). Host-set in the lobby. */
  turnTimerSec: number;
  started: boolean;
  /**
   * Authoritative, UNREDACTED game state for THIS room's game (King or Durak —
   * Stage 9.5). Never sent to clients as-is; redacted per viewer via the game's
   * definition. King-specific helpers below narrow it by `gameType`.
   */
  gameState: AnyGameState | null;
  /** Private deal audit log (server-only; never broadcast). King-only today. */
  dealLog: DealRecord[];
  /**
   * Server-only join secret. We never store the plaintext password — only a
   * salted hash. Both fields stay out of every snapshot/log. (MVP-strength: see
   * ONLINE_ARCHITECTURE.md — not a substitute for TLS/WSS + auth.)
   */
  passwordSalt: string | null;
  passwordHash: string | null;
  /** Epoch ms; set on create, bumped on each persisted change. */
  createdAt: number;
  updatedAt: number;
  /**
   * Epoch ms when the room became an "orphan" (no connected human members —
   * only bots and/or offline humans), or null while at least one human is
   * connected. An orphan room is auto-deleted after ORPHAN_ROOM_TTL_MS so an
   * abandoned table (lobby OR active game) never lingers. Reset to null the
   * moment a human reconnects/joins. Persisted so restarts honour the timer.
   */
  orphanSince: number | null;
  /**
   * Rematch readiness (Stage 25.9) — the clientIds of seated humans who pressed "Play again"
   * after the game finished. In-memory only (never persisted / snapshotted); cleared on restart,
   * leave, or a fresh game start. Undefined when no rematch is pending.
   */
  rematchReady?: Set<string>;
}

export interface OpResult {
  ok: boolean;
  error?: ErrorCode;
}

const MAX_PLAYERS = 6;

// ---------------------------------------------------------------------------
// Join-secret hashing (salted; plaintext is never stored)
// ---------------------------------------------------------------------------

/**
 * Pluggable join-password hasher (БЕЗ-3). serverCore must stay client-bundle-safe
 * — it is reachable from the browser via the game registry — so it cannot import
 * `node:crypto`. The strong KDF (scrypt) therefore lives server-side in
 * server/roomPassword.ts and is injected into createRoom/addMember/verifyPassword.
 * The default below is the legacy lightweight hash: it keeps pure unit tests (and
 * any client-side call) working, and the scrypt hasher delegates to it when
 * verifying rooms created before the upgrade (tagged-hash routing).
 */
export interface PasswordHasher {
  /** Produce the stored hash for a password under a room salt. */
  hash(salt: string, password: string): string;
  /** Constant-time check of an attempt against a stored hash. */
  verify(salt: string, password: string, storedHash: string): boolean;
}

/** Constant-time string equality — no early-out on first mismatch. Pure JS. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Legacy salted, lightly-stretched hash. MVP strength; kept for back-compat. */
function legacyHashSecret(salt: string, password: string): string {
  let h = `${salt}|${password}`;
  for (let i = 0; i < 1000; i++) h = hashString(`${h}|${salt}`);
  return h;
}

/** Client-safe default hasher (legacy KDF, constant-time compare). */
export const DEFAULT_PASSWORD_HASHER: PasswordHasher = {
  hash: legacyHashSecret,
  verify: (salt, password, storedHash) =>
    constantTimeEqual(legacyHashSecret(salt, password), storedHash),
};

export function roomHasPassword(room: ServerRoom): boolean {
  return room.passwordHash !== null;
}

/** True if the room is open, or the attempt matches the stored hash. */
export function verifyPassword(
  room: ServerRoom, attempt: string | undefined, hasher: PasswordHasher = DEFAULT_PASSWORD_HASHER,
): boolean {
  if (room.passwordHash === null || room.passwordSalt === null) return true; // open room
  if (!attempt) return false;
  return hasher.verify(room.passwordSalt, attempt, room.passwordHash);
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

export function createRoom(opts: {
  code: string;
  playerCount: 2 | 3 | 4 | 5 | 6;
  modeSelectionType: 'fixed' | 'dealer_choice';
  host: { clientId: string; reconnectToken: string; name: string; avatar?: string };
  /** Which game to host (default King). */
  gameType?: GameType;
  /** Durak variant; ignored for King. */
  variant?: DurakVariant;
  /** Deberc match target ('small' | 'big'); ignored for King/Durak. */
  matchSize?: DebercMatchSize;
  /** Tarneeb variant ('pairs' | 'solo'); ignored for other games. */
  tarneebVariant?: TarneebVariant;
  /** Tarneeb match target score (Stage 29.8); ignored for other games. */
  tarneebTargetScore?: number;
  /** 51 elimination score (Stage 30.15); ignored for other games. */
  fiftyOneEliminationScore?: number;
  /** Optional join password; when set, `salt` must be supplied by the caller. */
  password?: string;
  salt?: string;
  /** Password KDF (default legacy; the server injects scrypt — БЕЗ-3). */
  hasher?: PasswordHasher;
  /** Per-turn timer in seconds (0 = off). */
  turnTimerSec?: number;
  /** Epoch ms for createdAt/updatedAt (injected by the I/O layer). */
  now?: number;
}): ServerRoom {
  const hasPw = typeof opts.password === 'string' && opts.password.length > 0;
  const salt = opts.salt ?? '';
  const hasher = opts.hasher ?? DEFAULT_PASSWORD_HASHER;
  const now = opts.now ?? 0;
  const room: ServerRoom = {
    code: opts.code,
    mode: 'server_authoritative',
    gameType: opts.gameType ?? DEFAULT_GAME_TYPE,
    variant: opts.variant,
    matchSize: opts.matchSize,
    tarneebVariant: opts.tarneebVariant,
    tarneebTargetScore: opts.tarneebTargetScore,
    fiftyOneEliminationScore: opts.fiftyOneEliminationScore,
    members: new Map(),
    playerCount: opts.playerCount,
    modeSelectionType: opts.modeSelectionType,
    turnTimerSec: normalizeTimer(opts.turnTimerSec),
    started: false,
    gameState: null,
    dealLog: [],
    passwordSalt: hasPw ? salt : null,
    passwordHash: hasPw ? hasher.hash(salt, opts.password!) : null,
    createdAt: now,
    updatedAt: now,
    orphanSince: null, // the host is connected at creation → not an orphan
  };
  room.members.set(opts.host.clientId, {
    clientId: opts.host.clientId,
    reconnectToken: opts.host.reconnectToken,
    name: opts.host.name,
    role: 'player',
    seatIndex: null,
    isHost: true,
    connected: true,
    type: 'human',
    avatar: sanitizeAvatar(opts.host.avatar, opts.host.name),
    userId: null,
  });
  assignSeats(room);
  return room;
}

export function activePlayers(room: ServerRoom): ServerMember[] {
  return [...room.members.values()].filter((m) => m.role === 'player');
}

/** Max player seats for the room — the game's catalog maxPlayers, capped (Stage 9.10). */
export function roomCapacity(room: ServerRoom): number {
  const max = getGameCatalogEntry(room.gameType ?? DEFAULT_GAME_TYPE)?.maxPlayers ?? room.playerCount;
  return Math.min(max, MAX_PLAYERS);
}

/** Re-numbers player seats by insertion order (spectators get null). */
export function assignSeats(room: ServerRoom): void {
  let seat = 0;
  for (const m of room.members.values()) {
    m.seatIndex = m.role === 'player' ? seat++ : null;
  }
}

/** Allowed per-turn timer values (seconds); anything else falls back to 0 (off). */
export function normalizeTimer(sec: unknown): number {
  return sec === 30 || sec === 60 || sec === 90 ? sec : 0;
}

/** Host-only: set the per-turn timer before the game starts. */
export function setTimer(room: ServerRoom, hostClientId: string, turnTimerSec: number): OpResult {
  if (!room.members.get(hostClientId)?.isHost) return { ok: false, error: 'NOT_HOST' };
  if (room.started) return { ok: false, error: 'GAME_ALREADY_STARTED' };
  room.turnTimerSec = normalizeTimer(turnTimerSec);
  return { ok: true };
}

export function addMember(
  room: ServerRoom,
  member: { clientId: string; reconnectToken: string; name: string; role?: SeatRole; password?: string; avatar?: string },
  hasher: PasswordHasher = DEFAULT_PASSWORD_HASHER,
): OpResult {
  // Protected rooms require the correct password before anything else.
  if (!verifyPassword(room, member.password, hasher)) {
    return { ok: false, error: 'BAD_PASSWORD' };
  }
  // New players can't join a game in progress (existing members RECONNECT).
  if (room.started) {
    return { ok: false, error: 'GAME_ALREADY_STARTED' };
  }
  const role: SeatRole = member.role === 'spectator' ? 'spectator' : 'player';
  // A room is full at the game's catalog maxPlayers (Stage 9.10), capped by MAX_PLAYERS.
  if (role === 'player' && activePlayers(room).length >= roomCapacity(room)) {
    return { ok: false, error: 'ROOM_FULL' };
  }
  if ([...room.members.values()].some((m) => m.name === member.name)) {
    return { ok: false, error: 'NAME_TAKEN' };
  }
  room.members.set(member.clientId, {
    clientId: member.clientId,
    reconnectToken: member.reconnectToken,
    name: member.name,
    role,
    seatIndex: null,
    isHost: false,
    connected: true,
    type: 'human',
    avatar: sanitizeAvatar(member.avatar, member.name),
    userId: null,
  });
  assignSeats(room);
  return { ok: true };
}

/**
 * Host-only: add a server-side AI bot to a free player seat BEFORE the game
 * starts. The bot occupies a seat like a normal player (assigned in order) but
 * has no socket and is marked `type: 'ai'`. Its `reconnectToken` is never sent
 * to any client (bots receive no WELCOME), so it cannot be hijacked. The caller
 * supplies a fresh clientId/reconnectToken (the pure core has no UUID source).
 */
export function addBot(
  room: ServerRoom,
  hostClientId: string,
  ids: { clientId: string; reconnectToken: string },
): OpResult & { bot?: ServerMember } {
  if (!room.members.get(hostClientId)?.isHost) return { ok: false, error: 'NOT_HOST' };
  if (room.started) return { ok: false, error: 'GAME_ALREADY_STARTED' };
  if (activePlayers(room).length >= roomCapacity(room)) {
    return { ok: false, error: 'ROOM_FULL' };
  }
  // A deterministic, varied identity (name + avatar), deduped against the current
  // members so a room never shows two identical bot names/avatars while the pools
  // allow. Assigned ONCE and stored on the member → reconnect/restore never rerolls
  // it (Stage 13.6). The seed is stable per (room, gameType); the index is the
  // bot's ordinal. Bots stay explicitly AI via the " AI" name suffix + lobby badge.
  const members = [...room.members.values()];
  const takenNames = new Set(members.map((m) => m.name));
  const takenAvatars = new Set(members.map((m) => m.avatar));
  const botOrdinal = members.filter((m) => m.type === 'ai').length;
  const seed = `${room.code}:${room.gameType ?? DEFAULT_GAME_TYPE}`;
  const identity = nextBotIdentity(seed, botOrdinal, takenNames, takenAvatars);
  const bot: ServerMember = {
    clientId: ids.clientId,
    reconnectToken: ids.reconnectToken,
    name: identity.name,
    role: 'player',
    seatIndex: null,
    isHost: false,
    connected: true, // bots are always "present"
    type: 'ai',
    avatar: identity.avatar,
    userId: null, // bots have no account → never written to user_stats
  };
  room.members.set(bot.clientId, bot);
  assignSeats(room);
  return { ok: true, bot };
}

/**
 * Resume a seat by its stored reconnect credential. `ServerMember.reconnectToken`
 * holds the value AT REST — the server persists a one-way hash (БЕЗ-4), so the
 * caller passes the hashed presented token (see server/reconnectToken.ts); the
 * plaintext never lives on the member. Compared in constant time to avoid a
 * timing oracle on the stored hash.
 */
export function reconnectMember(room: ServerRoom, reconnectToken: string): ServerMember | null {
  const member = [...room.members.values()].find((m) => constantTimeEqual(m.reconnectToken, reconnectToken));
  if (!member) return null;
  if (member.type === 'ai') return null; // bots have no client and never reconnect
  member.connected = true;
  return member;
}

export function markDisconnected(room: ServerRoom, clientId: string): void {
  const m = room.members.get(clientId);
  if (m) m.connected = false;
}

/**
 * Stage 36.0 — server-authoritative cross-device reclaim. Finds the HUMAN member
 * whose account matches `userId` (resolved server-side from the session cookie —
 * NEVER a client-supplied value), so a signed-in player can resume their OWN seat
 * from a different device even without the original reconnect token. A blank /
 * null userId never matches (guests can't reclaim each other's seats), and bots are
 * never reclaimable. Marks the member connected and returns it; the caller mints a
 * fresh reconnect token for the new device (invalidating the old one).
 */
export function reclaimMemberByUserId(room: ServerRoom, userId: string | null | undefined): ServerMember | null {
  if (!userId) return null;
  const member = [...room.members.values()].find((m) => m.type === 'human' && m.userId === userId);
  if (!member) return null;
  member.connected = true;
  return member;
}

/** A privacy-safe pointer to a room the caller has a seat in — enough to render a
 *  "resume your game?" card (code, game, lobby/in-game, seat COUNT, last activity),
 *  but NEVER any hand, game state, reconnect token, or another player's identity. */
export interface UserRoomRef {
  code: string;
  gameType: GameType;
  started: boolean;
  /** Number of seated members (humans + bots) — a count only, no names/identities. */
  players: number;
  /** Room's last-activity epoch ms (for a relative "updated Ns ago" label). */
  updatedAt: number;
}

/**
 * Stage 36.0 — the rooms where `userId` holds a human seat, for cross-device
 * discovery ("you have a game in progress, rejoin?"). Privacy-safe: only the code
 * + game type + started flag, never tokens, hands, or other players' identities.
 * A blank / null userId returns []. Server-side only; matched on the authoritative
 * userId, never on any client-claimed identity.
 */
export function findUserRoomCodes(
  rooms: Iterable<ServerRoom>, userId: string | null | undefined,
): UserRoomRef[] {
  if (!userId) return [];
  const out: UserRoomRef[] = [];
  for (const room of rooms) {
    if ([...room.members.values()].some((m) => m.type === 'human' && m.userId === userId)) {
      out.push({
        code: room.code,
        gameType: room.gameType ?? DEFAULT_GAME_TYPE,
        started: room.started,
        players: room.members.size,
        updatedAt: room.updatedAt,
      });
    }
  }
  return out;
}

/** True when at least one HUMAN member currently has a live connection. */
export function hasConnectedHuman(room: ServerRoom): boolean {
  return [...room.members.values()].some((m) => m.type === 'human' && m.connected);
}

/**
 * Updates the room's orphan timer after any membership/connection change.
 * Sets `orphanSince` to `now` the moment the last connected human leaves, keeps
 * the original timestamp while it stays orphaned, and clears it when a human
 * (re)connects. Call after join/reconnect/disconnect/remove and on restore.
 */
export function recomputeOrphan(room: ServerRoom, now: number): void {
  if (hasConnectedHuman(room)) {
    room.orphanSince = null;
  } else if (room.orphanSince == null) {
    room.orphanSince = now;
  }
}

/**
 * The auto-action delay (ms) for the CURRENT acting member, or null to wait
 * indefinitely. Encodes the precedence rule (ONLINE_ARCHITECTURE.md):
 *   • bot / public screens → handled elsewhere (returns null here);
 *   • connected human + room timer on → the room timer;
 *   • connected human, no timer → null (wait for them);
 *   • DISCONNECTED human → substitute after `substituteMs`, or the room timer if
 *     it is enabled AND shorter (players agreed to that timer).
 * Pure: the caller supplies `substituteMs`.
 */
export function substituteDelayMs(
  member: ServerMember | null,
  room: ServerRoom,
  substituteMs: number,
): number | null {
  if (!member || member.type !== 'human') return null;
  const timerMs = room.turnTimerSec > 0 ? room.turnTimerSec * 1000 : null;
  if (!member.connected) {
    return timerMs != null ? Math.min(timerMs, substituteMs) : substituteMs;
  }
  return timerMs; // connected: the room timer, or null (wait)
}

/**
 * Host-only kick of another member BEFORE the game starts. Validates the
 * request (host, lobby-only, real target, not self) and removes the target,
 * which re-numbers seats. The removed member's reconnectToken leaves with it, so
 * a kicked client can no longer RECONNECT. Returns the removed member on success.
 */
export function kickMember(
  room: ServerRoom,
  hostClientId: string,
  targetClientId: string,
): OpResult & { removed?: ServerMember } {
  const host = room.members.get(hostClientId);
  if (!host?.isHost) return { ok: false, error: 'NOT_HOST' };
  if (room.started) return { ok: false, error: 'ILLEGAL_ACTION' };       // lobby only
  if (targetClientId === hostClientId) return { ok: false, error: 'ILLEGAL_ACTION' }; // use Leave for self
  const target = room.members.get(targetClientId);
  if (!target) return { ok: false, error: 'BAD_MESSAGE' };               // unknown target
  removeMember(room, targetClientId);                                    // re-numbers seats
  return { ok: true, removed: target };
}

/** Removes a member; promotes a new host if needed. Returns true if the room is now empty. */
export function removeMember(room: ServerRoom, clientId: string): { empty: boolean } {
  const wasHost = room.members.get(clientId)?.isHost ?? false;
  room.members.delete(clientId);
  if (room.members.size === 0) return { empty: true };
  if (wasHost) {
    const next = room.members.values().next().value;
    if (next) next.isHost = true;
  }
  assignSeats(room);
  return { empty: false };
}

// ---------------------------------------------------------------------------
// Game lifecycle (server owns the reducer + the deal)
// ---------------------------------------------------------------------------

/**
 * Host-triggered start: the server builds the initial deal via the reducer
 * using a server-generated seed, then records the deal metadata.
 */
export function startGame(room: ServerRoom, deal: DealContext = {}): OpResult {
  if (room.started) return { ok: false, error: 'ILLEGAL_ACTION' };
  // Start once the seated players are within the game's catalog range (Stage 9.10).
  // King: 3–4, Durak: 2–4. The room caps at maxPlayers; the host may start early.
  const entry = getGameCatalogEntry(room.gameType ?? DEFAULT_GAME_TYPE);
  const count = activePlayers(room).length;
  if (!entry || count < entry.minPlayers || count > entry.maxPlayers) {
    return { ok: false, error: 'ILLEGAL_ACTION' };
  }
  // Resolve the game's definition (Stage 8.5). Unknown game → fail gracefully.
  // For King this is `gameReducer`/`buildStartAction`, so behaviour is identical.
  const def = getGameDefinition(room.gameType ?? DEFAULT_GAME_TYPE);
  if (!def) return { ok: false, error: 'ILLEGAL_ACTION' };
  // The deal (shuffle + first-dealer pick) happens here, server-side, under a
  // recorded seed so the round is reproducible/auditable.
  const seed = deal.seed ?? randomSeed();
  room.gameState = def.reducer(null, def.buildStartAction(snapshot(room)), { rng: makeRng(seed) });
  room.started = true;
  recordDeal(room, seed, deal.now ?? 0);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Rematch / "Play again" for an online room (Stage 25.9)
//
// After a game finishes, seated humans can restart the SAME game (same gameType/options/
// members/seats) in the SAME room. All state is in-memory on the room; nothing is persisted.
// ---------------------------------------------------------------------------

/** Is the room's game over (so a rematch may be offered)? Routes through the game definition. */
export function isRoomFinished(room: ServerRoom): boolean {
  if (!room.started || !room.gameState) return false;
  const def = getGameDefinition(room.gameType ?? DEFAULT_GAME_TYPE);
  return !!def && def.isFinished(room.gameState as never);
}

/** Connected human players — the members whose consent a rematch needs (bots are always ready). */
export function rematchHumans(room: ServerRoom): ServerMember[] {
  return activePlayers(room).filter((m) => m.type === 'human' && m.connected);
}

/** Mark a member ready for a rematch (only seated players; ignored otherwise). */
export function markRematchReady(room: ServerRoom, clientId: string): void {
  const m = room.members.get(clientId);
  if (!m || m.role !== 'player' || m.type !== 'human') return;
  (room.rematchReady ??= new Set()).add(clientId);
}

/** Drop a member's rematch readiness (on leave/decline). */
export function removeRematchReady(room: ServerRoom, clientId: string): void {
  room.rematchReady?.delete(clientId);
}

/** Forget any pending rematch (on restart / new game / reset). */
export function clearRematch(room: ServerRoom): void {
  room.rematchReady = undefined;
}

/** Public rematch snapshot for REMATCH_STATE — ready clientIds (still-connected humans) + needed. */
export function rematchStateOf(room: ServerRoom): { ready: string[]; needed: number } {
  const humanIds = new Set(rematchHumans(room).map((m) => m.clientId));
  const ready = [...(room.rematchReady ?? [])].filter((id) => humanIds.has(id));
  return { ready, needed: humanIds.size };
}

/** True once every connected human has pressed ready (and there is at least one). */
export function allHumansReady(room: ServerRoom): boolean {
  const { ready, needed } = rematchStateOf(room);
  return needed > 0 && ready.length >= needed;
}

/**
 * Restart the SAME game in the SAME room after it finished: reset to a fresh deal keeping the
 * members/seats/gameType/options. Fails unless the current game is actually finished.
 */
export function restartGame(room: ServerRoom, deal: DealContext = {}): OpResult {
  if (!isRoomFinished(room)) return { ok: false, error: 'ILLEGAL_ACTION' };
  clearRematch(room);
  room.started = false;
  room.gameState = null;
  return startGame(room, deal);
}

/**
 * Applies a client's ACTION_REQUEST. Authorises the sender (right actor for the
 * action), then runs the reducer. The reducer returns the SAME reference for an
 * illegal move, which we detect and reject without mutating.
 *
 * `deal.seed` is threaded into the reducer ONLY when supplied — it is optional and
 * backward-compatible, so the existing WS call (no seed) runs the reducer exactly
 * as before for every released game (King/Durak/Deberc/Tarneeb/Preferans player
 * actions consume no rng, so their online path is byte-identical). The seam exists
 * for a game whose player action can invoke the rng mid-turn — 51's DRAW_FROM_DECK
 * reshuffles the discard when the draw pile empties (§5); passing a server seed
 * keeps that reshuffle reproducible/auditable instead of falling back to
 * Math.random. 51 is not yet hostable online (CREATE_ROOM rejects it), so this is
 * exercised by serverCore readiness tests only (Stage 30.4).
 */
export function applyActionRequest(
  room: ServerRoom,
  clientId: string,
  action: AnyGameAction,
  deal: DealContext = {},
): OpResult {
  const state = room.gameState;
  if (!state) return { ok: false, error: 'ILLEGAL_ACTION' };
  const gameType = room.gameType ?? DEFAULT_GAME_TYPE;
  const def = getGameDefinition(gameType);
  if (!def) return { ok: false, error: 'ILLEGAL_ACTION' };
  const seat = room.members.get(clientId)?.seatIndex ?? null;

  // Lifecycle actions (match creation / between-hands advance) are SERVER-driven only
  // (startGame / autoAdvance) — a client ACTION_REQUEST must NEVER trigger them, even
  // from the acting seat, or an actor could reset/replace a live authoritative state.
  // Poker's lifecycle actions are START_GAME / START_NEXT_HAND; no released game routes
  // either through a client action, so rejecting them here is safe for every game.
  const actionType = (action as { type?: string }).type;
  if (actionType === 'START_GAME' || actionType === 'START_NEXT_HAND') {
    return { ok: false, error: 'ILLEGAL_ACTION' };
  }

  // Authorise the sender. King keeps its EXACT rule (1:1); any other game allows
  // only the player whose turn it is (the reducer enforces the rest of legality).
  const authorized = gameType === 'king'
    ? authorizeAction(state as GameState, action as GameAction, seat)
    : seat != null && def.getActingPlayerId(state) === seatToPlayerId(seat);
  if (!authorized) return { ok: false, error: 'NOT_YOUR_TURN' };

  // Only pass a reducer context when a seed was supplied, so the no-seed WS path
  // stays identical to `def.reducer(state, action)` for the released games.
  const next = deal.seed != null
    ? def.reducer(state, action, { rng: makeRng(deal.seed) })
    : def.reducer(state, action);
  if (next === state) return { ok: false, error: 'ILLEGAL_ACTION' };
  room.gameState = next;

  // King-only: backfill the chosen mode onto the current round's deal record (DC).
  if (gameType === 'king' && (action as GameAction).type === 'CHOOSE_MODE' && next) {
    const ks = next as GameState;
    const last = room.dealLog[room.dealLog.length - 1];
    if (last && last.roundIndex === ks.currentRoundIdx) last.modeId = ks.currentRound.mode.id;
  }
  return { ok: true };
}

/**
 * Server-driven progression of public screens (trick_complete / round_scoring).
 * The WebSocket layer calls this on a timer so all clients stay in sync; clients
 * never send NEXT_TRICK / NEXT_ROUND. Returns true if the state advanced.
 */
export function autoAdvance(room: ServerRoom, deal: DealContext = {}): boolean {
  if (!room.gameState) return false;
  const gameType = room.gameType ?? DEFAULT_GAME_TYPE;

  if (gameType === 'king') {
    const state = room.gameState as GameState;
    if (state.status === 'trick_complete') {
      room.gameState = gameReducer(state, { type: 'NEXT_TRICK' });
      return true;
    }
    if (state.status === 'round_scoring') {
      // NEXT_ROUND deals a new round → seed it and record the deal metadata.
      const seed = deal.seed ?? randomSeed();
      const next = gameReducer(state, { type: 'NEXT_ROUND' }, { rng: makeRng(seed) });
      room.gameState = next;
      if (next && next.status !== 'game_finished') recordDeal(room, seed, deal.now ?? 0);
      return true;
    }
    return false;
  }

  if (gameType === 'deberc') {
    // Deberc's public screens are server-advanced (getActingDebercPlayerId → null):
    // trick_complete → NEXT_TRICK; hand_scoring → NEXT_HAND, which RE-DEALS and so
    // must be threaded with a server seed — otherwise the engine falls back to
    // Math.random and the deal is non-reproducible / not server-authoritative.
    const def = getGameDefinition('deberc');
    if (!def) return false;
    const state = room.gameState as DebercState;
    if (state.phase === 'trick_complete') {
      room.gameState = def.reducer(state, { type: 'NEXT_TRICK' });
      return true;
    }
    if (state.phase === 'hand_scoring') {
      const seed = deal.seed ?? randomSeed();
      room.gameState = def.reducer(state, { type: 'NEXT_HAND' }, { rng: makeRng(seed) });
      return true;
    }
    return false;
  }

  if (gameType === 'tarneeb') {
    // Tarneeb's only server-advanced public screen is `hand_complete` (no seat
    // acts there: getActingTarneebSeat → null). START_NEXT_HAND RE-DEALS, so it
    // must be threaded with a server seed — otherwise the redeal falls back to
    // Math.random and stops being reproducible / server-authoritative. There is
    // NO trick_complete phase (the 4th card resolves the trick inside PLAY_CARD),
    // and `game_finished` is terminal, so neither auto-advances.
    const def = getGameDefinition('tarneeb');
    if (!def) return false;
    const state = room.gameState as TarneebState;
    if (state.phase === 'hand_complete') {
      const seed = deal.seed ?? randomSeed();
      room.gameState = def.reducer(state, { type: 'START_NEXT_HAND' }, { rng: makeRng(seed) });
      return true;
    }
    return false;
  }

  if (gameType === 'preferans') {
    // Preferans mirrors Tarneeb: the only server-advanced public screen is
    // `hand_complete` (no seat acts there: getActingPreferansSeat → null).
    // START_NEXT_HAND RE-DEALS, so it must be threaded with a server seed to stay
    // reproducible. The trick resolves inside PLAY_CARD (no trick_complete screen)
    // and `game_finished` is terminal. NOTE: Preferans is NOT hostable online yet
    // (GAME_CATALOG.preferans.supportsOnline = false → wsHandlers rejects
    // CREATE_ROOM), so this branch only runs in internal serverCore readiness tests.
    const def = getGameDefinition('preferans');
    if (!def) return false;
    const state = room.gameState as PreferansState;
    if (state.phase === 'hand_complete') {
      const seed = deal.seed ?? randomSeed();
      room.gameState = def.reducer(state, { type: 'START_NEXT_HAND' }, { rng: makeRng(seed) });
      return true;
    }
    return false;
  }

  if (gameType === 'fifty-one') {
    // 51's only server-advanced public screen is `round_complete` (no seat acts
    // there: getActingFiftyOneSeat → null). START_NEXT_ROUND RE-DEALS the next
    // round, so it must be threaded with a server seed — otherwise the redeal
    // falls back to Math.random and stops being reproducible / server-authoritative.
    // The round resolves inside DISCARD (empty hand → scoreRound, no trick_complete
    // screen) and `game_finished` is terminal. NOTE: 51 is NOT hostable online yet
    // (GAME_CATALOG['fifty-one'].supportsOnline = false → wsHandlers rejects
    // CREATE_ROOM), so this branch only runs in internal serverCore readiness tests
    // (Stage 30.4), exactly like the Preferans branch was before its release.
    const def = getGameDefinition('fifty-one');
    if (!def) return false;
    const state = room.gameState as FiftyOneState;
    if (state.phase === 'round_complete') {
      const seed = deal.seed ?? randomSeed();
      room.gameState = def.reducer(state, { type: 'START_NEXT_ROUND' }, { rng: makeRng(seed) });
      return true;
    }
    return false;
  }

  if (gameType === 'poker') {
    // Poker's only server-advanced public screen is `hand_complete` (no seat acts
    // there: getActingPokerSeat → null). START_NEXT_HAND RE-DEALS the next hand, so
    // it must be threaded with a server seed — otherwise the redeal falls back to
    // Math.random and stops being reproducible / server-authoritative. The hand
    // resolves inside the betting action that closes the river / a fold-out (no
    // trick_complete screen) and `game_finished` is terminal.
    const def = getGameDefinition('poker');
    if (!def) return false;
    const state = room.gameState as PokerState;
    if (state.phase === 'hand_complete') {
      const seed = deal.seed ?? randomSeed();
      const next = def.reducer(state, { type: 'START_NEXT_HAND' }, { rng: makeRng(seed) });
      room.gameState = next;
      // Record the re-deal's seed so EVERY hand (not just the first) has audit metadata.
      // Skip when the advance ends the match (no new deal happened).
      if (next && (next as PokerState).phase !== 'game_finished') recordDeal(room, seed, deal.now ?? 0);
      return true;
    }
    return false;
  }

  // Durak: no server-advanced public screens (bouts resolve inside the reducer).
  return false;
}

/**
 * The public (system-advanced) screen the room is on, normalised across games so
 * the I/O layer can choose an advance delay without knowing each game's state
 * shape. King → trick_complete / round_scoring; Deberc → trick_complete and
 * hand_scoring (mapped to 'round_scoring', the between-hands pause); Durak → none.
 * Returns null when a player must act (or there is no game yet).
 */
export type PublicScreen = 'trick_complete' | 'round_scoring' | null;
export function publicScreenOf(room: ServerRoom): PublicScreen {
  const s = room.gameState;
  if (!s) return null;
  const gt = room.gameType ?? DEFAULT_GAME_TYPE;
  if (gt === 'king') {
    const st = (s as GameState).status;
    return st === 'trick_complete' ? 'trick_complete' : st === 'round_scoring' ? 'round_scoring' : null;
  }
  if (gt === 'deberc') {
    const ph = (s as DebercState).phase;
    return ph === 'trick_complete' ? 'trick_complete' : ph === 'hand_scoring' ? 'round_scoring' : null;
  }
  if (gt === 'tarneeb') {
    // Tarneeb has one public between-hands screen (`hand_complete`), mapped to the
    // generic 'round_scoring' pause. No trick_complete screen (see autoAdvance).
    return (s as TarneebState).phase === 'hand_complete' ? 'round_scoring' : null;
  }
  if (gt === 'preferans') {
    // Like Tarneeb: `hand_complete` is the single public between-hands pause.
    // (Internal-only until Preferans online lands — see autoAdvance note.)
    return (s as PreferansState).phase === 'hand_complete' ? 'round_scoring' : null;
  }
  if (gt === 'fifty-one') {
    // 51's single public between-rounds pause is `round_complete`, mapped to the
    // generic 'round_scoring'. Internal-only until 51 online lands (Stage 30.5).
    return (s as FiftyOneState).phase === 'round_complete' ? 'round_scoring' : null;
  }
  if (gt === 'poker') {
    // Poker's single public between-hands pause is `hand_complete`, mapped to the
    // generic 'round_scoring' (a showdown / next-hand pause).
    return (s as PokerState).phase === 'hand_complete' ? 'round_scoring' : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Server-side bots (AI seats with no socket)
// ---------------------------------------------------------------------------

/** The seat index encoded in an engine player id (`player-N`). */
function playerIdToSeat(playerId: string): number {
  return Number(playerId.split('-')[1]);
}

/**
 * If the player who must act right now is a bot, return that member; else null.
 * Returns null on public/no-actor screens (handled by the advance timer).
 */
/** The member (human or bot) who must act right now, or null on a public screen. */
export function actingMember(room: ServerRoom): ServerMember | null {
  const s = room.gameState;
  if (!s) return null;
  const def = getGameDefinition(room.gameType ?? DEFAULT_GAME_TYPE);
  if (!def) return null;
  const actingId = def.getActingPlayerId(s); // King or Durak; both use 'player-N' ids
  if (!actingId) return null;
  const seat = playerIdToSeat(actingId);
  return [...room.members.values()].find((m) => m.role === 'player' && m.seatIndex === seat) ?? null;
}

export function botMemberToAct(room: ServerRoom): ServerMember | null {
  const m = actingMember(room);
  return m && m.type === 'ai' ? m : null;
}

/**
 * Turn-timer expiry: play an automatic move for the current actor (human or
 * bot) using the shared AI heuristics, through the same authorised reducer path.
 * Returns whether an action was applied. Used by the server when a turn timer
 * runs out so a slow/absent player never stalls the table.
 */
export function applyTimeoutAction(room: ServerRoom): { acted: boolean } {
  const m = actingMember(room);
  if (!m || !room.gameState) return { acted: false };
  const def = getGameDefinition(room.gameType ?? DEFAULT_GAME_TYPE);
  if (!def) return { acted: false }; // unknown game → fail gracefully (no auto-action)
  const action = def.botAction(room.gameState);
  if (!action) return { acted: false };
  return { acted: applyActionRequest(room, m.clientId, action).ok };
}

/**
 * If it is a bot's turn, compute its action and apply it through the SAME
 * authorised reducer path as a human (so all legality — follow-suit, forced
 * ruff, legal discards, turn order — is enforced, never bypassed). Returns
 * whether a bot acted.
 */
export function applyBotTurn(room: ServerRoom): { acted: boolean } {
  const bot = botMemberToAct(room);
  if (!bot || !room.gameState) return { acted: false };
  const def = getGameDefinition(room.gameType ?? DEFAULT_GAME_TYPE);
  if (!def) return { acted: false }; // unknown game → fail gracefully (bot can't act)
  const action = def.botAction(room.gameState);
  if (!action) return { acted: false };
  const res = applyActionRequest(room, bot.clientId, action);
  return { acted: res.ok };
}

// ---------------------------------------------------------------------------
// Deal audit (private; server-only)
// ---------------------------------------------------------------------------

/** Fingerprint of the dealt hands + kitty for the current round. */
function dealFingerprint(state: GameState): string {
  const hands = state.players.map((p) => p.hand.map((c) => `${c.rank}${c.suit[0]}`).join(','));
  const kitty = state.currentRound.kitty.map((c) => `${c.rank}${c.suit[0]}`).join(',');
  return hashString(JSON.stringify({ r: state.currentRoundIdx, d: state.dealerIndex, hands, kitty }));
}

/** Appends a DealRecord for the room's current round (King-only deal audit). */
function recordDeal(room: ServerRoom, seed: number, timestamp: number): void {
  // Poker keeps a per-HAND deal audit log too (Stage 37.4 hardening): every
  // server-authoritative shuffle seed is recorded so the whole match is reproducible,
  // not just the first hand. The fingerprint is derived from PUBLIC deal metadata only
  // (hand index + button + seed) — never any card / deck / hole data.
  if (room.gameType === 'poker') {
    const p = room.gameState as PokerState | null;
    if (!p) return;
    room.dealLog.push({
      roundIndex: p.handNumber,
      dealerIndex: p.buttonSeat,
      dealerId: p.players[p.buttonSeat]?.id ?? `player-${p.buttonSeat}`,
      modeId: null,
      seed,
      deckHash: hashString(`poker|${p.handNumber}|${p.buttonSeat}|${seed}`),
      timestamp,
    });
    return;
  }
  if (room.gameType !== 'king') return; // only King (and poker above) keep a deal audit log
  const s = room.gameState as GameState | null;
  if (!s) return;
  room.dealLog.push({
    roundIndex: s.currentRoundIdx,
    dealerIndex: s.dealerIndex,
    dealerId: s.currentRound.dealerId,
    // In fixed mode the mode is known at deal time; in Dealer's Choice it is
    // backfilled by applyActionRequest when the dealer picks.
    modeId: room.modeSelectionType === 'dealer_choice' ? null : s.currentRound.mode.id,
    seed,
    deckHash: dealFingerprint(s),
    timestamp,
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function snapshot(room: ServerRoom): RoomSnapshot {
  return {
    code: room.code,
    members: [...room.members.values()].map((m) => ({
      clientId: m.clientId,
      name: m.name,
      role: m.role,
      seatIndex: m.seatIndex,
      isHost: m.isHost,
      connected: m.connected,
      type: m.type,
      avatar: m.avatar,
      // Public same-origin URL only; emitted when a valid one is stamped (else omitted
      // so legacy/guest/bot members are unchanged and the client shows the emoji).
      ...(isSafeAvatarImageUrl(m.avatarImageUrl) ? { avatarImageUrl: m.avatarImageUrl } : {}),
    })),
    gameType: room.gameType ?? DEFAULT_GAME_TYPE,
    variant: room.variant,
    matchSize: room.matchSize,
    tarneebVariant: room.tarneebVariant,
    tarneebTargetScore: room.tarneebTargetScore,
    fiftyOneEliminationScore: room.fiftyOneEliminationScore,
    playerCount: room.playerCount,
    modeSelectionType: room.modeSelectionType,
    turnTimerSec: room.turnTimerSec,
    started: room.started,
    // Expose only WHETHER a password is required — never the secret/hash/salt.
    hasPassword: roomHasPassword(room),
  };
}

/**
 * Public, privacy-safe summary for the room discovery list. Exposes ONLY
 * non-sensitive fields — never tokens, password hash/salt, gameState, hands,
 * dealLog or seeds.
 */
export function roomSummary(room: ServerRoom): RoomSummary {
  const players = activePlayers(room);
  const occupiedSeats = players.length;
  const status: RoomSummary['status'] = room.started
    ? 'in_game'
    : occupiedSeats >= room.playerCount ? 'full' : 'lobby';
  // The host is always a player; look across all members so we still surface the
  // host's avatar/connection even in edge cases.
  const host = [...room.members.values()].find((m) => m.isHost);
  return {
    code: room.code,
    hostName: host?.name ?? '—',
    // Re-sanitize: the summary is public, so guarantee a whitelisted emoji id
    // (never free text) regardless of how the member was stored.
    hostAvatar: sanitizeAvatar(host?.avatar, host?.name ?? room.code),
    hostConnected: host?.connected ?? false,
    // Emitted from the room (Stage 8.5) so future games extend without a protocol
    // change. King today; legacy rooms without the field default to King.
    gameType: room.gameType ?? DEFAULT_GAME_TYPE,
    // Only present for games with a variant (Durak) → King summaries are unchanged.
    ...(room.variant ? { variant: room.variant } : {}),
    // Only present for Deberc (match size) → King/Durak summaries are unchanged.
    ...(room.matchSize ? { matchSize: room.matchSize } : {}),
    // Only present for Tarneeb → other games' summaries are unchanged.
    ...(room.tarneebVariant ? { tarneebVariant: room.tarneebVariant } : {}),
    ...(room.tarneebTargetScore ? { tarneebTargetScore: room.tarneebTargetScore } : {}),
    // Only present for 51 → other games' summaries are unchanged.
    ...(room.fiftyOneEliminationScore ? { fiftyOneEliminationScore: room.fiftyOneEliminationScore } : {}),
    playerCount: room.playerCount,
    occupiedSeats,
    hasPassword: roomHasPassword(room),
    status,
    updatedAt: room.updatedAt,
  };
}

/** Summaries for a set of rooms, newest first. */
export function listRoomSummaries(rooms: Iterable<ServerRoom>): RoomSummary[] {
  // Only advertise rooms with at least one CONNECTED human. A room whose humans
  // all closed their tab is an orphan: it lingers briefly so a reload can
  // reconnect (deleted by the orphan sweep after ORPHAN_ROOM_TTL_MS), but it must
  // NOT show in the join list — nobody is there to join (FIX-1).
  return [...rooms]
    .filter(hasConnectedHuman)
    .map(roomSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Codes of rooms that should be auto-cleaned. A room idle longer than `ttlMs`
 * is removed; but a room with at least one connected player is kept until a
 * longer `hardTtlMs` passes (so an active table is never yanked).
 */
export function roomsToExpire(
  rooms: Iterable<ServerRoom>,
  now: number,
  ttlMs: number,
  hardTtlMs: number,
  orphanTtlMs: number = Infinity,
): string[] {
  const expired: string[] = [];
  for (const room of rooms) {
    const idle = now - room.updatedAt;
    if (hasConnectedHuman(room)) {
      // An active table (a connected human) survives until the long hard-TTL.
      if (idle > hardTtlMs) expired.push(room.code);
    } else {
      // Orphan (only bots / offline humans): delete after the SHORT orphan TTL
      // from when it became orphaned — or the legacy idle TTL as a backstop.
      // `orphanSince` defaults to updatedAt for rooms restored without it.
      const since = room.orphanSince ?? room.updatedAt;
      if (now - since >= orphanTtlMs || idle > ttlMs) expired.push(room.code);
    }
  }
  return expired;
}

/** The state a given client is allowed to see (own hand only) — game-aware. */
export function sanitizedStateFor(room: ServerRoom, clientId: string): AnyGameState | null {
  if (!room.gameState) return null;
  const def = getGameDefinition(room.gameType ?? DEFAULT_GAME_TYPE);
  if (!def) return null;
  const member = room.members.get(clientId);
  return def.redactStateFor(room.gameState, member?.seatIndex ?? null);
}

// ---------------------------------------------------------------------------
// Persistence (pure serialize/deserialize + a storage interface)
// ---------------------------------------------------------------------------

/** Bumps updatedAt; call before persisting a changed room. */
export function touchRoom(room: ServerRoom, now: number): void {
  room.updatedAt = now;
}

/**
 * JSON-safe form of a room. The Map of members becomes an array; transient
 * socket refs are NOT part of ServerRoom so nothing live is captured. The
 * salted password hash IS persisted (it is not plaintext); the deal audit log
 * IS persisted (server-only — it is never put in a snapshot).
 */
export interface PersistedRoom {
  v: 1;
  code: string;
  mode: ServerMode;
  /** Which game (Stage 8.5). Older saves lack it → restored as King. */
  gameType?: GameType;
  /** Durak variant; undefined for King. */
  variant?: DurakVariant;
  /** Deberc match target ('small' | 'big'); undefined for King/Durak. */
  matchSize?: DebercMatchSize;
  /** Tarneeb variant ('pairs' | 'solo'); undefined (→ pairs) for other games. */
  tarneebVariant?: TarneebVariant;
  /** Tarneeb match target score (Stage 29.8); undefined (→ 41) for other games / legacy rooms. */
  tarneebTargetScore?: number;
  /** 51 elimination score (Stage 30.15); undefined (→ 510) for other games / legacy rooms. */
  fiftyOneEliminationScore?: number;
  members: ServerMember[];
  playerCount: 2 | 3 | 4 | 5 | 6;
  modeSelectionType: 'fixed' | 'dealer_choice';
  turnTimerSec: number;
  started: boolean;
  gameState: AnyGameState | null;
  dealLog: DealRecord[];
  passwordSalt: string | null;
  passwordHash: string | null;
  createdAt: number;
  updatedAt: number;
  /** Orphan timer (epoch ms) or null. Older saves lack it → treated as null. */
  orphanSince?: number | null;
}

export function serializeRoom(room: ServerRoom): PersistedRoom {
  return {
    v: 1,
    code: room.code,
    mode: room.mode,
    gameType: room.gameType,
    variant: room.variant,
    matchSize: room.matchSize,
    tarneebVariant: room.tarneebVariant,
    tarneebTargetScore: room.tarneebTargetScore,
    fiftyOneEliminationScore: room.fiftyOneEliminationScore,
    members: [...room.members.values()].map((m) => ({ ...m })),
    playerCount: room.playerCount,
    modeSelectionType: room.modeSelectionType,
    turnTimerSec: room.turnTimerSec,
    started: room.started,
    gameState: room.gameState,
    dealLog: room.dealLog,
    passwordSalt: room.passwordSalt,
    passwordHash: room.passwordHash,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    orphanSince: room.orphanSince,
  };
}

/**
 * Rebuilds a ServerRoom from persisted data. Returns null if the data is
 * malformed (so a corrupt entry is skipped, not fatal). Every member is marked
 * disconnected — there are no live sockets after a restore.
 */
export function deserializeRoom(data: unknown): ServerRoom | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.code !== 'string' || !Array.isArray(o.members)) return null;
  if (typeof o.playerCount !== 'number' || o.playerCount < 2 || o.playerCount > 6) return null;
  if (o.modeSelectionType !== 'fixed' && o.modeSelectionType !== 'dealer_choice') return null;

  const members = new Map<string, ServerMember>();
  for (const raw of o.members as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const m = raw as Record<string, unknown>;
    if (typeof m.clientId !== 'string' || typeof m.reconnectToken !== 'string') return null;
    members.set(m.clientId, {
      clientId: m.clientId,
      reconnectToken: m.reconnectToken,
      name: typeof m.name === 'string' ? m.name : 'Player',
      role: m.role === 'spectator' ? 'spectator' : 'player',
      seatIndex: typeof m.seatIndex === 'number' ? m.seatIndex : null,
      isHost: m.isHost === true,
      // Bots are always "present"; humans have no live socket after a restore.
      connected: m.type === 'ai',
      type: m.type === 'ai' ? 'ai' : 'human',
      avatar: sanitizeAvatar(m.avatar, typeof m.name === 'string' ? m.name : 'player'),
      userId: typeof m.userId === 'string' ? m.userId : null,
      // Restore the uploaded-avatar URL only if it is a valid same-origin value;
      // legacy rooms (no field) and any tampered value degrade to the emoji. A stale
      // URL (avatar since deleted) simply 404s on the client → emoji fallback, and a
      // fresh reconnect re-stamps the current value.
      avatarImageUrl: isSafeAvatarImageUrl(m.avatarImageUrl) ? m.avatarImageUrl : null,
    });
  }

  return {
    code: o.code,
    mode: 'server_authoritative',
    // Legacy rooms persisted before Stage 8.5 have no gameType → restore as King.
    gameType: isGameType(o.gameType) ? o.gameType : DEFAULT_GAME_TYPE,
    variant: o.variant === 'simple' || o.variant === 'transfer' ? o.variant : undefined,
    matchSize: o.matchSize === 'small' || o.matchSize === 'big' ? o.matchSize : undefined,
    // Legacy rooms (no field) or a bad value → undefined → the reducer reads pairs.
    tarneebVariant: o.tarneebVariant === 'solo' ? 'solo' : o.tarneebVariant === 'pairs' ? 'pairs' : undefined,
    // Match target (Stage 29.8): re-normalise on restore; a missing/legacy value stays undefined
    // (buildStartAction then applies the default 41), any present value is clamped to a safe range.
    tarneebTargetScore: o.tarneebTargetScore != null ? normalizeTargetScore(o.tarneebTargetScore) : undefined,
    // 51 elimination score (Stage 30.15): re-normalise on restore; a missing/legacy value stays
    // undefined (buildStartAction then applies the default 510), a bad value snaps to a preset.
    fiftyOneEliminationScore: o.fiftyOneEliminationScore != null ? normalizeEliminationScore(o.fiftyOneEliminationScore as number) : undefined,
    members,
    playerCount: o.playerCount as 2 | 3 | 4 | 5 | 6, // guarded to 2..6 above
    modeSelectionType: o.modeSelectionType,
    turnTimerSec: normalizeTimer(o.turnTimerSec),
    started: o.started === true,
    gameState: (o.gameState ?? null) as AnyGameState | null,
    dealLog: Array.isArray(o.dealLog) ? (o.dealLog as DealRecord[]) : [],
    passwordSalt: typeof o.passwordSalt === 'string' ? o.passwordSalt : null,
    passwordHash: typeof o.passwordHash === 'string' ? o.passwordHash : null,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
    orphanSince: typeof o.orphanSince === 'number' ? o.orphanSince : null,
  };
}

/**
 * Server-side room storage. The default is in-memory (LAN/dev/tests); the
 * WebSocket layer can swap in a file-backed implementation for restart
 * survival (see server/storage.ts).
 */
export interface RoomStorage {
  loadRooms(): ServerRoom[];
  saveRoom(room: ServerRoom): void;
  deleteRoom(code: string): void;
}

/** Process-memory storage (no durability). Used for dev and unit tests. */
export class MemoryRoomStorage implements RoomStorage {
  private data = new Map<string, PersistedRoom>();

  loadRooms(): ServerRoom[] {
    const rooms: ServerRoom[] = [];
    for (const p of this.data.values()) {
      const room = deserializeRoom(p);
      if (room) rooms.push(room);
    }
    return rooms;
  }

  saveRoom(room: ServerRoom): void {
    this.data.set(room.code, serializeRoom(room));
  }

  deleteRoom(code: string): void {
    this.data.delete(code);
  }
}
