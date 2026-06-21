import { describe, it, expect } from 'vitest';
import {
  SESSION_COOKIE, parseCookies, serializeCookie, sessionCookieOptions,
  isMutatingMethod, isOriginAllowed, resolveCookieSecure,
} from './cookies';

describe('parseCookies', () => {
  it('parses a multi-pair header and URL-decodes values', () => {
    expect(parseCookies('a=1; b=two; king_session=ab%3Dcd')).toEqual({ a: '1', b: 'two', king_session: 'ab=cd' });
  });
  it('is tolerant of empty/missing/garbage input', () => {
    expect(parseCookies(null)).toEqual({});
    expect(parseCookies('')).toEqual({});
    expect(parseCookies('novalue; =bad; ok=1')).toEqual({ ok: '1' });
  });
  it('strips surrounding quotes', () => {
    expect(parseCookies('x="quoted"')).toEqual({ x: 'quoted' });
  });
});

describe('serializeCookie', () => {
  it('emits httpOnly/secure/sameSite/path/max-age for a session cookie', () => {
    const s = serializeCookie(SESSION_COOKIE, 'tok en', sessionCookieOptions({ secure: true, maxAgeSec: 3600 }));
    expect(s).toContain('king_session=tok%20en');
    expect(s).toContain('HttpOnly');
    expect(s).toContain('Secure');
    expect(s).toContain('SameSite=Lax');
    expect(s).toContain('Path=/');
    expect(s).toContain('Max-Age=3600');
  });
  it('omits Secure in dev and emits a delete cookie at maxAge 0', () => {
    const dev = serializeCookie(SESSION_COOKIE, 't', sessionCookieOptions({ secure: false, maxAgeSec: 100 }));
    expect(dev).not.toContain('Secure');
    const del = serializeCookie(SESSION_COOKIE, '', sessionCookieOptions({ secure: true, maxAgeSec: 0 }));
    expect(del).toContain('Max-Age=0');
    expect(del).toContain('Expires=Thu, 01 Jan 1970');
  });
});

describe('resolveCookieSecure (dev vs production)', () => {
  it('defaults to secure only in production', () => {
    expect(resolveCookieSecure({ NODE_ENV: 'production' })).toBe(true);
    expect(resolveCookieSecure({ NODE_ENV: 'development' })).toBe(false);
    expect(resolveCookieSecure({})).toBe(false);
  });
  it('honours an explicit COOKIE_SECURE override', () => {
    expect(resolveCookieSecure({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toBe(false);
    expect(resolveCookieSecure({ NODE_ENV: 'development', COOKIE_SECURE: 'true' })).toBe(true);
  });
});

describe('isMutatingMethod', () => {
  it('flags state-changing verbs only', () => {
    for (const m of ['POST', 'put', 'PATCH', 'delete']) expect(isMutatingMethod(m)).toBe(true);
    for (const m of ['GET', 'head', 'OPTIONS', undefined]) expect(isMutatingMethod(m)).toBe(false);
  });
});

describe('isOriginAllowed (CSRF origin check)', () => {
  it('rejects a missing Origin on a mutation', () => {
    expect(isOriginAllowed(undefined, 'host:3001', [])).toBe(false);
  });
  it('with an allowlist, accepts only listed origins', () => {
    const allow = ['https://king.example.com'];
    expect(isOriginAllowed('https://king.example.com', 'king.example.com', allow)).toBe(true);
    expect(isOriginAllowed('https://evil.com', 'king.example.com', allow)).toBe(false);
  });
  it('with no allowlist (dev/LAN), accepts only same-origin (host match)', () => {
    expect(isOriginAllowed('http://localhost:3001', 'localhost:3001', [])).toBe(true);
    expect(isOriginAllowed('http://localhost:5173', 'localhost:3001', [])).toBe(false);
    expect(isOriginAllowed('not a url', 'localhost:3001', [])).toBe(false);
  });
});
