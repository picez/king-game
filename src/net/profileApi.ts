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
import type { CardStyle } from './userSettings';

export interface ApiUser {
  id: string;
  displayName: string | null;
  isGuest: boolean;
}

export interface GlobalSettingsDto {
  lang: Lang;
  avatar: string | null;
  cardStyle: CardStyle;
}

export interface MeResponse {
  authenticated: boolean;
  user: ApiUser | null;
  settings?: GlobalSettingsDto | null;
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

/** GET /api/me — current identity + settings, or null when unavailable. */
export async function fetchMe(base: string): Promise<MeResponse | null> {
  const { ok, data } = await call<MeResponse>(base, '/api/me');
  return ok ? data : null;
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
