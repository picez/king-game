// ---------------------------------------------------------------------------
// Browser-only avatar image processing (Stage 14.1). Kept OUT of the pure store
// module (src/net/customAvatar.ts) because it needs the DOM (Image/canvas). Takes
// a user-picked File, validates the type/size, center-crops to a square, resizes to
// AVATAR_OUTPUT_PX, and RE-ENCODES to WebP (JPEG fallback) — which strips EXIF and
// the original bytes/filename. Returns a small `data:` URL suitable for local
// storage. Never uploads, never touches the network. No new dependencies.
// ---------------------------------------------------------------------------

import {
  AVATAR_OUTPUT_PX, AVATAR_EXPORT_QUALITY,
  isAcceptedAvatarType, isAvatarInputTooLarge, isValidCustomAvatar,
} from '../../net/customAvatar';

/** Reasons a processing attempt can fail (mapped to a user message by the caller). */
export type AvatarProcessError = 'unsupported' | 'too_large' | 'decode_failed' | 'encode_failed';

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
 * Processes a picked File into a stored-ready avatar data URL, or rejects with an
 * `AvatarProcessError`. Type + input-size are validated FIRST (cheap, no decode).
 */
export async function processAvatarImage(file: File): Promise<string> {
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

  // Center-crop to a square (no crop UI), then draw resized into the square canvas.
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_OUTPUT_PX, AVATAR_OUTPUT_PX);

  // Prefer WebP; fall back to JPEG where WebP export is unsupported.
  let out = canvas.toDataURL('image/webp', AVATAR_EXPORT_QUALITY);
  if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', AVATAR_EXPORT_QUALITY);
  if (!isValidCustomAvatar(out)) throw new Error('too_large' satisfies AvatarProcessError);
  return out;
}
