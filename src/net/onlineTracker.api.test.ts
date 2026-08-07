// ---------------------------------------------------------------------------
// Stage 38.0.6 — routing, auth and privacy for GET /api/me/online-tracker.
//
// The DB-backed round-trips live in onlineTracker.integration.test.ts; this file needs
// no database and pins the guards a leak would have to get past.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../../server/api';
import { buildOnlineTracker, TRACKED_ONLINE_GAMES } from './onlineTracker';

interface Captured { status: number; body: unknown; raw: string }
function mockReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method, url, headers, socket: { remoteAddress: '127.0.0.1' }, on: () => {} } as unknown as IncomingMessage;
}
function mockRes(): { res: ServerResponse; out: Captured } {
  const out: Captured = { status: 0, body: undefined, raw: '' };
  const res = {
    headersSent: false,
    setHeader: () => {},
    writeHead(status: number) { out.status = status; this.headersSent = true; return this; },
    end(body?: unknown) {
      if (body !== undefined) {
        out.raw = String(body);
        try { out.body = JSON.parse(out.raw); } catch { out.body = body; }
      }
    },
  } as unknown as ServerResponse;
  return { res, out };
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('routing + availability', () => {
  beforeEach(() => { delete process.env.DATABASE_URL; });

  it('GET with no database → the API-wide 503, never a crash and never fake zeros', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('GET', '/api/me/online-tracker'), res);
    expect(out.status).toBe(503);
    // The SAME code every other /api route returns without a database — one consistent
    // answer instead of a route-specific one.
    expect((out.body as { error: string }).error).toBe('db_disabled');
    // An empty matrix would be a LIE ("you have played nothing") — it must not be sent.
    expect(out.raw).not.toContain('byGame');
  });

  it('a transient Postgres failure is mapped by the shared catch, not swallowed', () => {
    const api = read('server/api.ts');
    // The route sits INSIDE the try block whose catch turns a DB error into a 503, so a
    // Postgres hiccup can never surface as a crash or as an empty (all-zero) matrix.
    const tryAt = api.indexOf('// Public (session-optional) routes.');
    const routeAt = api.indexOf("path === '/api/me/online-tracker'");
    const catchAt = api.indexOf('} catch (err) {', tryAt);
    expect(tryAt).toBeGreaterThan(-1);
    expect(routeAt).toBeGreaterThan(tryAt);
    expect(routeAt).toBeLessThan(catchAt);
    expect(api.slice(catchAt, catchAt + 900)).toContain('json(res, 503, { error: code, message }');
  });

  it('a non-GET method is not routed here', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const { res, out } = mockRes();
      await handleApiRequest(mockReq(method, '/api/me/online-tracker', { origin: 'http://localhost:5173' }), res);
      expect([403, 404, 503], method).toContain(out.status);
      expect(out.raw, method).not.toContain('byGame');
    }
  });

  it('the route exists exactly once and is gated on a session', () => {
    const api = read('server/api.ts');
    expect((api.match(/'\/api\/me\/online-tracker'/g) ?? []).length).toBe(1);
    expect(api).toMatch(/path === '\/api\/me\/online-tracker' && method === 'GET'[\s\S]{0,320}requireUser\(\)/);
    // No route-local availability code — the API-wide gate owns that answer.
    expect(api).not.toContain("error: 'tracker_unavailable'");
  });
});

describe('the account can only ever be the session owner', () => {
  const api = read('server/api.ts');
  const handler = api.slice(api.indexOf('async function handleGetOnlineTracker'), api.indexOf('* Public per-game leaderboard'));

  it('the handler takes its userId as a parameter and reads nothing from the request', () => {
    expect(handler).toContain('userId: string');
    expect(handler).toContain('getOnlineParticipationCounters(userId)');
    // No query string, no body, no header is consulted for identity.
    expect(handler).not.toMatch(/req\.url|parseUrl|searchParams|readBody|req\.headers\[/);
  });

  it('the router resolves the account through requireUser (the session cookie)', () => {
    const route = api.slice(api.indexOf("path === '/api/me/online-tracker'"), api.indexOf('// Poker chip wallet (Stage 37.7)'));
    expect(route).toContain('const u = await requireUser();');
    expect(route).toContain('handleGetOnlineTracker(req, res, u)');
    // requireUser answers 401 when there is no session.
    expect(api).toMatch(/const requireUser[\s\S]{0,320}401[\s\S]{0,80}unauthenticated/);
  });

  it('the repository query is scoped to that one account', () => {
    const repo = read('server/db/onlineMatches.ts');
    const fn = repo.slice(repo.indexOf('export async function getOnlineParticipationCounters'));
    expect(fn).toContain('eq(onlineMatchParticipants.userId, userId)');
    expect(fn).toContain("eq(onlineMatchParticipants.memberType, 'human')");
    // Only terminal outcomes, and only the tracked (non-Poker) games.
    expect(fn).toMatch(/inArray\(onlineMatchParticipants\.outcome, \['win', 'loss', 'draw'\]\)/);
    expect(fn).toContain('inArray(onlineMatches.gameType, [...TRACKED_ONLINE_GAMES])');
    expect(fn).not.toMatch(/count\(\*\)::int`,\s*\n\s*wins[\s\S]*?filter \(where .*outcome.* = 'pending'/);
  });
});

describe('the response body carries counters and nothing else', () => {
  it('a fully populated matrix serializes with no identifying field', () => {
    const tracker = buildOnlineTracker(TRACKED_ONLINE_GAMES.flatMap((g) => ([
      { gameType: g, category: 'human_only', wins: 3, losses: 2, draws: 1, forfeits: 1 },
      { gameType: g, category: 'with_bots', wins: 1, losses: 1, draws: 0, forfeits: 0 },
    ])));
    const raw = JSON.stringify({ tracker });

    for (const forbidden of ['userId', 'user_id', 'matchId', 'match_id', 'roomCode', 'room_code',
      'seatIndex', 'seat_index', 'memberType', 'displayName', 'avatar', 'email', 'opponent']) {
      expect(raw, forbidden).not.toContain(forbidden);
    }
    // Only the known counter keys appear anywhere in the payload.
    const keys = new Set<string>();
    JSON.parse(raw, function collect(k) { if (k) keys.add(k); return undefined; });
    const walk = (v: unknown): void => {
      if (v && typeof v === 'object') {
        for (const [k, child] of Object.entries(v)) { keys.add(k); walk(child); }
      }
    };
    walk({ tracker });
    const allowed = new Set<string>([
      'tracker', 'overall', 'byGame', 'human_only', 'with_bots',
      'matches', 'wins', 'losses', 'draws', 'forfeits', 'winRate',
      ...TRACKED_ONLINE_GAMES,
    ]);
    for (const k of keys) expect(allowed.has(k), `unexpected key: ${k}`).toBe(true);
  });

  it('Poker is absent from the serialized payload', () => {
    const raw = JSON.stringify({ tracker: buildOnlineTracker([{ gameType: 'poker', category: 'human_only', wins: 9, losses: 9, draws: 0, forfeits: 0 }]) });
    expect(raw).not.toContain('poker');
    expect(JSON.parse(raw).tracker.overall.human_only.matches).toBe(0);
  });
});

describe('the tracker touches no other stats model', () => {
  const repo = read('server/db/onlineMatches.ts');
  const api = read('server/api.ts');
  const handler = api.slice(api.indexOf('async function handleGetOnlineTracker'), api.indexOf('* Public per-game leaderboard'));

  it('it reads only the two online-match tables', () => {
    const fn = repo.slice(repo.indexOf('export async function getOnlineParticipationCounters'));
    expect(fn).toContain('onlineMatchParticipants');
    expect(fn).toContain('onlineMatches');
    for (const legacy of ['userStats', 'user_stats', 'gamePlayers', 'game_players', 'rounds']) {
      expect(fn, legacy).not.toContain(legacy);
    }
  });

  it('the handler writes nothing and reads no legacy stats module', () => {
    expect(handler).not.toMatch(/insert|update|delete|rebuildUserStats/i);
    expect(handler).not.toMatch(/db\/stats|db\/pokerStats|db\/durakStats/);
  });

  it('the existing stats/leaderboard/achievement routes are untouched', () => {
    for (const route of ['/api/games/king/stats', '/api/games/poker/stats', '/api/games/king/leaderboard']) {
      expect(api, route).toContain(`path === '${route}'`);
    }
  });
});
