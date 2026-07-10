// ---------------------------------------------------------------------------
// Avatar image processing (Stage 17.1) — server-side decode / crop / resize /
// re-encode, DEPENDENCY-FREE via ffmpeg (already used by the repo's asset scripts).
//
// Why ffmpeg and not a library: this repo keeps a deliberately lean dependency set
// and its CI `npm ci` is sensitive to native-module lockfile churn (the documented
// libc problem). A native decoder like `sharp` would add many optional platform
// packages to the lockfile — high risk of breaking CI — so we reuse the ffmpeg
// binary that dev + GitHub's ubuntu runner already provide (see AVATAR_UPLOAD_PLAN.md
// §3). ffmpeg is invoked with a FIXED argv reading stdin (`pipe:0`) and writing
// stdout (`pipe:1`) — no user-controlled path or filename, no shell — so there is
// no traversal / injection surface. The re-encode strips all metadata and rebuilds
// a clean WebP, neutralising EXIF and polyglot payloads.
//
// Hardening (Stage 17.4): a WATCHDOG kills a hung/slow ffmpeg after a timeout, and a
// STDOUT cap kills a process that streams more than a sane amount — neither can wedge
// a request or leak a child. Runtime note: if ffmpeg is absent (e.g. a minimal host),
// processing returns `unavailable` and the API answers 503 — the feature simply stays
// off there, with zero impact on gameplay or the rest of the API.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import {
  detectImageType, isAcceptedUpload, readWebpDimensions,
  AVATAR_OUTPUT_PX, MAX_AVATAR_OUTPUT_BYTES, AVATAR_STORED_MIME,
} from '../src/net/avatarImage';

/** The ffmpeg binary to run — `FFMPEG_PATH` (e.g. a Render-provided path) or `ffmpeg`
 *  on PATH. Read per-call so a runtime env / test override is honoured. */
function ffmpegBin(): string {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}
/** Watchdog: kill ffmpeg if it hasn't finished in time (env-overridable for tests). */
function timeoutMs(): number {
  const v = Number(process.env.AVATAR_FFMPEG_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 8000;
}
/** Hard ceiling on collected stdout — far above the 120 KB target; a bigger stream
 *  means a misbehaving process, so we kill it rather than buffer unbounded memory. */
const MAX_FFMPEG_STDOUT = 4 * 1024 * 1024;

export type ProcessResult =
  | { ok: true; mimeType: string; bytes: Buffer; byteSize: number; width: number; height: number }
  | { ok: false; reason: 'unsupported_type' | 'invalid_image' | 'too_large' | 'unavailable' };

/** Runs ffmpeg with a fixed argv, feeding `input` on stdin, collecting stdout. A
 *  watchdog kills a hung process (→ null); an oversized stdout stream also kills it. */
function runFfmpeg(args: string[], input: Buffer): Promise<Buffer | { unavailable: true } | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(ffmpegBin(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      return resolve({ unavailable: true });
    }
    const out: Buffer[] = [];
    let size = 0;
    let settled = false;
    const kill = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    const done = (v: Buffer | { unavailable: true } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    // Watchdog: a malformed/hostile input that hangs the decoder can't wedge the
    // request — kill and fail after the timeout.
    const timer = setTimeout(() => { kill(); done(null); }, timeoutMs());
    child.on('error', (e: NodeJS.ErrnoException) => done(e?.code === 'ENOENT' ? { unavailable: true } : null));
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_FFMPEG_STDOUT) { kill(); done(null); return; } // runaway output → abort
      out.push(c);
    });
    child.stdout.on('error', () => { /* ignore broken pipe on reject */ });
    child.on('close', (code) => done(code === 0 ? Buffer.concat(out) : null));
    // Feed the upload; ignore EPIPE if ffmpeg rejects the input early.
    child.stdin.on('error', () => { /* handled via close code */ });
    child.stdin.end(input);
  });
}

function encodeArgs(quality: number): string[] {
  const px = AVATAR_OUTPUT_PX;
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-i', 'pipe:0',
    '-map_metadata', '-1',
    '-vf', `scale=${px}:${px}:force_original_aspect_ratio=increase,crop=${px}:${px}`,
    '-frames:v', '1',
    '-c:v', 'libwebp', '-quality', String(quality),
    '-f', 'webp', 'pipe:1',
  ];
}

/**
 * Validates (magic bytes) then decodes → center-crops → resizes to a square →
 * re-encodes to a metadata-free WebP. Rejects svg/gif/unknown up front, and any
 * result over the hard cap (after one lower-quality retry). Returns `unavailable`
 * when ffmpeg cannot be launched.
 */
export async function processAvatarToWebp(input: Buffer): Promise<ProcessResult> {
  const type = detectImageType(input);
  if (!isAcceptedUpload(type)) {
    return { ok: false, reason: type === 'svg' || type === 'gif' ? 'unsupported_type' : 'invalid_image' };
  }
  for (const quality of [82, 60]) {
    const res = await runFfmpeg(encodeArgs(quality), input);
    if (res && 'unavailable' in res) return { ok: false, reason: 'unavailable' };
    if (!res || res.length === 0) return { ok: false, reason: 'invalid_image' };
    const dims = readWebpDimensions(res);
    if (!dims) return { ok: false, reason: 'invalid_image' };
    if (res.length <= MAX_AVATAR_OUTPUT_BYTES) {
      return { ok: true, mimeType: AVATAR_STORED_MIME, bytes: res, byteSize: res.length, width: dims.width, height: dims.height };
    }
    // else: too big at this quality → retry lower, then give up.
  }
  return { ok: false, reason: 'too_large' };
}

/** Cheap probe: is ffmpeg launchable here? Used by tests to skip gracefully. */
export function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(ffmpegBin(), ['-hide_banner', '-version'], { stdio: 'ignore' }); }
    catch { return resolve(false); }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
