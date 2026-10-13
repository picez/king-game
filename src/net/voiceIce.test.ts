// Unit + safety tests for the server-side voice ICE config (server/voiceIce.ts, Stage 25.6):
// STUN-only default, runtime env override, secret-free MODE for diagnostics, and a redaction
// helper that never leaks credentials.
import { describe, it, expect, afterEach } from 'vitest';
import {
  parseIceServers, iceMode, configuredIceServers, iceConfigPayload, redactIceServers,
  DEFAULT_ICE_SERVERS, turnRestConfig, mintTurnCredential, TURN_TTL_DEFAULT_SECONDS,
} from '../../server/voiceIce';
import { createHmac } from 'node:crypto';

const ORIG = process.env.VOICE_ICE_SERVERS;
afterEach(() => {
  if (ORIG === undefined) delete process.env.VOICE_ICE_SERVERS;
  else process.env.VOICE_ICE_SERVERS = ORIG;
  delete process.env.VOICE_TURN_URLS;
  delete process.env.VOICE_TURN_SECRET;
  delete process.env.VOICE_TURN_TTL_SECONDS;
});

describe('short-lived TURN credentials (Stage 40.1)', () => {
  const cfg = { urls: ['turn:t.example.com:3478', 'turns:t.example.com:5349'], secret: 's3cret', ttlSeconds: 600 };

  it('needs BOTH a relay URL and a secret; a stun: URL does not count', () => {
    expect(turnRestConfig({})).toBeNull();
    expect(turnRestConfig({ VOICE_TURN_URLS: 'turn:t:3478' })).toBeNull();
    expect(turnRestConfig({ VOICE_TURN_SECRET: 'x' })).toBeNull();
    expect(turnRestConfig({ VOICE_TURN_URLS: 'stun:s:3478', VOICE_TURN_SECRET: 'x' })).toBeNull();
    expect(turnRestConfig({ VOICE_TURN_URLS: ' turn:t:3478 , stun:s:1, turns:t:5349', VOICE_TURN_SECRET: ' x ' }))
      .toEqual({ urls: ['turn:t:3478', 'turns:t:5349'], secret: 'x', ttlSeconds: TURN_TTL_DEFAULT_SECONDS });
  });

  it('clamps the lifetime to 5 minutes – 24 hours, and ignores nonsense', () => {
    const ttl = (v: string) => turnRestConfig({ VOICE_TURN_URLS: 'turn:t:1', VOICE_TURN_SECRET: 'x', VOICE_TURN_TTL_SECONDS: v })!.ttlSeconds;
    expect(ttl('1')).toBe(300);
    expect(ttl('999999')).toBe(86400);
    expect(ttl('1800')).toBe(1800);
    expect(ttl('abc')).toBe(TURN_TTL_DEFAULT_SECONDS);
    expect(ttl('-5')).toBe(TURN_TTL_DEFAULT_SECONDS);
  });

  it('mints the TURN REST pair: "<expiry>:label" and base64(HMAC-SHA1(secret, username))', () => {
    const s = mintTurnCredential(cfg, 1_700_000_000_000);
    expect(s.urls).toEqual(cfg.urls);
    expect(s.username).toBe('1700000600:cardmajlis');
    expect(s.credential).toBe(createHmac('sha1', 's3cret').update('1700000600:cardmajlis').digest('base64'));
    // The secret itself is never part of what the browser receives.
    expect(JSON.stringify(s)).not.toContain('s3cret');
  });

  it('a later request gets a different credential; the old one simply expires', () => {
    expect(mintTurnCredential(cfg, 1_000_000).credential).not.toBe(mintTurnCredential(cfg, 2_000_000).credential);
  });

  it('configured → appended to the served list, mode turn_configured, secret not served', () => {
    process.env.VOICE_TURN_URLS = 'turn:t.example.com:3478';
    process.env.VOICE_TURN_SECRET = 'top-secret-value';
    const servers = configuredIceServers(1_700_000_000_000);
    expect(servers[0]).toEqual(DEFAULT_ICE_SERVERS[0]);
    expect(servers[1].username).toBe(`${1_700_000_000 + TURN_TTL_DEFAULT_SECONDS}:cardmajlis`);
    expect(iceMode(servers)).toBe('turn_configured');
    expect(JSON.stringify(iceConfigPayload())).not.toContain('top-secret-value');
    expect(JSON.stringify(redactIceServers(servers))).not.toContain(servers[1].credential as string);
  });

  it('not configured → exactly the previous behaviour', () => {
    expect(configuredIceServers()).toEqual(DEFAULT_ICE_SERVERS);
  });
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
