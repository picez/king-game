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
import { isDbEnabled, classifyDbError } from './db/client';
import {
  generateSessionToken, hashSessionToken, sessionTtlSeconds, hashIp,
} from './sessionTokens';
import {
  SESSION_COOKIE, parseCookies, serializeCookie, sessionCookieOptions,
  isMutatingMethod, isOriginAllowed, resolveCookieSecure,
} from '../src/net/cookies';
import { sanitizeGameSettings } from '../src/net/userSettings';
import { publicGameCatalog } from '../src/games/catalog';
import {
  MAX_AVATAR_UPLOAD_BYTES, multipartBoundary, parseSingleFileMultipart,
  avatarImageUrlPath, avatarPublicIdFromPath,
} from '../src/net/avatarImage';
import {
  googleConfig, buildAuthUrl, exchangeCode, decodeIdToken, validateIdClaims, isLinkableIdentity,
} from './googleOAuth';
import {
  makePkce, signState, verifyState, statesMatch, randomToken,
} from './oauthState';

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const KING = 'king';
const MAX_BODY_BYTES = 16 * 1024;
/** Short-lived signed cookie holding the OAuth state/PKCE/guest during login. */
const OAUTH_STATE_COOKIE = 'king_oauth';
const OAUTH_STATE_MAX_AGE = 600; // seconds (matches oauthState STATE_TTL_SEC)

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

/**
 * Reads the raw request body up to `maxBytes` (for the multipart avatar upload —
 * the 16 KB JSON cap does NOT apply here). Aborts early past the cap, returning
 * null; returns the concatenated Buffer otherwise.
 */
type BodyRead = { ok: true; body: Buffer } | { ok: false; reason: 'too_large' | 'timeout' };

/** Body-read watchdog: a stalled/slowloris upload (headers + partial body, then silence)
 *  never reaches `end` and never exceeds the cap, so WITHOUT this the request would hang.
 *  Kept BELOW the client's 30 s so the client gets our 408, not its own AbortController
 *  timeout. Env-overridable (AVATAR_BODY_TIMEOUT_MS), default 12 s. */
function bodyTimeoutMs(): number {
  const v = Number(process.env.AVATAR_BODY_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 12_000;
}
/** DB-write watchdog for the avatar upsert. Env AVATAR_DB_TIMEOUT_MS, default 8 s. */
function dbWriteTimeoutMs(): number {
  const v = Number(process.env.AVATAR_DB_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 8_000;
}
/** Resolve to the promise's value, or the sentinel `'__timeout__'` after `ms` — used to
 *  bound a phase (DB write) that has no timeout of its own. Never leaves a pending await. */
const PHASE_TIMEOUT = '__timeout__' as const;
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof PHASE_TIMEOUT> {
  return Promise.race([p, new Promise<typeof PHASE_TIMEOUT>((r) => setTimeout(() => r(PHASE_TIMEOUT), ms))]);
}
/** Safe phase-timing log for avatar upload — ONLY the phase name + a numeric/enum extra
 *  (never a filename, bytes, email, token, session id, or the full userId). */
function logAvatarPhase(phase: string, extra?: string | number): void {
  console.log(`[King] avatar ${phase}${extra != null ? ` ${extra}` : ''}`);
}

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<BodyRead> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (v: BodyRead) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    // Stop reading and let the handler answer 408 — do NOT req.destroy() here (destroying
    // the socket would prevent the 408 from reaching the client, causing its own timeout).
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), bodyTimeoutMs());
    req.on('data', (c: Buffer) => {
      if (settled) return;
      size += c.length;
      if (size > maxBytes) { done({ ok: false, reason: 'too_large' }); return; }
      chunks.push(c);
    });
    req.on('end', () => done({ ok: true, body: Buffer.concat(chunks) }));
    req.on('error', () => done({ ok: false, reason: 'timeout' }));
  });
}

/** Sends binary (an image) with explicit safe headers. */
function sendBinary(res: ServerResponse, status: number, body: Buffer, contentType: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(body);
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

/**
 * DB-gated, never-throwing resolver of a user's SAME-ORIGIN uploaded-avatar URL
 * (Stage 17.3), for the WS layer to stamp onto a seated member. Returns null when no
 * DB / no uploaded avatar / any hiccup — so the seat simply shows the emoji. The URL
 * is built by the server's own helper from the stored (id, version); no client value
 * is ever involved.
 */
export async function resolveAvatarImageUrl(userId: string | null): Promise<string | null> {
  if (!userId || !isDbEnabled()) return null;
  try {
    const { getAvatarForUser } = await import('./db/userAvatars');
    const ref = await getAvatarForUser(userId);
    return ref ? avatarImageUrlPath(ref.id, ref.version) : null;
  } catch {
    return null;
  }
}

// ── route handlers ──────────────────────────────────────────────────────────

/** Debug-safe DB error log: first line only, truncated — NEVER the driver's `params:`
 *  line (which can echo input values), the SQL, or the connection string. */
function logDbBrief(where: string, err: unknown): void {
  const brief = String((err as Error)?.message ?? err).split('\n')[0].slice(0, 200);
  console.error(`[King] DB error on ${where} → ${brief}`);
}

/**
 * GET /api/me — "who am I?". Resilient by design: a TRANSIENT DB error (e.g. a Render
 * free-tier Postgres cold-start or a dropped pooled connection) must NOT hard-fail
 * identity. The safe answer is always "a guest", so on any DB error we degrade to
 * `200 { authenticated:false }` rather than a 503 that would trap the whole Profile in
 * an "unreachable" state. The client then shows Sign in and a later probe recovers the
 * real identity once the DB is back. The error is logged debug-safely and `/health`
 * (+ `/health/diagnostics`) still report `db:error` for ops visibility.
 */
async function handleMe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return json(res, 200, { authenticated: false, user: null }, corsHeaders(req));
    const { getProfile } = await import('./db/users');
    const profile = await getProfile(userId);
    if (!profile) return json(res, 200, { authenticated: false, user: null }, corsHeaders(req));
    // Linked provider (Google) + login-only basics, if any. Never expose the
    // provider_account_id, tokens, or session id.
    const { getAccountForUser } = await import('./db/authAccounts');
    const account = await getAccountForUser(userId);
    // Uploaded custom avatar (Stage 17.1), if any — a SAME-ORIGIN, versioned URL.
    // Distinct from `avatarUrl` (the OAuth provider picture) — never conflated.
    const { getAvatarForUser } = await import('./db/userAvatars');
    const uploaded = await getAvatarForUser(userId);
    json(res, 200, {
      authenticated: true,
      user: { ...publicUser(profile), avatar: profile.settings.avatar },
      provider: account?.provider ?? null,
      email: account?.email ?? null,
      avatarUrl: account?.picture ?? null,
      avatarImageUrl: uploaded ? avatarImageUrlPath(uploaded.id, uploaded.version) : null,
      settings: profile.settings,
    }, corsHeaders(req));
  } catch (err) {
    logDbBrief('GET /api/me', err);
    // A SCHEMA drift (missing migration) must NOT be masked as a guest: OAuth would
    // succeed but the profile still couldn't be read. Surface a safe `migration_required`
    // so the UI tells the operator to run migrations. A TRANSIENT DB error still degrades
    // to a guest (Stage 24.3), so a Postgres blip never traps the UI.
    if (classifyDbError(err) === 'migration_required') {
      return json(res, 503, { error: 'migration_required', message: 'The server database needs a schema update (run migrations).' }, corsHeaders(req));
    }
    json(res, 200, { authenticated: false, user: null }, corsHeaders(req));
  }
}

// ── avatar upload / delete / serve (Stage 17.1; hidden backend, no UI wiring) ──

/** Maps a processing failure reason to a SAFE HTTP status + error code (no SQL/secrets).
 *  A body-read timeout → 408 upload_timeout (server didn't receive it in time → "smaller
 *  image"); ffmpeg/DB unavailable-or-timeout → 503 processing_unavailable. */
const AVATAR_ERR: Record<string, { status: number; code: string }> = {
  unsupported_type: { status: 415, code: 'unsupported_type' },
  invalid_image:    { status: 400, code: 'invalid_image' },
  too_large:        { status: 413, code: 'too_large' },
  unavailable:      { status: 503, code: 'processing_unavailable' },
  timeout:          { status: 503, code: 'processing_unavailable' }, // ffmpeg processing timed out
};
/** The diagnostic phase name to log for each processing-failure reason. */
const AVATAR_FAIL_PHASE: Record<string, string> = {
  unsupported_type: 'magic_check_fail', invalid_image: 'magic_check_fail',
  timeout: 'ffmpeg_timeout', unavailable: 'ffmpeg_unavailable', too_large: 'output_too_large',
};

async function handlePostAvatar(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  // Safe phase-timing trace so a production hang can be pinpointed WITHOUT logging any
  // filename, image bytes, email, token, session id, or the full userId. Every phase is
  // bounded (body read < ffmpeg < DB) and every exit path returns a safe JSON status, so
  // the request can never pend past the client's 30 s timeout.
  const t0 = Date.now();
  logAvatarPhase('upload_start');
  const { allowAvatarUpload } = await import('./avatarRateLimit');
  if (!allowAvatarUpload(userId)) {
    logAvatarPhase('rate_limited');
    return json(res, 429, { error: 'rate_limited', message: 'Too many uploads. Try again later.' }, corsHeaders(req));
  }
  // Guests may not upload (local-only avatar remains theirs). Signed-in only.
  const { getProfile } = await import('./db/users');
  const profile = await getProfile(userId);
  if (!profile || profile.isGuest) {
    return json(res, 403, { error: 'guest_forbidden', message: 'Sign in to sync a custom avatar.' }, corsHeaders(req));
  }
  logAvatarPhase('auth_ok');
  // Reject an obviously-oversized upload before reading a single byte of the body.
  const declaredLen = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLen)) logAvatarPhase('content_length', declaredLen);
  if (Number.isFinite(declaredLen) && declaredLen > MAX_AVATAR_UPLOAD_BYTES + 4096) {
    return json(res, 413, { error: 'too_large', message: 'Image exceeds the 2 MB limit.' }, corsHeaders(req));
  }
  const boundary = multipartBoundary(req.headers['content-type']);
  if (!boundary) {
    logAvatarPhase('not_multipart');
    return json(res, 415, { error: 'unsupported_type', message: 'Send multipart/form-data with a single image file.' }, corsHeaders(req));
  }
  logAvatarPhase('body_read_start');
  const bodyRead = await readRawBody(req, MAX_AVATAR_UPLOAD_BYTES + 4096); // + small multipart overhead
  if (!bodyRead.ok) {
    if (bodyRead.reason === 'timeout') {
      logAvatarPhase('body_read_timeout');
      return json(res, 408, { error: 'upload_timeout', message: 'Server took too long to receive the image. Try a smaller image.' }, corsHeaders(req));
    }
    logAvatarPhase('body_too_large');
    return json(res, 413, { error: 'too_large', message: 'Image exceeds the 2 MB limit.' }, corsHeaders(req));
  }
  logAvatarPhase('body_read_ok', bodyRead.body.length);
  const file = parseSingleFileMultipart(bodyRead.body, boundary);
  if (!file || file.bytes.length === 0) {
    logAvatarPhase('no_file');
    return json(res, 400, { error: 'no_file', message: 'No image file found in the request.' }, corsHeaders(req));
  }
  if (file.bytes.length > MAX_AVATAR_UPLOAD_BYTES) {
    logAvatarPhase('file_too_large', file.bytes.length);
    return json(res, 413, { error: 'too_large', message: 'Image exceeds the 2 MB limit.' }, corsHeaders(req));
  }
  logAvatarPhase('ffmpeg_start', file.bytes.length);
  const { processAvatarToWebp } = await import('./avatarProcess');
  const processed = await processAvatarToWebp(Buffer.from(file.bytes));
  if (!processed.ok) {
    logAvatarPhase(AVATAR_FAIL_PHASE[processed.reason] ?? `fail_${processed.reason}`);
    const m = AVATAR_ERR[processed.reason] ?? { status: 500, code: 'upload_failed' };
    return json(res, m.status, { error: m.code }, corsHeaders(req));
  }
  logAvatarPhase('ffmpeg_ok', processed.byteSize);
  // Bound the DB write too — a slow/hung Postgres write must not outlast the client.
  const { upsertAvatar } = await import('./db/userAvatars');
  logAvatarPhase('db_write_start');
  try {
    const ref = await withTimeout(upsertAvatar(userId, {
      mimeType: processed.mimeType, bytes: processed.bytes, byteSize: processed.byteSize,
      width: processed.width, height: processed.height,
    }), dbWriteTimeoutMs());
    if (ref === PHASE_TIMEOUT) {
      logAvatarPhase('db_write_timeout');
      return json(res, 503, { error: 'processing_unavailable', message: 'Avatar storage timed out. Please try again.' }, corsHeaders(req));
    }
    logAvatarPhase('db_write_ok');
    json(res, 200, { avatarImageUrl: avatarImageUrlPath(ref.id, ref.version) }, corsHeaders(req));
    logAvatarPhase('response_sent', Date.now() - t0);
  } catch (err) {
    logAvatarPhase('db_write_error');
    logDbBrief('POST /api/me/avatar', err);
    json(res, 503, { error: 'processing_unavailable', message: 'Avatar storage is temporarily unavailable.' }, corsHeaders(req));
  }
}

async function handleDeleteAvatar(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const { deleteAvatar } = await import('./db/userAvatars');
  await deleteAvatar(userId);
  json(res, 200, { avatarImageUrl: null }, corsHeaders(req));
}

/**
 * Public GET /api/avatar/<id>.webp — serves the processed bytes with safe, immutable
 * (version-stamped URL) caching. No session, no cookies echoed. A missing id / row →
 * a plain 404 so clients fall back to the emoji. Never JSON here.
 */
async function handleServeAvatar(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
  if (!isDbEnabled()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
  const { getAvatarByPublicId } = await import('./db/userAvatars');
  const stored = await getAvatarByPublicId(id);
  if (!stored) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
  // Defense-in-depth: serve a KNOWN-SAFE image content type (never echo an arbitrary
  // stored value), paired with nosniff so a bad type can't be interpreted as anything
  // executable. The server only ever writes webp today; jpeg is the reserved fallback.
  const contentType = stored.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  sendBinary(res, 200, stored.bytes, contentType, {
    'cache-control': 'public, max-age=31536000, immutable',
    'content-disposition': 'inline',
  });
}

/** Whitelist the user fields exposed to the client (no email/status/timestamps). */
function publicUser(p: { id: string; displayName: string | null; isGuest: boolean }): { id: string; displayName: string | null; isGuest: boolean } {
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
  if ('animationPreference' in body) patch.animationPreference = body.animationPreference;
  if ('favoriteGame' in body) patch.favoriteGame = body.favoriteGame;
  if ('cardFaceTheme' in body) patch.cardFaceTheme = body.cardFaceTheme;
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

async function handleGetDurakStats(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const { getDurakStats } = await import('./db/durakStats');
  json(res, 200, { gameType: 'durak', stats: await getDurakStats(userId) }, corsHeaders(req));
}

async function handleGetDebercStats(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const { getDebercStats } = await import('./db/debercStats');
  json(res, 200, { gameType: 'deberc', stats: await getDebercStats(userId) }, corsHeaders(req));
}

async function handleGetTarneebStats(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const { getTarneebStats } = await import('./db/tarneebStats');
  json(res, 200, { gameType: 'tarneeb', stats: await getTarneebStats(userId) }, corsHeaders(req));
}

async function handleGetPreferansStats(req: IncomingMessage, res: ServerResponse, userId: string): Promise<void> {
  const { getPreferansStats } = await import('./db/preferansStats');
  json(res, 200, { gameType: 'preferans', stats: await getPreferansStats(userId) }, corsHeaders(req));
}

/**
 * Public per-game leaderboard (no session required — only public, score-level
 * fields). If a session cookie is present we resolve it ONLY to mark the
 * caller's own row (`self`) for highlighting; the user id itself is never
 * returned. A session-resolution hiccup never fails the public read.
 */
async function handleGetKingLeaderboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { getLeaderboard } = await import('./db/stats');
  let selfUserId: string | null = null;
  try { selfUserId = await resolveUserId(req); } catch { selfUserId = null; }
  json(res, 200, { gameType: KING, leaderboard: await getLeaderboard(KING, 20, selfUserId) }, corsHeaders(req));
}

async function handleGetDurakLeaderboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { getDurakLeaderboard } = await import('./db/durakStats');
  let selfUserId: string | null = null;
  try { selfUserId = await resolveUserId(req); } catch { selfUserId = null; }
  json(res, 200, { gameType: 'durak', leaderboard: await getDurakLeaderboard(20, selfUserId) }, corsHeaders(req));
}

async function handleGetDebercLeaderboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { getDebercLeaderboard } = await import('./db/debercStats');
  let selfUserId: string | null = null;
  try { selfUserId = await resolveUserId(req); } catch { selfUserId = null; }
  json(res, 200, { gameType: 'deberc', leaderboard: await getDebercLeaderboard(20, selfUserId) }, corsHeaders(req));
}

async function handleGetTarneebLeaderboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { getTarneebLeaderboard } = await import('./db/tarneebStats');
  let selfUserId: string | null = null;
  try { selfUserId = await resolveUserId(req); } catch { selfUserId = null; }
  json(res, 200, { gameType: 'tarneeb', leaderboard: await getTarneebLeaderboard(20, selfUserId) }, corsHeaders(req));
}

async function handleGetPreferansLeaderboard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { getPreferansLeaderboard } = await import('./db/preferansStats');
  let selfUserId: string | null = null;
  try { selfUserId = await resolveUserId(req); } catch { selfUserId = null; }
  json(res, 200, { gameType: 'preferans', leaderboard: await getPreferansLeaderboard(20, selfUserId) }, corsHeaders(req));
}

// ── Google OAuth (Stage 6) ──────────────────────────────────────────────────

function nowSec(): number { return Math.floor(Date.now() / 1000); }
function statePepper(): string { return process.env.SESSION_SECRET ?? ''; }

/** App origin used for post-login redirects (env override, else the request). */
function appBaseFrom(req: IncomingMessage): string {
  const env = process.env.APP_ORIGIN?.trim();
  if (env) return env.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim()
    || ((req.socket as { encrypted?: boolean })?.encrypted ? 'https' : 'http');
  const host = req.headers.host ?? 'localhost';
  return `${proto}://${host}`;
}

function setStateCookie(res: ServerResponse, value: string): void {
  res.setHeader('set-cookie', serializeCookie(OAUTH_STATE_COOKIE, value, {
    httpOnly: true, secure: cookieSecure(), sameSite: 'Lax', path: '/', maxAgeSec: OAUTH_STATE_MAX_AGE,
  }));
}

/** Redirects to the app root with a `?login=success|error` flag. */
function redirectLogin(req: IncomingMessage, res: ServerResponse, status: 'success' | 'error', cookies: string[] = []): void {
  const headers: Record<string, string | string[]> = { location: `${appBaseFrom(req)}/?login=${status}` };
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(302, headers);
  res.end();
}

/**
 * GET /auth/google/start — begins the Authorization-Code+PKCE flow. Captures the
 * current guest (if any) into a signed, short-lived state cookie so the callback
 * can merge it. Returns 503 `oauth_disabled` (no crash) when env is unset.
 */
async function handleGoogleStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cfg = googleConfig();
  if (!cfg) {
    return json(res, 503, { error: 'oauth_disabled', message: 'Google sign-in is not configured. Set GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI.' }, corsHeaders(req));
  }
  if (!isDbEnabled()) {
    return json(res, 503, { error: 'db_disabled', message: 'Sign-in requires a database.' }, corsHeaders(req));
  }
  let guestUserId: string | null = null;
  try { guestUserId = await resolveUserId(req); } catch { guestUserId = null; }

  const state = randomToken();
  const { verifier, challenge } = makePkce();
  const nonce = randomToken(16);
  const cookie = signState({ state, codeVerifier: verifier, nonce, guestUserId, iat: nowSec() }, statePepper());
  setStateCookie(res, cookie);
  res.writeHead(302, { location: buildAuthUrl(cfg, { state, codeChallenge: challenge, nonce }) });
  res.end();
}

/**
 * GET /auth/google/callback — verifies state, exchanges the code, validates the
 * id_token, then links the Google account: promotes a guest in place (new
 * account), or merges the guest into the existing account (returning user). Sets
 * a fresh session cookie and redirects to `/?login=success`. Any failure clears
 * the state cookie and redirects to `/?login=error` (never crashes).
 */
async function handleGoogleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const cfg = googleConfig();
  const clearState = serializeCookie(OAUTH_STATE_COOKIE, '', { httpOnly: true, secure: cookieSecure(), sameSite: 'Lax', path: '/', maxAgeSec: 0 });
  if (!cfg || !isDbEnabled()) return redirectLogin(req, res, 'error', [clearState]);

  const url = new URL(req.url ?? '', 'http://localhost');
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (url.searchParams.get('error') || !code) return redirectLogin(req, res, 'error', [clearState]);

  const payload = verifyState(parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE], statePepper(), nowSec());
  if (!payload || !statesMatch(payload.state, stateParam)) return redirectLogin(req, res, 'error', [clearState]);

  const tokens = await exchangeCode(cfg, code, payload.codeVerifier);
  const identity = validateIdClaims(decodeIdToken(tokens?.id_token), cfg.clientId, nowSec(), payload.nonce);
  if (!identity) return redirectLogin(req, res, 'error', [clearState]);
  // БЕЗ-5: refuse to link a Google account whose email Google has not verified.
  if (!isLinkableIdentity(identity)) {
    console.warn('[King] Google sign-in rejected: email not verified');
    return redirectLogin(req, res, 'error', [clearState]);
  }

  const { findUserByProviderAccount, linkProviderAccount } = await import('./db/authAccounts');
  const { promoteGuestToAccount, createAccountUser, getProfile } = await import('./db/users');
  const profile = { email: identity.email, name: identity.name, emailVerified: identity.emailVerified };

  const existing = await findUserByProviderAccount('google', identity.sub);
  let userId: string;
  if (existing) {
    userId = existing;
    if (payload.guestUserId && payload.guestUserId !== existing) {
      const { mergeGuestInto } = await import('./db/merge');
      await mergeGuestInto(payload.guestUserId, existing); // self-guards: only folds a live guest
    }
  } else {
    const guest = payload.guestUserId ? await getProfile(payload.guestUserId) : null;
    if (guest && guest.isGuest) {
      userId = payload.guestUserId as string;
      await promoteGuestToAccount(userId, profile);
    } else {
      userId = await createAccountUser(profile);
    }
  }
  await linkProviderAccount(userId, {
    provider: 'google', providerAccountId: identity.sub,
    email: identity.email, name: identity.name, picture: identity.picture,
  });

  // Issue a fresh session for the resolved user.
  const token = generateSessionToken();
  const { createSession } = await import('./db/sessions');
  await createSession({
    userId, tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + sessionTtlSeconds() * 1000),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 256) : null,
    ipHash: hashIp(clientIp(req)),
  });
  const sessionCookie = serializeCookie(SESSION_COOKIE, token, sessionCookieOptions({ secure: cookieSecure(), maxAgeSec: sessionTtlSeconds() }));
  redirectLogin(req, res, 'success', [clearState, sessionCookie]);
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
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    });
    res.end();
    return;
  }

  // Google OAuth (Stage 6). GET-only redirects; never throw to the caller — a
  // failure 503s (start) or redirects to ?login=error (callback). When env is
  // unset, handleGoogleStart returns 503 oauth_disabled and the server is fine.
  if (path === '/auth/google/start' && method === 'GET') {
    return handleGoogleStart(req, res).catch((e) => {
      console.error('[King] oauth start failed:', String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200));
      if (!res.headersSent) json(res, 503, { error: 'oauth_error', message: 'Sign-in is temporarily unavailable.' }, corsHeaders(req));
    });
  }
  if (path === '/auth/google/callback' && method === 'GET') {
    return handleGoogleCallback(req, res).catch((e) => {
      console.error('[King] oauth callback failed:', String((e as Error)?.message ?? e).split('\n')[0].slice(0, 200));
      if (!res.headersSent) redirectLogin(req, res, 'error');
    });
  }

  // Public, STATIC game catalog (Stage 8.3). No DB / session / mutation — must
  // work even when DATABASE_URL is unset, so it sits BEFORE the db-disabled gate.
  // Only public fields (catalog mapper omits anything internal like rulesDoc).
  if (path === '/api/games' && method === 'GET') {
    return json(res, 200, { games: publicGameCatalog() }, corsHeaders(req));
  }

  // Public avatar image (Stage 17.1). A same-origin, versioned, cacheable read that
  // must serve even mid-gate; with no DB there is simply nothing to serve (404). The
  // id is a strict UUID (avatarPublicIdFromPath) so no path traversal is possible.
  if (method === 'GET') {
    const avatarId = avatarPublicIdFromPath(path);
    if (avatarId) {
      return handleServeAvatar(req, res, avatarId).catch(() => {
        if (!res.headersSent) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); }
      });
    }
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
    if (path === '/api/games/durak/leaderboard' && method === 'GET') return await handleGetDurakLeaderboard(req, res);
    if (path === '/api/games/deberc/leaderboard' && method === 'GET') return await handleGetDebercLeaderboard(req, res);
    if (path === '/api/games/tarneeb/leaderboard' && method === 'GET') return await handleGetTarneebLeaderboard(req, res);
    if (path === '/api/games/preferans/leaderboard' && method === 'GET') return await handleGetPreferansLeaderboard(req, res);

    // Session-required routes.
    const requireUser = async (): Promise<string | null> => {
      const userId = await resolveUserId(req);
      if (!userId) { json(res, 401, { error: 'unauthenticated', message: 'No active session.' }, corsHeaders(req)); return null; }
      return userId;
    };

    if (path === '/api/profile' && method === 'PATCH') {
      const u = await requireUser(); if (!u) return; return await handlePatchProfile(req, res, u);
    }
    if (path === '/api/me/avatar' && method === 'POST') {
      const u = await requireUser(); if (!u) return; return await handlePostAvatar(req, res, u);
    }
    if (path === '/api/me/avatar' && method === 'DELETE') {
      const u = await requireUser(); if (!u) return; return await handleDeleteAvatar(req, res, u);
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
    if (path === '/api/games/durak/stats' && method === 'GET') {
      const u = await requireUser(); if (!u) return; return await handleGetDurakStats(req, res, u);
    }
    if (path === '/api/games/deberc/stats' && method === 'GET') {
      const u = await requireUser(); if (!u) return; return await handleGetDebercStats(req, res, u);
    }
    if (path === '/api/games/tarneeb/stats' && method === 'GET') {
      const u = await requireUser(); if (!u) return; return await handleGetTarneebStats(req, res, u);
    }
    if (path === '/api/games/preferans/stats' && method === 'GET') {
      const u = await requireUser(); if (!u) return; return await handleGetPreferansStats(req, res, u);
    }

    json(res, 404, { error: 'not_found' }, corsHeaders(req));
  } catch (err) {
    // A DB hiccup (e.g. unreachable Postgres) must not crash the process or leak
    // details. `/api/me` degrades to a guest above; the remaining (session-required)
    // routes return a SAFE code (no SQL / params / credentials): `migration_required`
    // for a schema drift (run migrations), else `db_error` ("temporarily unavailable").
    logDbBrief(`${method} ${path}`, err);
    const code = classifyDbError(err);
    const message = code === 'migration_required'
      ? 'The server database needs a schema update (run migrations).'
      : 'The profile service is temporarily unavailable.';
    json(res, 503, { error: code, message }, corsHeaders(req));
  }
}
