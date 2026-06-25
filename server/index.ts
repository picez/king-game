// ---------------------------------------------------------------------------
// King — SERVER-AUTHORITATIVE online server (Node + ws, run via tsx)
//
//   npm run server            # this file (server-authoritative, default)
//   PORT=8080 npm run server  # override port
//   npm run server:relay      # legacy host-authoritative relay (server/index.mjs)
//
// The server OWNS the GameState: it builds the deal, applies `gameReducer` to
// every ACTION_REQUEST, authorises the sender, and broadcasts a per-client
// redacted STATE_UPDATE. All game logic lives in src/net/serverCore.ts; this
// file is only WebSocket I/O. It imports the shared TypeScript core directly
// (tsx resolves the .ts modules — no separate build, no duplicated rules).
// ---------------------------------------------------------------------------

import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerResponse } from 'node:http';
import type { ClientMessage, ServerMessage, ErrorCode } from '../src/net/messages';
import {
  createRoom, addMember, reconnectMember, markDisconnected, removeMember, kickMember, addBot,
  startGame, applyActionRequest, autoAdvance, snapshot, sanitizedStateFor, touchRoom,
  listRoomSummaries, roomsToExpire, roomHasPassword, botMemberToAct, applyBotTurn,
  setTimer, actingMember, applyTimeoutAction,
  type ServerRoom, type ServerMember,
} from '../src/net/serverCore';
import { createStorage, type AppStorage } from './storage';
import { resolveTrickAdvanceMs } from '../src/net/serverTiming';
import { isDbEnabled, checkDbHealth } from './db/client';
import { handleApiRequest, resolveSessionUserId } from './api';
import type { IncomingMessage } from 'node:http';

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
// Pause before a server-side bot makes its move, so play does not snap instantly.
const BOT_DELAY_MS = Number(process.env.BOT_DELAY_MS ?? 800);

// Room auto-clean: idle rooms expire after ROOM_TTL; rooms with a connected
// player survive until the longer hard TTL.
const HOUR_MS = 60 * 60 * 1000;
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_HOURS ?? 24) * HOUR_MS;
const ROOM_HARD_TTL_MS = Number(process.env.ROOM_HARD_TTL_HOURS ?? 48) * HOUR_MS;
// Sweep cadence (ms). Overridable for tests/admin; default every 10 minutes.
const CLEANUP_INTERVAL_MS = Number(process.env.ROOM_CLEANUP_INTERVAL_MS ?? 10 * 60 * 1000);

/**
 * Browser-origin allowlist. Empty list = allow any (LAN/dev). Requests without
 * an Origin header (non-browser clients) are always allowed.
 */
function verifyOrigin(info: { origin?: string }): boolean {
  if (ALLOWED_ORIGINS.length === 0) return true;
  if (!info.origin) return true;
  return ALLOWED_ORIGINS.includes(info.origin);
}

const rooms = new Map<string, ServerRoom>();
const sockets = new Map<string, WebSocket>();              // clientId → socket
const advanceTimers = new Map<string, ReturnType<typeof setTimeout>>(); // code → timer
const botTimers = new Map<string, ReturnType<typeof setTimeout>>();     // code → bot-move timer
const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();    // code → human turn-timeout
// Per-room signature of the finished game we already wrote to stats. Prevents a
// reconnect/rebroadcast from double-counting; a fresh game (different scores)
// yields a new signature so it records once too. DB has its own idempotency key.
const recordedFinish = new Map<string, string>();                       // code → finish signature

// Assigned once in bootstrap() (createStorage is async for the pg backend).
// Declared with `let` so the I/O handlers below can close over it; they only
// run after the server is listening, by which point it is set.
let storage: AppStorage;

/** Persist a changed room (stamps updatedAt). Called on meaningful changes only. */
function persistRoom(room: ServerRoom): void {
  touchRoom(room, Date.now());
  storage.saveRoom(room);
}

// ---------------------------------------------------------------------------
// Send helpers
// ---------------------------------------------------------------------------

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

function broadcastState(room: ServerRoom): void {
  for (const m of room.members.values()) {
    send(socketOf(m), { t: 'STATE_UPDATE', state: sanitizedStateFor(room, m.clientId) });
  }
}

/**
 * Broadcast the new state, then schedule the next server-driven step:
 *  - public screens (trick_complete / round_scoring) auto-advance on a timer;
 *  - otherwise, if the player to act is a bot, schedule its move after a delay.
 * Re-entrant: each scheduled step calls this again, so a chain of bot turns (or
 * a bot that wins a trick then leads) keeps flowing without an infinite loop —
 * a step only reschedules when it actually changed the state.
 */
function clearRoomTimers(code: string): void {
  for (const map of [advanceTimers, botTimers, turnTimers]) {
    const tmr = map.get(code);
    if (tmr) { clearTimeout(tmr); map.delete(code); }
  }
}

/**
 * A cheap content signature of a finished game (round count + per-seat totals).
 * Two recordings of the SAME finished game share it; a different game differs.
 */
function finishSignature(room: ServerRoom): string {
  const s = room.gameState;
  if (!s) return '';
  const totals = s.players.map((p) => `${p.id}=${s.scores[p.id]?.total ?? 0}`).join(',');
  return `${(s.roundHistory ?? []).length}|${totals}`;
}

/**
 * When an online game reaches `game_finished`, persist its score-only history and
 * update stats for human members with a resolved account (Stage 5). Idempotent:
 * a per-room signature skips re-recording on reconnect/rebroadcast, and the DB
 * `game_key` backs it across restarts. DB-gated and best-effort — a failure never
 * affects gameplay (rules/redaction untouched); bots/unidentified seats are
 * skipped. Fire-and-forget so the WS path is never blocked on the DB.
 */
function maybeRecordFinished(room: ServerRoom): void {
  const state = room.gameState;
  if (!state || state.status !== 'game_finished') return;
  if (!isDbEnabled()) return;
  const sig = finishSignature(room);
  if (recordedFinish.get(room.code) === sig) return;
  recordedFinish.set(room.code, sig);

  // Seat → account for identified humans only (bots and anonymous seats absent).
  const seatUsers = new Map<number, string | null>();
  for (const m of room.members.values()) {
    if (m.role === 'player' && m.type === 'human' && m.seatIndex != null && m.userId) {
      seatUsers.set(m.seatIndex, m.userId);
    }
  }
  if (seatUsers.size === 0) return; // no one to attribute stats to → nothing to do

  void (async () => {
    try {
      const { recordFinishedGame } = await import('./db/stats');
      const res = await recordFinishedGame(room.code, state, seatUsers);
      if (res.recorded) {
        console.log(`[King] room ${room.code} stats recorded (${res.humanPlayers ?? 0} player(s))`);
      }
    } catch (err) {
      // Allow a later retry (e.g. transient DB error) by clearing the marker.
      recordedFinish.delete(room.code);
      console.error('[King] stats recording failed for room', room.code, '→',
        String((err as Error)?.message ?? err).split('\n')[0].slice(0, 200));
    }
  })();
}

function broadcastAndAdvance(room: ServerRoom): void {
  broadcastState(room);
  maybeRecordFinished(room);
  clearRoomTimers(room.code);

  const status = room.gameState?.status;
  const delay = status === 'trick_complete' ? TRICK_ADVANCE_MS
    : status === 'round_scoring' ? ROUND_ADVANCE_MS
    : null;

  if (delay != null) {
    advanceTimers.set(room.code, setTimeout(() => {
      advanceTimers.delete(room.code);
      if (!rooms.has(room.code)) return;
      const before = room.dealLog.length;
      if (autoAdvance(room, { now: Date.now() })) {
        if (room.dealLog.length > before) logLatestDeal(room); // a new round was dealt
        broadcastAndAdvance(room);
        persistRoom(room);
      }
    }, delay));
    return;
  }

  // A player-owned screen: if that player is a bot, play its move after a pause.
  if (botMemberToAct(room)) {
    botTimers.set(room.code, setTimeout(() => {
      botTimers.delete(room.code);
      if (!rooms.has(room.code)) return;
      const before = room.dealLog.length;
      if (applyBotTurn(room).acted) {
        if (room.dealLog.length > before) logLatestDeal(room); // bot dealt a new round
        broadcastAndAdvance(room);
        persistRoom(room);
      }
    }, BOT_DELAY_MS));
    return;
  }

  // Human's turn: if a turn timer is set, auto-play a safe AI move on timeout so
  // a slow/absent player never stalls the table. Reset on every transition.
  const acting = actingMember(room);
  if (acting && acting.type === 'human' && room.turnTimerSec > 0) {
    turnTimers.set(room.code, setTimeout(() => {
      turnTimers.delete(room.code);
      if (!rooms.has(room.code)) return;
      const before = room.dealLog.length;
      if (applyTimeoutAction(room).acted) {
        if (room.dealLog.length > before) logLatestDeal(room);
        console.log(`[King] room ${room.code} turn timeout → auto-action for seat ${acting.seatIndex}`);
        broadcastAndAdvance(room);
        persistRoom(room);
      }
    }, room.turnTimerSec * 1000));
  }
}

function welcome(socket: WebSocket, member: ServerMember, room: ServerRoom): void {
  send(socket, {
    t: 'WELCOME',
    clientId: member.clientId,
    reconnectToken: member.reconnectToken,
    room: snapshot(room),
  });
}

// ---------------------------------------------------------------------------
// Static client (single-service hosting, e.g. Render)
//
// When a production build exists in ../dist, this same server also serves the
// frontend (HTML/JS/CSS/icons) with an SPA fallback to index.html. That lets a
// single Render Web Service host BOTH the client and the WebSocket on one
// domain (client connects to wss://<domain>/ws). In dev there is no dist/ — the
// server only does WS + /health, and Vite serves the client (npm run dev).
// ---------------------------------------------------------------------------
const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const INDEX_HTML = join(DIST, 'index.html');
const SERVE_STATIC = existsSync(INDEX_HTML);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function sendFile(res: ServerResponse, filePath: string, status = 200): Promise<void> {
  const body = await readFile(filePath);
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  // Hashed assets are immutable; HTML / sw.js / manifest must re-check each load.
  const cache = filePath.includes(`${sep}assets${sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(status, { 'content-type': type, 'cache-control': cache });
  res.end(body);
}

async function serveStatic(req: { url?: string }, res: ServerResponse): Promise<void> {
  let pathname = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  if (pathname === '/') pathname = '/index.html';
  const candidate = normalize(join(DIST, pathname));
  // Path-traversal guard: never serve outside DIST.
  if (candidate.startsWith(DIST) && existsSync(candidate) && statSync(candidate).isFile()) {
    return sendFile(res, candidate).catch(() => sendFile(res, INDEX_HTML).catch(() => notFound(res)));
  }
  // SPA fallback: unknown route → index.html (client router/refresh-safe).
  return sendFile(res, INDEX_HTML).catch(() => notFound(res));
}

function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}

// ---------------------------------------------------------------------------
// Connection handling
// ---------------------------------------------------------------------------

// A tiny HTTP server hosts /health, serves the static client (if built), and
// shares the port with the WebSocket upgrade. Upgrade requests (the WS on /ws)
// are handled by `ws` via the 'upgrade' event, so they never hit this handler.
/**
 * /health — always 200 (the process is up). Reports `db`:
 *   • 'disabled' when no DATABASE_URL (file/memory MVP) — unchanged behaviour;
 *   • 'ok' / 'error' when a DB is configured (probed with `select 1`).
 * The DB is OPTIONAL in Stage 1, so a DB error never fails the health check.
 */
async function handleHealth(res: ServerResponse): Promise<void> {
  let db: string = 'disabled';
  if (isDbEnabled()) {
    const h = await checkDbHealth();
    db = h.state; // 'ok' | 'error' | 'disabled'
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', db, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
}

const httpServer = createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (path === '/health') {
    void handleHealth(res).catch(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', db: 'error', rooms: rooms.size, uptime: Math.round(process.uptime()) }));
    });
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

wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
  let session: { room: ServerRoom; clientId: string } | null = null;

  // Stage 5: resolve the player's account from the session cookie that rides the
  // WS upgrade (same-origin). This NAMES the player for stats only — seat/
  // reconnect authority stays on clientId + reconnectToken. Resolution is async;
  // a userId is needed only at game-finish (far later), so we attach it both when
  // it resolves and on each CREATE/JOIN/RECONNECT. Null for guests/no-DB/cross-
  // origin — those simply have no attributed identity. Never trusts client input.
  let resolvedUserId: string | null = null;
  const attachIdentity = (): void => {
    if (!session || !resolvedUserId) return;
    const m = session.room.members.get(session.clientId);
    if (m && m.type === 'human' && !m.userId) m.userId = resolvedUserId;
  };
  void resolveSessionUserId(request).then((uid) => { resolvedUserId = uid; attachIdentity(); });

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return sendError(socket, 'BAD_MESSAGE', 'Invalid JSON');
    }

    switch (msg.t) {
      case 'CREATE_ROOM': {
        const code = makeRoomCode();
        const clientId = randomUUID();
        const room = createRoom({
          code,
          playerCount: msg.playerCount === 3 ? 3 : 4,
          modeSelectionType: msg.modeSelectionType === 'dealer_choice' ? 'dealer_choice' : 'fixed',
          host: { clientId, reconnectToken: randomUUID(), name: msg.name, avatar: msg.avatar },
          // Optional join password — hashed with a fresh salt inside serverCore.
          password: msg.password,
          salt: randomUUID(),
          turnTimerSec: msg.turnTimerSec,
        });
        rooms.set(code, room);
        sockets.set(clientId, socket);
        session = { room, clientId };
        attachIdentity();
        welcome(socket, room.members.get(clientId)!, room);
        broadcastRoom(room);
        persistRoom(room);
        logRoomEvent('CREATE_ROOM', code, room);
        break;
      }

      case 'JOIN_ROOM': {
        const reqCode = String(msg.code || '').toUpperCase();
        const room = rooms.get(reqCode);
        if (!room) {
          logRoomEvent('JOIN_ROOM', reqCode, null, 'ROOM_NOT_FOUND');
          return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
        }
        const clientId = randomUUID();
        const res = addMember(room, {
          clientId, reconnectToken: randomUUID(), name: msg.name, role: msg.role, password: msg.password, avatar: msg.avatar,
        });
        if (!res.ok) {
          logRoomEvent('JOIN_ROOM', reqCode, room, res.error);
          const message = res.error === 'BAD_PASSWORD' ? 'Wrong or missing room password' : 'Cannot join room';
          return sendError(socket, res.error!, message);
        }
        sockets.set(clientId, socket);
        session = { room, clientId };
        attachIdentity();
        welcome(socket, room.members.get(clientId)!, room);
        broadcastRoom(room);
        if (room.gameState) send(socket, { t: 'STATE_UPDATE', state: sanitizedStateFor(room, clientId) });
        persistRoom(room);
        logRoomEvent('JOIN_ROOM', reqCode, room);
        break;
      }

      case 'RECONNECT': {
        const reqCode = String(msg.code || '').toUpperCase();
        const room = rooms.get(reqCode);
        if (!room) {
          logRoomEvent('RECONNECT', reqCode, null, 'ROOM_NOT_FOUND');
          return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
        }
        const member = reconnectMember(room, msg.reconnectToken);
        if (!member) {
          logRoomEvent('RECONNECT', reqCode, room, 'UNKNOWN_TOKEN');
          return sendError(socket, 'ROOM_NOT_FOUND', 'Unknown reconnect token');
        }
        sockets.set(member.clientId, socket);
        session = { room, clientId: member.clientId };
        attachIdentity();
        welcome(socket, member, room);
        broadcastRoom(room);
        // Reconnecting client immediately gets the current sanitized state.
        if (room.gameState) send(socket, { t: 'STATE_UPDATE', state: sanitizedStateFor(room, member.clientId) });
        persistRoom(room);
        break;
      }

      case 'START_GAME': {
        if (!session) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
        const { room, clientId } = session;
        if (!room.members.get(clientId)?.isHost) return sendError(socket, 'NOT_HOST', 'Only the host may start');
        const res = startGame(room, { now: Date.now() });
        if (!res.ok) return sendError(socket, res.error!, 'Cannot start game');
        logLatestDeal(room);
        broadcastRoom(room);
        broadcastAndAdvance(room);
        persistRoom(room);
        break;
      }

      case 'ACTION_REQUEST': {
        if (!session) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
        const { room, clientId } = session;
        const res = applyActionRequest(room, clientId, msg.action);
        if (!res.ok) return sendError(socket, res.error!, 'Action rejected');
        broadcastAndAdvance(room);
        persistRoom(room);
        break;
      }

      case 'LIST_ROOMS': {
        // Discovery: public summaries only (no session required).
        send(socket, { t: 'ROOMS_LIST', rooms: listRoomSummaries(rooms.values()) });
        break;
      }

      // Legacy host-authoritative messages — ignored in server-authoritative mode.
      case 'HOST_STATE':
        break;

      case 'KICK_MEMBER': {
        if (!session) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
        const { room, clientId } = session;
        const target = String(msg.clientId || '');
        const res = kickMember(room, clientId, target);
        if (!res.ok) return sendError(socket, res.error!, 'Cannot remove member');
        // Tell the kicked client, then drop its socket. Its membership (and
        // reconnect token) is already gone, so it cannot RECONNECT.
        const targetSocket = sockets.get(target);
        if (targetSocket) {
          send(targetSocket, { t: 'KICKED', reason: 'HOST_REMOVED' });
          try { targetSocket.close(); } catch { /* already closing */ }
        }
        sockets.delete(target);
        broadcastRoom(room);
        persistRoom(room);
        break;
      }

      case 'ADD_BOT': {
        if (!session) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
        const { room, clientId } = session;
        // addBot itself rejects non-host / started / full.
        const res = addBot(room, clientId, { clientId: randomUUID(), reconnectToken: randomUUID() });
        if (!res.ok) return sendError(socket, res.error!, 'Cannot add bot');
        broadcastRoom(room);
        persistRoom(room);
        logRoomEvent('ADD_BOT', room.code, room);
        break;
      }

      case 'SET_TIMER': {
        if (!session) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
        const { room, clientId } = session;
        const res = setTimer(room, clientId, Number(msg.turnTimerSec));
        if (!res.ok) return sendError(socket, res.error!, 'Cannot set timer');
        broadcastRoom(room);
        persistRoom(room);
        break;
      }

      case 'LEAVE_ROOM': {
        if (session) handleLeave(session.room, session.clientId);
        session = null;
        break;
      }

      case 'PING':
        send(socket, { t: 'PONG' });
        break;

      default:
        sendError(socket, 'BAD_MESSAGE', `Unknown message: ${(msg as { t: string }).t}`);
    }
  });

  socket.on('close', () => {
    if (!session) return;
    sockets.delete(session.clientId);
    markDisconnected(session.room, session.clientId);
    broadcastRoom(session.room);
    persistRoom(session.room); // keep the store fresh (debounced); connected resets on restore
  });
});

function handleLeave(room: ServerRoom, clientId: string): void {
  sockets.delete(clientId);
  const { empty } = removeMember(room, clientId);
  // Tear the room down once no humans remain (bots alone must not keep it alive
  // or be promoted to host).
  const hasHuman = [...room.members.values()].some((m) => m.type === 'human');
  if (empty || !hasHuman) {
    clearRoomTimers(room.code);
    recordedFinish.delete(room.code);
    rooms.delete(room.code);
    storage.deleteRoom(room.code);
    return;
  }
  broadcastRoom(room);
  persistRoom(room);
}

/** Reschedule server-driven steps for a restored room (public advance or a bot turn). */
function rescheduleAdvance(room: ServerRoom): void {
  const status = room.gameState?.status;
  if (status === 'trick_complete' || status === 'round_scoring' || botMemberToAct(room)) {
    broadcastAndAdvance(room);
  }
}

// Remove idle rooms (and their persistence + timers). Returns how many were
// deleted. Called once at startup (so expired rooms go immediately, not only
// after the first interval) and then periodically.
function cleanupRooms(): number {
  const expired = roomsToExpire(rooms.values(), Date.now(), ROOM_TTL_MS, ROOM_HARD_TTL_MS);
  for (const code of expired) {
    clearRoomTimers(code);
    recordedFinish.delete(code);
    rooms.delete(code);
    storage.deleteRoom(code); // also drop it from the persistence file
    console.log(`[King] auto-cleaned idle room ${code}`);
  }
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
  for (const room of storage.loadRooms()) {
    rooms.set(room.code, room);
    rescheduleAdvance(room);
    restored++;
  }
  // Explicit startup sweep: delete already-expired rooms right away (and remove
  // them from storage) rather than waiting for the first interval to fire.
  const expiredOnStartup = cleanupRooms();

  setInterval(cleanupRooms, CLEANUP_INTERVAL_MS);

  httpServer.listen(PORT, HOST, () => {
    console.log(`[King] server-authoritative server listening on ${HOST}:${PORT} (${NODE_ENV})`);
    console.log(`[King] health: http://${HOST}:${PORT}/health`);
    console.log(SERVE_STATIC
      ? `[King] serving static client from ${DIST} (single-service mode; WS on /ws)`
      : `[King] no dist/ build found — WS + /health only (run "npm run build" to serve the client here)`);
    console.log(isDbEnabled()
      ? '[King] database: DATABASE_URL set — /health probes Postgres'
      : '[King] database: disabled (no DATABASE_URL)');
    console.log(
      `[King] startup: restored ${restored} room(s) from storage, removed ${expiredOnStartup} expired ` +
      `(TTL ${ROOM_TTL_MS / HOUR_MS}h, hard TTL ${ROOM_HARD_TTL_MS / HOUR_MS}h)`,
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
