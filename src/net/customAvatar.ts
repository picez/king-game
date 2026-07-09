// ---------------------------------------------------------------------------
// Custom avatar — LOCAL-ONLY personalization (Stage 14.1).
//
// A user may pick a local image as their avatar. It is stored ONLY on this device
// (localStorage, as a small re-encoded data URL) — NEVER uploaded, NEVER put into
// the WS room protocol / game state, NEVER written to the DB or user_settings. The
// whitelisted EMOJI avatar remains the server-safe, cross-device identity (that is
// what online rooms + other players ever see). This module is the pure validation +
// local-store layer (no canvas/DOM); the browser-only canvas re-encode lives in
// src/ui/components/customAvatarImage.ts.
//
// Privacy/security: only png/jpeg/webp are accepted; SVG and everything else are
// rejected (no script vectors); the image is canvas-RE-ENCODED (strips EXIF + any
// original bytes/filename); a hard stored-size cap prevents localStorage abuse; no
// remote URLs are ever accepted (data: URLs only).
// ---------------------------------------------------------------------------

import type { StorageLike } from './session';

/** localStorage key. Uses the product namespace (the legacy `king.*` prefix stays
 *  for older keys — see prefs.ts — but new keys use the Card Majlis brand). */
export const CUSTOM_AVATAR_KEY = 'cardMajlis.customAvatar.v1';

/** Only real raster images the browser can safely re-encode. NO gif/svg/unknown. */
export const ACCEPTED_AVATAR_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Max INPUT file the user may pick (before re-encode). */
export const MAX_AVATAR_INPUT_BYTES = 2 * 1024 * 1024; // 2 MB
/** Square output edge (px) the image is center-cropped + resized to. */
export const AVATAR_OUTPUT_PX = 192;
/** WebP/JPEG export quality for the re-encode. */
export const AVATAR_EXPORT_QUALITY = 0.82;
/** Max STORED data-URL length (~a 120 KB payload as base64 ≈ 160 KB of chars). */
export const MAX_AVATAR_DATAURL_CHARS = 170_000;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Whether a MIME type is an accepted raster image (png/jpeg/webp only). */
export function isAcceptedAvatarType(type: unknown): boolean {
  return typeof type === 'string' && (ACCEPTED_AVATAR_MIME as readonly string[]).includes(type);
}

/** The `accept` attribute for the file input — exactly the whitelist. */
export const AVATAR_ACCEPT_ATTR = ACCEPTED_AVATAR_MIME.join(',');

/** Whether an input file exceeds the max input size. */
export function isAvatarInputTooLarge(bytes: number): boolean {
  return bytes > MAX_AVATAR_INPUT_BYTES;
}

/**
 * Validates a STORED avatar value: must be a `data:image/(png|jpeg|webp);base64,…`
 * URL, within the size cap, and NEVER an SVG or a remote (http/https) URL. Anything
 * else → not a valid custom avatar (the caller falls back to the emoji).
 */
export function isValidCustomAvatar(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (v.length > MAX_AVATAR_DATAURL_CHARS) return false;
  if (/^data:image\/svg/i.test(v)) return false;   // no SVG (script vector)
  if (/^https?:/i.test(v)) return false;           // no remote URLs
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v);
}

/** Loads the local custom avatar data URL, or null when unset/invalid. */
export function loadCustomAvatar(storage: StorageLike | null = defaultStorage()): string | null {
  const v = storage?.getItem(CUSTOM_AVATAR_KEY) ?? null;
  return isValidCustomAvatar(v) ? v : null;
}

/** Persists a re-encoded avatar data URL locally. Returns false if invalid/too big. */
export function saveCustomAvatar(dataUrl: string, storage: StorageLike | null = defaultStorage()): boolean {
  if (!isValidCustomAvatar(dataUrl)) return false;
  try { storage?.setItem(CUSTOM_AVATAR_KEY, dataUrl); return true; } catch { return false; }
}

/** Removes the local custom avatar (reset to the emoji). */
export function clearCustomAvatar(storage: StorageLike | null = defaultStorage()): void {
  try { storage?.removeItem(CUSTOM_AVATAR_KEY); } catch { /* non-fatal */ }
}
