import { describe, it, expect, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../../server/api';

// Verifies the HTTP API degrades gracefully with NO database: every /api/* route
// returns a clean 503 and never throws, so the server/lobby/local/guest-online
// paths are unaffected. No driver is loaded (repos are imported only when DB-on).

interface Captured { status: number; headers: Record<string, string>; body: unknown; }

function mockReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method, url, headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

function mockRes(): { res: ServerResponse; out: Captured } {
  const out: Captured = { status: 0, headers: {}, body: undefined };
  const res = {
    headersSent: false,
    setHeader: () => {},
    writeHead(status: number, headers: Record<string, string> = {}) { out.status = status; out.headers = headers; this.headersSent = true; return this; },
    end(body?: string) { if (body) { try { out.body = JSON.parse(body); } catch { out.body = body; } } },
  } as unknown as ServerResponse;
  return { res, out };
}

describe('HTTP API with no DATABASE_URL', () => {
  beforeEach(() => { delete process.env.DATABASE_URL; });

  it('returns 503 db_disabled for a read route (GET /api/me)', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('GET', '/api/me'), res);
    expect(out.status).toBe(503);
    expect((out.body as { error: string }).error).toBe('db_disabled');
  });

  it('returns 503 for a mutating route before any CSRF/DB work (POST /api/guest-session)', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('POST', '/api/guest-session'), res);
    expect(out.status).toBe(503);
    expect((out.body as { error: string }).error).toBe('db_disabled');
  });

  it('answers CORS preflight (OPTIONS) with 204 even without a DB', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('OPTIONS', '/api/settings'), res);
    expect(out.status).toBe(204);
  });

  it('returns 503 oauth_disabled for the Google scaffold routes', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('GET', '/auth/google/start'), res);
    expect(out.status).toBe(503);
    expect((out.body as { error: string }).error).toBe('oauth_disabled');
  });

  it('serves the STATIC game catalog (GET /api/games) even with no DB', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('GET', '/api/games'), res);
    expect(out.status).toBe(200);
    const body = out.body as { games: { id: string; supportsOnline: boolean }[] };
    expect(Array.isArray(body.games)).toBe(true);
    expect(body.games.map((g) => g.id)).toEqual(['king']);
    expect(body.games[0].supportsOnline).toBe(true);
    // Public shape only — no internal fields leak.
    expect('rulesDoc' in body.games[0]).toBe(false);
  });
});
