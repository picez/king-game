import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  joinVoice, leaveVoice, relayVoiceSignal, setVoiceMute, isInVoice, voicePeerCount, resetVoice,
} from '../../server/voiceSignaling';
import type { ServerMessage } from './messages';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
beforeEach(() => resetVoice());

// Fake sockets = plain objects; deliveries reference them so we can assert routing.
const A = { id: 'A' }, B = { id: 'B' }, C = { id: 'C' };
type D = { socket: object; msg: ServerMessage };
const to = (ds: D[], sock: object) => ds.filter((d) => d.socket === sock).map((d) => d.msg);

describe('voiceSignaling — room-scoped roster', () => {
  it('join sends the joiner a VOICE_PEERS snapshot and notifies existing peers', () => {
    joinVoice('R', 'a', A, 'Alex');
    const ds = joinVoice('R', 'b', B, 'Bea');
    // Bea gets the roster with Alex; Alex gets a PEER_JOINED for Bea.
    expect(to(ds, B)).toEqual([{ t: 'VOICE_PEERS', peers: [{ clientId: 'a', name: 'Alex', muted: false }] }]);
    expect(to(ds, A)).toEqual([{ t: 'VOICE_PEER_JOINED', clientId: 'b', name: 'Bea', muted: false }]);
    expect(voicePeerCount('R')).toBe(2);
  });

  it('leave removes the peer and sends VOICE_PEER_LEFT to the rest', () => {
    joinVoice('R', 'a', A, 'Alex'); joinVoice('R', 'b', B, 'Bea');
    const ds = leaveVoice('R', 'a');
    expect(to(ds, B)).toEqual([{ t: 'VOICE_PEER_LEFT', clientId: 'a' }]);
    expect(isInVoice('R', 'a')).toBe(false);
    // Last leaver empties + drops the room.
    leaveVoice('R', 'b');
    expect(voicePeerCount('R')).toBe(0);
  });

  it('relays an OFFER ONLY to the target peer in the same room (never broadcast)', () => {
    joinVoice('R', 'a', A, 'Alex'); joinVoice('R', 'b', B, 'Bea'); joinVoice('R', 'c', C, 'Cy');
    const relay: ServerMessage = { t: 'VOICE_SIGNAL_OFFER', fromClientId: 'a', sdp: 'v=0' };
    const ds = relayVoiceSignal('R', 'a', 'b', relay);
    expect(ds).toEqual([{ socket: B, msg: relay }]); // only Bea, not Cy
    expect(to(ds, C)).toEqual([]);
  });

  it('rejects a relay when the sender is not in voice, the target is not in the room, or self', () => {
    joinVoice('R', 'a', A, 'Alex'); joinVoice('R', 'b', B, 'Bea');
    const relay: ServerMessage = { t: 'VOICE_SIGNAL_ICE', fromClientId: 'a', candidate: 'x' };
    expect(relayVoiceSignal('R', 'ghost', 'b', relay)).toEqual([]); // sender not in voice
    expect(relayVoiceSignal('R', 'a', 'ghost', relay)).toEqual([]); // target not in room
    expect(relayVoiceSignal('R', 'a', 'a', relay)).toEqual([]);     // self
    expect(relayVoiceSignal('OTHER', 'a', 'b', relay)).toEqual([]); // different room
  });

  it('mute state broadcasts to the OTHER voice peers only', () => {
    joinVoice('R', 'a', A, 'Alex'); joinVoice('R', 'b', B, 'Bea');
    const ds = setVoiceMute('R', 'a', true);
    expect(to(ds, B)).toEqual([{ t: 'VOICE_MUTE_STATE', clientId: 'a', muted: true }]);
    expect(to(ds, A)).toEqual([]); // not echoed to self
  });
});

describe('voice — source guards (relay only, no audio/WebRTC/DB/secrets)', () => {
  const relay = read('server/voiceSignaling.ts');
  const rate = read('server/voiceRateLimit.ts');
  const pure = read('src/net/voiceSignal.ts');
  const messages = read('src/net/messages.ts');
  const index = read('server/index.ts');

  it('the voice modules have NO WebRTC / getUserMedia / AudioContext / audio element', () => {
    for (const src of [relay, rate, pure]) {
      expect(src).not.toMatch(/RTCPeerConnection|getUserMedia|mediaDevices|AudioContext|new Audio|<audio/i);
    }
  });

  it('the voice server modules NEVER import the DB / persist anything', () => {
    for (const src of [relay, rate]) {
      expect(src).not.toMatch(/from '\.\/db\/|getDb|import\('\.\/db|INSERT|UPDATE friendships|postgres/i);
    }
  });

  it('voice payloads carry no email/token/session/reconnect (public routing only)', () => {
    const block = messages.slice(messages.indexOf("'VOICE_PEERS'"), messages.indexOf('| { t: \'PONG\' };'));
    expect(block).not.toMatch(/email|token|session|reconnect|password/i);
  });

  it('index.ts relays voice size-capped + rate-limited, and never broadcasts a signal', () => {
    expect(index).toContain('allowVoiceSignal');
    expect(index).toContain('isValidSdp');
    expect(index).toContain('isValidIce');
    expect(index).toContain('relayVoiceSignal');
    // Cleanup wired on close + explicit leave.
    expect(index).toMatch(/leaveVoice\(session\.room\.code/);
    expect(index).toMatch(/leaveVoice\(room\.code/);
  });
});
