// S3 — ranked solitaire: tokens, the result checks (no DB), and the full flow
// on Postgres (skipped unless TEST_DATABASE_URL is set, like the other DB suites).
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeToken, readToken, handleSolitaireRoutes, resetSolitaireRate } from '../../server/solitaire';
import { MIN_MS_PER_MOVE, parseResultBody, rankedMs } from '../solitaire/ranked';
import { engineFor } from '../solitaire/registry';
import type { Move, VariantKey } from '../solitaire/engine';
import { dailySeed, utcDay } from '../solitaire/daily';
import type { RouteHelpers } from '../../server/admin/routes';

/** Greedy hint play until a win: a real winning move list for some seed. */
function winningGame(key: VariantKey): { seed: number; moves: Move[] } {
  const e = engineFor(key);
  for (let seed = 1; seed < 500; seed++) {
    let s = e.deal(seed);
    const moves: Move[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 3000 && !e.won(s); i++) {
      const m = e.canAutoFinish(s) ? e.finishStep(s) : e.hint(s);
      if (!m) break;
      const next = e.apply(s, m)!;
      const k = JSON.stringify(next);
      if (seen.has(k)) break;
      seen.add(k);
      s = next;
      moves.push(m);
    }
    if (e.won(s)) return { seed, moves };
  }
  throw new Error('no greedy win found');
}

interface Reply { status: number; body: Record<string, unknown> }
function helpers(path: string, method: string, user: string | null, body: unknown = {}, query = ''): { h: RouteHelpers; reply: Promise<Reply> } {
  let resolve!: (r: Reply) => void;
  const reply = new Promise<Reply>((r) => { resolve = r; });
  const h = {
    req: {} as never, res: {} as never, path, method,
    query: new URLSearchParams(query),
    json: (status: number, b: unknown) => resolve({ status, body: b as Record<string, unknown> }),
    readBody: async () => JSON.parse(JSON.stringify(body)) as Record<string, unknown>,
    resolveUserId: async () => user,
  } as RouteHelpers;
  return { h, reply };
}
async function call(path: string, method: string, user: string | null, body: unknown = {}, query = ''): Promise<Reply> {
  const { h, reply } = helpers(path, method, user, body, query);
  expect(await handleSolitaireRoutes(h)).toBe(true);
  return reply;
}

describe('tokens and checks', () => {
  it('a token round-trips, a tampered or expired one is refused', () => {
    const p = { u: 'user-1', v: 'klondike-1' as const, s: 42, d: null, t: Date.now() };
    const tok = makeToken(p);
    expect(readToken(tok)).toEqual(p);
    const [body, mac] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ ...p, s: 43 })).toString('base64url');
    expect(readToken(`${forged}.${mac}`)).toBeNull();
    expect(readToken(`${body}.x${mac.slice(1)}`)).toBeNull();
    expect(readToken(tok, p.t + 4 * 24 * 3600_000)).toBeNull();
    expect(readToken('nonsense')).toBeNull();
  });

  it('ranked time is the server wall clock with a per-move floor', () => {
    expect(rankedMs(1000, 61_000, 100)).toEqual({ ok: true, ms: 60_000 });
    expect(rankedMs(1000, 1000 + 99 * MIN_MS_PER_MOVE, 100)).toEqual({ ok: false });
  });

  it('result bodies are shape-checked', () => {
    expect(parseResultBody({ token: 't', moves: [{ t: 'stock' }], undos: 1, hints: -3, elapsedMs: 5 })).toEqual({ token: 't', moves: [{ t: 'stock' }], undos: 1, hints: 0, elapsedMs: 5 });
    expect(parseResultBody({ token: 't', moves: [] })).toBeNull();
    expect(parseResultBody({ token: 't', moves: [{ t: 'stock', evil: 1 }] })).toBeNull();
    expect(parseResultBody({ token: 5, moves: [{ t: 'stock' }] })).toBeNull();
  });
});

describe('routes without a database', () => {
  beforeAll(() => resetSolitaireRate());

  it('ignores other paths; needs a session to start or submit', async () => {
    const { h } = helpers('/api/me', 'GET', 'u');
    expect(await handleSolitaireRoutes(h)).toBe(false);
    expect((await call('/api/solitaire/start', 'POST', null, { variant: 'freecell' })).status).toBe(401);
    expect((await call('/api/solitaire/leaderboard', 'GET', null, {}, 'variant=nope&board=time')).status).toBe(400);
  });

  it('start hands out a signed seed; the daily seed is the shared one', async () => {
    const r = await call('/api/solitaire/start', 'POST', 'u1', { variant: 'spider-2', daily: true });
    expect(r.status).toBe(200);
    expect(r.body.seed).toBe(dailySeed('spider-2', utcDay()));
    expect(readToken(String(r.body.token))?.u).toBe('u1');
    expect((await call('/api/solitaire/start', 'POST', 'u1', { variant: 'bogus' })).status).toBe(400);
  });

  it('refuses a foreign token, an illegal move, a lost game and a too-fast win', async () => {
    const win = winningGame('tripeaks');
    const now = Date.now();
    const tok = (u: string, t = now - 600_000) => makeToken({ u, v: 'tripeaks', s: win.seed, d: null, t });
    const body = (token: string, moves: Move[]) => ({ token, moves, undos: 0, hints: 0, elapsedMs: 1000 });
    expect((await call('/api/solitaire/result', 'POST', 'me', body(tok('someone-else'), win.moves))).status).toBe(403);
    const bad = await call('/api/solitaire/result', 'POST', 'me', body(tok('me'), [{ t: 'remove', ids: [999] }]));
    expect(bad).toMatchObject({ status: 422, body: { error: 'illegal_move', at: 0 } });
    expect((await call('/api/solitaire/result', 'POST', 'me', body(tok('me'), win.moves.slice(0, -1)))).body.error).toBe('not_won');
    expect((await call('/api/solitaire/result', 'POST', 'me', body(tok('me', now), win.moves))).body.error).toBe('too_fast');
  });

  it('is wired into the API, the merge and the migration', () => {
    expect(readFileSync('server/api.ts', 'utf8')).toContain('if (await handleSolitaireRoutes(h)) return;');
    expect(readFileSync('server/db/merge.ts', 'utf8')).toContain('UPDATE solitaire_results SET user_id');
    const mig = readFileSync('server/db/migrations/0016_solitaire.sql', 'utf8');
    expect(mig).toContain('solitaire_results_daily_once');
    expect(mig).toContain('solitaire_results_seed_once');
  });
});

const URL_ = process.env.TEST_DATABASE_URL;

describe.skipIf(!URL_)('ranked solitaire on Postgres (S3)', () => {
  let a = '';
  let b = '';
  beforeAll(async () => {
    process.env.DATABASE_URL = URL_;
    resetSolitaireRate();
    const users = await import('../../server/db/users');
    a = await users.createAccountUser({ email: null, name: `SOL-A-${Date.now()}`, emailVerified: false });
    b = await users.createAccountUser({ email: null, name: `SOL-B-${Date.now()}`, emailVerified: false });
  });

  it('records a verified win once, ranks it and lists it', async () => {
    const win = winningGame('tripeaks');
    const body = (u: string, t: number) => ({ token: makeToken({ u, v: 'tripeaks', s: win.seed, d: null, t }), moves: win.moves, undos: 0, hints: 0, elapsedMs: 1 });
    const ok = await call('/api/solitaire/result', 'POST', a, body(a, Date.now() - 120_000));
    expect(ok.status).toBe(201);
    expect(Number(ok.body.ms)).toBeGreaterThanOrEqual(120_000);
    expect((await call('/api/solitaire/result', 'POST', a, body(a, Date.now() - 120_000))).status).toBe(409);
    const slower = await call('/api/solitaire/result', 'POST', b, body(b, Date.now() - 300_000));
    expect(slower.status).toBe(201);

    const lb = await call('/api/solitaire/leaderboard', 'GET', b, {}, 'variant=tripeaks&board=time');
    const rows = lb.body.rows as Array<{ rank: number; self: boolean; value: number }>;
    const ia = rows.findIndex((r) => !r.self && r.value < 200_000);
    const ib = rows.findIndex((r) => r.self);
    expect(ib).toBeGreaterThan(ia);
    expect((lb.body.me as { self: boolean }).self).toBe(true);
    const wins = await call('/api/solitaire/leaderboard', 'GET', null, {}, 'variant=tripeaks&board=wins');
    expect((wins.body.rows as unknown[]).length).toBeGreaterThan(0);
  });

  it('the deal of the day counts once per player', async () => {
    const day = utcDay();
    const e = engineFor('tripeaks');
    // Only a daily seed that greedy play wins can be used; skip quietly otherwise.
    let s = e.deal(dailySeed('tripeaks', day));
    const moves: Move[] = [];
    for (let i = 0; i < 400 && !e.won(s); i++) { const m = e.hint(s); if (!m) break; s = e.apply(s, m)!; moves.push(m); }
    if (!e.won(s)) return;
    const tok = makeToken({ u: a, v: 'tripeaks', s: dailySeed('tripeaks', day), d: day, t: Date.now() - 100_000 });
    expect((await call('/api/solitaire/result', 'POST', a, { token: tok, moves, undos: 0, hints: 0, elapsedMs: 1 })).status).toBe(201);
    expect((await call('/api/solitaire/result', 'POST', a, { token: tok, moves, undos: 0, hints: 0, elapsedMs: 1 })).status).toBe(409);
    const lb = await call('/api/solitaire/leaderboard', 'GET', a, {}, `variant=tripeaks&board=daily&day=${day}`);
    expect((lb.body.me as { rank: number }).rank).toBeGreaterThan(0);
  });

  it('guest wins follow the player into the account; a duplicate keeps the account result', async () => {
    const users = await import('../../server/db/users');
    const { mergeGuestInto } = await import('../../server/db/merge');
    const guest = (await users.getOrCreateGuest(`sol-guest-${Date.now()}`)).id;
    const target = await users.createAccountUser({ email: null, name: `SOL-T-${Date.now()}`, emailVerified: false });
    const win = winningGame('tripeaks');
    const submit = (u: string, seed: number) => call('/api/solitaire/result', 'POST', u, {
      token: makeToken({ u, v: 'tripeaks', s: seed, d: null, t: Date.now() - 90_000 }), moves: win.moves, undos: 0, hints: 0, elapsedMs: 1,
    });
    // Same deal for both (the account keeps its own), plus a FreeCell win only the guest has.
    expect((await submit(target, win.seed)).status).toBe(201);
    expect((await submit(guest, win.seed)).status).toBe(201);
    const db = (await (await import('../../server/db/client')).getDb())!.sql as unknown as import('postgres').Sql;
    await db`INSERT INTO solitaire_results (user_id, variant, seed, moves, duration_ms) VALUES (${guest}, 'freecell', 7, 90, 300000)`;
    expect((await mergeGuestInto(guest, target)).merged).toBe(true);
    const rows = await db`SELECT user_id, variant FROM solitaire_results WHERE user_id IN (${guest}, ${target}) ORDER BY variant`;
    expect(rows.map((r) => [r.user_id === target, r.variant])).toEqual([[true, 'freecell'], [true, 'tripeaks']]);
  });

  it('admin: summary, list and a logged removal', async () => {
    const store = await import('../../server/admin/store');
    const sum = await store.solitaireSummary();
    expect(sum.find((x) => x.variant === 'tripeaks')?.wins).toBeGreaterThan(0);
    const list = await store.listSolitaire(0, 'tripeaks');
    expect(list.total).toBeGreaterThan(0);
    const victim = list.rows[0];
    const actor = { id: a, label: 'test-admin' };
    await store.deleteSolitaireResult(actor, victim.id, 'solver suspected');
    expect((await store.listSolitaire(0, 'tripeaks')).total).toBe(list.total - 1);
    await expect(store.deleteSolitaireResult(actor, victim.id, 'again')).rejects.toMatchObject({ code: 'not_found' });
    const db = (await (await import('../../server/db/client')).getDb())!.sql as unknown as import('postgres').Sql;
    const log = await db`SELECT kind, details FROM admin_actions WHERE kind = 'solitaire_delete' ORDER BY at DESC LIMIT 1`;
    expect(log[0]?.kind).toBe('solitaire_delete');
  });
});

