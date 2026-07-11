// ---------------------------------------------------------------------------
// Client adaptor for the Stage 4 profile/settings/guest HTTP API.
//
// SOFT by design: every call degrades gracefully. If the API is unreachable or
// the DB is disabled (503), the helpers resolve to `null`/`disabled` and the UI
// falls back to localStorage prefs exactly as before — there is NO login wall
// and local/guest play never depends on this module.
//
// `apiBaseFromWsUrl` is a pure, unit-tested mapping from the WebSocket URL the
// client already knows (ws(s)://host[:port]/ws) to the HTTP origin that serves
// the API (same single-service host). It is exported separately so it can be
// tested without a network.
// ---------------------------------------------------------------------------

import type { Lang } from '../i18n';
import type { CardStyle, AnimationPreference, FavoriteGame, CardFaceTheme } from './userSettings';

export interface ApiUser {
  id: string;
  displayName: string | null;
  isGuest: boolean;
  /** Whitelisted emoji avatar (from settings), if any. */
  avatar?: string | null;
}

export interface GlobalSettingsDto {
  lang: Lang;
  avatar: string | null;
  cardStyle: CardStyle;
  animationPreference: AnimationPreference;
  favoriteGame: FavoriteGame;
  cardFaceTheme: CardFaceTheme;
}

export interface MeResponse {
  authenticated: boolean;
  user: ApiUser | null;
  settings?: GlobalSettingsDto | null;
  /** Linked external provider, e.g. 'google' (Stage 6); null for guests. */
  provider?: string | null;
  /** Provider-reported email, if shared; null otherwise. */
  email?: string | null;
  /** Provider picture URL (informational; not the game avatar). */
  avatarUrl?: string | null;
  /**
   * Uploaded custom avatar (Stage 17.1): a same-origin, versioned URL
   * (`/api/avatar/<id>.webp?v=<n>`), or null. DISTINCT from `avatarUrl` (the OAuth
   * provider picture). Not consumed by any UI yet — the backend is hidden this stage.
   */
  avatarImageUrl?: string | null;
}

/**
 * Derives the HTTP(S) API base from the client's WebSocket URL. `wss://h/ws` →
 * `https://h`; `ws://h:3001/ws` → `http://h:3001`. Falls back to the page origin
 * for an unparseable input. Pure (no I/O).
 */
export function apiBaseFromWsUrl(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    const httpProto = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol;
    return `${httpProto}//${u.host}`;
  } catch {
    if (typeof window !== 'undefined' && window.location) return window.location.origin;
    return '';
  }
}

/** A single fetch wrapper: credentials included (cookie), JSON, never throws. */
async function call<T>(
  base: string, path: string, init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(`${base}${path}`, {
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
    let data: T | null = null;
    try { data = (await res.json()) as T; } catch { /* empty/non-JSON body */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    // Network error / server down / CORS — treat as "API unavailable".
    return { ok: false, status: 0, data: null };
  }
}

/**
 * Classified result of GET /api/me. Lets the UI tell a network/CORS failure (the
 * server is UNREACHABLE) apart from a reachable server whose account service is off
 * (a 503 `db_disabled` — sign-in isn't available, but the server is up). Carries no
 * secrets: only the parsed public body + the HTTP status.
 */
export interface MeProbe {
  /** The identity (a 200 response), else null. */
  me: MeResponse | null;
  /**
   * The server answered HEALTHILY — either a 200, OR a deliberate `503 db_disabled`
   * (a no-DB deploy that is up but simply offers no sign-in). FALSE for a network/
   * CORS failure (status 0) AND for a server error (other 5xx / proxy error), because
   * both of those are transient/unhealthy and get the "Retry" recovery, not the calm
   * "this server doesn't offer sign-in" message.
   */
  serverReachable: boolean;
  /** Sign-in / account service is available here (a 200 from /api/me). */
  authAvailable: boolean;
  /** HTTP status (0 = network / CORS failure). */
  status: number;
}

/**
 * GET /api/me — classified so the UI never conflates "not signed in" with "server
 * down". A 200 → reachable + auth available (identity may be a guest); a deliberate
 * `503 db_disabled` → reachable but sign-in off (calm, expected); anything else
 * (network failure, or a 5xx/proxy error) → unreachable → the UI offers Retry.
 */
export async function fetchMe(base: string): Promise<MeProbe> {
  const { ok, status, data } = await call<MeResponse & { error?: string }>(base, '/api/me');
  if (ok && data) return { me: data, serverReachable: true, authAvailable: true, status };
  // Only a clean `503 db_disabled` counts as "up but sign-in off". A network failure
  // (status 0) or any other error status (500/502/504 from a crashed app or proxy) is
  // treated as UNREACHABLE so the user gets Retry rather than a misleading message.
  const dbDisabled = status === 503 && (data as { error?: string } | null)?.error === 'db_disabled';
  return { me: null, serverReachable: dbDisabled, authAvailable: false, status };
}

/**
 * The Google sign-in entry point (full-page navigation, NOT fetch — the OAuth
 * redirect flow must happen at the top level so the session cookie is set).
 */
export function googleStartUrl(base: string): string {
  return `${base}/auth/google/start`;
}

/** POST /api/logout — revoke the current session. Returns true on success. */
export async function logout(base: string): Promise<boolean> {
  const { ok } = await call<{ ok: boolean }>(base, '/api/logout', { method: 'POST' });
  return ok;
}

/**
 * POST /api/guest-session — ensure a guest user + session for this device. The
 * server returns the (possibly newly generated) guestKey to persist locally.
 */
export async function ensureGuestSession(
  base: string, guestKey: string | null,
): Promise<{ user: ApiUser; guestKey: string; settings: GlobalSettingsDto | null } | null> {
  const { ok, data } = await call<{ user: ApiUser; guestKey: string; settings: GlobalSettingsDto | null }>(
    base, '/api/guest-session', { method: 'POST', body: JSON.stringify(guestKey ? { guestKey } : {}) },
  );
  return ok ? data : null;
}

/** PATCH /api/profile — update display name. */
export async function updateProfile(base: string, displayName: string): Promise<ApiUser | null> {
  const { ok, data } = await call<{ user: ApiUser }>(
    base, '/api/profile', { method: 'PATCH', body: JSON.stringify({ displayName }) },
  );
  return ok ? data?.user ?? null : null;
}

/** PATCH /api/settings — push a partial global-settings patch. */
export async function updateSettings(base: string, patch: Partial<GlobalSettingsDto>): Promise<GlobalSettingsDto | null> {
  const { ok, data } = await call<{ settings: GlobalSettingsDto }>(
    base, '/api/settings', { method: 'PATCH', body: JSON.stringify(patch) },
  );
  return ok ? data?.settings ?? null : null;
}

/** GET /api/games/king/settings — King per-game prefs (e.g. defaultTimer). */
export async function fetchKingSettings(base: string): Promise<{ defaultTimer: number } | null> {
  const { ok, data } = await call<{ settings: { defaultTimer?: number } }>(base, '/api/games/king/settings');
  if (!ok || !data) return null;
  return { defaultTimer: Number(data.settings?.defaultTimer ?? 0) };
}

/** PATCH /api/games/king/settings — push King per-game prefs. */
export async function updateKingSettings(base: string, settings: { defaultTimer: number }): Promise<{ defaultTimer: number } | null> {
  const { ok, data } = await call<{ settings: { defaultTimer?: number } }>(
    base, '/api/games/king/settings', { method: 'PATCH', body: JSON.stringify(settings) },
  );
  if (!ok || !data) return null;
  return { defaultTimer: Number(data.settings?.defaultTimer ?? 0) };
}
