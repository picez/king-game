// ---------------------------------------------------------------------------
// Static client hosting + /health (extracted from server/index.ts, Stage 8.1).
//
// Behaviour is byte-for-byte the same as before — this is a pure refactor.
// When a production build exists in ../dist, the same HTTP server that hosts the
// WS upgrade also serves the SPA (HTML/JS/CSS/icons) with an index.html fallback,
// so one Render Web Service hosts both client + WebSocket on one domain. In dev
// there is no dist/ and only /health + the WS endpoint respond.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import { isDbEnabled, checkDbHealth } from './db/client';
import { buildDiagnostics, type DiagnosticsInput } from './diagnostics';

export const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist');
const INDEX_HTML = join(DIST, 'index.html');
export const SERVE_STATIC = existsSync(INDEX_HTML);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// --- Cache-Control policy (Stage 28.1 — bandwidth) ---------------------------
// Three tiers, so a repeat visit re-downloads almost nothing:
//   • hashed Vite output (/assets/*.<hash>.js|css) — content-addressed, so it can
//     be cached forever and never revalidated.
//   • static media (images / audio / fonts under /cards, /visual, /icons, /sounds,
//     /chat-media, favicon) — NOT filename-hashed, so cached for a week and then
//     cheaply revalidated (ETag → 304). This is the big win: the ~10 MB of card
//     faces + hero art no longer re-download every session. CAVEAT: an in-place
//     asset change (same filename, new bytes) can take up to `max-age` to reach
//     clients — acceptable because these files are content-stable between deploys.
//   • app shell (index.html / sw.js / manifest / json) — `no-cache`: always
//     revalidated so a new build is picked up immediately (a 304 when unchanged).
const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
const CACHE_MEDIA = 'public, max-age=604800'; // 7 days, revalidatable (not immutable)
const CACHE_REVALIDATE = 'no-cache';

// Extensions treated as long-lived static media (get CACHE_MEDIA when not hashed).
const MEDIA_EXT = new Set([
  '.png', '.webp', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.mp3', '.webm', '.ogg', '.wav', '.woff2', '.woff',
]);
// Text-ish types worth gzip'ing on the fly (images/audio/fonts are already
// compressed — never re-compress those).
const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.css', '.json', '.svg', '.webmanifest', '.map', '.txt']);
const GZIP_MIN_BYTES = 512;

export function cacheControlFor(filePath: string, ext: string): string {
  if (filePath.includes(`${sep}assets${sep}`)) return CACHE_IMMUTABLE; // hashed → immutable
  if (MEDIA_EXT.has(ext)) return CACHE_MEDIA;                          // static media → week
  return CACHE_REVALIDATE;                                            // shell → revalidate
}

/** Weak validator from size + mtime — stable per build, cheap to compute. */
function etagFor(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

function acceptsGzip(headers?: IncomingHttpHeaders): boolean {
  const ae = headers?.['accept-encoding'];
  return typeof ae === 'string' && /\bgzip\b/.test(ae);
}

export async function sendFile(
  res: ServerResponse,
  filePath: string,
  status = 200,
  reqHeaders?: IncomingHttpHeaders,
  isHead = false,
): Promise<void> {
  const ext = extname(filePath).toLowerCase();
  const type = MIME[ext] ?? 'application/octet-stream';
  const cache = cacheControlFor(filePath, ext);

  const st = statSync(filePath);
  const etag = etagFor(st.size, st.mtimeMs);
  const lastModified = new Date(st.mtime).toUTCString();

  // Conditional request → 304 (no body). Makes revalidation of `no-cache` shell
  // files and post-expiry media essentially free. ETag is primary; If-Modified-
  // Since (second-granular) is the fallback. Applies to GET and HEAD alike.
  const inm = reqHeaders?.['if-none-match'];
  const ims = reqHeaders?.['if-modified-since'];
  const notModified =
    (typeof inm === 'string' && inm === etag) ||
    (typeof ims === 'string' && Number.isFinite(Date.parse(ims)) &&
      Date.parse(ims) >= Math.floor(st.mtimeMs / 1000) * 1000);
  if (status === 200 && notModified) {
    res.writeHead(304, { 'cache-control': cache, etag, 'last-modified': lastModified });
    res.end();
    return;
  }

  const headers: Record<string, string> = {
    'content-type': type,
    'cache-control': cache,
    etag,
    'last-modified': lastModified,
    vary: 'Accept-Encoding',
  };

  // gzip only compressible text (decide by uncompressed size — no read needed to
  // decide). Images/audio/fonts are already compressed and never re-gzipped.
  const useGzip = COMPRESSIBLE_EXT.has(ext) && st.size >= GZIP_MIN_BYTES && acceptsGzip(reqHeaders);

  if (useGzip) {
    // Must read+compress to know the encoded length so HEAD's Content-Length matches GET.
    const gz = gzipSync(await readFile(filePath));
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = String(gz.length);
    res.writeHead(status, headers);
    res.end(isHead ? undefined : gz);
    return;
  }

  // Non-compressed path: Content-Length is the file size — a HEAD needs no read.
  headers['content-length'] = String(st.size);
  if (isHead) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  res.writeHead(status, headers);
  res.end(await readFile(filePath));
}

export function notFound(res: ServerResponse, isHead = false): void {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(isHead ? undefined : 'Not found');
}

export async function serveStatic(
  req: { url?: string; headers?: IncomingHttpHeaders; method?: string },
  res: ServerResponse,
): Promise<void> {
  const isHead = req.method === 'HEAD';
  let pathname = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  if (pathname === '/') pathname = '/index.html';
  const candidate = normalize(join(DIST, pathname));
  // Path-traversal guard: never serve outside DIST.
  if (candidate.startsWith(DIST) && existsSync(candidate) && statSync(candidate).isFile()) {
    return sendFile(res, candidate, 200, req.headers, isHead)
      .catch(() => sendFile(res, INDEX_HTML, 200, req.headers, isHead).catch(() => notFound(res, isHead)));
  }
  // A MISSING path that looks like a static file (has an extension — .png/.css/.js/
  // .mp3 …) is a genuine 404, NOT the SPA shell. Returning index.html here would mask
  // a broken/misnamed asset as a 200 (Content-Type text/html) and turn cache/bandwidth
  // checks into false positives. Extension-less routes (/, /profile, /?room=CODE) still
  // fall back to index.html so the client router / a refresh keep working.
  if (extname(pathname) !== '') return notFound(res, isHead);
  return sendFile(res, INDEX_HTML, 200, req.headers, isHead).catch(() => notFound(res, isHead));
}

/**
 * /health — always 200 (the process is up). Reports `db`:
 *   • 'disabled' when no DATABASE_URL (file/memory MVP);
 *   • 'ok' / 'error' when a DB is configured (probed with `select 1`).
 * Never throws: a DB probe failure is reported as `db:'error'`, not a 5xx, so the
 * health check stays up. `roomCount` is the live room count from the server.
 */
export async function handleHealth(res: ServerResponse, roomCount: number): Promise<void> {
  const reply = (db: string) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', db, rooms: roomCount, uptime: Math.round(process.uptime()) }));
  };
  try {
    let db: string = 'disabled';
    if (isDbEnabled()) db = (await checkDbHealth()).state; // 'ok' | 'error' | 'disabled'
    reply(db);
  } catch {
    reply('error');
  }
}

/**
 * GET /health/diagnostics — a SAFE, PUBLIC operational snapshot (Stage 24.0).
 * Always 200, never throws (a diagnostics endpoint must not itself fail). Carries
 * only aggregate counts / booleans / a version + short commit / the public game-id
 * list — NEVER user/room/session/email/token/chat/card data (see diagnostics.ts and
 * its tests). Cheap: reads in-memory counters + the cached boot ffmpeg flag; it does
 * NOT probe the database (use plain /health for a live DB probe).
 */
export function handleDiagnostics(res: ServerResponse, input: DiagnosticsInput): void {
  try {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(buildDiagnostics(input)));
  } catch {
    if (!res.headersSent) res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  }
}
