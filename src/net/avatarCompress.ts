// ---------------------------------------------------------------------------
// Browser-side avatar compression for the SYNCED upload (Stage 24.8).
//
// Before POST /api/me/avatar, the picked image is decoded, center-cropped to a square,
// resized to 192×192, and re-encoded to a SMALL WebP (JPEG fallback) via a quality
// ladder targeting <= ~100 KB. That keeps the upload payload tiny so the request is fast
// and rarely hits the Render timeout — the server STILL validates magic bytes, size,
// re-encodes and strips metadata (it stays authoritative; this is a speed optimisation).
//
// The canvas re-encode also strips EXIF/metadata and the original filename/bytes (the
// output File carries a synthetic `avatar.webp`/`avatar.jpg` name). Shares its decode +
// crop step with the LOCAL-only avatar (src/ui/components/customAvatarImage.ts), so there
// is one canvas pipeline. No new dependencies.
// ---------------------------------------------------------------------------

import {
  AVATAR_OUTPUT_PX, AVATAR_EXPORT_QUALITY,
  isAcceptedAvatarType, isAvatarInputTooLarge,
} from './customAvatar';

/** Reasons a compression attempt can fail (mapped to a user message by the caller). */
export type AvatarProcessError =
  | 'unsupported' | 'too_large' | 'decode_failed' | 'encode_failed' | 'compress_too_large';

/** Target upload payload cap — keeps POST /api/me/avatar fast on Render. */
export const MAX_AVATAR_UPLOAD_TARGET_BYTES = 100 * 1024; // 100 KB

/** WebP quality ladder (preferred, smaller); tried high→low until under the cap. */
const WEBP_QUALITY_LADDER = [AVATAR_EXPORT_QUALITY, 0.72, 0.62, 0.52];
/** JPEG fallback ladder (WebP export unsupported, or all WebP steps over the cap). */
const JPEG_QUALITY_LADDER = [0.78, 0.65, 0.55];

/** Loads a File into an HTMLImageElement via an object URL (revoked after load). */
function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode_failed')); };
    img.src = url;
  });
}

/**
 * Validate (type + input size) → decode → center-crop to a square → resize to
 * AVATAR_OUTPUT_PX. Shared by the local-only avatar (data URL) and the synced upload
 * (Blob). Throws an `AvatarProcessError`. Browser-only (needs Image + canvas).
 */
export async function drawAvatarSquareCanvas(file: File): Promise<HTMLCanvasElement> {
  if (!isAcceptedAvatarType(file.type)) throw new Error('unsupported' satisfies AvatarProcessError);
  if (isAvatarInputTooLarge(file.size)) throw new Error('too_large' satisfies AvatarProcessError);

  let img: HTMLImageElement;
  try { img = await loadImageFromFile(file); } catch { throw new Error('decode_failed' satisfies AvatarProcessError); }
  if (!img.width || !img.height) throw new Error('decode_failed' satisfies AvatarProcessError);

  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_OUTPUT_PX;
  canvas.height = AVATAR_OUTPUT_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('encode_failed' satisfies AvatarProcessError);

  const side = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_OUTPUT_PX, AVATAR_OUTPUT_PX);
  return canvas;
}

/** Promise wrapper for `canvas.toBlob` (resolves null when toBlob is unavailable). */
function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') { resolve(null); return; }
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}

/**
 * PURE ladder selection (extracted for unit testing with a mocked encoder — no real
 * canvas needed). Tries WebP high→low; if WebP is unsupported (the encoder returns a
 * non-webp/`null` blob) or every WebP step stays over `cap`, tries the JPEG ladder.
 * Returns the FIRST output at/under the cap (+ its synthetic filename), else null.
 */
export async function pickUnderCap(
  encode: (type: string, quality: number) => Promise<Blob | null>,
  cap: number = MAX_AVATAR_UPLOAD_TARGET_BYTES,
): Promise<{ blob: Blob; name: string } | null> {
  for (const q of WEBP_QUALITY_LADDER) {
    const blob = await encode('image/webp', q);
    if (!blob || blob.type !== 'image/webp') break; // WebP export unsupported → JPEG
    if (blob.size <= cap) return { blob, name: 'avatar.webp' };
  }
  for (const q of JPEG_QUALITY_LADDER) {
    const blob = await encode('image/jpeg', q);
    if (blob && blob.size <= cap) return { blob, name: 'avatar.jpg' };
  }
  return null;
}

/**
 * Compress a picked image to a small (<= ~100 KB) 192×192 WebP (JPEG fallback) File,
 * ready for the synced upload. Metadata/EXIF + the original filename/bytes are stripped
 * by the canvas re-encode; the output File uses a synthetic `avatar.webp`/`avatar.jpg`
 * name and an `image/webp`|`image/jpeg` type. Throws an `AvatarProcessError` on an
 * unsupported/too-large/undecodable image, or `compress_too_large` when even the lowest
 * quality stays over the cap.
 */
export async function compressAvatarForUpload(file: File): Promise<File> {
  const canvas = await drawAvatarSquareCanvas(file);
  const picked = await pickUnderCap((type, q) => canvasToBlob(canvas, type, q));
  if (!picked) throw new Error('compress_too_large' satisfies AvatarProcessError);
  return new File([picked.blob], picked.name, { type: picked.blob.type });
}
