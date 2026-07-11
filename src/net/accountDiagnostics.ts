// ---------------------------------------------------------------------------
// Debug-safe account/connection diagnostics (Stage 24.2).
//
// A small, PURE description of WHERE the profile API is being called and WHAT it
// answered — so a user stuck on "can't reach the game server" can see (and copy) the
// exact cause: default vs custom server, same- vs cross-origin, the /api/me status,
// and any error code (db_disabled, …). It carries ONLY connection metadata — NEVER
// cookies, tokens, session ids, emails, or any identity — so it is always safe to
// display or paste into a bug report. The formatter's test asserts this.
// ---------------------------------------------------------------------------

export interface AccountDiagnostics {
  /** Whether a custom server URL is in effect (device-local) or the default. */
  connectionMode: 'default' | 'custom';
  /** The HTTP(S) ORIGIN the API is called on (scheme + host[:port]); no path/secrets. */
  apiBase: string;
  /** The page's own origin, or null when there is no window. */
  pageOrigin: string | null;
  /** apiBase === pageOrigin — a cross-origin API is the usual cause of a CORS failure. */
  sameOrigin: boolean;
  /** The probed endpoint (path only). */
  endpoint: string;
  /** Last HTTP status (null = not probed yet, 0 = network/CORS failure). */
  status: number | null;
  /** status === 0 (fetch threw — network/CORS/wrong host). */
  networkError: boolean;
  /** Debug-safe error code from the body (e.g. 'db_disabled'), or null. */
  code: string | null;
  /** The server answered healthily (200 or a clean db_disabled 503). */
  serverReachable: boolean;
  /** Sign-in is available here (a 200 from /api/me). */
  authAvailable: boolean;
}

/** Human-readable auth availability for the diagnostics line. */
export function authState(d: AccountDiagnostics): 'available' | 'unavailable' | 'unknown' {
  if (d.authAvailable) return 'available';
  if (d.serverReachable) return 'unavailable'; // reachable (db_disabled) but no sign-in
  return 'unknown';                             // couldn't reach → truly unknown
}

/**
 * A compact, DEBUG-SAFE diagnostics string the user can copy into a bug report.
 * Contains ONLY connection metadata (mode / origin / status / code). It must NEVER
 * include cookies, tokens, session ids, emails, or any identity — asserted by tests.
 */
export function formatAccountDiagnostics(d: AccountDiagnostics): string {
  const api = d.networkError ? 'network_error' : (d.status == null ? 'pending' : String(d.status));
  return [
    `Server: ${d.connectionMode === 'custom' ? 'Custom' : 'Default'}`,
    `Origin: ${d.apiBase}${d.sameOrigin ? ' (same-origin)' : ' (cross-origin)'}`,
    `API: ${d.endpoint} -> ${api}${d.code ? ` (${d.code})` : ''}`,
    `Auth: ${authState(d)}`,
  ].join('\n');
}
