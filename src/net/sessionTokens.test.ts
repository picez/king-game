import { describe, it, expect } from 'vitest';
// Server-only module (node:crypto). Tests run in the 'node' environment, so
// importing it here is fine and needs no database.
import {
  generateSessionToken, hashSessionToken, sessionTtlSeconds, hashIp,
} from '../../server/sessionTokens';

describe('session token generation', () => {
  it('produces a long, URL-safe, unique token each time', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet
  });
});

describe('hashSessionToken', () => {
  it('is deterministic for the same token + pepper, and verifiable', () => {
    const token = 'abc123';
    expect(hashSessionToken(token, 'secret')).toBe(hashSessionToken(token, 'secret'));
    // 64-hex SHA-256 output — never the plaintext token.
    expect(hashSessionToken(token, 'secret')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token, 'secret')).not.toContain(token);
  });
  it('changes with the pepper (SESSION_SECRET) and with the token', () => {
    expect(hashSessionToken('t', 'p1')).not.toBe(hashSessionToken('t', 'p2'));
    expect(hashSessionToken('t1', 'p')).not.toBe(hashSessionToken('t2', 'p'));
  });
});

describe('sessionTtlSeconds', () => {
  it('defaults to 30 days and honours a valid override (clamped)', () => {
    expect(sessionTtlSeconds({})).toBe(30 * 24 * 3600);
    expect(sessionTtlSeconds({ SESSION_TTL_DAYS: '7' })).toBe(7 * 24 * 3600);
    expect(sessionTtlSeconds({ SESSION_TTL_DAYS: '99999' })).toBe(365 * 24 * 3600);
    expect(sessionTtlSeconds({ SESSION_TTL_DAYS: 'nonsense' })).toBe(30 * 24 * 3600);
  });
});

describe('hashIp', () => {
  it('hashes (never stores) an IP and returns null for empty', () => {
    expect(hashIp(null)).toBeNull();
    expect(hashIp('1.2.3.4', 'p')).toMatch(/^[0-9a-f]{32}$/);
    expect(hashIp('1.2.3.4', 'p')).not.toContain('1.2.3.4');
  });
});
