import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { processAvatarToWebp, ffmpegAvailable } from '../../server/avatarProcess';
import { parseSingleFileMultipart } from './avatarImage';
import { handleApiRequest } from '../../server/api';

// Stage 17.4 — avatar upload security/release audit. Behavioural checks (ffmpeg
// watchdog, polyglot neutralisation, malformed input) + source-level hardening guards.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const hasFfmpeg = await ffmpegAvailable();

function synthPng(w = 300, h = 200): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 'lavfi', '-i', `color=c=red:s=${w}x${h},format=rgb24`,
      '-frames:v', '1', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1']);
    const out: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`exit ${code}`))));
  });
}

describe.skipIf(!hasFfmpeg)('ffmpeg processing — watchdog + polyglot neutralisation', () => {
  afterEach(() => { delete process.env.AVATAR_FFMPEG_TIMEOUT_MS; });

  it('a too-tight watchdog kills the process and fails cleanly (no hang)', async () => {
    process.env.AVATAR_FFMPEG_TIMEOUT_MS = '1'; // fires before ffmpeg can finish
    const png = await synthPng();
    const r = await processAvatarToWebp(png);
    expect(r.ok).toBe(false); // killed → not a crash, not a hang
  });

  it('a PNG polyglot (valid image + trailing junk) → a CLEAN 192 WebP, junk dropped', async () => {
    const png = await synthPng();
    const polyglot = Buffer.concat([png, Buffer.from('<<<TRAILING-SCRIPT-PAYLOAD>>>'.repeat(50))]);
    const r = await processAvatarToWebp(polyglot);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.width).toBe(192);
    expect(r.height).toBe(192);
    // The re-encoded output is a pure WebP and never carries the trailing payload.
    expect(r.bytes.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(r.bytes.includes(Buffer.from('TRAILING-SCRIPT-PAYLOAD'))).toBe(false);
  });
});

describe('malformed multipart never throws (returns null)', () => {
  const boundary = 'B';
  const enc = (s: string) => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));
  it('handles truncated / boundary-less / header-less bodies safely', () => {
    for (const body of [
      new Uint8Array(0),
      enc('garbage with no boundary at all'),
      enc(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a"`), // no header terminator
      enc(`--${boundary}\r\n\r\nno-disposition-body\r\n--${boundary}--`),                 // no filename
    ]) {
      expect(() => parseSingleFileMultipart(body, boundary)).not.toThrow();
      // The last two are structurally invalid → null; none crash.
    }
    expect(parseSingleFileMultipart(enc('nope'), boundary)).toBeNull();
  });
});

describe('GET avatar route — no path traversal, never serves arbitrary bytes', () => {
  beforeEach(() => { delete process.env.DATABASE_URL; });
  function mockReq(method: string, url: string): IncomingMessage {
    return { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' }, on: () => {} } as unknown as IncomingMessage;
  }
  function mockRes() {
    const out: { status: number; body: unknown } = { status: 0, body: undefined };
    const res = { headersSent: false, setHeader: () => {},
      writeHead(s: number) { out.status = s; this.headersSent = true; return this; },
      end(b?: unknown) { if (b !== undefined) { try { out.body = JSON.parse(b as string); } catch { out.body = b; } } },
    } as unknown as ServerResponse;
    return { res, out };
  }
  it('a traversal path is not treated as an avatar id (never a 200 body)', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('GET', '/api/avatar/..%2f..%2fsecret.webp'), res);
    expect(out.status).not.toBe(200);
    expect(out.body).not.toBeInstanceOf(Buffer);
  });
});

describe('source hardening guards', () => {
  const proc = read('server/avatarProcess.ts');
  const api = read('server/api.ts');
  const rate = read('server/avatarRateLimit.ts');
  const migration = read('server/db/migrations/0008_avatar_upload.sql');

  it('ffmpeg runs with a watchdog + SIGKILL + stdout cap, fixed pipes, no shell', () => {
    expect(proc).toContain('setTimeout');
    expect(proc).toContain("kill('SIGKILL')");
    expect(proc).toContain('MAX_FFMPEG_STDOUT');
    expect(proc).toContain("'pipe:0'");
    expect(proc).toContain("'pipe:1'");
    expect(proc).not.toContain('shell: true');
    // No logging of image bytes / body anywhere in the processor.
    expect(proc).not.toMatch(/console\.(log|info|error|warn)/);
  });

  it('serve clamps the content type to a safe image type + nosniff + immutable', () => {
    expect(api).toContain("stored.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/webp'");
    expect(api).toContain("'x-content-type-options': 'nosniff'");
    expect(api).toContain('public, max-age=31536000, immutable');
    expect(api).toContain("'content-disposition': 'inline'");
  });

  it('upload rate-limits BEFORE any DB/body work and checks Content-Length + guest', () => {
    // Rate limit precedes the getProfile (guest) query in the handler source order.
    const postIdx = api.indexOf('async function handlePostAvatar');
    const seg = api.slice(postIdx, api.indexOf('async function handleDeleteAvatar'));
    expect(seg.indexOf('allowAvatarUpload')).toBeLessThan(seg.indexOf("import('./db/users')"));
    expect(seg).toContain("req.headers['content-length']");
    expect(seg).toContain("error: 'guest_forbidden'");
    expect(seg).toContain("error: 'expected_multipart'");
    // No raw image / body logging in the upload handler.
    expect(seg).not.toMatch(/console\.[a-z]+\([^)]*(body|file|bytes|image)/i);
  });

  it('the OAuth picture is never copied into the uploaded avatarImageUrl', () => {
    const meIdx = api.indexOf('async function handleMe');
    const seg = api.slice(meIdx, api.indexOf('// ── avatar upload'));
    expect(seg).toContain('avatarUrl: account?.picture ?? null');
    expect(seg).toContain('avatarImageUrl: uploaded ?');
    expect(seg).not.toContain('avatarImageUrl: account');
  });

  it('rate limit is keyed by the server-resolved userId (unspoofable)', () => {
    expect(rate).toContain('allowAvatarUpload(userId');
    expect(rate).toContain('MAX_TRACKED_USERS'); // self-bounds
  });

  it('migration keeps unique(user_id) + cascade + bytea + no filename', () => {
    expect(migration).toMatch(/user_id\s+uuid\s+NOT NULL\s+UNIQUE/i);
    expect(migration).toMatch(/ON DELETE CASCADE/i);
    expect(migration).toContain('bytea');
    expect(migration).not.toMatch(/file_?name/i);
  });
});
