// ---------------------------------------------------------------------------
// Client adaptor for the server avatar upload backend (Stage 17.1 API → 17.2 UI).
//
// Upload is multipart/form-data (a real FormData with the picked File) — never a
// JSON-encoded image body and never a remote URL. Delete hits the same endpoint. Both
// include the session cookie and, being SOFT like the rest of profileApi, never
// throw: a failure resolves to a typed error the Profile UI maps to a message.
//
// The returned `avatarImageUrl` is a same-origin, versioned URL
// (`/api/avatar/<id>.webp?v=<n>`) — distinct from the OAuth provider `avatarUrl`.
// ---------------------------------------------------------------------------

/** Why an upload failed, mapped from the HTTP status / error code to a UI message. */
export type AvatarUploadError =
  | 'unauthenticated' // 401 — no session
  | 'forbidden'       // 403 — guest may not sync
  | 'too_large'       // 413 — over the 2 MB / output cap
  | 'unsupported_type'// 400/415 — not a png/jpeg/webp we can process
  | 'rate_limited'    // 429 — too many uploads
  | 'unavailable'     // 503 — DB off or ffmpeg/DB processing unavailable
  | 'timeout'         // client AbortController fired — NO response within the client budget
  | 'server_timeout'  // 408 — the SERVER gave up receiving/processing (distinct from above)
  | 'network'         // fetch failed / offline
  | 'failed';         // anything else

/** Client-side upload timeout. A stalled request (server hang, slow mobile network,
 *  proxy buffering) must NEVER leave the button spinning forever — we abort and surface
 *  a clear, retryable error instead. Overridable for tests. */
export const AVATAR_UPLOAD_TIMEOUT_MS = 30_000;

export type AvatarUploadResult =
  | { ok: true; avatarImageUrl: string }
  | { ok: false; error: AvatarUploadError };

function mapError(status: number, code: unknown): AvatarUploadError {
  if (status === 0) return 'network';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 408) return 'server_timeout'; // server gave up receiving/processing
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  if (status === 400 || status === 415) {
    if (code === 'too_large') return 'too_large';
    if (code === 'unsupported_type' || code === 'invalid_image') return 'unsupported_type';
    return 'failed'; // no_file / expected_multipart → generic
  }
  return 'failed';
}

/**
 * POST /api/me/avatar — multipart upload of the picked image. The browser sets the
 * multipart boundary Content-Type from the FormData, so we DO NOT set it ourselves
 * (and never send JSON here). Returns the new same-origin avatar URL, or a typed error.
 *
 * A hard client TIMEOUT (AbortController) guarantees the call ALWAYS settles — a stalled
 * request resolves to a `timeout` error instead of hanging the "Uploading…" button.
 */
export async function uploadAvatar(
  base: string, file: File, timeoutMs: number = AVATAR_UPLOAD_TIMEOUT_MS,
): Promise<AvatarUploadResult> {
  const form = new FormData();
  form.append('file', file);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/me/avatar`, {
      method: 'POST', credentials: 'include', body: form, signal: controller.signal,
    });
    type Body = { avatarImageUrl?: string; error?: string };
    let data: Body | null = null;
    try { data = (await res.json()) as Body; } catch { /* empty/non-JSON */ }
    if (res.ok && data?.avatarImageUrl) return { ok: true, avatarImageUrl: data.avatarImageUrl };
    return { ok: false, error: mapError(res.status, data?.error) };
  } catch (err) {
    // AbortError = our timeout fired; anything else = a real network/fetch failure.
    return { ok: false, error: (err as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** DELETE /api/me/avatar — remove the synced avatar. Returns true on success. A short
 *  timeout keeps the "Remove" action from hanging if the request stalls. */
export async function deleteServerAvatar(base: string, timeoutMs: number = AVATAR_UPLOAD_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/me/avatar`, { method: 'DELETE', credentials: 'include', signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
