// ---------------------------------------------------------------------------
// Server-side voice ICE config (Stage 25.6) — the RUNTIME seam for TURN.
//
// The browser needs ICE servers (STUN, and optionally TURN for strict NAT) to establish the
// peer-to-peer voice mesh. Two ways to supply them:
//   • build-time  `VITE_VOICE_ICE_SERVERS` — baked into the client bundle (src/voice/iceConfig.ts).
//   • runtime     `VOICE_ICE_SERVERS`      — read HERE by the server and served to the browser at
//                                            GET /api/voice/ice-config (no client rebuild needed).
// The client prefers the runtime endpoint and falls back to the build-time value, then STUN.
//
// SECURITY: a STATIC TURN credential is, by design, delivered to the browser — the browser must
// authenticate to the TURN server, so the credential is inherently client-visible. We therefore
// RETURN it from /api/voice/ice-config, but we NEVER log it and NEVER put it in
// /health/diagnostics (which reports only the *mode*).
//
// (Stage 40.1) SHORT-LIVED credentials. A static credential handed to every visitor can be
// copied and used to relay unrelated traffic through the TURN server for as long as it is
// not rotated. With
//   VOICE_TURN_URLS    comma-separated turn:/turns: URLs
//   VOICE_TURN_SECRET  the TURN server's shared secret (coturn `use-auth-secret` +
//                      `static-auth-secret`, the "TURN REST API" scheme)
//   VOICE_TURN_TTL_SECONDS  optional lifetime, default 4h (clamped to 5min–24h)
// the server mints a fresh credential on every /api/voice/ice-config request:
//   username   = "<unix expiry>:cardmajlis"
//   credential = base64(HMAC-SHA1(secret, username))
// The TURN server recomputes the HMAC and refuses the pair after the expiry. The SECRET
// never leaves the server; what the browser receives stops working on its own.
//
// DOM-free (no `RTCIceServer` type) so it compiles under the server tsconfig and is fully
// unit-testable. Mirrors the client parser in src/voice/iceConfig.ts.
// ---------------------------------------------------------------------------

import { createHmac } from 'node:crypto';

export interface IceServer { urls: string | string[]; username?: string; credential?: string; }

/** The default when nothing is configured: free Google public STUN — no TURN, no credentials. */
export const DEFAULT_ICE_SERVERS: IceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

const ICE_URL_RE = /^(stun|turns?):/i;

function isIceUrl(u: unknown): u is string {
  return typeof u === 'string' && ICE_URL_RE.test(u.trim());
}

function sanitizeIceServer(v: unknown): IceServer | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const urls = o.urls;
  const okUrls = isIceUrl(urls) || (Array.isArray(urls) && urls.length > 0 && urls.every(isIceUrl));
  if (!okUrls) return null;
  const server: IceServer = { urls: urls as string | string[] };
  if (typeof o.username === 'string') server.username = o.username;
  if (typeof o.credential === 'string') server.credential = o.credential;
  return server;
}

/** Parse a JSON array of ICE servers, falling back to STUN-only on absent/malformed. Never throws. */
export function parseIceServers(raw: string | undefined | null): IceServer[] {
  if (!raw || !raw.trim()) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_ICE_SERVERS;
    const servers = parsed.map(sanitizeIceServer).filter((s): s is IceServer => s !== null);
    return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

/** True when any server offers a TURN(S) relay. */
function hasTurn(servers: IceServer[]): boolean {
  return servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some((u) => /^turns?:/i.test(u)));
}

/** A secret-free summary for /health/diagnostics — the MODE only, never the credentials. */
export function iceMode(servers: IceServer[]): 'stun_only' | 'turn_configured' {
  return hasTurn(servers) ? 'turn_configured' : 'stun_only';
}

// ── Short-lived TURN credentials (TURN REST API) ─────────────────────────────
export const TURN_TTL_DEFAULT_SECONDS = 4 * 60 * 60;
const TURN_TTL_MIN_SECONDS = 5 * 60;
const TURN_TTL_MAX_SECONDS = 24 * 60 * 60;

export interface TurnRestConfig { urls: string[]; secret: string; ttlSeconds: number; }

/** The shared-secret TURN config from env, or null unless BOTH a relay URL and a secret are
 *  set. A stun: URL in VOICE_TURN_URLS is ignored — a credential for it would mean nothing. */
export function turnRestConfig(
  env: { VOICE_TURN_URLS?: string; VOICE_TURN_SECRET?: string; VOICE_TURN_TTL_SECONDS?: string } = process.env,
): TurnRestConfig | null {
  const secret = env.VOICE_TURN_SECRET?.trim();
  const urls = (env.VOICE_TURN_URLS ?? '').split(',').map((u) => u.trim()).filter((u) => /^turns?:/i.test(u));
  if (!secret || urls.length === 0) return null;
  const ttl = Number(env.VOICE_TURN_TTL_SECONDS);
  const ttlSeconds = Number.isFinite(ttl) && ttl > 0
    ? Math.min(TURN_TTL_MAX_SECONDS, Math.max(TURN_TTL_MIN_SECONDS, Math.floor(ttl)))
    : TURN_TTL_DEFAULT_SECONDS;
  return { urls, secret, ttlSeconds };
}

/** One TURN entry whose credential the TURN server will refuse after `ttlSeconds`. */
export function mintTurnCredential(cfg: TurnRestConfig, nowMs: number): IceServer {
  const username = `${Math.floor(nowMs / 1000) + cfg.ttlSeconds}:cardmajlis`;
  const credential = createHmac('sha1', cfg.secret).update(username).digest('base64');
  return { urls: cfg.urls, username, credential };
}

/**
 * The runtime-configured ICE servers (reads the SERVER env, not the build-time VITE var):
 * VOICE_ICE_SERVERS (or the STUN default) plus, when the shared secret is configured, one
 * freshly minted short-lived TURN entry.
 */
export function configuredIceServers(nowMs: number = Date.now()): IceServer[] {
  const servers = parseIceServers(process.env.VOICE_ICE_SERVERS);
  const turn = turnRestConfig();
  return turn ? [...servers, mintTurnCredential(turn, nowMs)] : servers;
}

/**
 * The body served at GET /api/voice/ice-config. Includes the TURN credential BY DESIGN (the
 * browser must authenticate to the TURN server) — a static one from VOICE_ICE_SERVERS and/or
 * a short-lived one minted for this request. Cheap, no I/O, never throws.
 */
export function iceConfigPayload(): { iceServers: IceServer[] } {
  return { iceServers: configuredIceServers() };
}

/** LOG-safe view: urls + a hasCredential flag — NEVER the secret. Use this if you must log. */
export function redactIceServers(servers: IceServer[]): Array<{ urls: string | string[]; hasCredential: boolean }> {
  return servers.map((s) => ({ urls: s.urls, hasCredential: !!(s.credential || s.username) }));
}
