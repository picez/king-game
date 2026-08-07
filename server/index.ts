// ---------------------------------------------------------------------------
// King — SERVER-AUTHORITATIVE online server: composition root (Node + ws, tsx).
//
//   npm run server            # this file (server-authoritative, default)
//   PORT=8080 npm run server  # override port
//
// (The old host-authoritative relay was retired in Stage 8.6 — it now lives,
// unsupported and not wired to any script, at legacy/server-relay.mjs.)
//
// The server OWNS the GameState: it builds the deal, applies `gameReducer` to
// every ACTION_REQUEST, authorises the sender, and broadcasts a per-client
// redacted STATE_UPDATE. Game logic lives in src/net/serverCore.ts; this file is
// only WebSocket I/O + lifecycle. Stage 8.1 split the former monolith into:
//   • server/httpStatic.ts   — static client hosting + /health
//   • server/roomSocial.ts   — reactions + chat (ephemeral room-social state)
//   • server/finishSignature.ts — finished-game stats fingerprint (pure)
//   • server/wsHandlers.ts   — the client-message dispatch (handleClientMessage)
// This file wires those together with the room/socket/timer state, the game-loop
// (broadcastAndAdvance), room lifecycle/cleanup, and bootstrap. No behaviour,
// protocol, gameplay, rules, scoring, persistence, or auth changed.
// ---------------------------------------------------------------------------

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ClientMessage, ServerMessage, ErrorCode } from '../src/net/messages';
import {
  markDisconnected, removeMember, autoAdvance, snapshot, sanitizedStateFor, touchRoom,
  roomsToExpire, roomHasPassword, botMemberToAct, applyBotTurn,
  actingMember, applyTimeoutAction, recomputeOrphan, publicScreenOf, roomTimerInfo,
  beginTurnDeadline, resolveHumanFireAt,
  isRoomFinished, markRematchReady, removeRematchReady, clearRematch, rematchStateOf,
  allHumansReady, restartGame, freezeOnlineMatch,
  type ServerRoom, type ServerMember,
} from '../src/net/serverCore';
import {
  finishSeatUsers, ratedByFrozenCategory, startingHumanSeats,
  type OnlineMatchMeta,
} from '../src/net/onlineMatch';
import { seatOutcomesFor } from '../src/net/onlineMatchOutcome';
import type { AnyGameState } from '../src/games/anyGame';
import { runPermanentLeave, type PermanentLeaveDeps } from './permanentLeave';
import { hashReconnectToken } from './reconnectToken';
import { createStorage, type AppStorage } from './storage';
import { resolveTrickAdvanceMs } from '../src/net/serverTiming';
import { isDbEnabled, probeDbState } from './db/client';
import { handleApiRequest, resolveSessionUserId, resolveAvatarImageUrl } from './api';
import { attachPresence, detachPresence, isOnline, presenceSocketsFor } from './friendsPresence';
import { allowFriendInvite } from './friendsRateLimit';
import { verifyFriendInvite, inviteReasonToErrorCode } from '../src/net/friendInvite';
import { joinVoice, leaveVoice, relayVoiceSignal, setVoiceMute, type VoiceDelivery } from './voiceSignaling';
import { allowVoiceSignal } from './voiceRateLimit';
import { isValidSdp, isValidIce } from '../src/net/voiceSignal';
import { ffmpegAvailable } from './avatarProcess';
import { serveStatic, handleHealth, handleDiagnostics, SERVE_STATIC, DIST } from './httpStatic';
import { setFfmpegReady, getFfmpegReady, serverVersion, gitCommit, type DbState } from './diagnostics';
import { iceMode, configuredIceServers, iceConfigPayload } from './voiceIce';
import { RoomSocialStore } from './roomSocial';
import { finishSignature } from './finishSignature';
import { handleClientMessage, type WsContext, type SessionRef } from './wsHandlers';
import { getGameDefinition } from '../src/games/registry';
import { isBankrollRoom, payoutStacks, hasUnsettledEscrow, debitRematch, withRoomLock, clearRoomLock, reconcileEscrow, resolveEscrowEvidence, refundBuyInsResult, reconcileOrphanedDebits, reconcileCorruptRoom, bankrollEconomyUnavailable, pokerRecoveryBlocked, settlementPending, payoutPending, statsPending, unboundEscrowGame, escrowUnresolved, escrowlessClaim, applyRefundOutcome } from './pokerEscrow';
import { resolveUnboundEscrowGame } from './pokerBinding';
import { runBankrollRematch, handleRematchRequest } from './pokerRematch';
import { settleAndRecordBankrollPokerFinish, recordConfirmedPokerStats, settleRoomForDeletion } from './pokerFinish';
import { runBootstrapEconomyRecovery, runRuntimeEconomyRecovery, runRoomRecoverySweep, shouldDeferBootstrapAdvance } from './pokerBootstrap';
import {
  ensureRebuyDeadline, clearRebuyDeadline, shouldCloseRebuyWindow, closeRebuyWindow,
  inOnlineRebuyWindow, resolveRebuySeat, rebuyRequestAllowed, performRebuy, performDecline,
  reconcileRebuys, REBUY_WINDOW_MS, type RebuyDeps,
} from './pokerRebuy';
import { durakFinishSignature } from '../src/net/durakStats';
import { debercFinishSignature } from '../src/net/debercStats';
import { tarneebFinishSignature } from '../src/net/tarneebStats';
import { preferansFinishSignature } from '../src/net/preferansStats';
import { fiftyOneFinishSignature } from '../src/net/fiftyOneStats';
import { pokerFinishSignature } from '../src/net/pokerStats';
import type { GameState } from '../src/models/types';
import type { DurakState } from '../src/games/durak/types';
import type { DebercState } from '../src/games/deberc/types';
import type { TarneebState } from '../src/games/tarneeb/types';
import type { PreferansState } from '../src/games/preferans/types';
import type { FiftyOneState } from '../src/games/fiftyOne/types';
import type { PokerState } from '../src/games/poker/types';
import { ConnectionLimiter, DEFAULT_RATE_LIMITS, type RateLimitConfig } from '../src/net/rateLimit';
import { IpConnectionLimiter, DEFAULT_IP_RATE_LIMITS, type IpRateLimitConfig } from '../src/net/ipRateLimit';

/**
 * Debug-safe lobby log for CREATE_ROOM / JOIN_ROOM / RECONNECT. Logs only
 * non-sensitive routing info (code, status, seats, hasPassword, errorCode) —
 * NEVER passwords, tokens, names, or hands.
 */
function logRoomEvent(event: string, code: string, room: ServerRoom | null, errorCode?: string): void {
  if (!room) {
    console.log(`[King] ${event} room=${code || '?'} → ${errorCode ?? 'NO_ROOM'}`);
    return;
  }
  const players = [...room.members.values()].filter((m) => m.role === 'player');
  const occupied = players.length;
  const connected = [...room.members.values()].filter((m) => m.connected).length;
  const status = room.started ? 'in_game' : occupied >= room.playerCount ? 'full' : 'lobby';
  console.log(
    `[King] ${event} room=${code} status=${status} seats=${occupied}/${room.playerCount} ` +
    `connected=${connected} hasPassword=${roomHasPassword(room)}${errorCode ? ` → ${errorCode}` : ' → OK'}`,
  );
}

/** Logs a deal record summary for audit/debug — never logs hands. */
function logLatestDeal(room: ServerRoom): void {
  const d = room.dealLog[room.dealLog.length - 1];
  if (!d) return;
  console.log(
    `[King] room ${room.code} deal: round=${d.roundIndex} dealer=${d.dealerIndex} ` +
    `mode=${d.modeId ?? 'pending'} seed=${d.seed} deckHash=${d.deckHash}`,
  );
}

// ── Environment config ─────────────────────────────────────────────────────
// Defaults keep LAN/dev trivial; production overrides via env (see DEPLOYMENT.md):
//   PORT             listen port (default 3001)
//   HOST             bind address (default 0.0.0.0; use 127.0.0.1 behind a proxy)
//   NODE_ENV         'production' enables stricter startup checks/warnings
//   ALLOWED_ORIGINS  comma-separated browser origins to allow (empty = allow all)
const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV ?? 'development';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// How long a completed trick stays on the table before the server auto-advances
// to the next trick. Long enough to read the cards (post-playtest fix #2);
// overridable via TRICK_ADVANCE_MS env (clamped to a sane range).
const TRICK_ADVANCE_MS = resolveTrickAdvanceMs(process.env.TRICK_ADVANCE_MS);
const ROUND_ADVANCE_MS = 10000; // give everyone time to read the round scores
// Poker showdown-review pauses (§16 G): server-driven, so every client shows the same
// review for the same time before the next hand is auto-dealt.
const POKER_SHOWDOWN_REVIEW_MS = 7000;
const POKER_FOLDWIN_REVIEW_MS = 2500;
// Pause before a server-side bot makes its move, so play does not snap instantly.
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 800);

// Room auto-clean: idle rooms expire after ROOM_TTL; rooms with a connected
// player survive until the longer hard TTL.
const HOUR_MS = 60 * 60 * 1000;
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_HOURS ?? 24) * HOUR_MS;
const ROOM_HARD_TTL_MS = Number(process.env.ROOM_HARD_TTL_HOURS ?? 48) * HOUR_MS;
// Orphan room (no connected human — only bots/offline humans) → delete after this.
// Default 5 minutes (Stage 36.0): long enough that a player who accidentally closed
// the tab / reloaded — including in a game against bots — can come back and RECONNECT
// to the SAME room, while an abandoned table still vanishes on its own. Applies to
// both a lobby and an active game. Overridable via ORPHAN_ROOM_TTL_MS.
const ORPHAN_ROOM_TTL_MS = Number(process.env.ORPHAN_ROOM_TTL_MS ?? 5 * 60 * 1000);
// When a DISCONNECTED human's turn comes, wait this long before an AI substitute
// acts for them (Stage 7.2; default 2 min). A room turn timer, if enabled AND
// shorter, takes precedence (players agreed to it). Reconnecting cancels it.
const SUBSTITUTE_DELAY_MS = Number(process.env.DISCONNECTED_SUBSTITUTE_DELAY_MS ?? 2 * 60 * 1000);
// Sweep cadence (ms). Overridable for tests/admin; default every 45 s so an
// orphaned room is actually removed within ~orphan-TTL + one sweep (not up to
// 10 min later). Cheap: the sweep is an in-memory filter over the room map.
const CLEANUP_INTERVAL_MS = Number(process.env.ROOM_CLEANUP_INTERVAL_MS ?? 45 * 1000);
// WS liveness heartbeat: ping every client this often and terminate any that did
// not answer the previous ping (a half-open socket — the tab was closed, wifi
// dropped, mobile backgrounded — where 'close' never fires). WITHOUT this, such a
// member stays connected=true forever, the room never becomes an orphan, and it
// lingers until the 48 h hard TTL — the "rooms not destroyed" bug. terminate()
// fires 'close', which marks the member disconnected → orphan → swept.
const HEARTBEAT_INTERVAL_MS = Number(process.env.WS_HEARTBEAT_INTERVAL_MS ?? 30 * 1000);

// Per-connection WS rate limits (БЕЗ-1). Generous defaults (see rateLimit.ts);
// every knob is env-overridable so ops can tighten for a public launch or loosen
// for load tests. A non-finite/absent env value falls back to the default.
const numEnv = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
};
const boolEnv = (name: string, fallback: boolean): boolean => {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true' || v.toLowerCase() === 'yes';
};
const RATE_LIMITS: RateLimitConfig = {
  message: {
    capacity: numEnv('WS_MSG_BURST', DEFAULT_RATE_LIMITS.message.capacity),
    refillPerSec: numEnv('WS_MSG_PER_SEC', DEFAULT_RATE_LIMITS.message.refillPerSec),
  },
  createRoom: {
    capacity: numEnv('WS_CREATE_BURST', DEFAULT_RATE_LIMITS.createRoom.capacity),
    refillPerSec: numEnv('WS_CREATE_PER_SEC', DEFAULT_RATE_LIMITS.createRoom.refillPerSec),
  },
  joinFailure: {
    capacity: numEnv('WS_JOIN_FAIL_BURST', DEFAULT_RATE_LIMITS.joinFailure.capacity),
    refillPerSec: numEnv('WS_JOIN_FAIL_PER_SEC', DEFAULT_RATE_LIMITS.joinFailure.refillPerSec),
  },
};

// Per-IP connection limits (infra-level: bounds concurrency + connect-flood from a
// single host, which the per-connection ConnectionLimiter above does not cover).
// Env-tunable. TRUST_PROXY makes IP extraction read X-Forwarded-For (set it on
// Render/behind any reverse proxy; OFF by default so a direct client can't spoof
// its IP). Loopback is exempt by default — tests/LAN open many sockets from ::1.
const IP_RATE_LIMITS: IpRateLimitConfig = {
  maxConcurrent: numEnv('IP_MAX_CONCURRENT', DEFAULT_IP_RATE_LIMITS.maxConcurrent),
  connect: {
    capacity: numEnv('IP_CONNECT_BURST', DEFAULT_IP_RATE_LIMITS.connect.capacity),
    refillPerSec: numEnv('IP_CONNECT_PER_SEC', DEFAULT_IP_RATE_LIMITS.connect.refillPerSec),
  },
};
const TRUST_PROXY = boolEnv('TRUST_PROXY', false);
const IP_LIMIT_EXEMPT_LOOPBACK = boolEnv('IP_LIMIT_EXEMPT_LOOPBACK', true);
const ipLimiter = new IpConnectionLimiter(IP_RATE_LIMITS);

/**
 * The remote IP of an upgrade request. Behind a trusted proxy the real client is
 * the FIRST entry of X-Forwarded-For (the proxy appends hops); direct connections
 * use the socket peer. Never trusts XFF unless TRUST_PROXY is set (else any client
 * could forge its IP and dodge the limit).
 */
function extractClientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** True for loopback peers (IPv4, IPv6, and IPv4-mapped-IPv6 forms). */
function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
    || ip.startsWith('127.') || ip.startsWith('::ffff:127.');
}

/**
 * Browser-origin allowlist. Empty list = allow any (LAN/dev). Requests without
 * an Origin header (non-browser clients) are always allowed.
 */
function verifyOrigin(info: { origin?: string }): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true;
  if (!info.origin) return true;
  return ALLOWED_ORIGINS.includes(info.origin);
}

// ── Server state ───────────────────────────────────────────────────────────
const rooms = new Map<string, ServerRoom>();
const sockets = new Map<string, WebSocket>();              // clientId → socket
// WS-level liveness: true once a socket has answered our latest ping. A socket
// still false at the next heartbeat tick is dead → terminated (see HEARTBEAT).
const socketAlive = new WeakMap<WebSocket, boolean>();
const advanceTimers = new Map<string, ReturnType<typeof setTimeout>>(); // code → timer
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();     // code → bot-move timer
const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();    // code → human turn-timeout
// Per-room signature of the finished game we already wrote to stats. Prevents a
// reconnect/rebroadcast from double-counting; a fresh game (different scores)
// yields a new signature so it records once too. DB has its own idempotency key.
const recordedFinish = new Map<string, string>();                       // code → finish signature
// EPHEMERAL room-social (reactions + chat) state; never persisted (see roomSocial.ts).
const social = new RoomSocialStore();

// Assigned once in bootstrap() (createStorage is async for the pg backend).
// Declared with `let` so the I/O handlers below can close over it; they only
// run after the server is listening, by which point it is set.
let storage: AppStorage;

/** Persist a changed room (stamps updatedAt). Called on meaningful changes only. */
function persistRoom(room: ServerRoom): void {
  const now = Date.now();
  // Keep the orphan timer current: set it when the last human disconnects, clear
  // it when a human (re)connects. orphanSince itself is NOT bumped by activity, so
  // the ORPHAN_ROOM_TTL_MS countdown runs from when humans actually left (Stage 7.2).
  recomputeOrphan(room, now);
  touchRoom(room, now);
  storage.saveRoom(room);
}

// ── Send / broadcast helpers ───────────────────────────────────────────────

function send(socket: WebSocket | undefined, msg: ServerMessage): void {
  if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}
function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
  send(socket, { t: 'ERROR', code, message });
}
function socketOf(member: ServerMember): WebSocket | undefined {
  return sockets.get(member.clientId);
}

function makeRoomCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function broadcastRoom(room: ServerRoom): void {
  const snap = snapshot(room);
  for (const m of room.members.values()) send(socketOf(m), { t: 'ROOM_UPDATE', room: snap });
}

/** Sends one server message to every member of a room (Stage 7 social). */
function broadcastToRoom(room: ServerRoom, msg: ServerMessage): void {
  for (const m of room.members.values()) send(socketOf(m), msg);
}

/** Sends a freshly joined/reconnected client the room's recent chat (if any). */
function sendChatHistory(socket: WebSocket, code: string): void {
  const history = social.history(code);
  if (history.length) send(socket, { t: 'CHAT_HISTORY', messages: history });
}

function broadcastState(room: ServerRoom): void {
  // Every STATE_UPDATE carries the authoritative turn-timer (Stage 37.5) so all
  // clients count down to the SAME deadline and a reload/reconnect can't reset it.
  const timer = roomTimerInfo(room, Date.now());
  for (const m of room.members.values()) {
    send(socketOf(m), { t: 'STATE_UPDATE', state: sanitizedStateFor(room, m.clientId), timer });
  }
}

// ── friends: room invite + presence push (Stage 25.2) ────────────────────────

/**
 * Handle a FRIEND_INVITE from an authenticated socket: verify the sender is in a room and
 * an accepted friend of an ONLINE target, then deliver FRIEND_INVITE_RECEIVED to the
 * target's live sockets. The room code is the SENDER's own room (never a client value).
 * Best-effort + rate-limited; carries no email/token/session. Fails silently.
 */
async function deliverFriendInvite(socket: WebSocket, senderUserId: string | null, session: SessionRef, toUserId: unknown): Promise<void> {
  if (!senderUserId || !isDbEnabled()) return;
  if (!allowFriendInvite(senderUserId)) { sendError(socket, 'RATE_LIMITED', 'Slow down — too many invites.'); return; }
  const s = session.value;
  const roomCode = s?.room.code ?? null;
  let friends = false;
  try {
    const { areFriends } = await import('./db/friends');
    friends = typeof toUserId === 'string' ? await areFriends(senderUserId, toUserId) : false;
  } catch { return; }
  const verdict = verifyFriendInvite({
    senderUserId, senderRoomCode: roomCode, toUserId, areFriends: friends,
    targetOnline: typeof toUserId === 'string' && isOnline(toUserId),
  });
  if (!verdict.ok) {
    // Surface an actionable failure back to the SENDER as a non-fatal toast (Stage 25.7).
    const code = inviteReasonToErrorCode(verdict.reason);
    if (code) sendError(socket, code, INVITE_ERROR_TEXT[code]);
    return;
  }
  if (!s) return;
  const fromName = s.room.members.get(s.clientId)?.name ?? 'A friend';
  const payload: ServerMessage = {
    t: 'FRIEND_INVITE_RECEIVED',
    fromUserId: senderUserId, fromName, code: verdict.code, gameType: s.room.gameType, at: Date.now(),
  };
  for (const sock of presenceSocketsFor(verdict.toUserId)) send(sock as WebSocket, payload);
}

/** Broadcast the current rematch progress to everyone in the room (public clientIds only). */
function broadcastRematch(room: ServerRoom): void {
  const { ready, needed } = rematchStateOf(room);
  broadcastToRoom(room, { t: 'REMATCH_STATE', ready, needed });
}

/**
 * Handle REMATCH_READY / REMATCH_DECLINE for an online room (Stage 25.9). Only after the game is
 * finished and only from a seated human. When all connected humans are ready (bots always count
 * as ready), restart the SAME game in the SAME room; otherwise broadcast the progress. DECLINE
 * clears the pending readiness. Best-effort + silent on invalid state; no token/session/email.
 */
function handleRematch(session: SessionRef, decline: boolean): void {
  // (37.7.8 FAIL 3) The request-level authorization + readiness routing lives in the extracted,
  // unit-tested `handleRematchRequest`; index.ts only wires the real side effects.
  handleRematchRequest(session, decline, {
    isRoomFinished, pokerRecoveryBlocked, isBankrollRoom,
    broadcastRoom, broadcastRematch,
    markReady: markRematchReady, removeReady: removeRematchReady,
    allHumansReady, withRoomLock,
    // Bankroll poker (§16, 37.7.1/37.7.7): a rematch is a BRAND-NEW paid match — the extracted,
    // unit-tested lifecycle helper (debit → restart → refund-on-failure → broadcast).
    runRematch: (room) => runBankrollRematch(room, {
      debitRematch, refundBuyIns: refundBuyInsResult, freeze: freezeRoomForOperator,
      restartGame: (r) => restartGame(r, { now: Date.now() }),
      clearRematch, broadcastRematch, broadcastRoom,
      advance: (r) => broadcastAndAdvance(r, { turnAdvanced: true }),
      persist: persistRoom,
      forgetFinish: (r) => recordedFinish.delete(r.code),
      logDeal: logLatestDeal,
    }),
    // Non-bankroll: let the fresh game record its OWN finish (the previous is recorded once).
    restartNonBankroll: (room) => {
      recordedFinish.delete(room.code);
      clearRematch(room);
      const res = restartGame(room, { now: Date.now() });
      if (res.ok) {
        // (38.0.5) A rematch is a BRAND-NEW match: fresh id, fresh frozen roster/category.
        beginOnlineMatch(room);
        logLatestDeal(room);
        broadcastRoom(room);
        broadcastAndAdvance(room, { turnAdvanced: true }); // a fresh game → a fresh deadline
        persistRoom(room);
      }
    },
  });
}

/** Human-readable text for an invite failure (the client also has i18n via the code). */
const INVITE_ERROR_TEXT: Record<'FRIEND_NOT_ONLINE' | 'NOT_FRIENDS' | 'NOT_IN_ROOM', string> = {
  FRIEND_NOT_ONLINE: 'That friend is offline right now.',
  NOT_FRIENDS: 'You are not friends with that player.',
  NOT_IN_ROOM: 'Create or join a room before inviting.',
};

// ── voice signaling relay (Stage 25.3) — server is a room-scoped RELAY, no audio ────
function dispatchVoice(deliveries: VoiceDelivery[]): void {
  for (const d of deliveries) send(d.socket as WebSocket, d.msg);
}

/**
 * Handle a VOICE_* signaling message. Voice membership = being a member of the socket's
 * current room (guests allowed); the room is derived server-side. OFFER/ANSWER/ICE are
 * relayed ONLY to the single target peer in the SAME room (never broadcast), rate-limited,
 * and size-capped. No audio is ever seen; SDP/ICE are opaque strings. Fails silently.
 */
function handleVoiceMessage(socket: WebSocket, session: SessionRef, msg: ClientMessage): void {
  const s = session.value;
  if (!s) return; // voice requires being in a room
  const roomCode = s.room.code;
  const clientId = s.clientId;
  const name = s.room.members.get(clientId)?.name ?? 'Player';
  switch (msg.t) {
    case 'VOICE_JOIN': return dispatchVoice(joinVoice(roomCode, clientId, socket, name));
    case 'VOICE_LEAVE': return dispatchVoice(leaveVoice(roomCode, clientId));
    case 'VOICE_MUTE_STATE': return dispatchVoice(setVoiceMute(roomCode, clientId, !!msg.muted));
    case 'VOICE_SIGNAL_OFFER':
    case 'VOICE_SIGNAL_ANSWER': {
      if (!allowVoiceSignal(clientId) || !isValidSdp(msg.sdp) || typeof msg.toClientId !== 'string') return;
      const relay = { t: msg.t, fromClientId: clientId, sdp: msg.sdp } as ServerMessage;
      return dispatchVoice(relayVoiceSignal(roomCode, clientId, msg.toClientId, relay));
    }
    case 'VOICE_SIGNAL_ICE': {
      if (!allowVoiceSignal(clientId) || !isValidIce(msg.candidate) || typeof msg.toClientId !== 'string') return;
      const relay = { t: 'VOICE_SIGNAL_ICE', fromClientId: clientId, candidate: msg.candidate } as ServerMessage;
      return dispatchVoice(relayVoiceSignal(roomCode, clientId, msg.toClientId, relay));
    }
    default: return;
  }
}

/** Push a FRIEND_PRESENCE update to a user's online friends (best-effort, DB-gated). */
async function broadcastPresence(userId: string, online: boolean): Promise<void> {
  if (!isDbEnabled()) return;
  try {
    const { friendUserIds } = await import('./db/friends');
    const ids = await friendUserIds(userId);
    const update: ServerMessage = { t: 'FRIEND_PRESENCE', updates: [{ userId, online }] };
    for (const fid of ids) for (const sock of presenceSocketsFor(fid)) send(sock as WebSocket, update);
  } catch { /* best-effort — presence is a nicety, never fatal */ }
}

/** Clears all server-driven timers for a room (advance / bot / human turn). */
function clearRoomTimers(code: string): void {
  for (const map of [advanceTimers, botTimers, turnTimers]) {
    const tmr = map.get(code);
    if (tmr) { clearTimeout(tmr); map.delete(code); }
  }
}

/**
 * When an online game reaches `game_finished`, persist its score-only history and
 * update stats for human members with a resolved account (Stage 5). Idempotent:
 * a per-room signature skips re-recording on reconnect/rebroadcast, and the DB
 * `game_key` backs it across restarts. DB-gated and best-effort — a failure never
 * affects gameplay (rules/redaction untouched); bots/unidentified seats are
 * skipped. Fire-and-forget so the WS path is never blocked on the DB.
 */
/**
 * PERMANENTLY freeze a bankroll room for operator review (Stage 37.7.8). Used for an `invalid`
 * payout (bad conservation / structurally-invalid escrow) — a fail-CLOSED, non-transient condition,
 * NOT a retryable DB error. Logs the room code + a SAFE reason ONCE (no stacks / matchId / userId /
 * escrow / corruption detail); the public snapshot only ever exposes `frozen`.
 */
function freezeRoomForOperator(room: ServerRoom, reason: string): void {
  if (room.pokerFrozen) return; // already frozen → don't re-log
  room.pokerFrozen = true;
  console.error(`[Poker] room ${room.code} FROZEN for operator review — ${reason}`);
}

// ── Stage 38.0.5: the frozen ONLINE match identity ──────────────────────────
// Created ONCE per started match (and once more for a rematch, which is a NEW match).
// It is what lets a permanent leave replace a human with an AI without destroying the
// finish attribution: the category (human_only | with_bots) and the starting roster are
// decided HERE and never recomputed. The durable Postgres copy is written best-effort in
// the background; until it is confirmed, an AUTHENTICATED permanent leave fails closed
// (retryable) — see server/permanentLeave.ts.

/** Freeze the match metadata for a just-started ONLINE non-Poker room + persist it durably. */
function beginOnlineMatch(room: ServerRoom): void {
  const meta = freezeOnlineMatch(room, randomUUID(), Date.now());
  if (!meta) return;
  if (!isDbEnabled()) return;    // no durable model → room JSON metadata only
  void (async () => {
    try {
      const { recordOnlineMatchStart } = await import('./db/onlineMatches');
      const res = await recordOnlineMatchStart(meta);
      // Only the room's CURRENT match may be flagged durable (a rematch may have
      // replaced it while this write was in flight).
      if (res !== 'conflict' && rooms.get(room.code)?.onlineMatch?.matchId === meta.matchId) {
        meta.durable = true;
        persistRoom(room);
      } else if (res === 'conflict') {
        console.error(`[King] room ${room.code} online match record CONFLICTS with the durable row — permanent leave disabled for this match`);
      }
    } catch (err) {
      // Transient: the permanent-leave path retries this exact write before forfeiting.
      console.error('[King] online match start not recorded for room', room.code, '→',
        String((err as Error)?.message ?? err).split('\n')[0].slice(0, 200));
    }
  })();
}

/**
 * Record the FINAL per-seat outcomes of a finished online match into the canonical
 * `online_match_participants` model (Stage 38.0.5 B6). Idempotent + fail-safe:
 *  - a FORFEITED seat is skipped by the repository's `WHERE ... AND forfeited = false`
 *    gate, so the leaver keeps exactly ONE technical loss and never inherits the
 *    replacement bot's eventual win;
 *  - bots (starting or replacement) simply have no account on their row;
 *  - BOTH categories are recorded (the Stage 38.0.6 tracker counts human_only AND
 *    with_bots), which is why this is independent of the legacy rating gate below.
 */
function recordOnlineMatchOutcome(room: ServerRoom, meta: OnlineMatchMeta, state: AnyGameState): void {
  if (!isDbEnabled() || meta.durable !== true) return;
  const outcomes = seatOutcomesFor(meta.gameType, state);
  if (!outcomes || outcomes.size === 0) return;
  const matchId = meta.matchId;
  void (async () => {
    try {
      const { recordOnlineMatchFinish } = await import('./db/onlineMatches');
      await recordOnlineMatchFinish(matchId, outcomes, new Date());
    } catch (err) {
      console.error('[King] online match outcome not recorded for room', room.code, '→',
        String((err as Error)?.message ?? err).split('\n')[0].slice(0, 200));
    }
  })();
}

/** The confirmed-stats recorder deps (37.7.8/37.7.9) — shared by the finish flow AND the sweep. */
function statsRecorderDeps(): import('./pokerFinish').ConfirmedStatsDeps {
  return {
    // (37.7.9 FAIL 1) The dedup marker + the durable games.game_key both key on the STABLE escrow
    // matchId, so two identical-outcome matches in the same room never collide.
    alreadyRecorded: (code, identity) => recordedFinish.get(code) === identity,
    markRecorded: (code, identity) => { recordedFinish.set(code, identity); },
    unmarkRecorded: (code) => { recordedFinish.delete(code); },
    record: async (code, st, seatUsers, matchId) =>
      (await import('./db/pokerStats')).recordFinishedPokerGame(code, st, seatUsers, matchId),
  };
}

/** The shared deps for the per-room bootstrap recovery orchestration (37.7.10/37.7.11). */
function bootstrapRecoveryDeps(): import('./pokerBootstrap').BootstrapRecoveryDeps {
  return {
    // (37.7.15 FAIL 2) The RECOVERY path proves EXACT durable ownership — it covers a `funded` escrow
    // too, so a room whose durable record is missing/mismatched can never be resumed as `live`.
    // (Teardown keeps the narrower `reconcileEscrow`: it settles, it never resumes.)
    reconcileEscrow: resolveEscrowEvidence,
    isFinished: (state) => getGameDefinition('poker')?.isFinished(state) === true,
    rescheduleAdvance,
    persist: (room) => { if (rooms.has(room.code)) persistRoom(room); },
    clearTimers: (room) => clearRoomTimers(room.code),
    freeze: freezeRoomForOperator,
    refundBuyIns: refundBuyInsResult,
  };
}

/** The shared deps for the settle-then-record bankroll poker finish flow (37.7.8). */
function bankrollFinishDeps(): import('./pokerFinish').BankrollFinishDeps {
  return {
    payoutStacks,
    persist: persistRoom,
    broadcast: broadcastRoom,
    clearRematch,
    freeze: freezeRoomForOperator,
    recordStats: (room, state) => recordConfirmedPokerStats(room, state, statsRecorderDeps()),
  };
}

function maybeRecordFinished(room: ServerRoom): void {
  const state = room.gameState;
  if (!state || !isDbEnabled()) return;
  // Game-agnostic gate: only record when the room's game opts in (recordsStats)
  // and its own definition says the state is finished (King: game_finished;
  // Durak: finished). Keeps the finish path routing through the definition seam.
  const def = getGameDefinition(room.gameType);
  if (!def?.recordsStats || !def.isFinished(state)) return;

  // (37.7.8) Bankroll poker: SETTLEMENT-BEFORE-STATS. Payout AND stats run as ONE serialized flow
  // under the room lock — stats are recorded ONLY after a confirmed payout (paid/already_paid), never
  // in parallel and never before. `already_refunded` → cancelled lobby (no stats); `retry_pending` →
  // deferred to the settlement sweep; `invalid` → permanent operator freeze. Bankroll poker NEVER
  // falls through to the generic (pre-payout) stats path below.
  if (isBankrollRoom(room) && room.gameType === 'poker') {
    void withRoomLock(room.code, () => settleAndRecordBankrollPokerFinish(room, state as PokerState, bankrollFinishDeps())).catch(() => {});
    return;
  }

  // (38.0.5) The CANONICAL online-match participant outcomes are recorded for BOTH
  // categories — the rating gate below is a separate, narrower policy.
  const meta = room.onlineMatch;
  if (meta) recordOnlineMatchOutcome(room, meta, state);

  // Owner rule (2026-07-08): rating/stats count ONLY human-vs-human games — a
  // table with ANY bot, or with fewer than 2 humans, is never recorded (applies
  // to every game type). This blocks farming stats against bots, online or not.
  //
  // (38.0.5) The question is answered from the FROZEN starting roster, not from live
  // membership. A permanent leave puts an AI on a human's seat, and the old live check
  // would then have silently discarded a legitimate `human_only` result for everyone
  // who stayed. `human_only` stays rated forever; `with_bots` stays unrated forever.
  if (meta) {
    if (!ratedByFrozenCategory(meta)) {
      console.log(`[King] room ${room.code} ${room.gameType} finished — stats skipped (started ${meta.category}, ${startingHumanSeats(meta).length} starting human seat(s))`);
      return;
    }
  } else {
    const playerMembers = [...room.members.values()].filter((m) => m.role === 'player');
    const humanPlayers = playerMembers.filter((m) => m.type === 'human').length;
    const botPlayers = playerMembers.filter((m) => m.type === 'ai').length;
    if (botPlayers > 0 || humanPlayers < 2) {
      console.log(`[King] room ${room.code} ${room.gameType} finished — stats skipped (${humanPlayers} human, ${botPlayers} bot)`);
      return;
    }
  }

  const gt = room.gameType;
  const sig = gt === 'durak' ? durakFinishSignature(state as DurakState)
    : gt === 'deberc' ? debercFinishSignature(state as DebercState)
      : gt === 'tarneeb' ? tarneebFinishSignature(state as TarneebState)
        : gt === 'preferans' ? preferansFinishSignature(state as PreferansState)
          : gt === 'fifty-one' ? fiftyOneFinishSignature(state as FiftyOneState)
            : gt === 'poker' ? pokerFinishSignature(state as PokerState)
              : finishSignature(room);
  if (recordedFinish.get(room.code) === sig) return;
  recordedFinish.set(room.code, sig);

  // Seat → account for identified humans only (bots and anonymous seats absent).
  //
  // (38.0.5) Sourced from the IMMUTABLE starting roster when the room has frozen
  // metadata, MINUS every forfeited seat: a permanent leaver already owns exactly one
  // durable technical loss and must never receive a second result (nor be turned into
  // a winner because the AI that inherited the seat went on to win). A starting human
  // whose account only resolved after START (a late session / cross-device reclaim)
  // is filled in from the live member for the SAME seat.
  const seatUsers = new Map<number, string | null>();
  if (meta) {
    const liveUserBySeat = (seat: number): string | null => {
      for (const m of room.members.values()) {
        if (m.role === 'player' && m.type === 'human' && m.seatIndex === seat) return m.userId ?? null;
      }
      return null;
    };
    for (const [seat, uid] of finishSeatUsers(meta, liveUserBySeat)) seatUsers.set(seat, uid);
  } else {
    for (const m of room.members.values()) {
      if (m.role === 'player' && m.type === 'human' && m.seatIndex != null && m.userId) {
        seatUsers.set(m.seatIndex, m.userId);
      }
    }
  }
  if (seatUsers.size === 0) return; // no one to attribute stats to → nothing to do

  void (async () => {
    try {
      const res = gt === 'durak'
        ? await (await import('./db/durakStats')).recordFinishedDurakGame(room.code, state as DurakState, seatUsers)
        : gt === 'deberc'
          ? await (await import('./db/debercStats')).recordFinishedDebercGame(room.code, state as DebercState, seatUsers)
          : gt === 'tarneeb'
            ? await (await import('./db/tarneebStats')).recordFinishedTarneebGame(room.code, state as TarneebState, seatUsers)
            : gt === 'preferans'
              ? await (await import('./db/preferansStats')).recordFinishedPreferansGame(room.code, state as PreferansState, seatUsers)
              : gt === 'fifty-one'
                ? await (await import('./db/fiftyOneStats')).recordFinishedFiftyOneGame(room.code, state as FiftyOneState, seatUsers)
                : gt === 'poker'
                  ? await (await import('./db/pokerStats')).recordFinishedPokerGame(room.code, state as PokerState, seatUsers)
                  : await (await import('./db/stats')).recordFinishedGame(room.code, state as GameState, seatUsers);
      if (res.recorded) {
        console.log(`[King] room ${room.code} ${room.gameType} stats recorded (${res.humanPlayers ?? 0} player(s))`);
      }
    } catch (err) {
      // Allow a later retry (e.g. transient DB error) by clearing the marker.
      recordedFinish.delete(room.code);
      console.error('[King] stats recording failed for room', room.code, '→',
        String((err as Error)?.message ?? err).split('\n')[0].slice(0, 200));
    }
  })();
}

/**
 * Broadcast the new state, then (re)schedule the next server-driven step. The turn
 * timer is now an AUTHORITATIVE room DEADLINE (Stage 37.5), not a fresh full-length
 * countdown re-armed on every call:
 *  - `turnAdvanced: true`  — a REAL gameplay transition began a new turn → MINT a new
 *    deadline (bump the revision, set `turnDeadlineAt`). Passed by the action / bot /
 *    timeout / auto-advance / start / rematch paths.
 *  - `turnAdvanced: false` (default) — a CONNECTION event or a harmless rebroadcast
 *    (reconnect / reclaim / disconnect / restore). The existing deadline + revision
 *    are KEPT; the setTimeout is merely re-armed to fire at the SAME absolute time, so
 *    it never resets or extends. Only the disconnected-substitute deadline may start
 *    (on the acting human's disconnect) or cancel (on their reconnect).
 * Re-entrant: each scheduled step calls this again with `turnAdvanced: true`.
 */
function broadcastAndAdvance(room: ServerRoom, opts: { turnAdvanced?: boolean } = {}): void {
  broadcastState(room);
  maybeRecordFinished(room);
  if (opts.turnAdvanced) beginTurnDeadline(room, Date.now()); // a new turn → a fresh deadline
  armRoomTimer(room, Date.now());
}

/**
 * (Re)arm the single server-driven timer for a room to fire at the CURRENT deadline —
 * public-screen advance, bot move, room-timer turn deadline, or a disconnected-human
 * substitute. Uses absolute deadlines so a re-arm (from a connection event) fires at
 * the same wall-clock time instead of restarting.
 */
function armRoomTimer(room: ServerRoom, now: number): void {
  clearRoomTimers(room.code); // clears the pending setTimeout handle only — not the deadlines

  const screen = publicScreenOf(room);
  // Poker showdown review (§16 G) is SERVER-DRIVEN: a contested showdown pauses ~7s so
  // everyone can read the winner + combination + the highlighted five; a fold-win (no
  // reveal) uses a shorter pause. Auto-advance then deals the next hand exactly once.
  const pokerReview = (room.gameType === 'poker' && screen === 'round_scoring')
    ? (((room.gameState as PokerState | null)?.lastHand?.showdown) ? POKER_SHOWDOWN_REVIEW_MS : POKER_FOLDWIN_REVIEW_MS)
    : null;
  const delay = pokerReview != null ? pokerReview
    : screen === 'trick_complete' ? TRICK_ADVANCE_MS
    : screen === 'round_scoring' ? ROUND_ADVANCE_MS
    : null;
  if (delay != null) {
    advanceTimers.set(room.code, setTimeout(() => {
      advanceTimers.delete(room.code);
      if (!rooms.has(room.code)) return;
      const before = room.dealLog.length;
      if (autoAdvance(room, { now: Date.now() })) {
        if (room.dealLog.length > before) logLatestDeal(room); // a new round was dealt
        broadcastAndAdvance(room, { turnAdvanced: true });
        persistRoom(room);
      }
    }, delay));
    return;
  }

  if (botMemberToAct(room)) {
    botTimers.set(room.code, setTimeout(() => {
      botTimers.delete(room.code);
      if (!rooms.has(room.code)) return;
      const before = room.dealLog.length;
      if (applyBotTurn(room).acted) {
        if (room.dealLog.length > before) logLatestDeal(room); // bot dealt a new round
        broadcastAndAdvance(room, { turnAdvanced: true });
        persistRoom(room);
      }
    }, BOT_DELAY_MS));
    return;
  }

  const acting = actingMember(room);
  if (!acting || acting.type !== 'human') return; // no human on the clock

  // The ABSOLUTE fire time for this human turn (room deadline / substitute / none) —
  // computed by the pure serverCore helper, which also manages the substitute deadline.
  const fireAt = resolveHumanFireAt(room, now, SUBSTITUTE_DELAY_MS);
  if (fireAt == null) return;

  const revisionAtArm = room.turnTimerRevision ?? 0;
  const seatAtArm = acting.seatIndex;
  turnTimers.set(room.code, setTimeout(() => {
    turnTimers.delete(room.code);
    onTurnTimeout(room, revisionAtArm, seatAtArm);
  }, Math.max(0, fireAt - now)));
}

/** A public phase/status string for diagnostics ONLY — never any card/token data. */
function safePhaseOf(room: ServerRoom): string {
  const s = room.gameState as { phase?: unknown; status?: unknown } | null;
  const p = s?.phase ?? s?.status;
  return typeof p === 'string' ? p : 'unknown';
}

/**
 * Fired when a room's turn deadline expires. Stale-guards against a newer turn (a
 * different revision) or an actor that is no longer a human, then applies ONE legal
 * auto-action through the same authorised reducer path. On success it advances the
 * turn (fresh deadline); on failure it logs a card-free diagnostic (surfacing a
 * game-specific botAction gap) WITHOUT spinning a zero-delay loop.
 */
function onTurnTimeout(room: ServerRoom, revisionAtArm: number, seatAtArm: number | null): void {
  if (!rooms.has(room.code)) return;
  // A newer turn already began (a real transition bumped the revision) → this old
  // callback must not act in the new turn.
  if ((room.turnTimerRevision ?? 0) !== revisionAtArm) return;
  const acting = actingMember(room);
  if (!acting || acting.type !== 'human' || acting.seatIndex !== seatAtArm) return;
  const before = room.dealLog.length;
  const res = applyTimeoutAction(room);
  if (res.acted) {
    if (room.dealLog.length > before) logLatestDeal(room);
    const reason = acting.connected ? 'turn timeout' : 'disconnected substitute';
    console.log(`[King] room ${room.code} ${room.gameType} ${reason} → auto-action for seat ${acting.seatIndex}`);
    broadcastAndAdvance(room, { turnAdvanced: true });
    persistRoom(room);
  } else {
    // The auto-action could not be applied even though a human is on the clock. This
    // should never happen (every game's botAction is legal in every player-owned
    // phase) — log it so a regression is visible, and do NOT re-arm a 0-delay loop.
    console.error(
      `[King] room ${room.code} ${room.gameType} timeout produced NO action for seat ${acting.seatIndex} `
      + `(phase ${safePhaseOf(room)}) — botAction/legality gap; room may stall`,
    );
  }
}

// `reconnectToken` is the PLAINTEXT the caller (wsHandlers) holds — the member
// stores only its hash (БЕЗ-4), so we must be handed the plaintext to send.
function welcome(socket: WebSocket, member: ServerMember, room: ServerRoom, reconnectToken: string): void {
  send(socket, {
    t: 'WELCOME',
    clientId: member.clientId,
    reconnectToken,
    room: snapshot(room),
  });
}

function handleLeave(room: ServerRoom, clientId: string): void {
  sockets.delete(clientId);
  dispatchVoice(leaveVoice(room.code, clientId)); // drop from voice on an explicit room leave
  const { empty } = removeMember(room, clientId);
  // Tear the room down once no humans remain (bots alone must not keep it alive
  // or be promoted to host).
  const hasHuman = [...room.members.values()].some((m) => m.type === 'human');
  if (empty || !hasHuman) {
    // Settle bankroll escrow before dropping the room (refund if unfinished, else
    // ensure payout); a settlement failure keeps the room for a retry sweep (§16 G).
    deleteRoomWithSettlement(room.code, room);
    return;
  }
  removeRematchReady(room, clientId);
  broadcastRoom(room);
  // If a rematch was pending, refresh its progress (this human's consent + count are gone).
  if (isRoomFinished(room)) broadcastRematch(room);
  persistRoom(room);
}

/**
 * (38.0.5) Detach a connection from a STARTED room WITHOUT removing its member — the
 * seat is KEPT and stays reconnectable. Mirrors the socket-close cleanup exactly, so an
 * explicit `LEAVE_ROOM` during an active game behaves like an ordinary disconnect
 * instead of deleting a seated player and re-numbering every remaining seat.
 */
function detachSession(room: ServerRoom, clientId: string): void {
  sockets.delete(clientId);
  dispatchVoice(leaveVoice(room.code, clientId));
  markDisconnected(room, clientId);
  broadcastRoom(room);
  if (rooms.has(room.code) && isRoomFinished(room)) broadcastRematch(room);
  persistRoom(room);
  // Re-evaluate the timers now that this seat is offline (schedules the AI substitute
  // when it is their turn). Connection-event variant — the deadline is never re-minted.
  if (rooms.has(room.code) && room.gameState) broadcastAndAdvance(room);
}

/** Reschedule server-driven steps for a restored room (public advance or a bot turn). */
// ── §17 ONLINE between-hands rebuy window (Stage 38.0.3C) ───────────────────
// The room, not a client, owns this window: an ABSOLUTE deadline minted once per
// (matchId, handNumber), a wallet debit taken under `withRoomLock → withEconomyBarrier →
// tx`, and a close that can only happen after every eligible seat answered, the deadline
// passed, or a crash-recovered debit was reconciled. An in-flight debit always blocks it.

function rebuyDeps(): RebuyDeps {
  return {
    persist: persistRoom,
    broadcast: broadcastRoom,
    freeze: freezeRoomForOperator,
    now: () => Date.now(),
  };
}

/** Timers armed per room code so a window always resolves even with no further traffic. */
const rebuyTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearRebuyTimer(code: string): void {
  const t = rebuyTimers.get(code);
  if (t) { clearTimeout(t); rebuyTimers.delete(code); }
}

/**
 * Drive the window for one room: mint the deadline on entry, arm a single absolute-deadline
 * timer, and close once it is allowed. Everything runs under the ROOM LOCK, so a timeout can
 * never interleave with a rebuy request.
 */
function syncRebuyWindow(room: ServerRoom): void {
  if (!inOnlineRebuyWindow(room)) {
    if (room.pokerRebuyDeadlineAt) { clearRebuyDeadline(room); persistRoom(room); }
    clearRebuyTimer(room.code);
    return;
  }
  if (ensureRebuyDeadline(room, { now: () => Date.now() })) persistRoom(room);
  clearRebuyTimer(room.code);
  const fire = Math.max(0, (room.pokerRebuyDeadlineAt ?? Date.now()) - Date.now());
  rebuyTimers.set(room.code, setTimeout(() => {
    rebuyTimers.delete(room.code);
    void resolveRebuyWindow(room.code);
  }, fire));
}

/** Reconcile durable evidence, then close the window when it is allowed. Lock-serialized. */
async function resolveRebuyWindow(code: string): Promise<void> {
  const room = rooms.get(code);
  if (!room) return;
  await withRoomLock(code, async () => {
    const live = rooms.get(code);
    if (!live || !inOnlineRebuyWindow(live)) return;
    // (§17 E) Reconciliation ALWAYS runs before an expiry close, so a debit that committed
    // just before a crash/timeout is applied instead of being silently declined.
    const rec = await reconcileRebuys(live, rebuyDeps());
    if (rec === 'retry_pending') { syncRebuyWindow(live); return; }   // DB down → keep waiting
    if (rec === 'frozen') { clearRebuyTimer(code); persistRoom(live); broadcastRoom(live); return; }
    if (!shouldCloseRebuyWindow(live, Date.now())) { syncRebuyWindow(live); return; }
    if (closeRebuyWindow(live)) {
      persistRoom(live);
      broadcastRoom(live);
      rescheduleAdvance(live);
      maybeRecordFinished(live);
    }
  }).catch(() => { /* a transient failure retries on the next tick/traffic */ });
}

/**
 * Handle `POKER_REBUY_REQUEST` / `POKER_REBUY_DECLINE`. The payload is EMPTY — every value
 * (room, user, seat, match, hand, amount) is derived here from authoritative state.
 */
async function handlePokerRebuy(
  ref: SessionRef, socket: WebSocket, decline: boolean, accountUserId: () => Promise<string | null>,
): Promise<void> {
  const session = ref.value;
  const refuse = (code: ErrorCode, msg: string) => sendError(socket, code, msg);
  if (!session) { refuse('REBUY_NOT_ALLOWED', 'Rebuy is not available.'); return; }
  const code = session.room.code;
  if (session.room.gameType !== 'poker') { refuse('REBUY_NOT_ALLOWED', 'Rebuy is not available.'); return; }
  // The account must be a signed-in NON-GUEST; a guest/spectator resolves to no seat below.
  const userId = await accountUserId().catch(() => null);
  await withRoomLock(code, async () => {
    const live = rooms.get(code);
    if (!live) { refuse('REBUY_NOT_ALLOWED', 'Rebuy is not available.'); return; }
    const seat = resolveRebuySeat(live, userId);
    if (!rebuyRequestAllowed(live, seat)) { refuse('REBUY_NOT_ALLOWED', 'Rebuy is not available.'); return; }
    if (decline) {
      if (performDecline(live, seat!, { persist: persistRoom, broadcast: broadcastRoom })) {
        void resolveRebuyWindow(live.code);   // a decline can complete the window immediately
      }
      return;
    }
    const outcome = await performRebuy(live, userId!, seat!, rebuyDeps());
    if (!outcome.ok) {
      const err: ErrorCode = outcome.reason === 'insufficient' ? 'INSUFFICIENT_CHIPS'
        : outcome.reason === 'not_allowed' ? 'REBUY_NOT_ALLOWED' : 'ECONOMY_UNAVAILABLE';
      // Safe, bounded copy only — never a SQL error, a balance or an economy identifier.
      refuse(err, err === 'INSUFFICIENT_CHIPS' ? 'Not enough chips in your wallet.' : 'Rebuy is not available.');
      return;
    }
    // PRIVATE result: only the requester learns their new balance.
    send(socket, { t: 'POKER_REBUY_RESULT', balance: outcome.balance, applied: !outcome.alreadyApplied });
    void resolveRebuyWindow(live.code);
  }).catch(() => { refuse('ECONOMY_UNAVAILABLE', 'The chip economy is unavailable.'); });
}

// ── Stage 38.0.5: PERMANENT "Leave game" (irreversible active-game forfeit) ──
// The three exits are deliberately distinct and never share a message:
//   LEAVE_ROOM              → lobby only, frees the seat, no loss, no bot;
//   socket close / Back     → reconnectable, the seat waits for the player;
//   LEAVE_GAME_PERMANENTLY  → THIS: a durable technical loss, an AI on the same seat
//                             (or a closed room), and an annulled reconnect identity.
// The whole transition lives in the pure-ish `runPermanentLeave` orchestrator; this
// function only supplies the real I/O side effects and turns the outcome into a wire
// reply. Serialized on the room, exactly like every other lifecycle op.

/**
 * Sockets whose permanent leave has ALREADY been accepted (Stage 38.0.5.1). A duplicate
 * intent — a double tap that beat the client's own single-flight guard, or a retry after
 * a lost ACK — must be idempotent: re-ACK it instead of answering `ERROR`, which would
 * tell the player their irreversible departure failed. Weakly held: it dies with the socket.
 */
const permanentlyLeftSockets = new WeakSet<WebSocket>();

function permanentLeaveDeps(): PermanentLeaveDeps {
  return {
    rooms,
    dbEnabled: isDbEnabled,
    ensureDurableMatch: async (meta) =>
      (await import('./db/onlineMatches')).recordOnlineMatchStart(meta),
    applyForfeit: async (input) =>
      (await import('./db/onlineMatches')).applyPermanentForfeitTx(input),
    detachClient: (room, clientId) => {
      sockets.delete(clientId);
      dispatchVoice(leaveVoice(room.code, clientId)); // tell the voice peers, drop no audio
    },
    closeRoom: (room) => deleteRoomWithSettlement(room.code, room),
    persist: persistRoom,
    broadcastRoom,
    // CONNECTION-EVENT variant on purpose: no `turnAdvanced`, so the CURRENT turn
    // deadline is neither reset nor extended, and `armRoomTimer` schedules exactly ONE
    // bot action when the taken-over seat is the one on the clock.
    advance: (room) => broadcastAndAdvance(room),
    newIds: () => ({ clientId: randomUUID(), reconnectToken: hashReconnectToken(randomUUID()) }),
    now: () => Date.now(),
  };
}

/**
 * Handle `LEAVE_GAME_PERMANENTLY`. The payload is EMPTY: the room + clientId come from
 * this socket's server-side session and the account from the session cookie — nothing
 * is ever taken from the client. Replies with `PERMANENT_LEAVE_ACCEPTED` only after the
 * durable forfeit committed AND the seat transition was applied and persisted; any
 * other outcome leaves the room, the seat, the reconnect token and the client's saved
 * session completely untouched (the reconnectable Back-to-menu exit still works).
 */
async function handlePermanentLeave(
  ref: SessionRef, socket: WebSocket, accountUserId: () => string | null,
): Promise<void> {
  const refuse = (): void => sendError(socket, 'PERMANENT_LEAVE_UNAVAILABLE', 'Cannot leave permanently right now.');
  // (38.0.5.1) Idempotent duplicate: this connection's departure is already complete, so
  // repeat the ACK. Answering ERROR here would race the first ACK on the client and could
  // repaint an irreversible, already-committed departure as a failure.
  if (permanentlyLeftSockets.has(socket)) { send(socket, { t: 'PERMANENT_LEAVE_ACCEPTED' }); return; }
  const session = ref.value;
  if (!session) { refuse(); return; }
  const { code, clientId } = { code: session.room.code, clientId: session.clientId };
  const result = await withRoomLock(code, () =>
    runPermanentLeave(code, clientId, accountUserId(), permanentLeaveDeps()),
  ).catch(() => ({ ok: false, reason: 'retryable' } as const));

  if (!result.ok) { refuse(); return; }
  // The seat is gone for good: this connection must never be treated as a member again
  // (a duplicate intent, or this socket's later close handler, must not touch the room).
  permanentlyLeftSockets.add(socket);
  if (ref.value && ref.value.clientId === clientId) ref.value = null;
  send(socket, { t: 'PERMANENT_LEAVE_ACCEPTED' });
  console.log(`[King] room ${code} permanent leave accepted (${result.kind})`);
}

function rescheduleAdvance(room: ServerRoom): void {
  // (37.7.3 FAIL 5) A frozen room (corrupt durable match) or a cancelled match never advances.
  if (room.pokerFrozen || room.pokerMatchCancelled) return;
  // (37.7.4 FAIL 2) A funded bankroll room with the economy unavailable (no DB) fails closed —
  // no auto-advance/timer/bot until a DB-backed restart can reconcile it.
  if (bankrollEconomyUnavailable(room)) return;
  // (37.7.13 FAIL 2) An UNRESOLVED transient escrow (the durable outcome is unknown) never advances
  // or arms a timer — the hand may already be paid, refunded, or never charged at all.
  // (37.7.17 FAIL 2) Nor does a room that CLAIMS a match with no escrow at all.
  if (escrowUnresolved(room) || escrowlessClaim(room)) return;
  // (§17) An ONLINE rebuy window is not a public screen to advance past — it is a paid
  // decision point. Drive its deadline/close lifecycle instead and stop here.
  if (inOnlineRebuyWindow(room)) { syncRebuyWindow(room); return; }
  const screen = publicScreenOf(room);
  const acting = actingMember(room);
  // Drive public screens, bot turns, and — after a restart — a disconnected
  // human's turn (schedules the AI substitute so the table never stalls).
  if (screen != null || botMemberToAct(room)
    || (acting && acting.type === 'human' && !acting.connected)) {
    broadcastAndAdvance(room);
  }
}

// ── HTTP server: /health, /api + /auth, static client, then 426 in dev ───────
// Upgrade requests (the WS on /ws) are handled by `ws` via the 'upgrade' event,
// so they never hit this handler.
const httpServer = createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/health/diagnostics') {
    // Aggregate-only operational snapshot (Stage 24.0; DB state added 24.3). A cheap
    // `select 1` probe distinguishes db enabled / disabled / error; everything else is
    // in-memory counters + the cached boot ffmpeg flag. See server/diagnostics.ts.
    let open = 0, inGame = 0;
    for (const room of rooms.values()) { if (room.started) inGame++; else open++; }
    const emit = (db: DbState) => handleDiagnostics(res, {
      version: serverVersion(),
      commit: gitCommit(),
      uptimeSeconds: process.uptime(),
      db,
      ffmpegReady: getFfmpegReady(),
      rooms: { total: rooms.size, open, inGame },
      connections: sockets.size,
      voiceIce: iceMode(configuredIceServers()), // secret-free MODE only
    });
    void (async () => {
      // Cheap, short-TTL-cached probe: select 1 + a required-columns check on
      // user_settings → enabled / disabled / error / migration_required.
      const db: DbState = await probeDbState(Date.now());
      emit(db);
    })().catch(() => emit(isDbEnabled() ? 'error' : 'disabled')); // probeDbState never throws
    return;
  }
  if (path === '/health') {
    void handleHealth(res, rooms.size).catch(() => { /* handleHealth never throws */ });
    return;
  }
  if (path === '/api/voice/ice-config') {
    // Public, no DB/session: serve the runtime ICE servers to the browser (Stage 25.6). Any
    // STATIC TURN credential is client-visible by design (the browser authenticates to TURN);
    // it is returned here but NEVER logged and NEVER in /health/diagnostics. STUN-only by default.
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(iceConfigPayload()));
    return;
  }
  // Profiles/settings/auth API (Stage 4). Shares this port; never touches /ws,
  // /health, static, or the SPA fallback. Gracefully 503s when no DATABASE_URL.
  if (path === '/api' || path.startsWith('/api/') || path.startsWith('/auth/')) {
    void handleApiRequest(req, res).catch((err) => {
      console.error('[King] /api handler crashed:', String(err?.message ?? err));
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal' }));
      }
    });
    return;
  }
  if (SERVE_STATIC) { void serveStatic(req, res); return; }
  // Dev (no build): this process is only the WS + health endpoint.
  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('Upgrade Required: this is the King WebSocket server');
});

// The client connects to wss://<host>/ws (production) or ws://<host>:PORT/ws
// (LAN). `ws` accepts the upgrade on that path; normal GETs fall through to the
// static handler above.
const wss = new WebSocketServer({ server: httpServer, verifyClient: verifyOrigin });

// The operations the WS dispatch (wsHandlers.ts) needs — bundled once.
const wsCtx: WsContext = {
  rooms, sockets, social,
  send, sendError, broadcastRoom, broadcastToRoom, broadcastAndAdvance, sendChatHistory,
  persistRoom, freezeRoom: freezeRoomForOperator, beginOnlineMatch, welcome, handleLeave, detachSession,
  makeRoomCode, logRoomEvent, logLatestDeal,
};

wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
  // Per-IP gate (infra-level): reject before any per-socket state is set up when a
  // single host holds too many sockets open or is opening them too fast. Loopback
  // (tests/LAN) is exempt. tryAccept reserves a slot only on success, so a reject
  // needs no release; an accepted socket releases its slot on 'close'.
  const ip = extractClientIp(request);
  if (!(IP_LIMIT_EXEMPT_LOOPBACK && isLoopbackIp(ip))) {
    const verdict = ipLimiter.tryAccept(ip, Date.now());
    if (!verdict.ok) {
      console.log(`[King] connection rejected: ip=${ip} reason=${verdict.reason} (${ipLimiter.activeCount(ip)} open)`);
      try { socket.close(1013, 'rate limited'); } catch { socket.terminate(); }
      return;
    }
    socket.on('close', () => ipLimiter.release(ip, Date.now()));
  }

  const sessionRef: SessionRef = { value: null };
  // One rate limiter per socket (БЕЗ-1). Reset on reconnect (new socket) — that is
  // acceptable: it caps amplification through a single connection, not the number
  // of connections (an infra/proxy concern; see MVP_STATUS.md known limitations).
  const limiter = new ConnectionLimiter(RATE_LIMITS, Date.now());

  // Liveness: mark alive now and on every pong (browsers answer WS pings at the
  // protocol level, no app cooperation needed). The heartbeat below terminates a
  // socket that stops answering — so a vanished tab is detected within ~2 ticks.
  socketAlive.set(socket, true);
  socket.on('pong', () => socketAlive.set(socket, true));

  // Stage 5: resolve the player's account from the session cookie that rides the
  // WS upgrade (same-origin). This NAMES the player for stats only — seat/
  // reconnect authority stays on clientId + reconnectToken. Resolution is async;
  // a userId is needed only at game-finish (far later), so we attach it both when
  // it resolves and on each CREATE/JOIN/RECONNECT. Null for guests/no-DB/cross-
  // origin — those simply have no attributed identity. Never trusts client input.
  let resolvedUserId: string | null = null;
  // Stage 17.3: the resolved user's SAME-ORIGIN uploaded-avatar URL (null = none),
  // fetched ONCE when the identity resolves — never on every broadcast. Stamped onto
  // the seated member so other players' seats show the image. A stale value (avatar
  // deleted after this fetch) 404s on the client → emoji; a fresh connect re-fetches.
  let resolvedAvatarImageUrl: string | null = null;
  const attachIdentity = (): void => {
    if (!sessionRef.value || !resolvedUserId) return;
    const m = sessionRef.value.room.members.get(sessionRef.value.clientId);
    if (m && m.type === 'human') {
      if (!m.userId) m.userId = resolvedUserId;
      if (resolvedAvatarImageUrl && m.avatarImageUrl !== resolvedAvatarImageUrl) {
        m.avatarImageUrl = resolvedAvatarImageUrl;
      }
    }
  };
  // Stage 37.7.2 (FAIL 3): per-connection navigation lifecycle. A monotonic revision +
  // an open flag make a delayed async CREATE/JOIN cancellable — it completes only if it is
  // still the latest navigation and the socket is open. Set false on close (below).
  let navSeq = 0;
  let socketOpen = true;
  const lifecycle = {
    beginNav: () => ++navSeq,
    isCurrentNav: (token: number) => token === navSeq && socketOpen,
  };
  // Stage 37.7.1: the identity resolution promise — awaited by the bankroll-Poker CREATE
  // gate so it can't race this async resolution (a guest / unresolved session must not be
  // able to host a bankroll table). `getAccountUserId` resolves to a NON-GUEST userId or null.
  const identityReady: Promise<string | null> = resolveSessionUserId(request);
  const getAccountUserId = async (): Promise<string | null> => {
    let uid: string | null;
    try { uid = await identityReady; } catch { return null; }
    if (!uid) return null;
    try {
      const { getProfile } = await import('./db/users');
      const prof = await getProfile(uid);
      return prof && !prof.isGuest ? uid : null;
    } catch { return null; }
  };
  void identityReady.then(async (uid) => {
    resolvedUserId = uid;
    // Friends presence (Stage 25.1/25.2): a signed-in socket makes that user "online" on
    // this instance (in-memory; no room/gameplay effect). On the offline→online transition,
    // push a FRIEND_PRESENCE to their online friends. Detached on close below.
    if (uid && attachPresence(uid, socket)) void broadcastPresence(uid, true);
    attachIdentity();
    // Then fetch the avatar URL (DB, once) and, if present, stamp + re-broadcast so
    // seats that were already rendered pick up the image a beat later.
    resolvedAvatarImageUrl = await resolveAvatarImageUrl(uid);
    if (resolvedAvatarImageUrl && sessionRef.value) {
      attachIdentity();
      broadcastRoom(sessionRef.value.room);
    }
  });
  // Presence detach runs on close REGARDLESS of room membership (a signed-in socket may
  // be open for presence without being seated in a room). On the online→offline transition,
  // push a FRIEND_PRESENCE(offline) to their online friends.
  socket.on('close', () => {
    socketOpen = false; // (FAIL 3) cancel any in-flight async CREATE/JOIN for this socket
    if (resolvedUserId && detachPresence(resolvedUserId, socket)) void broadcastPresence(resolvedUserId, false);
  });

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return sendError(socket, 'BAD_MESSAGE', 'Invalid JSON');
    }
    // Friends (Stage 25.2): a room invite is handled here (it needs the socket's resolved
    // userId + presence, which the room dispatch doesn't carry). Everything else → dispatch.
    if (msg.t === 'FRIEND_INVITE') { void deliverFriendInvite(socket, resolvedUserId, sessionRef, msg.toUserId); return; }
    // Rematch / Play again (Stage 25.9): restart the same finished game in the same room.
    if (msg.t === 'REMATCH_READY' || msg.t === 'REMATCH_DECLINE') { handleRematch(sessionRef, msg.t === 'REMATCH_DECLINE'); return; }
    // (38.0.5) The PERMANENT active-game forfeit. Its own message — never LEAVE_ROOM,
    // never a socket close — with no payload; handled here because it is async (durable
    // forfeit) and needs the socket + this connection's resolved account id.
    if (msg.t === 'LEAVE_GAME_PERMANENTLY') {
      void handlePermanentLeave(sessionRef, socket, () => resolvedUserId);
      return;
    }
    // (§17) Rebuy intents carry NO payload and never travel as a generic ACTION_REQUEST.
    if (msg.t === 'POKER_REBUY_REQUEST' || msg.t === 'POKER_REBUY_DECLINE') {
      void handlePokerRebuy(sessionRef, socket, msg.t === 'POKER_REBUY_DECLINE', getAccountUserId);
      return;
    }
    // Voice signaling (Stage 25.3): a room-scoped relay handled here (needs the socket +
    // its room/clientId). No audio; the room dispatch never sees these.
    if (typeof msg.t === 'string' && msg.t.startsWith('VOICE_')) { handleVoiceMessage(socket, sessionRef, msg); return; }
    handleClientMessage(wsCtx, socket, sessionRef, attachIdentity, msg, limiter, () => resolvedUserId, getAccountUserId, lifecycle);
  });

  socket.on('close', () => {
    const session = sessionRef.value;
    if (!session) return;
    // Stage 36.0 race guard: a member keeps its clientId across reconnects, and each
    // connection has its own sessionRef pointing at that clientId. If a NEWER socket
    // already reconnected this member (same clientId), the sockets map now points at
    // that newer socket — an OLD half-open socket's late 'close' must NOT delete the
    // live mapping or flip the just-reconnected member back to disconnected. Only the
    // socket that currently OWNS the clientId performs the disconnect cleanup.
    if (sockets.get(session.clientId) !== socket) return;
    sockets.delete(session.clientId);
    dispatchVoice(leaveVoice(session.room.code, session.clientId)); // notify voice peers
    markDisconnected(session.room, session.clientId);
    broadcastRoom(session.room);
    // If a rematch was pending on a finished game, refresh its progress (this human went offline).
    if (rooms.has(session.room.code) && isRoomFinished(session.room)) broadcastRematch(session.room);
    persistRoom(session.room); // keep the store fresh (debounced); connected resets on restore
    // In an active game, re-evaluate the timers now that someone went offline:
    // if it is the disconnected player's turn, this schedules the AI substitute
    // (after SUBSTITUTE_DELAY_MS). Harmless for non-acting/lobby disconnects.
    if (rooms.has(session.room.code) && session.room.gameState) broadcastAndAdvance(session.room);
  });
});

// Remove idle rooms (and their persistence + timers). Returns how many were
// deleted. Called once at startup (so expired rooms go immediately, not only
// after the first interval) and then periodically.
/** Synchronously drop a room from memory + the persistence file. */
function purgeRoom(code: string): void {
  clearRoomTimers(code);
  recordedFinish.delete(code);
  social.delete(code);
  clearRoomLock(code); // release the per-room bankroll lifecycle lock (§16, 37.7.1)
  rooms.delete(code);
  storage.deleteRoom(code); // also drop it from the persistence file
}

/**
 * Delete a room, first SETTLING any unsettled bankroll escrow (§16 G): a finished
 * match pays out; an unfinished funded match refunds every buy-in. Deletion happens
 * ONLY after settlement is confirmed — if the DB op fails, the room (and its escrow)
 * are kept + persisted so the next sweep retries (a paid table is never destroyed with
 * chips still owed). Non-bankroll / already-settled rooms delete synchronously.
 */
function deleteRoomWithSettlement(code: string, room: ServerRoom): void {
  // (37.7.10 FAIL 2) A bankroll room needs the lock-serialized settlement flow when it still owes
  // chips (unsettled escrow), owes a stats write (stats-pending), OR still carries a game state whose
  // payout+stats must be finalized before deletion — a paid room is NEVER purged on a raw early exit
  // that skips the stats write. (37.7.11 FAIL 1: the guard covers ANY carried game state, not just a
  // FINISHED one — a `settled` escrow with an UNFINISHED state has no unsettled escrow, so it used to
  // purge synchronously and destroy the evidence of a paid match.) Everything else deletes synchronously.
  // (37.7.20 FAIL 3) ANY economy claim — an escrow of ANY status (terminal included), a generation
  // binding, owed stats, a corrupt persisted escrow or a carried game state — must go through the
  // lock-serialized durable-evidence flow. The old fast path purged a TERMINAL room synchronously
  // (`hasUnsettledEscrow` is false for it), so a `cancelled` claim the DB never recorded — or one it
  // recorded as a PAYOUT — was deleted without any proof.
  const claimsEconomy = isBankrollRoom(room)
    && (!!room.pokerEscrow || !!room.gameState || !!room.pokerGameMatchId || !!room.pokerStatsPending || !!room.pokerEscrowCorrupt);
  if (!claimsEconomy) { purgeRoom(code); return; }
  // Serialize with any in-flight start/payout/rematch for this room, then reconcile a
  // restored transient escrow (pending/settling) before settling.
  void withRoomLock(code, async () => {
    if (!rooms.has(code)) return;                        // already purged by another op
    // A corrupt persisted escrow (FAIL 5): refund its durable matches by room code from the
    // DB before deletion; keep the room if anything is still owed / unresolved.
    if (room.pokerEscrowCorrupt) {
      if (await reconcileCorruptRoom(room)) purgeRoom(code); else persistRoom(room);
      return;
    }
    // (37.7.8) An `invalid`-payout FROZEN room is a PERMANENT operator condition — never auto-pay,
    // auto-refund, or purge it. Keep it (escrow intact) for review.
    if (room.pokerFrozen) { persistRoom(room); return; }
    // (37.7.10) Settle THEN record (same lifecycle as finish/sweep) — a finished paid match records
    // its owed stats before purge; a transient payout/stats failure keeps the room for the next sweep.
    const fate = await settleRoomForDeletion(room, {
      // (37.7.20 FAIL 3) The ALL-STATUS resolver — the transient-only `reconcileEscrow` never
      // validated a terminal claim, so a purge could bypass the 37.7.16/37.7.17 terminal rules.
      reconcileEscrow: resolveEscrowEvidence, hasUnsettledEscrow,
      isFinished: (s) => getGameDefinition('poker')?.isFinished(s) === true,
      settleAndRecord: (r, s) => settleAndRecordBankrollPokerFinish(r, s, bankrollFinishDeps()),
      refundBuyIns: refundBuyInsResult, persist: persistRoom, freeze: freezeRoomForOperator,
      clearTimers: (r) => clearRoomTimers(r.code),
    });
    if (fate === 'purge') { purgeRoom(code); console.log(`[King] settled + removed bankroll room ${code}`); }
  });
}

/**
 * Retry the pending settlement for any bankroll room whose last DB settlement failed
 * transiently (§16, 37.7.6/37.7.7). Two SYMMETRIC cases, distinguished so a live match is
 * NEVER touched:
 *   • SETTLEMENT-pending (funded escrow + NO game): a failed-start/refund → retry the REFUND;
 *     on success the room becomes a resolved CANCELLED lobby a fresh START can use.
 *   • PAYOUT-pending (funded/settling escrow + a FINISHED game): a failed payout → retry the
 *     PAYOUT with the authoritative final state; on success the escrow settles and rematch is
 *     re-enabled. If the DB gate reports the match was refunded, cancel the finished table
 *     honestly (never pay/continue it as a paid game).
 * A LIVE match (funded + UNFINISHED game) matches none and is left running. Serialized per
 * room; idempotent (the settlement gate + ledger keys no-op on a repeat).
 *   • STATS-pending (37.7.9 FAIL 2): a PAID match (settled) whose stats write failed transiently →
 *     retry ONLY the stats write (never re-pay). On success/duplicate the flag clears + rematch
 *     re-enables. This survives restart (the flag is persisted).
 */
// (37.7.18 FAIL 3) SINGLE-FLIGHT guard for the runtime economy pass: the global orphan scan is a
// cluster-wide settlement operation, so two overlapping ticks (or a tick racing bootstrap) must never
// run at once. It is set for the whole bootstrap pass too.
let economyRecoveryInFlight = false;

/**
 * (37.7.18 FAIL 3) The RUNTIME global recovery pass: retries orphaned durable debits and
 * `escrowless_unresolved` claims that a TRANSIENT failure left unresolved, WITHOUT a server restart.
 * Runs on the same cleanup interval as the per-room retries, single-flight, and never re-applies a
 * healthy live/payout/stats room (so no timer or advance is re-armed on a tick).
 */
function runtimeEconomyRecovery(): void {
  if (!isDbEnabled() || economyRecoveryInFlight) return;
  economyRecoveryInFlight = true;
  void runRuntimeEconomyRecovery([...rooms.values()], {
    ...bootstrapRecoveryDeps(),
    isBankrollRoom, reconcileOrphanedDebits, withRoomLock,
    roomExists: (r) => rooms.has(r.code),
    currentRooms: () => [...rooms.values()],
    log: (m) => console.log(`[King] ${m}`),
    logError: (m) => console.error(`[King] ${m}`),
  }).then((report) => {
    for (const [code, recovery] of report.recoveries) {
      const room = rooms.get(code);
      if (room) broadcastRoom(room);
      console.log(`[King] runtime economy recovery for room ${code} (${recovery})`);
    }
  }).catch((err) => {
    console.error(`[King] runtime economy recovery failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }).finally(() => { economyRecoveryInFlight = false; });
}

function retryPendingSettlements(): void {
  for (const room of rooms.values()) {
    if (escrowUnresolved(room)) {
      // (37.7.14 FAIL 1) RECONCILIATION HAS PRECEDENCE. A `pending`/`settling` escrow's durable
      // outcome is unknown, so nothing may be refunded/paid/recorded — and no state or binding may be
      // dropped — until it is proven. This branch is what Stage 37.7.13's "retried on the next sweep"
      // actually needs: the shared bootstrap classify/apply policy, run in-process under the room
      // lock. Once resolved the room stops matching here, so a revived `live` table is re-armed
      // exactly once rather than on every 45s tick.
      void withRoomLock(room.code, async () => {
        if (!rooms.has(room.code) || !escrowUnresolved(room)) return;
        const out = await runRoomRecoverySweep(room, bootstrapRecoveryDeps());
        if (!out.changed) return;                    // still unproven → stay inert, no log spam
        broadcastRoom(room);
        console.log(`[King] unresolved poker escrow reconciled for room ${room.code} (${out.reconciled}${out.recovery ? ` → ${out.recovery}` : ''})`);
      });
    } else if (unboundEscrowGame(room)) {
      // (37.7.12 FAIL 1) A LIVE escrow whose match never produced the room's current state (a
      // crashed rematch). Drop the stale state and refund the fresh buy-in — never pay/record it.
      void withRoomLock(room.code, async () => {
        if (!rooms.has(room.code) || !unboundEscrowGame(room)) return;
        const res = await resolveUnboundEscrowGame(room, {
          refundBuyIns: refundBuyInsResult, persist: persistRoom, clearTimers: (r) => clearRoomTimers(r.code),
        });
        // (37.7.19 FAIL 1) `paid_conflict` means the payout WON — a PERMANENT operator condition.
        // Bootstrap and teardown already froze it; the periodic sweep only logged, so the room could
        // silently unblock once its escrow turned `settled` and its state/binding had been cleared.
        if (res === 'paid_conflict') {
          clearRoomTimers(room.code);
          freezeRoomForOperator(room, 'paid match cannot be refunded');
          persistRoom(room);
        }
        broadcastRoom(room);
        console.log(`[King] unplayed rematch debit resolved for room ${room.code} (${res})`);
      });
    } else if (settlementPending(room)) {
      void withRoomLock(room.code, async () => {
        if (!rooms.has(room.code) || !settlementPending(room)) return;
        // (37.7.18 FAIL 1) ONLY a CONFIRMED refund makes this a cancelled lobby. `already_paid`
        // means the payout won the settlement race — an incoherent paid table with no game, frozen.
        // (37.7.19 FAIL 1) The ONE shared policy: confirmed → cancelled, transient → keep,
        // already_paid/invalid → PERMANENT frozen (never a retryable settlement-pending).
        const disp = applyRefundOutcome(room, await refundBuyInsResult(room), {
          freeze: freezeRoomForOperator, persist: persistRoom, clearTimers: (r) => clearRoomTimers(r.code),
        }, { escrowExpected: true });
        if (disp === 'settlement_pending') return;
        broadcastRoom(room);
        if (disp === 'cancelled') console.log(`[King] settlement-pending refund resolved for room ${room.code}`);
      });
    } else if (payoutPending(room)) {
      void withRoomLock(room.code, async () => {
        if (!rooms.has(room.code) || !payoutPending(room)) return;
        // (37.7.8) Retry the payout AND, only on a confirmed payout, record the deferred stats — the
        // same settle-then-record flow as the finish path. `invalid` freezes the room permanently
        // (payoutPending now excludes frozen, so the sweep will never retry it again).
        const { result } = await settleAndRecordBankrollPokerFinish(room, room.gameState as PokerState, bankrollFinishDeps());
        if (result === 'paid' || result === 'already_paid') console.log(`[King] payout-pending resolved for room ${room.code}`);
      });
    } else if (statsPending(room)) {
      void withRoomLock(room.code, async () => {
        if (!rooms.has(room.code) || !statsPending(room)) return;
        // (37.7.9 FAIL 2) The payout already settled — retry ONLY the stats write, NEVER the payout.
        const state = room.gameState as PokerState | null;
        if (!state) { room.pokerStatsPending = undefined; persistRoom(room); return; } // no finished state → nothing to record
        const stats = await recordConfirmedPokerStats(room, state, statsRecorderDeps());
        if (stats === 'invalid') {
          // (37.7.11 FAIL 2) Structurally incoherent paid match — a retry can never fix it. Freeze
          // PERMANENTLY (keeps the owed flag as evidence; `statsPending` excludes frozen rooms, so
          // this branch never runs again → no 45s log spam) and never write a partial attribution.
          freezeRoomForOperator(room, 'paid match participants invalid');
          persistRoom(room);
          broadcastRoom(room);
          return;
        }
        if (stats !== 'failed') {
          room.pokerStatsPending = undefined; // recorded / already_exists / skipped → resolved
          persistRoom(room);
          broadcastRoom(room); // recovery clears → rematch re-enabled
          console.log(`[King] stats-pending resolved for room ${room.code} (${stats})`);
        }
      });
    }
  }
}

function cleanupRooms(): number {
  const expired = roomsToExpire(rooms.values(), Date.now(), ROOM_TTL_MS, ROOM_HARD_TTL_MS, ORPHAN_ROOM_TTL_MS);
  for (const code of expired) {
    const room = rooms.get(code);
    if (room) deleteRoomWithSettlement(code, room);
    else purgeRoom(code);
    console.log(`[King] auto-cleaned idle room ${code}`);
  }
  retryPendingSettlements(); // (37.7.6/37.7.7) resolve any refund/payout that failed transiently
  runtimeEconomyRecovery(); // (37.7.18) retry orphaned debits + escrowless claims without a restart
  // Reclaim per-IP tracking for hosts with no open sockets (bounded memory).
  ipLimiter.sweep(Date.now());
  return expired.length;
}

// Flush pending writes on shutdown so the latest state survives a restart.
// (flush() may be async for the Postgres backend — await it before exiting.)
async function shutdown(): Promise<void> {
  try {
    if (storage && typeof storage.flush === 'function') await storage.flush();
  } catch (err) {
    console.error('[King] shutdown flush failed:', String(err));
  }
  process.exit(0);
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });

/**
 * Async startup: pick the storage backend (file/memory/pg), let it initialise
 * (Postgres preloads its cache here; file/memory are no-ops), restore persisted
 * rooms, sweep expired ones, schedule cleanup, then listen. A fatal storage
 * error (e.g. ROOM_STORAGE=pg without DATABASE_URL, or an unreachable DB)
 * rejects here and exits — the non-DB default path is unaffected.
 */
async function bootstrap(): Promise<void> {
  storage = await createStorage();
  if (storage.init) await storage.init();

  // Restore persisted rooms so a server restart doesn't drop in-progress games.
  let restored = 0;
  const restoredRooms: ServerRoom[] = [];
  for (const room of storage.loadRooms()) {
    // Restored humans have no live socket → mark the room orphaned now (keeping a
    // persisted orphanSince if present) so an abandoned table is swept on schedule.
    recomputeOrphan(room, Date.now());
    rooms.set(room.code, room);
    restoredRooms.push(room);
    restored++;
    // (37.7.3 FAIL 5; widened 37.7.11 FAIL 1) DEFER the advance for EVERY bankroll room until the
    // economy recovery classification decides whether it is a live funded match, a payout/stats
    // finalization, a refunded match, or an incoherent paid one. The old guard deferred only
    // `hasUnsettledEscrow` rooms, so an already-SETTLED (paid) room was advanced/timed here BEFORE
    // recovery ever looked at it. Only `recoverRestoredBankrollRoom` may re-arm it now.
    if (!shouldDeferBootstrapAdvance(room)) rescheduleAdvance(room);
  }

  // Bankroll crash recovery (§16, 37.7.1 → 37.7.3). Passes:
  //  (a) reconcile each restored room's TRANSIENT escrow (pending/settling) vs the DB;
  //  (b) DB-authoritative orphan scan (FAIL 1): refund committed matches with no active room;
  //  (c) resolve corrupt-escrow rooms: a malformed persisted escrow carries no provable matchId,
  //      so (37.7.18) NOTHING is settled by room code — the room is FROZEN for operator review;
  //  (d) FAIL 5: for a bankroll room that still has a game state but is NOT a live funded
  //      match, terminally CANCEL it (its buy-ins were refunded → clear the game to a clean
  //      lobby) or leave it FROZEN — never let a refunded match continue as a free game.
  if (isDbEnabled()) {
    // (37.7.13 FAIL 1) The WHOLE pipeline — reconcile → classify → derive settlement protection FROM
    // those classifications → orphan scan → corrupt-room pass → apply — lives in ONE shared helper
    // the integration tests drive too. It used to be inlined here, and the orphan scan ran BEFORE any
    // classification against a set built from a room SHAPE test, so a room that classification would
    // have FROZEN (an unknown/unproven binding) was refunded by the scan seconds earlier.
    economyRecoveryInFlight = true;
    await runBootstrapEconomyRecovery(restoredRooms, {
      ...bootstrapRecoveryDeps(),
      isBankrollRoom, hasUnsettledEscrow, reconcileOrphanedDebits, reconcileCorruptRoom, withRoomLock,
      roomExists: (r) => rooms.has(r.code),
      currentRooms: () => [...rooms.values()],
      log: (m) => console.log(`[King] ${m}`),
      logError: (m) => console.error(`[King] ${m}`),
    }).finally(() => { economyRecoveryInFlight = false; })
      // (§17 E) A room restored INSIDE a rebuy window keeps its ABSOLUTE deadline (the
      // persisted instant is restored verbatim, never re-minted). Reconciliation runs
      // FIRST — a debit that committed just before the crash is applied exactly once —
      // and only then may an already-expired window close.
      .then(() => Promise.all(restoredRooms
        .filter((r) => inOnlineRebuyWindow(r))
        .map((r) => resolveRebuyWindow(r.code))))
      .catch(() => { /* a transient failure retries on the runtime sweep */ });
  } else {
    // (37.7.4 FAIL 2) No economy (no DB): a restored bankroll room with unsettled escrow FAILS
    // CLOSED — it is NOT advanced/timed and NOT cancelled/refunded (that needs DB proof). Its
    // escrow + game state are kept intact; a later DB-backed restart reconciles or settles it.
    const frozenNoDb = restoredRooms.filter((r) => isBankrollRoom(r) && hasUnsettledEscrow(r));
    if (frozenNoDb.length) {
      console.error(`[King] ${frozenNoDb.length} bankroll room(s) restored with NO chip economy — frozen (no advance/settle) until a DB-backed restart`);
    }
    // Non-bankroll rooms already advanced in the restore loop above.
  }

  // Explicit startup sweep: delete already-expired rooms right away (and remove
  // them from storage) rather than waiting for the first interval to fire.
  const expiredOnStartup = cleanupRooms();

  setInterval(cleanupRooms, CLEANUP_INTERVAL_MS);

  // WS heartbeat: drop dead sockets so their rooms can orphan + be swept. A socket
  // that has not answered the previous ping (still `false`) is terminated — which
  // fires its 'close' handler (markDisconnected). Otherwise re-arm: mark it pending
  // (false) and ping; a live browser answers with a pong, flipping it back to true.
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socketAlive.get(socket) === false) { socket.terminate(); continue; }
      socketAlive.set(socket, false);
      try { socket.ping(); } catch { socket.terminate(); }
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on('close', () => clearInterval(heartbeat));

  httpServer.listen(PORT, HOST, () => {
    console.log(`[King] server-authoritative server listening on ${HOST}:${PORT} (${NODE_ENV})`);
    console.log(`[King] health: http://${HOST}:${PORT}/health`);
    console.log(SERVE_STATIC
      ? `[King] serving static client from ${DIST} (single-service mode; WS on /ws)`
      : `[King] no dist/ build found — WS + /health only (run "npm run build" to serve the client here)`);
    console.log(isDbEnabled()
      ? '[King] database: DATABASE_URL set — /health probes Postgres'
      : '[King] database: disabled (no DATABASE_URL)');
    // Avatar upload readiness (Stage 17.5): a one-time, non-fatal probe so the deploy
    // log states plainly whether uploads will work here. Uploads need BOTH a database
    // AND ffmpeg; without ffmpeg, POST /api/me/avatar returns a clean 503 (feature off,
    // everything else unaffected). Never throws, runs once at boot — no per-request cost.
    void ffmpegAvailable().then((ok) => {
      // Cache the one-time result so GET /health/diagnostics can report avatar-upload
      // readiness without ever spawning ffmpeg per request (Stage 24.0).
      setFfmpegReady(ok);
      console.log(ok
        ? '[King] avatar uploads: ffmpeg found — uploads work when DATABASE_URL is set'
        : '[King] avatar uploads: ffmpeg NOT found — POST /api/me/avatar returns 503 (see RENDER_DEPLOY.md)');
    });
    console.log(
      `[King] startup: restored ${restored} room(s) from storage, removed ${expiredOnStartup} expired ` +
      `(TTL ${ROOM_TTL_MS / HOUR_MS}h, hard TTL ${ROOM_HARD_TTL_MS / HOUR_MS}h, ` +
      `orphan ${Math.round(ORPHAN_ROOM_TTL_MS / 60000)}m, substitute ${Math.round(SUBSTITUTE_DELAY_MS / 1000)}s)`,
    );
    if (ALLOWED_ORIGINS.length > 0) {
      console.log(`[King] origin allowlist: ${ALLOWED_ORIGINS.join(', ')}`);
    } else if (NODE_ENV === 'production') {
      console.warn('[King] WARNING: no ALLOWED_ORIGINS set in production — any browser origin may connect. Set ALLOWED_ORIGINS and serve behind TLS/WSS.');
    } else {
      console.log(`[King] LAN clients connect to ws://<this-machine-ip>:${PORT}`);
    }
  });
}

bootstrap().catch((err) => {
  console.error('[King] fatal startup error:', String(err?.message ?? err));
  process.exit(1);
});
