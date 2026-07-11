// ---------------------------------------------------------------------------
// Voice ICE server config — PURE parser + redaction (Stage 25.5).
//
// STUN-only by default (Google public STUN). A deployment MAY provide its own ICE
// servers (incl. a TURN relay for strict-NAT users) via the build-time env
// `VITE_VOICE_ICE_SERVERS` — a JSON array of `{ urls, username?, credential? }`. Secrets
// are NEVER committed: they come from the env at build time and are only handed to the
// browser's RTCPeerConnection. `redactIceServers` strips credentials so the config can be
// logged / shown in diagnostics safely. See VOICE_CHAT_PLAN.md §7 (TURN is post-MVP).
// ---------------------------------------------------------------------------

/** The MVP default: Google public STUN (free, no credentials, no TURN). */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

const ICE_URL_RE = /^(stun|turns?):/i;

function isIceUrl(u: unknown): u is string {
  return typeof u === 'string' && ICE_URL_RE.test(u.trim());
}

/** Validate + narrow one entry to a safe RTCIceServer, or null. */
function sanitizeIceServer(v: unknown): RTCIceServer | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const urls = o.urls;
  const okUrls = isIceUrl(urls) || (Array.isArray(urls) && urls.length > 0 && urls.every(isIceUrl));
  if (!okUrls) return null;
  const server: RTCIceServer = { urls: urls as string | string[] };
  // username/credential are only meaningful for TURN — kept for the browser, redacted in logs.
  if (typeof o.username === 'string') server.username = o.username;
  if (typeof o.credential === 'string') server.credential = o.credential;
  return server;
}

/**
 * Parse `VITE_VOICE_ICE_SERVERS` (a JSON array) into RTCIceServers, falling back to the
 * STUN-only default when unset / empty / malformed. Never throws.
 */
export function parseIceServers(raw: string | undefined | null): RTCIceServer[] {
  if (!raw || !raw.trim()) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_ICE_SERVERS;
    const servers = parsed.map(sanitizeIceServer).filter((s): s is RTCIceServer => s !== null);
    return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

/** A LOG/DIAGNOSTICS-safe view: urls + whether a credential is present — NEVER the secret. */
export function redactIceServers(servers: RTCIceServer[]): Array<{ urls: string | string[]; hasCredential: boolean }> {
  return servers.map((s) => ({ urls: s.urls as string | string[], hasCredential: !!(s.credential || s.username) }));
}
