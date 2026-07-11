// ---------------------------------------------------------------------------
// Voice ICE config CLIENT fetch (Stage 25.6).
//
// Resolves the ICE servers the browser uses for the voice mesh, preferring the RUNTIME endpoint
// so a deployment can add/rotate TURN without rebuilding the client:
//   1. GET <apiBase>/api/voice/ice-config  (server env VOICE_ICE_SERVERS)   ← preferred
//   2. build-time `VITE_VOICE_ICE_SERVERS`  (baked into this bundle)         ← fallback
//   3. STUN-only default                                                     ← final fallback
//
// This is the ONLY voice module that performs a network fetch; it is same-origin to the API host
// and reads only public ICE config. A STATIC TURN credential returned by the endpoint is, by
// design, delivered to the browser (it must authenticate to TURN) — we never log it here.
// ---------------------------------------------------------------------------

import { parseIceServers } from './iceConfig';

/** The build-time (bundled) ICE servers — STUN-only unless VITE_VOICE_ICE_SERVERS was set. */
function buildTimeIceServers(): RTCIceServer[] {
  const raw = typeof import.meta !== 'undefined'
    ? (import.meta.env?.VITE_VOICE_ICE_SERVERS as string | undefined)
    : undefined;
  return parseIceServers(raw);
}

export interface FetchIceOptions {
  /** HTTP origin of the API (apiBaseFromWsUrl(wsUrl)); '' = same-origin. */
  baseUrl?: string;
  signal?: AbortSignal;
  /** Inject a fetch for tests; defaults to global fetch (absent → build-time value). */
  fetchImpl?: typeof fetch;
}

/**
 * Resolve the ICE servers, ALWAYS returning a usable list (never throws). On any network/parse
 * failure it falls back to the build-time value, then STUN. The runtime endpoint is authoritative
 * when reachable, so a deployment that clears TURN there takes effect without a rebuild.
 */
export async function fetchIceServers(opts: FetchIceOptions = {}): Promise<RTCIceServer[]> {
  const fallback = buildTimeIceServers();
  const doFetch = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!doFetch) return fallback;
  try {
    const res = await doFetch(`${opts.baseUrl ?? ''}/api/voice/ice-config`, {
      signal: opts.signal, headers: { accept: 'application/json' },
    });
    if (!res.ok) return fallback;
    const data: unknown = await res.json();
    const arr = data && typeof data === 'object' ? (data as { iceServers?: unknown }).iceServers : null;
    if (!Array.isArray(arr)) return fallback;
    // Re-validate through the shared parser (drops bad entries; STUN default if none survive).
    return parseIceServers(JSON.stringify(arr));
  } catch {
    return fallback; // offline / aborted / bad JSON → graceful fallback
  }
}

/** Secret-free MODE of a resolved server list, for the optional UI/debug indicator. */
export function iceModeOf(servers: RTCIceServer[]): 'stun_only' | 'turn_configured' {
  const isTurn = (u: unknown) => typeof u === 'string' && /^turns?:/i.test(u);
  return servers.some((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(isTurn))
    ? 'turn_configured' : 'stun_only';
}
