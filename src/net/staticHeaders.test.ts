import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { sendFile, cacheControlFor, serveStatic, SERVE_STATIC } from '../../server/httpStatic';
import { handleApiRequest } from '../../server/api';

// ---------------------------------------------------------------------------
// Stage 28.1 — static-asset bandwidth. Guards the Cache-Control tiers, ETag/304
// revalidation, and gzip so a repeat visit re-downloads almost nothing (the
// ~10 MB of card faces + hero art was previously served `no-cache`, no ETag, so
// every session re-fetched it in full). Also pins /api as `no-store`.
// ---------------------------------------------------------------------------

interface Captured { status: number; headers: Record<string, string>; body: Buffer; ended: boolean; }

function mockRes(): { res: ServerResponse; out: Captured } {
  const out: Captured = { status: 0, headers: {}, body: Buffer.alloc(0), ended: false };
  const res = {
    headersSent: false,
    setHeader: () => {},
    writeHead(status: number, headers: Record<string, string> = {}) {
      out.status = status;
      // Lower-case keys for stable lookups.
      out.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
      this.headersSent = true; return this;
    },
    end(body?: Buffer | string) {
      if (body) out.body = Buffer.isBuffer(body) ? body : Buffer.from(body);
      out.ended = true;
    },
  } as unknown as ServerResponse;
  return { res, out };
}

let dir: string;
const files: Record<string, string> = {};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'static-headers-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  mkdirSync(join(dir, 'cards', 'faces'), { recursive: true });
  files.hashedJs = join(dir, 'assets', 'index-ABC12345.js');
  files.png = join(dir, 'spades-a.png');
  // A real card-face filename, so we exercise the exact name the app requests.
  files.cardFace = join(dir, 'cards', 'faces', 'spades-a.png');
  writeFileSync(files.cardFace, Buffer.from([0x89, 0x50, 0x4e, 0x47, ...new Array(600).fill(1)]));
  files.webp = join(dir, 'felt.webp');
  files.mp3 = join(dir, 'chime.mp3');
  files.html = join(dir, 'index.html');
  files.sw = join(dir, 'sw.js');
  files.manifest = join(dir, 'manifest.webmanifest');
  // A compressible payload well over the gzip threshold.
  writeFileSync(files.hashedJs, `console.log("${'x'.repeat(4000)}");`);
  writeFileSync(files.png, Buffer.from([0x89, 0x50, 0x4e, 0x47, ...new Array(600).fill(0)]));
  writeFileSync(files.webp, Buffer.alloc(300));
  writeFileSync(files.mp3, Buffer.alloc(300));
  writeFileSync(files.html, `<!doctype html><title>t</title>${'<!-- pad -->'.repeat(80)}`);
  writeFileSync(files.sw, `/* sw */ ${'x'.repeat(1000)}`);
  writeFileSync(files.manifest, JSON.stringify({ name: 'x', pad: 'y'.repeat(600) }));
});

afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('cacheControlFor — three tiers', () => {
  it('hashed /assets/* → immutable, one year', () => {
    expect(cacheControlFor(`${sep}app${sep}dist${sep}assets${sep}index-ABC.js`, '.js'))
      .toBe('public, max-age=31536000, immutable');
  });
  it('static media (png/webp/mp3/woff2/svg) → a week, revalidatable (NOT immutable)', () => {
    for (const ext of ['.png', '.webp', '.jpg', '.gif', '.mp3', '.webm', '.woff2', '.svg', '.ico']) {
      const cc = cacheControlFor(`${sep}dist${sep}cards${sep}x${ext}`, ext);
      expect(cc, ext).toBe('public, max-age=604800');
      expect(cc, `${ext} must not be immutable`).not.toContain('immutable');
    }
  });
  it('app shell (index.html / sw.js / manifest / json) → no-cache (always revalidate)', () => {
    expect(cacheControlFor(`${sep}dist${sep}index.html`, '.html')).toBe('no-cache');
    expect(cacheControlFor(`${sep}dist${sep}sw.js`, '.js')).toBe('no-cache'); // NOT under /assets/
    expect(cacheControlFor(`${sep}dist${sep}manifest.webmanifest`, '.webmanifest')).toBe('no-cache');
  });
});

describe('sendFile — headers, MIME, ETag', () => {
  it('serves hashed JS immutable with an ETag + Last-Modified', async () => {
    const { res, out } = mockRes();
    await sendFile(res, files.hashedJs, 200);
    expect(out.status).toBe(200);
    expect(out.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(out.headers['etag']).toMatch(/^W\/"/);
    expect(out.headers['last-modified']).toBeTruthy();
  });

  it('gives images a week-long cache + correct MIME (webp/png/mp3 no longer octet-stream)', async () => {
    const cases: [string, string][] = [[files.png, 'image/png'], [files.webp, 'image/webp'], [files.mp3, 'audio/mpeg']];
    for (const [file, mime] of cases) {
      const { res, out } = mockRes();
      await sendFile(res, file, 200);
      expect(out.headers['content-type']).toBe(mime);
      expect(out.headers['cache-control']).toBe('public, max-age=604800');
    }
  });

  it('serves the app shell no-cache (revalidated every load)', async () => {
    const { res, out } = mockRes();
    await sendFile(res, files.html, 200);
    expect(out.headers['cache-control']).toBe('no-cache');
    expect(out.headers['content-type']).toContain('text/html');
  });
});

describe('conditional requests → 304 (the bandwidth win)', () => {
  it('returns 304 with no body when If-None-Match matches the ETag', async () => {
    const first = mockRes();
    await sendFile(first.res, files.png, 200);
    const etag = first.out.headers['etag'];
    expect(etag).toBeTruthy();

    const second = mockRes();
    const reqHeaders = { 'if-none-match': etag } as IncomingHttpHeaders;
    await sendFile(second.res, files.png, 200, reqHeaders);
    expect(second.out.status).toBe(304);
    expect(second.out.body.length).toBe(0);
    expect(second.out.headers['cache-control']).toBe('public, max-age=604800');
  });

  it('does NOT 304 a fresh (non-matching) ETag', async () => {
    const { res, out } = mockRes();
    await sendFile(res, files.png, 200, { 'if-none-match': 'W/"deadbeef-1"' } as IncomingHttpHeaders);
    expect(out.status).toBe(200);
    expect(out.body.length).toBeGreaterThan(0);
  });
});

describe('gzip for compressible text (never for images)', () => {
  it('gzips JS when the client accepts it, and the body round-trips', async () => {
    const { res, out } = mockRes();
    await sendFile(res, files.hashedJs, 200, { 'accept-encoding': 'gzip, deflate, br' } as IncomingHttpHeaders);
    expect(out.headers['content-encoding']).toBe('gzip');
    expect(out.headers['vary']).toBe('Accept-Encoding');
    expect(gunzipSync(out.body).toString()).toContain('console.log');
  });

  it('does NOT gzip when the client does not accept it', async () => {
    const { res, out } = mockRes();
    await sendFile(res, files.hashedJs, 200, {} as IncomingHttpHeaders);
    expect(out.headers['content-encoding']).toBeUndefined();
  });

  it('never gzips already-compressed images even with Accept-Encoding gzip', async () => {
    const { res, out } = mockRes();
    await sendFile(res, files.png, 200, { 'accept-encoding': 'gzip' } as IncomingHttpHeaders);
    expect(out.headers['content-encoding']).toBeUndefined();
  });
});

describe('real card face + HEAD (Stage 28.1b)', () => {
  it('serves /cards/faces/spades-a.png as image/png with a week cache + ETag', async () => {
    const { res, out } = mockRes();
    await sendFile(res, files.cardFace, 200);
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toBe('image/png');
    expect(out.headers['cache-control']).toBe('public, max-age=604800');
    expect(out.headers['etag']).toMatch(/^W\/"/);
    expect(out.headers['last-modified']).toBeTruthy();
    expect(out.body.length).toBeGreaterThan(0);
  });

  it('HEAD returns the same headers but NO body, with a real Content-Length', async () => {
    const get = mockRes();
    await sendFile(get.res, files.cardFace, 200);
    const head = mockRes();
    await sendFile(head.res, files.cardFace, 200, undefined, true /* isHead */);
    expect(head.out.status).toBe(200);
    expect(head.out.body.length).toBe(0);                                   // no body
    expect(head.out.headers['content-type']).toBe('image/png');
    expect(head.out.headers['content-length']).toBe(get.out.headers['content-length']); // matches GET
    expect(Number(head.out.headers['content-length'])).toBeGreaterThan(0);
  });
});

function reqTo(url: string, method = 'GET', headers: Record<string, string> = {}) {
  return { url, method, headers } as unknown as IncomingMessage;
}

describe('serveStatic routing: missing file-like path → 404, app route → shell (Stage 28.1b)', () => {
  it('a MISSING .png returns 404 — NOT the html app shell', async () => {
    const { res, out } = mockRes();
    await serveStatic(reqTo('/cards/faces/NOPE.png'), res);
    expect(out.status).toBe(404);
    expect(out.headers['content-type'] ?? '').not.toContain('text/html');
    expect(out.headers['cache-control']).toBe('no-store');
  });

  it('missing .css / .js / .mp3 all 404 (not a 200 shell)', async () => {
    for (const url of ['/styles/nope.css', '/assets/nope.js', '/sounds/nope.mp3']) {
      const { res, out } = mockRes();
      await serveStatic(reqTo(url), res);
      expect(out.status, url).toBe(404);
      expect(out.headers['content-type'] ?? '', url).not.toContain('text/html');
    }
  });

  it('HEAD of a missing .png → 404 with no body', async () => {
    const { res, out } = mockRes();
    await serveStatic(reqTo('/cards/faces/NOPE.png', 'HEAD'), res);
    expect(out.status).toBe(404);
    expect(out.body.length).toBe(0);
  });

  // The following need a real ../dist build (SERVE_STATIC). They run after `npm run
  // build`; in a build-less unit pass they skip rather than assert on absent files.
  it.skipIf(!SERVE_STATIC)('serves the real built card face PNG (GET) with image/png + week cache', async () => {
    const { res, out } = mockRes();
    await serveStatic(reqTo('/cards/faces/spades-a.png'), res);
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toBe('image/png');
    expect(out.headers['cache-control']).toBe('public, max-age=604800');
    expect(out.headers['etag']).toMatch(/^W\/"/);
  });

  it.skipIf(!SERVE_STATIC)('serves a real sound with audio/mpeg (GET)', async () => {
    const { res, out } = mockRes();
    await serveStatic(reqTo('/sounds/bid-tick.mp3'), res);
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toBe('audio/mpeg');
    expect(out.headers['cache-control']).toBe('public, max-age=604800');
  });

  it.skipIf(!SERVE_STATIC)('an extensionless app route falls back to index.html (200 text/html)', async () => {
    for (const url of ['/profile', '/some/deep/route']) {
      const { res, out } = mockRes();
      await serveStatic(reqTo(url), res);
      expect(out.status, url).toBe(200);
      expect(out.headers['content-type'], url).toContain('text/html');
      expect(out.headers['cache-control'], url).toBe('no-cache'); // shell revalidates
    }
  });

  it.skipIf(!SERVE_STATIC)('the root and a ?room= invite both serve the shell', async () => {
    for (const url of ['/', '/?room=ABCD']) {
      const { res, out } = mockRes();
      await serveStatic(reqTo(url), res);
      expect(out.status, url).toBe(200);
      expect(out.headers['content-type'], url).toContain('text/html');
    }
  });
});

describe('/api and /auth are no-store (never cached)', () => {
  function headersFor() {
    const out: { headers: Record<string, string>; status: number } = { headers: {}, status: 0 };
    const res = {
      headersSent: false, setHeader: () => {},
      writeHead(s: number, h: Record<string, string> = {}) {
        out.status = s;
        out.headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
        this.headersSent = true; return this;
      },
      end() {},
    } as unknown as ServerResponse;
    return { res, out };
  }
  const call = async (url: string) => {
    delete process.env.DATABASE_URL;
    const { res, out } = headersFor();
    const req = { method: 'GET', url, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
    await handleApiRequest(req, res);
    return out;
  };

  it('GET /api/me → no-store', async () => {
    expect((await call('/api/me')).headers['cache-control']).toBe('no-store');
  });
  it('GET /api/games (public) → no-store', async () => {
    expect((await call('/api/games')).headers['cache-control']).toBe('no-store');
  });
  it('GET /auth/google/start → no-store (never cached)', async () => {
    // With no OAuth/DB config this degrades to a 503 JSON — but still no-store, so a
    // stale auth response can never be cached.
    expect((await call('/auth/google/start')).headers['cache-control']).toBe('no-store');
  });
});
