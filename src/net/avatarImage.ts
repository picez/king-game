// ---------------------------------------------------------------------------
// Avatar image helpers (Stage 17.1) — PURE, dependency-free, client-safe.
//
// Byte-level detection + a minimal single-file multipart parser + WebP dimension
// reader + the same-origin URL shape for the server avatar backend. No Node
// imports and no DOM APIs beyond TextDecoder, so this module compiles for both the
// browser bundle and the server. All input is `Uint8Array` (a Node Buffer IS one).
//
// Security posture: type is decided by MAGIC BYTES, never a client-declared MIME.
// Only png/jpeg/webp are acceptable uploads; svg/gif/unknown are rejected. The
// actual decode/resize/re-encode (which strips metadata + neutralises polyglots)
// happens on the server in server/avatarProcess.ts — this file only classifies.
// ---------------------------------------------------------------------------

/** Raster types we can safely re-encode; svg/gif/unknown are detected only to reject. */
export type ImageType = 'png' | 'jpeg' | 'webp' | 'gif' | 'svg' | 'unknown';

/** Max upload the server will read before aborting (before processing). */
export const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB
/** Square edge (px) the processed avatar is cropped + resized to. */
export const AVATAR_OUTPUT_PX = 192;
/** Hard cap on the STORED processed WebP (reject rather than store anything larger). */
export const MAX_AVATAR_OUTPUT_BYTES = 120 * 1024; // 120 KB
/** The only stored/served content types (server always produces webp today). */
export const AVATAR_STORED_MIME = 'image/webp';

function startsWith(b: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (b.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[offset + i] !== sig[i]) return false;
  return true;
}

/**
 * Classifies an image by its leading bytes (and, for SVG, a light text sniff).
 * A lying `Content-Type` cannot fool this — only the actual container is trusted.
 */
export function detectImageType(bytes: Uint8Array): ImageType {
  if (bytes.length < 12) return 'unknown';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  // WebP: "RIFF"....(size)...."WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  // GIF: "GIF87a" / "GIF89a"
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  // SVG: text; sniff the first bytes for "<svg" / "<?xml" (skip a UTF-8 BOM).
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 256))).replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return 'unknown';
}

/** The raster types the server will process (png/jpeg/webp). */
export function isAcceptedUpload(type: ImageType): boolean {
  return type === 'png' || type === 'jpeg' || type === 'webp';
}

/**
 * Reads a WebP's canvas dimensions from its RIFF header. Supports the simple lossy
 * (`VP8 `), lossless (`VP8L`), and extended (`VP8X`) forms. Returns null if the
 * buffer is not a WebP we can measure. Used to record + verify the processed size.
 */
export function readWebpDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (!(startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))) return null;
  const fourcc = new TextDecoder('latin1').decode(b.subarray(12, 16));
  if (fourcc === 'VP8 ') {
    // Lossy keyframe: start code 9D 01 2A at offset 23, then 14-bit width/height.
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const width = ((b[26] | (b[27] << 8)) & 0x3fff);
    const height = ((b[28] | (b[29] << 8)) & 0x3fff);
    return { width, height };
  }
  if (fourcc === 'VP8L') {
    // Lossless: signature 0x2F at 20, then 14-bit (width-1) and (height-1).
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (fourcc === 'VP8X') {
    // Extended: 24-bit (canvas-1) at offsets 24 (width) and 27 (height), little-endian.
    if (b.length < 30) return null;
    const width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    const height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
    return { width, height };
  }
  return null;
}

/** Extracts the boundary token from a multipart/form-data Content-Type header. */
export function multipartBoundary(contentType: string | undefined | null): string | null {
  if (!contentType || !/multipart\/form-data/i.test(contentType)) return null;
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const raw = (m?.[1] ?? m?.[2] ?? '').trim();
  return raw || null;
}

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export interface MultipartFile {
  bytes: Uint8Array;
  /** The declared part Content-Type (informational only — NOT trusted for the type). */
  declaredType: string | null;
}

/**
 * Extracts the FIRST file part from a multipart/form-data body. Binary-safe (no
 * string coercion of the payload). Returns null on any malformed structure. The
 * caller re-derives the true image type from the bytes (magic bytes), never from
 * the declared part header — and never persists the (untrusted) filename.
 */
export function parseSingleFileMultipart(body: Uint8Array, boundary: string): MultipartFile | null {
  const enc = (s: string): Uint8Array => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
  const delim = enc(`--${boundary}`);
  const crlf2 = enc('\r\n\r\n');
  let start = indexOf(body, delim);
  if (start < 0) return null;
  start += delim.length;
  // Skip the CRLF after the boundary line.
  if (body[start] === 0x0d && body[start + 1] === 0x0a) start += 2;
  const headerEnd = indexOf(body, crlf2, start);
  if (headerEnd < 0) return null;
  const rawHeaders = new TextDecoder('latin1').decode(body.subarray(start, headerEnd));
  if (!/content-disposition:[^\n]*\bfilename=/i.test(rawHeaders)) return null; // must be a file part
  const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(rawHeaders);
  const declaredType = ctMatch ? ctMatch[1].trim() : null;
  const contentStart = headerEnd + crlf2.length;
  // The part ends at the CRLF that precedes the next boundary delimiter.
  const nextDelim = indexOf(body, enc(`\r\n--${boundary}`), contentStart);
  const contentEnd = nextDelim < 0 ? body.length : nextDelim;
  if (contentEnd < contentStart) return null;
  return { bytes: body.subarray(contentStart, contentEnd), declaredType };
}

/** UUID (v4-shaped) used for the opaque public avatar id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The same-origin served path for an avatar: `/api/avatar/<id>.webp?v=<version>`. */
export function avatarImageUrlPath(id: string, version: number): string {
  return `/api/avatar/${id}.webp?v=${version}`;
}

/**
 * True only for a SAME-ORIGIN avatar URL the server itself would mint —
 * `/api/avatar/<uuid>.webp` with an optional `?v=<n>`. Used server-side to validate
 * a persisted value on restore, and client-side as a hard gate before setting an
 * <img src> for another player (so a remote / `data:` / `javascript:` URL, even if
 * it somehow appeared in a payload, is rejected → the emoji fallback is used).
 */
export function isSafeAvatarImageUrl(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  return /^\/api\/avatar\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp(\?v=\d+)?$/i.test(v);
}

/**
 * Parses `/api/avatar/<id>.webp` → the opaque id, or null. The id MUST be a UUID —
 * this both identifies the row and makes path traversal impossible (no slashes /
 * dots / user input reach any filesystem or query beyond a parameterised lookup).
 */
export function avatarPublicIdFromPath(path: string): string | null {
  const m = /^\/api\/avatar\/([^/]+)\.webp$/.exec(path);
  if (!m) return null;
  return UUID_RE.test(m[1]) ? m[1].toLowerCase() : null;
}
