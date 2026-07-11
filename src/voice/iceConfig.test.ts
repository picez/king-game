import { describe, it, expect } from 'vitest';
import { parseIceServers, redactIceServers, DEFAULT_ICE_SERVERS } from './iceConfig';

describe('parseIceServers — STUN-only default, env override', () => {
  it('falls back to the Google STUN default when unset / empty / whitespace', () => {
    for (const raw of [undefined, null, '', '   ']) {
      expect(parseIceServers(raw)).toEqual(DEFAULT_ICE_SERVERS);
      expect(parseIceServers(raw)[0].urls).toBe('stun:stun.l.google.com:19302');
    }
  });

  it('falls back on malformed JSON / non-array / no valid entries', () => {
    for (const raw of ['not json', '{}', '42', '[]', '[{"urls":"http://evil"}]', '[{"foo":1}]']) {
      expect(parseIceServers(raw)).toEqual(DEFAULT_ICE_SERVERS);
    }
  });

  it('accepts a custom STUN server (string or array urls)', () => {
    expect(parseIceServers('[{"urls":"stun:stun.example.com:3478"}]'))
      .toEqual([{ urls: 'stun:stun.example.com:3478' }]);
    expect(parseIceServers('[{"urls":["stun:a.example:3478","turns:b.example:5349"]}]'))
      .toEqual([{ urls: ['stun:a.example:3478', 'turns:b.example:5349'] }]);
  });

  it('accepts a TURN server WITH credentials from the env (never committed) and keeps them for the browser', () => {
    const raw = '[{"urls":"turn:turn.example.com:3478","username":"u","credential":"secret"}]';
    expect(parseIceServers(raw)).toEqual([
      { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'secret' },
    ]);
  });

  it('drops entries whose urls are missing / not a stun|turn scheme', () => {
    const raw = '[{"urls":"ftp://x"},{"urls":"stun:ok:3478"},{"urls":[]}]';
    expect(parseIceServers(raw)).toEqual([{ urls: 'stun:ok:3478' }]);
  });
});

describe('redactIceServers — diagnostics/log safety', () => {
  it('exposes only urls + a hasCredential boolean, NEVER the secret', () => {
    const servers = parseIceServers('[{"urls":"turn:t:3478","username":"u","credential":"secret"}]');
    const redacted = redactIceServers(servers);
    expect(redacted).toEqual([{ urls: 'turn:t:3478', hasCredential: true }]);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('"username"');
    expect(serialized).not.toContain('"credential"');
  });

  it('reports hasCredential:false for a plain STUN server', () => {
    expect(redactIceServers(DEFAULT_ICE_SERVERS)).toEqual([
      { urls: 'stun:stun.l.google.com:19302', hasCredential: false },
    ]);
  });
});
