// Unit + safety tests for the server-side voice ICE config (server/voiceIce.ts, Stage 25.6):
// STUN-only default, runtime env override, secret-free MODE for diagnostics, and a redaction
// helper that never leaks credentials.
import { describe, it, expect, afterEach } from 'vitest';
import {
  parseIceServers, iceMode, configuredIceServers, iceConfigPayload, redactIceServers,
  DEFAULT_ICE_SERVERS,
} from '../../server/voiceIce';

const ORIG = process.env.VOICE_ICE_SERVERS;
afterEach(() => {
  if (ORIG === undefined) delete process.env.VOICE_ICE_SERVERS;
  else process.env.VOICE_ICE_SERVERS = ORIG;
});

describe('parseIceServers — STUN default + runtime override', () => {
  it('falls back to STUN on unset / empty / malformed / non-array / no-valid', () => {
    for (const raw of [undefined, null, '', '   ', 'nope', '{}', '42', '[]', '[{"urls":"http://x"}]']) {
      expect(parseIceServers(raw)).toEqual(DEFAULT_ICE_SERVERS);
    }
    expect(DEFAULT_ICE_SERVERS[0].urls).toBe('stun:stun.l.google.com:19302');
  });

  it('parses a STUN + TURN array and keeps the credential (browser needs it to auth)', () => {
    const raw = '[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:t.example.com:3478","username":"u","credential":"secret"}]';
    expect(parseIceServers(raw)).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:t.example.com:3478', username: 'u', credential: 'secret' },
    ]);
  });

  it('drops entries with a non-stun/turn scheme', () => {
    expect(parseIceServers('[{"urls":"ftp://x"},{"urls":"turns:ok:5349"}]')).toEqual([{ urls: 'turns:ok:5349' }]);
  });
});

describe('iceMode — secret-free summary', () => {
  it('stun_only vs turn_configured', () => {
    expect(iceMode(DEFAULT_ICE_SERVERS)).toBe('stun_only');
    expect(iceMode([{ urls: 'turn:t:3478', username: 'u', credential: 'x' }])).toBe('turn_configured');
    expect(iceMode([{ urls: ['stun:a:3478', 'turns:b:5349'] }])).toBe('turn_configured');
  });
});

describe('configuredIceServers / iceConfigPayload — read the runtime env', () => {
  it('unset env → STUN-only payload', () => {
    delete process.env.VOICE_ICE_SERVERS;
    expect(configuredIceServers()).toEqual(DEFAULT_ICE_SERVERS);
    expect(iceConfigPayload()).toEqual({ iceServers: DEFAULT_ICE_SERVERS });
  });

  it('env with TURN → payload includes the TURN server WITH its credential (by design)', () => {
    process.env.VOICE_ICE_SERVERS = '[{"urls":"turn:t:3478","username":"u","credential":"secret"}]';
    const payload = iceConfigPayload();
    expect(payload.iceServers[0]).toEqual({ urls: 'turn:t:3478', username: 'u', credential: 'secret' });
    expect(iceMode(configuredIceServers())).toBe('turn_configured');
  });

  it('malformed env → safe STUN fallback (never throws)', () => {
    process.env.VOICE_ICE_SERVERS = 'not json at all';
    expect(configuredIceServers()).toEqual(DEFAULT_ICE_SERVERS);
    expect(iceMode(configuredIceServers())).toBe('stun_only');
  });
});

describe('redactIceServers — for safe logging', () => {
  it('exposes only urls + hasCredential, never the secret', () => {
    const redacted = redactIceServers([{ urls: 'turn:t:3478', username: 'u', credential: 'secret' }]);
    expect(redacted).toEqual([{ urls: 'turn:t:3478', hasCredential: true }]);
    const s = JSON.stringify(redacted);
    expect(s).not.toContain('secret');
    expect(s).not.toContain('username');
  });
});
