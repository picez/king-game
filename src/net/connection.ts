// ---------------------------------------------------------------------------
// Connection settings (Stage 14.2) — DEFAULT vs CUSTOM server, device-local.
//
// A normal player never types a server address: the app auto-uses the default
// (production / build-time VITE_WS_URL, or the same-origin host). A CUSTOM server
// address is an ADVANCED opt-in for LAN / dev / private deployments. The custom
// URL is a DEVICE/environment setting — kept in localStorage, NEVER synced to the
// profile/DB and NEVER in the WS protocol. Pure helpers here (no React/DOM); the
// default-URL derivation stays in net/online.ts (`defaultServerUrl`).
// ---------------------------------------------------------------------------

import type { StorageLike } from './session';
import { defaultServerUrl } from './online';

/** Device-local key for a custom server URL (product namespace). */
export const CUSTOM_SERVER_KEY = 'cardMajlis.customServer.v1';

/** Which connection the app is using right now. */
export type ConnectionMode = 'default' | 'custom';

/** Protocols the client can actually connect over (ws/wss for the socket; http(s)
 *  is accepted too since the API base is derived from the same host). */
const ALLOWED_PROTOCOLS = ['ws:', 'wss:', 'http:', 'https:'];

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Trims + validates a user-entered server URL. Returns the NORMALIZED URL, or null
 * when empty/invalid. Only ws/wss/http/https are accepted — `javascript:`, `data:`,
 * `file:`, mailto, etc. are rejected. A trailing slash on a non-root path is dropped
 * (so `ws://h:3001/ws/` → `ws://h:3001/ws`).
 */
export function normalizeServerUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  let u: URL;
  try { u = new URL(trimmed); } catch { return null; }
  if (!ALLOWED_PROTOCOLS.includes(u.protocol)) return null;
  if (!u.host) return null;
  let s = u.toString();
  if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
  return s;
}

/** Reads the saved custom server URL, or null when unset/invalid (→ default mode). */
export function loadCustomServer(storage: StorageLike | null = defaultStorage()): string | null {
  const v = storage?.getItem(CUSTOM_SERVER_KEY) ?? null;
  return v ? normalizeServerUrl(v) : null;
}

/** Validates + saves a custom server URL. Returns the normalized URL, or null when
 *  invalid (and stores nothing). */
export function saveCustomServer(raw: string, storage: StorageLike | null = defaultStorage()): string | null {
  const normalized = normalizeServerUrl(raw);
  if (!normalized) return null;
  try { storage?.setItem(CUSTOM_SERVER_KEY, normalized); return normalized; } catch { return null; }
}

/** Clears the custom server URL — the app falls back to the default. */
export function clearCustomServer(storage: StorageLike | null = defaultStorage()): void {
  try { storage?.removeItem(CUSTOM_SERVER_KEY); } catch { /* non-fatal */ }
}

/** 'custom' when a custom URL is set, else 'default'. */
export function connectionMode(customServer: string | null): ConnectionMode {
  return customServer ? 'custom' : 'default';
}

/**
 * The server URL the app should connect to: the CUSTOM URL when set, otherwise the
 * DEFAULT (`defaultServerUrl(loc, envUrl)`). `loc`/`envUrl` are passed through for
 * testability (mirrors defaultServerUrl's signature).
 */
export function resolveServerUrl(
  customServer: string | null,
  envUrl?: string,
  loc?: Parameters<typeof defaultServerUrl>[0],
): string {
  return customServer ?? defaultServerUrl(loc, envUrl);
}
