// ---------------------------------------------------------------------------
// Minimal HTTP API for profiles, settings, and guest sessions (Stage 4).
//
// Mounted on the SAME http.Server as /health, the static client, and the /ws
// WebSocket upgrade (server/index.ts) — one port, one service. This module owns
// only the /api/* and /auth/* surface; everything else is untouched.
//
// Hard guarantees that keep guest/local/online play working with NO database:
//   • When DATABASE_URL is unset (or the DB is unreachable) every /api/* route
//     returns a clean 503 `db_disabled` — the server, lobby, local mode, and
//     online guest rooms keep working exactly as before.
//   • The repositories (drizzle + pg driver) are imported DYNAMICALLY, only when
//     a DB IS configured, so a no-DB server never loads the driver.
//
// Auth model: opaque session token in an httpOnly cookie, hashed in the DB
// (revocable). CSRF = SameSite=Lax + an Origin check on mutations. No private
// game state is ever exposed here. See ARCHITECTURE_DB_AUTH.md §1.7/§5.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { isDbEnabled } from './db/client';
import {
  generateSessionToken, hashSessionToken, sessionTtlSeconds, hashIp,
} from './sessionTokens';
import {
  SESSION_COOKIE, parseCookies, serializeCookie, sessionCookieOptions,
  isMutatingMethod, isOriginAllowed, resolveCookieSecure,
} from '../src/net/cookies';
import { sanitizeGameSettings } from '../src/net/userSettings';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const KING = 'king';
const MAX_BODY_BYTES = 16 * 1024;

// ── tiny response helpers ───────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

/**
 * Credentialed CORS: cookies require a specific Allow-Origin (never `*`). We
 * echo the request Origin only when it is allowed (production allowlist) or,
 * in LAN/dev (no allowlist), when it matches the request Host — so the Vite dev
 * client (localhost:5173 → server :3001) can call the API without opening the
 * API to arbitrary sites. Returns the header bag (empty if not echoed).
 */
function corsHeaders(req: IncomingMessage): Record<string, string> {
  const origin = req.headers.origin;
  if (!origin) return {};
  const host = req.headers.host;
  if (!isOriginAllowed(origin, host, ALLOWED_ORIGINS)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  };
}

/** Reads + JSON-parses the request body (capped). Returns {} for empty/invalid. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) { aborted = true; resolve({}); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {});
      } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ── session helpers ─────────────────────────────────────────────────────────

function cookieSecure(): boolean {
  return resolveCookieSecure({ COOKIE_SECURE: process.env.COOKIE_SECURE, NODE_ENV: process.env.NODE_ENV });
}

function setSessionCookie(res: ServerResponse, token: string): void {
  const ttl = sessionTtlSeconds();
  res.setHeader('set-cookie', serializeCookie(
    SESSION_COOKIE, token, sessionCookieOptions({ secure: cookieSecure(), maxAgeSec: ttl }),
  ));
}

function clearSessionCookie(res: ServerResponse): void {
  res.setHeader('set-cookie', serializeCookie(
    SESSION_COOKIE, '', sessionCookieOptions({ secure: cookieSecure(), maxAgeSec: 0 }),
  ));
}

/** Resolves the current user id from the session cookie, or null. */
async function resolveUserId(req: IncomingMessage): Promise<string | null> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  const { findValidSession } = await import('./db/sessions');
  const session = await findValidSession(hashSessionToken(token), new Date());
  return session?.userId ?? null;
}

/**
 * DB-gated, never-throwing session resolver for the WebSocket layer (Stage 5).
 * The server reads the session cookie that rides the WS upgrade to NAME the
 * player for stats — it never trusts a client-sent userId. Returns null when no
 * DB is configured, the session is missing/invalid, or a DB hiccup occurs, so a
 * no-DB/cross-origin/guest connection simply has no attributed identity.
 */
export async function resolveSessionUserId(req: IncomingMessage): Promise<string | null> {
  if (!isDbEnabled()) return null;
  try {
    return await resolveUserId(req);
  } catch {
    return null;
  }
}

// ── route handlers ──────────────────────────────────────────────────────────

async function handleMe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const userId = await resolveUserId(req);
  if (!userId) return json(res, 200, { authenticated: false, user: null }, corsHeaders(req));
  const { getProfile } = await import('./db/users');
  const profile = await getProfile(userId);
  if (!profile) return json(res, 200, { authenticated: false, user: null }, corsHeaders(req));
  json(res, 200, { authenticated: true, user: publicUser(profile), settings: profile.settings }, corsHeaders(req));
}

/** Whitelist the user fields exposed to the client (no email/status/timestamps). */
function publicUser(p: { id: string; displayName: string | null; isGuest: boolean }): unknown {
  return { id: p.id, displayName: p.displayName, isGuest: p.isGuest };
}

async function handleGuestSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  // The guest device handle is a public lookup key from the client's
  // localStorage — NOT a credential. Generate one if the client has none yet.
  const guestKey = typeof body.guestKey === 'string' && body.guestKey.trim()
    ? body.guestKey.trim().slice(0, 64)
    : randomUUID();
  const { getOrCreateGuest, getProfile } = await import('./db/users');
  const user = await getOrCreateGuest(guestKey);

  const token = generateSessionToken();
  const { createSession } = await import('./db/sessions');
  const ttl = sessionTtlSeconds();
  await createSession({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + ttl * 1000),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 256) : null,
    ipHash: hashIp(clientIp(req)),
  });
  setSessionCookie(res, token);
  const profile = await getProfile(user.id);
  json(res, 200, {
    authenticated: true,
    guestKey,
    user: publicUser(user),
    settings: profile?.settings ?? null,
  }, corsHeaders(req));
}

async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) {
    const { revokeSession } = await import('./db/sessions');
    await revokeSession(hashSessionToken(token), new Date());
  }
  clearSessionCookie(res);
  json(res, 200, { ok: true }, corsHeaders(req));
}

async function handleGetSettings(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const { getProfile } = await import('./db/users');
  const profile = await getProfile(userId);
  if (!profile) return json(res, 404, { error: 'not_found' }, corsHeaders(req));
  json(res, 200, { settings: profile.settings }, corsHeaders(req));
}

async function handlePatchSettings(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const body = await readJsonBody(req);
  const { upsertGlobalSettings } = await import('./db/users');
  // upsertGlobalSettings validates/sanitises every field (bad lang/avatar dropped).
  const patch: Record<string, unknown> = {};
  if ('lang' in body) patch.lang = body.lang;
  if ('avatar' in body) patch.avatar = body.avatar;
  if ('cardStyle' in body) patch.cardStyle = body.cardStyle;
  const settings = await upsertGlobalSettings(userId, patch);
  json(res, 200, { settings }, corsHeaders(req));
}

async function handlePatchProfile(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const body = await readJsonBody(req);
  const { updateDisplayName, getProfile } = await import('./db/users');
  const displayName = await updateDisplayName(userId, body.displayName);
  const profile = await getProfile(userId);
  json(res, 200, { user: profile ? publicUser(profile) : { id: userId, displayName, isGuest: true } }, corsHeaders(req));
}

async function handleGetGameSettings(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const { getGameSettings } = await import('./db/users');
  json(res, 200, { gameType: KING, settings: await getGameSettings(userId, KING) }, corsHeaders(req));
}

async function handlePatchGameSettings(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const body = await readJsonBody(req);
  // Validate up front so an invalid timer is rejected with a clear 400 rather
  // than silently coerced — the repository also sanitises defensively.
  const clean = sanitizeGameSettings(KING, body);
  const { upsertGameSettings } = await import('./db/users');
  const settings = await upsertGameSettings(userId, KING, clean);
  json(res, 200, { gameType: KING, settings }, corsHeaders(req));
}

async function handleGetKingStats(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const { getUserStats } = await import('./db/stats');
  json(res, 200, { gameType: KING, stats: await getUserStats(userId, KING) }, corsHeaders(req));
}

/** Public per-game leaderboard (no session required — only public counters). */
async function handleGetKingLeaderboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { getLeaderboard } = await import('./db/stats');
  json(res, 200, { gameType: KING, leaderboard: await getLeaderboard(KING, 20) }, corsHeaders(req));
}

/** Google OAuth is staged: routes exist but return 503 until creds/flow land. */
function handleGoogleStub(req: IncomingMessage, res: ServerResponse): void {
  json(res, 503, {
    error: 'oauth_disabled',
    message: 'Google sign-in is not enabled yet (Stage 4 next substage). Set GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET and complete the OAuth flow.',
  }, corsHeaders(req));
}

function clientIp(req: IncomingMessage): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress ?? null;
}

// ── dispatcher ──────────────────────────────────────────────────────────────

/**
 * Routes one /api/* or /auth/* request. Always responds (never throws to the
 * caller). The server delegates here only for those path prefixes; /health,
 * static files, the SPA fallback, and the WS upgrade never reach this function.
 */
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '').split('?')[0];
  const method = (req.method ?? 'GET').toUpperCase();

  // CORS preflight — answer before any auth/DB work.
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      ...corsHeaders(req),
      'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    });
    res.end();
    return;
  }

  // Google OAuth scaffold — disabled until creds + flow are implemented.
  if (path === '/auth/google/start' || path === '/auth/google/callback') {
    return handleGoogleStub(req, res);
  }

  // No database → the whole API is gracefully disabled (gameplay unaffected).
  if (!isDbEnabled()) {
    return json(res, 503, {
      error: 'db_disabled',
      message: 'Profiles/settings require a database. Set DATABASE_URL to enable. Play is unaffected.',
    }, corsHeaders(req));
  }

  // CSRF: cookie-authenticated mutations must carry an allowed Origin.
  if (isMutatingMethod(method) && !isOriginAllowed(req.headers.origin, req.headers.host, ALLOWED_ORIGINS)) {
    return json(res, 403, { error: 'bad_origin', message: 'Origin not allowed for a state-changing request.' }, corsHeaders(req));
  }

  try {
    // Public (session-optional) routes.
    if (path === '/api/me' && method === 'GET') return await handleMe(req, res);
    if (path === '/api/guest-session' && method === 'POST') return await handleGuestSession(req, res);
    if (path === '/api/logout' && method === 'POST') return await handleLogout(req, res);
    if (path === '/api/games/king/leaderboard' && method === 'GET') return await handleGetKingLeaderboard(req, res);

    // Session-required routes.
    const requireUser = async (): Promise<string | null> => {
      const userId = await resolveUserId(req);
      if (!userId) { json(res, 401, { error: 'unauthenticated', message: 'No active session.' }, corsHeaders(req)); return null; }
      return userId;
    };

    if (path === '/api/profile' && method === 'PATCH') {
      const u = await requireUser(); if (!u) return; return await handlePatchProfile(req, res, u);
    }
    if (path === '/api/settings' && method === 'GET') {
      const u = await requireUser(); if (!u) return; return await handleGetSettings(req, res, u);
    }
    if (path === '/api/settings' && method === 'PATCH') {
      const u = await requireUser(); if (!u) return; return await handlePatchSettings(req, res, u);
    }
    if (path === '/api/games/king/settings' && method === 'GET') {
      const u = await requireUser(); if (!u) return; return await handleGetGameSettings(req, res, u);
    }
    if (path === '/api/games/king/settings' && method === 'PATCH') {
      const u = await requireUser(); if (!u) return; return await handlePatchGameSettings(req, res, u);
    }
    if (path === '/api/games/king/stats' && method === 'GET') {
      const u = await requireUser(); if (!u) return; return await handleGetKingStats(req, res, u);
    }

    json(res, 404, { error: 'not_found' }, corsHeaders(req));
  } catch (err) {
    // A DB hiccup (e.g. unreachable Postgres) must not crash the process or
    // leak details. Log only the first line, truncated — the driver appends a
    // `params:` line we must NOT print (could echo input values).
    const brief = String((err as Error)?.message ?? err).split('\n')[0].slice(0, 200);
    console.error('[King] /api error on', method, path, '→', brief);
    json(res, 503, { error: 'db_error', message: 'The profile service is temporarily unavailable.' }, corsHeaders(req));
  }
}
