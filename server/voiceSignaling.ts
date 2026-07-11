// ---------------------------------------------------------------------------
// Voice signaling relay — in-memory, room-scoped (Stage 25.3).
//
// The server RELAYS WebRTC signaling (SDP offers/answers, ICE candidates) between two
// members of the SAME room, and tracks who is in each room's voice session + their mute
// state. It NEVER touches audio, NEVER parses SDP/ICE beyond a size cap (validated by the
// caller), NEVER writes to the DB, and NEVER broadcasts an offer/answer/ICE to the whole
// room — those go ONLY to the single target peer. Mute state DOES broadcast to voice peers.
//
// Functions RETURN a list of targeted deliveries ({socket, msg}) instead of sending
// directly, so the whole relay is unit-testable with fake sockets (index.ts does the send).
// Single-instance (per-process), like rooms/presence today. No email/token/session anywhere.
// ---------------------------------------------------------------------------

import type { ServerMessage } from '../src/net/messages';

/** Opaque socket ref (the WebSocket at runtime; a string/object in tests). */
type SocketRef = object;

interface VoiceMember { socket: SocketRef; name: string; muted: boolean; }

// roomCode → (clientId → member). Created lazily; deleted when empty.
const voiceRooms = new Map<string, Map<string, VoiceMember>>();

export interface VoiceDelivery { socket: SocketRef; msg: ServerMessage; }

function roomOf(roomCode: string, create = false): Map<string, VoiceMember> | undefined {
  let r = voiceRooms.get(roomCode);
  if (!r && create) { r = new Map(); voiceRooms.set(roomCode, r); }
  return r;
}

/**
 * Join the room's voice session. Returns: a VOICE_PEERS snapshot to the joiner (the peers
 * ALREADY present), plus a VOICE_PEER_JOINED to each of those peers. Idempotent-ish: a
 * re-join just refreshes the socket and re-sends the roster.
 */
export function joinVoice(roomCode: string, clientId: string, socket: SocketRef, name: string): VoiceDelivery[] {
  const r = roomOf(roomCode, true)!;
  const existing = [...r.entries()]
    .filter(([cid]) => cid !== clientId)
    .map(([cid, m]) => ({ clientId: cid, name: m.name, muted: m.muted }));
  r.set(clientId, { socket, name, muted: false });
  const out: VoiceDelivery[] = [{ socket, msg: { t: 'VOICE_PEERS', peers: existing } }];
  for (const [cid, m] of r) {
    if (cid !== clientId) out.push({ socket: m.socket, msg: { t: 'VOICE_PEER_JOINED', clientId, name, muted: false } });
  }
  return out;
}

/** Leave the room's voice session. Returns a VOICE_PEER_LEFT to the remaining peers. */
export function leaveVoice(roomCode: string, clientId: string): VoiceDelivery[] {
  const r = voiceRooms.get(roomCode);
  if (!r || !r.has(clientId)) return [];
  r.delete(clientId);
  const out = [...r.values()].map((m) => ({ socket: m.socket, msg: { t: 'VOICE_PEER_LEFT', clientId } as ServerMessage }));
  if (r.size === 0) voiceRooms.delete(roomCode);
  return out;
}

/**
 * Relay an OFFER/ANSWER/ICE to a SINGLE target peer. Rejected (empty) unless BOTH the
 * sender AND the target are in this room's voice session. `msg` is the pre-built relay
 * message (already stamped with fromClientId by the caller). Never broadcast.
 */
export function relayVoiceSignal(roomCode: string, fromClientId: string, toClientId: string, msg: ServerMessage): VoiceDelivery[] {
  const r = voiceRooms.get(roomCode);
  if (!r || !r.has(fromClientId)) return []; // sender not in voice
  const target = r.get(toClientId);
  if (!target || toClientId === fromClientId) return []; // target not in the SAME voice room (or self)
  return [{ socket: target.socket, msg }];
}

/** Set a member's mute state and broadcast VOICE_MUTE_STATE to the OTHER voice peers. */
export function setVoiceMute(roomCode: string, clientId: string, muted: boolean): VoiceDelivery[] {
  const r = voiceRooms.get(roomCode);
  const m = r?.get(clientId);
  if (!r || !m) return [];
  m.muted = muted;
  return [...r.entries()]
    .filter(([cid]) => cid !== clientId)
    .map(([, peer]) => ({ socket: peer.socket, msg: { t: 'VOICE_MUTE_STATE', clientId, muted } as ServerMessage }));
}

/** Whether a client is currently in a room's voice session. */
export function isInVoice(roomCode: string, clientId: string): boolean {
  return !!voiceRooms.get(roomCode)?.has(clientId);
}

/** How many peers are in a room's voice session (tests/diagnostics; not on the wire). */
export function voicePeerCount(roomCode: string): number {
  return voiceRooms.get(roomCode)?.size ?? 0;
}

/** Test hook: forget all voice sessions. */
export function resetVoice(): void {
  voiceRooms.clear();
}
