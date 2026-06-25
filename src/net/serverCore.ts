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
import { gameReducer, getActingPlayerId, getCurrentPlayer } from '../core/gameEngine';
import { aiChooseMode, aiChooseTrump, aiChooseKittyDiscards, aiChooseCard } from '../core/ai';
import { sanitizeAvatar, BOT_AVATAR } from '../core/avatars';
import { makeRng, randomSeed, hashString } from '../core/rng';
import { redactStateFor } from './messages';
import type { ErrorCode, RoomSnapshot, RoomSummary, SeatRole } from './messages';
import { authorizeAction, buildStartAction, seatToPlayerId } from './online';

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
}

export interface ServerRoom {
  code: string;
  mode: ServerMode;
  members: Map<string, ServerMember>; // keyed by clientId, insertion-ordered
  playerCount: 3 | 4;
  modeSelectionType: 'fixed' | 'dealer_choice';
  /** Per-turn timer in seconds (0 = off). Host-set in the lobby. */
  turnTimerSec: number;
  started: boolean;
  /** Authoritative, UNREDACTED game state. Never sent to clients as-is. */
  gameState: GameState | null;
  /** Private deal audit log (server-only; never broadcast). */
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
}

export interface OpResult {
  ok: boolean;
  error?: ErrorCode;
}

const MAX_PLAYERS = 4;

// ---------------------------------------------------------------------------
// Join-secret hashing (salted; plaintext is never stored)
// ---------------------------------------------------------------------------

/** Salted, lightly-stretched hash of a join password. MVP strength only. */
function hashSecret(salt: string, password: string): string {
  let h = `${salt}|${password}`;
  for (let i = 0; i < 1000; i++) h = hashString(`${h}|${salt}`);
  return h;
}

export function roomHasPassword(room: ServerRoom): boolean {
  return room.passwordHash !== null;
}

/** True if the room is open, or the attempt matches the stored hash. */
export function verifyPassword(room: ServerRoom, attempt: string | undefined): boolean {
  if (room.passwordHash === null || room.passwordSalt === null) return true; // open room
  if (!attempt) return false;
  return hashSecret(room.passwordSalt, attempt) === room.passwordHash;
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

export function createRoom(opts: {
  code: string;
  playerCount: 3 | 4;
  modeSelectionType: 'fixed' | 'dealer_choice';
  host: { clientId: string; reconnectToken: string; name: string; avatar?: string };
  /** Optional join password; when set, `salt` must be supplied by the caller. */
  password?: string;
  salt?: string;
  /** Per-turn timer in seconds (0 = off). */
  turnTimerSec?: number;
  /** Epoch ms for createdAt/updatedAt (injected by the I/O layer). */
  now?: number;
}): ServerRoom {
  const hasPw = typeof opts.password === 'string' && opts.password.length > 0;
  const salt = opts.salt ?? '';
  const now = opts.now ?? 0;
  const room: ServerRoom = {
    code: opts.code,
    mode: 'server_authoritative',
    members: new Map(),
    playerCount: opts.playerCount,
    modeSelectionType: opts.modeSelectionType,
    turnTimerSec: normalizeTimer(opts.turnTimerSec),
    started: false,
    gameState: null,
    dealLog: [],
    passwordSalt: hasPw ? salt : null,
    passwordHash: hasPw ? hashSecret(salt, opts.password!) : null,
    createdAt: now,
    updatedAt: now,
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
): OpResult {
  // Protected rooms require the correct password before anything else.
  if (!verifyPassword(room, member.password)) {
    return { ok: false, error: 'BAD_PASSWORD' };
  }
  // New players can't join a game in progress (existing members RECONNECT).
  if (room.started) {
    return { ok: false, error: 'GAME_ALREADY_STARTED' };
  }
  const role: SeatRole = member.role === 'spectator' ? 'spectator' : 'player';
  // A room is full at its configured size (3 or 4), capped by MAX_PLAYERS.
  if (role === 'player' && activePlayers(room).length >= Math.min(room.playerCount, MAX_PLAYERS)) {
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
  if (activePlayers(room).length >= Math.min(room.playerCount, MAX_PLAYERS)) {
    return { ok: false, error: 'ROOM_FULL' };
  }
  // First free "Bot N" name (unique among current members).
  const taken = new Set([...room.members.values()].map((m) => m.name));
  let n = 1;
  while (taken.has(`Bot ${n}`)) n++;
  const bot: ServerMember = {
    clientId: ids.clientId,
    reconnectToken: ids.reconnectToken,
    name: `Bot ${n}`,
    role: 'player',
    seatIndex: null,
    isHost: false,
    connected: true, // bots are always "present"
    type: 'ai',
    avatar: BOT_AVATAR,
    userId: null, // bots have no account → never written to user_stats
  };
  room.members.set(bot.clientId, bot);
  assignSeats(room);
  return { ok: true, bot };
}

export function reconnectMember(room: ServerRoom, reconnectToken: string): ServerMember | null {
  const member = [...room.members.values()].find((m) => m.reconnectToken === reconnectToken);
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
  if (activePlayers(room).length !== room.playerCount) {
    return { ok: false, error: 'ILLEGAL_ACTION' };
  }
  // The deal (shuffle + first-dealer pick) happens here, server-side, under a
  // recorded seed so the round is reproducible/auditable.
  const seed = deal.seed ?? randomSeed();
  room.gameState = gameReducer(null, buildStartAction(snapshot(room)), { rng: makeRng(seed) });
  room.started = true;
  recordDeal(room, seed, deal.now ?? 0);
  return { ok: true };
}

/**
 * Applies a client's ACTION_REQUEST. Authorises the sender (right actor for the
 * action), then runs the reducer. The reducer returns the SAME reference for an
 * illegal move, which we detect and reject without mutating.
 */
export function applyActionRequest(
  room: ServerRoom,
  clientId: string,
  action: GameAction,
): OpResult {
  if (!room.gameState) return { ok: false, error: 'ILLEGAL_ACTION' };
  const member = room.members.get(clientId);
  if (!authorizeAction(room.gameState, action, member?.seatIndex ?? null)) {
    return { ok: false, error: 'NOT_YOUR_TURN' };
  }
  const next = gameReducer(room.gameState, action);
  if (next === room.gameState) return { ok: false, error: 'ILLEGAL_ACTION' };
  room.gameState = next;

  // Backfill the chosen mode onto the current round's deal record (DC mode).
  if (action.type === 'CHOOSE_MODE' && next) {
    const last = room.dealLog[room.dealLog.length - 1];
    if (last && last.roundIndex === next.currentRoundIdx) {
      last.modeId = next.currentRound.mode.id;
    }
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
  if (room.gameState.status === 'trick_complete') {
    room.gameState = gameReducer(room.gameState, { type: 'NEXT_TRICK' });
    return true;
  }
  if (room.gameState.status === 'round_scoring') {
    // NEXT_ROUND deals a new round → seed it and record the deal metadata.
    const seed = deal.seed ?? randomSeed();
    const next = gameReducer(room.gameState, { type: 'NEXT_ROUND' }, { rng: makeRng(seed) });
    room.gameState = next;
    if (next && next.status !== 'game_finished') recordDeal(room, seed, deal.now ?? 0);
    return true;
  }
  return false;
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
  const actingId = getActingPlayerId(s);
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
  const action = botAction(room.gameState);
  if (!action) return { acted: false };
  return { acted: applyActionRequest(room, m.clientId, action).ok };
}

/**
 * The action a bot should take for the current acting player, using the shared
 * core heuristics. Pure (reads the unredacted server state — the server legally
 * sees every hand). Returns null on screens a bot does not drive.
 */
export function botAction(state: GameState): GameAction | null {
  switch (state.status) {
    case 'mode_selection': {
      const dealer = state.players[state.dealerIndex];
      return { type: 'CHOOSE_MODE', modeId: aiChooseMode(state.dealerModes[dealer.id]) };
    }
    case 'select_trump': {
      const dealer = state.players[state.dealerIndex];
      return { type: 'SELECT_TRUMP', suit: aiChooseTrump(dealer.hand) };
    }
    case 'kitty_exchange': {
      const dealer = state.players[state.dealerIndex];
      return {
        type: 'EXCHANGE_KITTY',
        discards: aiChooseKittyDiscards(dealer.hand, state.config.kittySize, state.currentRound.mode.id),
      };
    }
    case 'playing': {
      const p = getCurrentPlayer(state);
      return { type: 'PLAY_CARD', playerId: p.id, card: aiChooseCard(state) };
    }
    default:
      return null;
  }
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
  const action = botAction(room.gameState);
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

/** Appends a DealRecord for the room's current round. */
function recordDeal(room: ServerRoom, seed: number, timestamp: number): void {
  const s = room.gameState;
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
    })),
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
    // King-only today; emitted from the room so future games extend without a
    // protocol change. Discovery is game-aware (see ONLINE_ARCHITECTURE.md).
    gameType: 'king',
    playerCount: room.playerCount,
    occupiedSeats,
    hasPassword: roomHasPassword(room),
    status,
    updatedAt: room.updatedAt,
  };
}

/** Summaries for a set of rooms, newest first. */
export function listRoomSummaries(rooms: Iterable<ServerRoom>): RoomSummary[] {
  return [...rooms].map(roomSummary).sort((a, b) => b.updatedAt - a.updatedAt);
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
): string[] {
  const expired: string[] = [];
  for (const room of rooms) {
    const idle = now - room.updatedAt;
    // Only connected HUMANS keep a room on the longer hard-TTL; bots are always
    // "present" and must not keep an abandoned room alive forever.
    const hasConnected = [...room.members.values()].some((m) => m.connected && m.type !== 'ai');
    if (hasConnected ? idle > hardTtlMs : idle > ttlMs) expired.push(room.code);
  }
  return expired;
}

/** The state a given client is allowed to see (own hand only). */
export function sanitizedStateFor(room: ServerRoom, clientId: string): GameState | null {
  const member = room.members.get(clientId);
  const viewerPlayerId = member && member.seatIndex != null ? seatToPlayerId(member.seatIndex) : null;
  return redactStateFor(room.gameState, viewerPlayerId);
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
  members: ServerMember[];
  playerCount: 3 | 4;
  modeSelectionType: 'fixed' | 'dealer_choice';
  turnTimerSec: number;
  started: boolean;
  gameState: GameState | null;
  dealLog: DealRecord[];
  passwordSalt: string | null;
  passwordHash: string | null;
  createdAt: number;
  updatedAt: number;
}

export function serializeRoom(room: ServerRoom): PersistedRoom {
  return {
    v: 1,
    code: room.code,
    mode: room.mode,
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
  if (o.playerCount !== 3 && o.playerCount !== 4) return null;
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
    });
  }

  return {
    code: o.code,
    mode: 'server_authoritative',
    members,
    playerCount: o.playerCount,
    modeSelectionType: o.modeSelectionType,
    turnTimerSec: normalizeTimer(o.turnTimerSec),
    started: o.started === true,
    gameState: (o.gameState ?? null) as GameState | null,
    dealLog: Array.isArray(o.dealLog) ? (o.dealLog as DealRecord[]) : [],
    passwordSalt: typeof o.passwordSalt === 'string' ? o.passwordSalt : null,
    passwordHash: typeof o.passwordHash === 'string' ? o.passwordHash : null,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : 0,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : 0,
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
