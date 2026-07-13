import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { sendFile, cacheControlFor } from '../../server/httpStatic';
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
  files.hashedJs = join(dir, 'assets', 'index-ABC12345.js');
  files.png = join(dir, 'spades-a.png');
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

describe('/api is no-store (never cached)', () => {
  it('GET /api/me responds with cache-control: no-store', async () => {
    delete process.env.DATABASE_URL;
    const out: { headers: Record<string, string> } = { headers: {} };
    const res = {
      headersSent: false, setHeader: () => {},
      writeHead(_s: number, h: Record<string, string> = {}) {
        out.headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
        this.headersSent = true; return this;
      },
      end() {},
    } as unknown as ServerResponse;
    const req = { method: 'GET', url: '/api/me', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
    await handleApiRequest(req, res);
    expect(out.headers['cache-control']).toBe('no-store');
  });
});
