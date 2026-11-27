// ---------------------------------------------------------------------------
// Ranked solitaire (Stage S3): start tokens, server-replayed results and the
// leaderboards. Contract: src/solitaire/ranked.ts. The engines are the very
// same pure modules the browser runs (src/solitaire/*).
// ---------------------------------------------------------------------------

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Sql } from 'postgres';
import { isVariantKey, replay, type Move, type VariantKey } from '../src/solitaire/engine';
import { engineFor } from '../src/solitaire/registry';
import { dailySeed, isUtcDay, utcDay } from '../src/solitaire/daily';
import {
  TOKEN_TTL_MS, isLeaderBoard, isTokenPayload, parseResultBody, rankedMs,
  type LeaderBoard, type LeaderRow, type LeaderboardResponse, type StartResponse, type TokenPayload,
} from '../src/solitaire/ranked';
import type { RouteHelpers } from './admin/routes';

// ── tokens ──────────────────────────────────────────────────────────────────

function secret(): string {
  return `solitaire:${process.env.SESSION_SECRET ?? 'dev-only-secret'}`;
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

export function makeToken(p: TokenPayload): string {
  const body = b64(JSON.stringify(p));
  return `${body}.${sign(body)}`;
}

export function readToken(token: string, now = Date.now()): TokenPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let p: unknown;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!isTokenPayload(p)) return null;
  if (now - p.t > TOKEN_TTL_MS || p.t - now > 60_000) return null;
  return p;
}

// ── rate limit (per user) ───────────────────────────────────────────────────

const hits = new Map<string, number[]>();
function rateOk(key: string, max: number, now = Date.now()): boolean {
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
  return true;
}
export function resetSolitaireRate(): void { hits.clear(); }

// ── store ───────────────────────────────────────────────────────────────────

async function sql(): Promise<Sql> {
  const { getDb } = await import('./db/client');
  const conn = await getDb();
  if (!conn) throw new Error('solitaire requires DATABASE_URL');
  return conn.sql as unknown as Sql;
}

const num = (v: unknown) => Number(v ?? 0) || 0;

async function leaderboard(variant: VariantKey, board: LeaderBoard, day: string | null, self: string | null): Promise<LeaderboardResponse> {
  const s = await sql();
  // One row per player (their best game, or their win count), then ranked.
  const best = board === 'wins'
    ? s`SELECT user_id, count(*)::int AS value, NULL::int AS moves, NULL::int AS ms, min(created_at) AS at
        FROM solitaire_results WHERE variant = ${variant} GROUP BY user_id`
    : board === 'moves'
      ? s`SELECT DISTINCT ON (user_id) user_id, moves AS value, moves, duration_ms AS ms, created_at AS at
          FROM solitaire_results WHERE variant = ${variant} ORDER BY user_id, moves, duration_ms, created_at`
      : board === 'daily'
        ? s`SELECT user_id, duration_ms AS value, moves, duration_ms AS ms, created_at AS at
            FROM solitaire_results WHERE variant = ${variant} AND daily = ${day}::date`
        : s`SELECT DISTINCT ON (user_id) user_id, duration_ms AS value, moves, duration_ms AS ms, created_at AS at
            FROM solitaire_results WHERE variant = ${variant} ORDER BY user_id, duration_ms, moves, created_at`;
  const order = board === 'wins' ? s`value DESC, at ASC`
    : board === 'moves' ? s`value ASC, ms ASC, at ASC`
      : s`value ASC, moves ASC, at ASC`;
  const rows = await s`
    WITH r AS (${best}),
    n AS (SELECT r.*, row_number() OVER (ORDER BY ${order}) AS rank FROM r)
    SELECT n.rank, n.value, n.moves, n.ms, n.user_id, u.display_name, st.avatar
    FROM n JOIN users u ON u.id = n.user_id LEFT JOIN user_settings st ON st.user_id = n.user_id
    WHERE u.deleted_at IS NULL AND (n.rank <= 20 OR n.user_id = ${self})
    ORDER BY n.rank`;
  const map = (r: Record<string, unknown>): LeaderRow => ({
    rank: num(r.rank), value: num(r.value),
    moves: r.moves == null ? null : num(r.moves), ms: r.ms == null ? null : num(r.ms),
    displayName: String(r.display_name ?? '—'), avatar: (r.avatar as string | null) ?? null, self: self !== null && r.user_id === self,
  });
  const all = rows.map(map);
  return { variant, board, day, rows: all.filter((r) => r.rank <= 20), me: all.find((r) => r.self) ?? null };
}

/** A long Spider game is ~1500 moves × ~45 bytes. */
export const RESULT_MAX_BYTES = 256 * 1024;

// ── routes ──────────────────────────────────────────────────────────────────

/** /api/solitaire/*. Returns false when the path is not one of them. */
export async function handleSolitaireRoutes(h: RouteHelpers): Promise<boolean> {
  const { path, method } = h;
  if (!path.startsWith('/api/solitaire/')) return false;

  if (path === '/api/solitaire/leaderboard' && method === 'GET') {
    const variant = h.query.get('variant');
    const board = h.query.get('board') ?? 'time';
    const dayParam = h.query.get('day');
    if (!isVariantKey(variant) || !isLeaderBoard(board)) { h.json(400, { error: 'bad_request' }); return true; }
    const day = board === 'daily' ? (isUtcDay(dayParam) ? dayParam : utcDay()) : null;
    let self: string | null = null;
    try { self = await h.resolveUserId(); } catch { self = null; }
    h.json(200, await leaderboard(variant, board, day, self));
    return true;
  }

  const userId = await h.resolveUserId();
  if (!userId) { h.json(401, { error: 'unauthenticated' }); return true; }

  if (path === '/api/solitaire/start' && method === 'POST') {
    if (!rateOk(`start:${userId}`, 60)) { h.json(429, { error: 'rate_limited' }); return true; }
    const b = await h.readBody();
    if (!isVariantKey(b.variant)) { h.json(400, { error: 'bad_request' }); return true; }
    const daily = b.daily === true ? utcDay() : null;
    const seed = daily ? dailySeed(b.variant, daily) : randomInt(0, 0xffffffff);
    const out: StartResponse = { seed, daily, token: makeToken({ u: userId, v: b.variant, s: seed, d: daily, t: Date.now() }) };
    h.json(200, out);
    return true;
  }

  if (path === '/api/solitaire/result' && method === 'POST') {
    if (!rateOk(`result:${userId}`, 20)) { h.json(429, { error: 'rate_limited' }); return true; }
    // A full Spider game can carry a few thousand moves: allow a bigger body here.
    const body = parseResultBody(await h.readBody(RESULT_MAX_BYTES));
    if (!body) { h.json(400, { error: 'bad_request' }); return true; }
    const tok = readToken(body.token);
    if (!tok || tok.u !== userId) { h.json(403, { error: 'bad_token' }); return true; }
    const r = replay(engineFor(tok.v), tok.s, body.moves as Move[]);
    if (!r.ok) { h.json(422, { error: 'illegal_move', at: r.at }); return true; }
    if (!r.won) { h.json(422, { error: 'not_won' }); return true; }
    const time = rankedMs(tok.t, Date.now(), body.moves.length);
    if (!time.ok) { h.json(422, { error: 'too_fast' }); return true; }
    const s = await sql();
    const ins = await s`
      INSERT INTO solitaire_results (user_id, variant, seed, daily, moves, duration_ms, undos, hints)
      VALUES (${userId}, ${tok.v}, ${tok.s}, ${tok.d}::date, ${body.moves.length}, ${time.ms}, ${body.undos}, ${body.hints})
      ON CONFLICT DO NOTHING RETURNING id`;
    if (ins.length === 0) { h.json(409, { error: 'already_recorded', ms: time.ms }); return true; }
    const board: LeaderBoard = tok.d ? 'daily' : 'time';
    const lb = await leaderboard(tok.v, board, tok.d, userId);
    h.json(201, { ok: true, ms: time.ms, board, rank: lb.me?.rank ?? null });
    return true;
  }

  h.json(404, { error: 'not_found' });
  return true;
}
