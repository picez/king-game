// ---------------------------------------------------------------------------
// Browser-only avatar image processing (Stage 14.1). Kept OUT of the pure store
// module (src/net/customAvatar.ts) because it needs the DOM (Image/canvas). Takes
// a user-picked File, validates the type/size, center-crops to a square, resizes to
// AVATAR_OUTPUT_PX, and RE-ENCODES to WebP (JPEG fallback) — which strips EXIF and
// the original bytes/filename. Returns a small `data:` URL suitable for local
// storage. Never uploads, never touches the network. No new dependencies.
// ---------------------------------------------------------------------------

import { AVATAR_EXPORT_QUALITY, isValidCustomAvatar } from '../../net/customAvatar';
import { drawAvatarSquareCanvas, type AvatarProcessError } from '../../net/avatarCompress';

// The decode/crop/resize pipeline is shared with the synced-upload compressor
// (src/net/avatarCompress.ts). Re-exported so existing importers keep working.
export type { AvatarProcessError };

/**
 * Processes a picked File into a stored-ready avatar DATA URL (local-only path), or
 * rejects with an `AvatarProcessError`. Reuses the shared square-crop canvas, then
 * re-encodes to a WebP (JPEG fallback) data URL — which strips EXIF + the original bytes.
 */
export async function processAvatarImage(file: File): Promise<string> {
  const canvas = await drawAvatarSquareCanvas(file);
  // Prefer WebP; fall back to JPEG where WebP export is unsupported.
  let out = canvas.toDataURL('image/webp', AVATAR_EXPORT_QUALITY);
  if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', AVATAR_EXPORT_QUALITY);
  if (!isValidCustomAvatar(out)) throw new Error('too_large' satisfies AvatarProcessError);
  return out;
}
