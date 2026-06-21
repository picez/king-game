// ---------------------------------------------------------------------------
// Pure cookie + origin helpers (Stage 4 — auth foundation).
//
// NO React, NO Node, NO DB, NO crypto — just string parsing/formatting and a
// couple of origin checks. This keeps cookie/session attribute logic and the
// CSRF origin check unit-testable without a server or a database, and safe to
// import from either side (only the server actually uses them today).
//
// Token hashing (which DOES need node:crypto) lives separately in
// server/sessionTokens.ts so this module stays dependency-free and pure.
// ---------------------------------------------------------------------------

/** The session cookie name (httpOnly; holds the opaque session token). */
export const SESSION_COOKIE = 'king_session';

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  /** Cookie lifetime in seconds. 0 → an immediate-expiry (delete) cookie. */
  maxAgeSec?: number;
}

/**
 * Parses a `Cookie:` header into a name→value map. Tolerant of missing/empty
 * headers and stray whitespace. Values are URL-decoded; malformed encodings
 * fall back to the raw value. Never throws.
 */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    // Strip optional surrounding quotes.
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    try { value = decodeURIComponent(value); } catch { /* keep raw */ }
    out[name] = value;
  }
  return out;
}

/**
 * Serializes a single Set-Cookie header value. The value is URL-encoded. A
 * `maxAgeSec` of 0 emits both `Max-Age=0` and an epoch `Expires` so the browser
 * deletes the cookie (used by logout).
 */
export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const segs = [`${name}=${encodeURIComponent(value)}`];
  segs.push(`Path=${opts.path ?? '/'}`);
  if (opts.sameSite) segs.push(`SameSite=${opts.sameSite}`);
  if (opts.httpOnly) segs.push('HttpOnly');
  if (opts.secure) segs.push('Secure');
  if (opts.maxAgeSec != null) {
    segs.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`);
    if (opts.maxAgeSec === 0) segs.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  return segs.join('; ');
}

/**
 * The session cookie attributes. httpOnly (no JS access — XSS-resistant),
 * SameSite=Lax (CSRF mitigation for top-level navigations while still allowing
 * the SPA's same-site fetches), `secure` driven by deployment (true in
 * production/HTTPS, false on dev http://localhost so the cookie still sets).
 */
export function sessionCookieOptions(opts: { secure: boolean; maxAgeSec: number }): CookieOptions {
  return {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'Lax',
    path: '/',
    maxAgeSec: opts.maxAgeSec,
  };
}

/** Whether the request method mutates state (and therefore needs CSRF defence). */
export function isMutatingMethod(method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

/**
 * Resolves COOKIE_SECURE: explicit env override wins ('true'/'false'),
 * otherwise defaults to secure in production. Pure (env passed in).
 */
export function resolveCookieSecure(env: { COOKIE_SECURE?: string; NODE_ENV?: string }): boolean {
  if (env.COOKIE_SECURE === 'true') return true;
  if (env.COOKIE_SECURE === 'false') return false;
  return env.NODE_ENV === 'production';
}

/**
 * CSRF defence for cookie-authenticated mutations: the request's Origin must
 * match an allowed origin. Strategy = SameSite=Lax cookie + this origin check
 * (see ARCHITECTURE_DB_AUTH.md §5). Rules:
 *   - A missing Origin header on a mutating request is REJECTED (browsers always
 *     send Origin on cross-origin and on POST/PATCH/etc. fetches).
 *   - If `allowedOrigins` is non-empty (production), the Origin must be in it.
 *   - If `allowedOrigins` is empty (LAN/dev), the Origin must match the request
 *     Host (same-origin), so we never blanket-trust an arbitrary site.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  host: string | null | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!origin) return false;
  if (allowedOrigins.length > 0) return allowedOrigins.includes(origin);
  if (!host) return false;
  // Same-origin check: the Origin's host[:port] must equal the request Host.
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { return false; }
  return originHost === host;
}
