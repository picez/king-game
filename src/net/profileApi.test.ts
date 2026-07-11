import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiBaseFromWsUrl, googleStartUrl, fetchMe } from './profileApi';

const resp = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchMe — classified probe (server-down vs sign-in-off vs signed-in)', () => {
  it('200 guest → reachable + auth available, identity present, not signed in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, { authenticated: false, user: null })));
    const p = await fetchMe('http://x');
    expect(p.serverReachable).toBe(true);
    expect(p.authAvailable).toBe(true);   // sign-in is possible here
    expect(p.me).toEqual({ authenticated: false, user: null });
    expect(p.status).toBe(200);
  });

  it('200 signed-in → identity carries the provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      resp(200, { authenticated: true, user: { id: 'u', isGuest: false }, provider: 'google', email: 'a@b.c' })));
    const p = await fetchMe('http://x');
    expect(p.authAvailable).toBe(true);
    expect(p.me?.provider).toBe('google');
  });

  it('503 db_disabled → server REACHABLE but sign-in NOT available (not a network fault)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(503, { error: 'db_disabled' })));
    const p = await fetchMe('http://x');
    expect(p.serverReachable).toBe(true);   // the origin answered
    expect(p.authAvailable).toBe(false);    // …but sign-in is off here
    expect(p.me).toBeNull();
    expect(p.status).toBe(503);
  });

  it('network / CORS failure → unreachable (status 0)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const p = await fetchMe('http://x');
    expect(p.serverReachable).toBe(false);
    expect(p.authAvailable).toBe(false);
    expect(p.status).toBe(0);
  });
});

describe('googleStartUrl', () => {
  it('points at the API /auth/google/start on the same origin', () => {
    expect(googleStartUrl('https://king.example.com')).toBe('https://king.example.com/auth/google/start');
    expect(googleStartUrl(apiBaseFromWsUrl('wss://king.example.com/ws'))).toBe('https://king.example.com/auth/google/start');
  });
});

describe('apiBaseFromWsUrl', () => {
  it('maps a wss WebSocket URL to an https API origin', () => {
    expect(apiBaseFromWsUrl('wss://king.example.com/ws')).toBe('https://king.example.com');
  });
  it('maps a ws LAN URL (with port + /ws path) to http origin keeping the port', () => {
    expect(apiBaseFromWsUrl('ws://192.168.1.20:3001/ws')).toBe('http://192.168.1.20:3001');
  });
  it('falls back to empty string for an unparseable URL with no window', () => {
    expect(apiBaseFromWsUrl('not a url')).toBe('');
  });
});
