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
import type { ServerResponse } from 'node:http';
import { isDbEnabled, checkDbHealth } from './db/client';

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
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function sendFile(res: ServerResponse, filePath: string, status = 200): Promise<void> {
  const body = await readFile(filePath);
  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  // Hashed assets are immutable; HTML / sw.js / manifest must re-check each load.
  const cache = filePath.includes(`${sep}assets${sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(status, { 'content-type': type, 'cache-control': cache });
  res.end(body);
}

export function notFound(res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('Not found');
}

export async function serveStatic(req: { url?: string }, res: ServerResponse): Promise<void> {
  let pathname = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  if (pathname === '/') pathname = '/index.html';
  const candidate = normalize(join(DIST, pathname));
  // Path-traversal guard: never serve outside DIST.
  if (candidate.startsWith(DIST) && existsSync(candidate) && statSync(candidate).isFile()) {
    return sendFile(res, candidate).catch(() => sendFile(res, INDEX_HTML).catch(() => notFound(res)));
  }
  // SPA fallback: unknown route → index.html (client router/refresh-safe).
  return sendFile(res, INDEX_HTML).catch(() => notFound(res));
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
