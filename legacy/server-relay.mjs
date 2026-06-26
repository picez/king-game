// ---------------------------------------------------------------------------
// King — LEGACY host-authoritative relay server (Node + ws)
//
//   ⛔ HISTORICAL / UNSUPPORTED — DO NOT DEVELOP THIS PATH.
//
//   This file is kept for historical reference ONLY. It is NOT wired to any npm
//   script and is NOT compatible with the current client (which no longer plays
//   the host-authority role — no HOST_STATE / ACTION_FORWARD). It was moved here
//   from server/index.mjs in Stage 8.6 to isolate the dead relay from the
//   supported codebase.
//
//   The supported server is SERVER-AUTHORITATIVE: server/index.ts via
//   `npm run server`. Use that. See ONLINE_ARCHITECTURE.md.
//
//   If you ever truly need to inspect the old relay, run it manually with
//   `node legacy/server-relay.mjs` — but it will not work with the shipped client.
//
// (Original design, for the record.) A pure relay + room manager: lobby with
// short room codes, host/players/spectators, reconnect via a per-client token,
// and broadcast of authoritative state. "Host-authoritative" meant one member
// (the host) ran the same `gameReducer` as the local game and pushed the result
// via HOST_STATE; the server only redacted opponents' hands and fanned it out.
// The shipped server replaced this by owning the reducer itself.
// ---------------------------------------------------------------------------

import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3001);
const MAX_PLAYERS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

/** @typedef {import('ws').WebSocket} WebSocket */

/**
 * @typedef {Object} Member
 * @property {string} clientId
 * @property {string} reconnectToken
 * @property {string} name
 * @property {'player'|'spectator'} role
 * @property {number|null} seatIndex
 * @property {boolean} isHost
 * @property {WebSocket|null} socket
 */

/**
 * @typedef {Object} Room
 * @property {string} code
 * @property {Map<string, Member>} members  keyed by clientId
 * @property {3|4} playerCount
 * @property {'fixed'|'dealer_choice'} modeSelectionType
 * @property {boolean} started
 * @property {any|null} state  latest authoritative GameState (unredacted)
 */

/** @type {Map<string, Room>} */
const rooms = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
    ).join('');
  } while (rooms.has(code));
  return code;
}

function send(socket, msg) {
  if (socket && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function sendError(socket, code, message) {
  send(socket, { t: 'ERROR', code, message });
}

function snapshot(room) {
  return {
    code: room.code,
    members: [...room.members.values()].map((m) => ({
      clientId: m.clientId,
      name: m.name,
      role: m.role,
      seatIndex: m.seatIndex,
      isHost: m.isHost,
      connected: !!m.socket && m.socket.readyState === m.socket.OPEN,
    })),
    playerCount: room.playerCount,
    modeSelectionType: room.modeSelectionType,
    started: room.started,
    hasPassword: false, // legacy relay has no password support
  };
}

function broadcastRoom(room) {
  const snap = snapshot(room);
  for (const m of room.members.values()) {
    send(m.socket, { t: 'ROOM_UPDATE', room: snap });
  }
}

/**
 * Redact every hand except the recipient's. Mirrors `redactStateFor` in
 * src/net/messages.ts (kept in sync intentionally so the server has no
 * dependency on the TypeScript client build).
 */
function redactStateFor(state, viewerPlayerId) {
  if (!state) return null;
  const hidden = { suit: 'spades', rank: '?', value: 0 };
  const dealerId = state.players?.[state.dealerIndex]?.id ?? null;
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === viewerPlayerId ? p : { ...p, hand: p.hand.map(() => hidden) },
    ),
    kittyForExchange:
      viewerPlayerId && dealerId === viewerPlayerId
        ? state.kittyForExchange
        : (state.kittyForExchange ?? []).map(() => hidden),
  };
}

function broadcastState(room) {
  for (const m of room.members.values()) {
    // A member's seat maps to player id `player-<seatIndex>` (see gameEngine).
    const viewerPlayerId = m.seatIndex != null ? `player-${m.seatIndex}` : null;
    send(m.socket, { t: 'STATE_UPDATE', state: redactStateFor(room.state, viewerPlayerId) });
  }
}

function hostOf(room) {
  return [...room.members.values()].find((m) => m.isHost) ?? null;
}

function activePlayers(room) {
  return [...room.members.values()].filter((m) => m.role === 'player');
}

function assignSeats(room) {
  activePlayers(room).forEach((m, i) => { m.seatIndex = i; });
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket) => {
  /** @type {{ room: Room, member: Member } | null} */
  let session = null;

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return sendError(socket, 'BAD_MESSAGE', 'Invalid JSON');
    }

    switch (msg.t) {
      case 'CREATE_ROOM': {
        const code = makeRoomCode();
        const member = newMember(msg.name, 'player', true);
        const room = {
          code,
          members: new Map([[member.clientId, member]]),
          playerCount: msg.playerCount === 3 ? 3 : 4,
          modeSelectionType: msg.modeSelectionType === 'dealer_choice' ? 'dealer_choice' : 'fixed',
          started: false,
          state: null,
        };
        member.socket = socket;
        rooms.set(code, room);
        assignSeats(room);
        session = { room, member };
        welcome(socket, member, room);
        broadcastRoom(room);
        break;
      }

      case 'JOIN_ROOM': {
        const room = rooms.get(String(msg.code || '').toUpperCase());
        if (!room) return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
        const role = msg.role === 'spectator' ? 'spectator' : 'player';
        if (role === 'player' && activePlayers(room).length >= MAX_PLAYERS) {
          return sendError(socket, 'ROOM_FULL', 'No free seats');
        }
        if ([...room.members.values()].some((m) => m.name === msg.name)) {
          return sendError(socket, 'NAME_TAKEN', 'Name already in this room');
        }
        const member = newMember(msg.name, role, false);
        member.socket = socket;
        room.members.set(member.clientId, member);
        assignSeats(room);
        session = { room, member };
        welcome(socket, member, room);
        broadcastRoom(room);
        if (room.state) broadcastState(room);
        break;
      }

      case 'RECONNECT': {
        const room = rooms.get(String(msg.code || '').toUpperCase());
        if (!room) return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
        const member = [...room.members.values()].find((m) => m.reconnectToken === msg.reconnectToken);
        if (!member) return sendError(socket, 'ROOM_NOT_FOUND', 'Unknown reconnect token');
        member.socket = socket;
        session = { room, member };
        welcome(socket, member, room);
        broadcastRoom(room);
        if (room.state) broadcastState(room);
        break;
      }

      case 'UPDATE_SETTINGS': {
        if (!requireHost(session, socket)) break;
        const { room } = session;
        if (msg.playerCount === 3 || msg.playerCount === 4) room.playerCount = msg.playerCount;
        if (msg.modeSelectionType) room.modeSelectionType = msg.modeSelectionType;
        broadcastRoom(room);
        break;
      }

      case 'START_GAME': {
        if (!requireHost(session, socket)) break;
        session.room.started = true;
        broadcastRoom(session.room);
        // The host client now runs the reducer and pushes HOST_STATE.
        break;
      }

      case 'ACTION_REQUEST': {
        if (!session) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
        const { room, member } = session;
        // Forward to the host, the game authority in relay mode. The host
        // validates turn/legality via the reducer and replies with HOST_STATE.
        const host = hostOf(room);
        if (!host?.socket) return sendError(socket, 'ILLEGAL_ACTION', 'Host is offline');
        send(host.socket, { t: 'ACTION_FORWARD', action: msg.action, fromSeat: member.seatIndex });
        break;
      }

      case 'HOST_STATE': {
        if (!requireHost(session, socket)) break;
        session.room.state = msg.state;
        broadcastState(session.room);
        break;
      }

      case 'LEAVE_ROOM': {
        if (session) dropMember(session.room, session.member);
        session = null;
        break;
      }

      case 'PING':
        send(socket, { t: 'PONG' });
        break;

      default:
        sendError(socket, 'BAD_MESSAGE', `Unknown message: ${msg.t}`);
    }
  });

  socket.on('close', () => {
    if (!session) return;
    // Keep the member around (so they can RECONNECT) but mark disconnected.
    session.member.socket = null;
    broadcastRoom(session.room);
  });
});

function newMember(name, role, isHost) {
  return {
    clientId: randomUUID(),
    reconnectToken: randomUUID(),
    name: String(name || 'Player').slice(0, 20),
    role,
    seatIndex: null,
    isHost,
    socket: null,
  };
}

function welcome(socket, member, room) {
  send(socket, {
    t: 'WELCOME',
    clientId: member.clientId,
    reconnectToken: member.reconnectToken,
    room: snapshot(room),
  });
}

function requireHost(session, socket) {
  if (!session || !session.member.isHost) {
    sendError(socket, 'NOT_HOST', 'Only the host may do that');
    return false;
  }
  return true;
}

function dropMember(room, member) {
  room.members.delete(member.clientId);
  if (room.members.size === 0) {
    rooms.delete(room.code);
    return;
  }
  // Promote a new host if the host left.
  if (member.isHost) {
    const next = room.members.values().next().value;
    if (next) next.isHost = true;
  }
  assignSeats(room);
  broadcastRoom(room);
}

console.log(`[King] relay server listening on ws://0.0.0.0:${PORT}`);
console.log(`[King] LAN clients connect to ws://<this-machine-ip>:${PORT}`);
