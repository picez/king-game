import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_HTTP_RATE_LIMITS, HttpIpRateLimiter, httpLimitKind, isPrivateIp } from './httpRateLimit';

describe('httpLimitKind', () => {
  it('limits every /auth/* request and only MUTATING /api/* requests', () => {
    expect(httpLimitKind('GET', '/auth/google/start')).toBe('auth');
    expect(httpLimitKind('GET', '/auth/google/callback')).toBe('auth');
    expect(httpLimitKind('POST', '/api/me/settings')).toBe('mutation');
    expect(httpLimitKind('put', '/api/me/settings')).toBe('mutation');
    expect(httpLimitKind('DELETE', '/api/me/avatar')).toBe('mutation');
    expect(httpLimitKind('GET', '/api/me')).toBeNull();
    expect(httpLimitKind('OPTIONS', '/api/me/settings')).toBeNull();
    expect(httpLimitKind('POST', '/health')).toBeNull();
    expect(httpLimitKind('POST', '/apiary')).toBeNull();
  });
});

describe('isPrivateIp', () => {
  it('recognises proxy-range peers, and only those', () => {
    for (const ip of ['10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.1', '::ffff:10.0.0.7', '169.254.1.1', 'fd12:3456::1', 'fe80::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '::ffff:93.184.216.34', '2a00:1450::1']) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe('HttpIpRateLimiter', () => {
  it('allows the burst, then 429s with a Retry-After, then refills', () => {
    const lim = new HttpIpRateLimiter();
    const { capacity, refillPerSec } = DEFAULT_HTTP_RATE_LIMITS.auth;
    for (let i = 0; i < capacity; i++) expect(lim.check('1.2.3.4', 'auth', 0).ok).toBe(true);
    const denied = lim.check('1.2.3.4', 'auth', 0);
    expect(denied).toEqual({ ok: false, retryAfterSec: Math.ceil(1 / refillPerSec) });
    expect(lim.check('1.2.3.4', 'auth', 1000 / refillPerSec).ok).toBe(true);
  });

  it('keeps IPs and kinds independent', () => {
    const lim = new HttpIpRateLimiter({ auth: { capacity: 1, refillPerSec: 1 }, mutation: { capacity: 1, refillPerSec: 1 } });
    expect(lim.check('a', 'auth', 0).ok).toBe(true);
    expect(lim.check('a', 'auth', 0).ok).toBe(false);
    expect(lim.check('a', 'mutation', 0).ok).toBe(true);
    expect(lim.check('b', 'auth', 0).ok).toBe(true);
  });

  it('forgets idle IPs and stays bounded under a spray of addresses', () => {
    const lim = new HttpIpRateLimiter();
    lim.check('x', 'mutation', 0);
    lim.sweep(60_000);
    expect(lim.size).toBe(0);
    for (let i = 0; i < 10_050; i++) lim.check(`10.0.${i >> 8}.${i & 255}`, 'auth', 0);
    expect(lim.size).toBeLessThanOrEqual(10_000);
  });
});

describe('server wiring', () => {
  it('checks the limiter BEFORE handing /api and /auth to the handler, answering 429', () => {
    const src = readFileSync(join(process.cwd(), 'server/index.ts'), 'utf8');
    const gate = src.indexOf('httpLimitKind(req.method, path)');
    const handler = src.indexOf('void handleApiRequest(req, res)');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(handler);
    expect(src).toContain("'retry-after'");
    expect(src.slice(gate, handler)).toContain('429');
    // Behind an untrusted proxy every player shares one peer address — never limit that.
    expect(src.slice(gate, handler)).toContain('!TRUST_PROXY && isPrivateIp(ip)');
  });
});
