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
// /health/diagnostics (which reports only the *mode*). Short-lived, per-session credentials
// (minted here on each request) are the post-MVP hardening — this module is where they'd go.
//
// Pure + DOM-free (no `RTCIceServer` type) so it compiles under the server tsconfig and is fully
// unit-testable. Mirrors the client parser in src/voice/iceConfig.ts.
// ---------------------------------------------------------------------------

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

/** The runtime-configured ICE servers (reads the SERVER env, not the build-time VITE var). */
export function configuredIceServers(): IceServer[] {
  return parseIceServers(process.env.VOICE_ICE_SERVERS);
}

/**
 * The body served at GET /api/voice/ice-config. Includes any STATIC TURN credential BY DESIGN
 * (the browser must authenticate to the TURN server). Cheap, no I/O, never throws.
 */
export function iceConfigPayload(): { iceServers: IceServer[] } {
  return { iceServers: configuredIceServers() };
}

/** LOG-safe view: urls + a hasCredential flag — NEVER the secret. Use this if you must log. */
export function redactIceServers(servers: IceServer[]): Array<{ urls: string | string[]; hasCredential: boolean }> {
  return servers.map((s) => ({ urls: s.urls, hasCredential: !!(s.credential || s.username) }));
}
