import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../../server/api';
import { uploadAvatar, deleteServerAvatar } from './avatarApi';

// Routing + boundary tests for the Stage 17.1 avatar backend that need NO DB and NO
// ffmpeg. Full processing/storage round-trips live in avatarProcess.test.ts (ffmpeg)
// and avatarUpload.integration.test.ts (DB). Here we verify the routes exist, degrade
// cleanly with no DB, and that NOTHING leaked into the WS protocol / room payload.

interface Captured { status: number; headers: Record<string, string>; body: unknown; }
function mockReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method, url, headers, socket: { remoteAddress: '127.0.0.1' }, on: () => {} } as unknown as IncomingMessage;
}
function mockRes(): { res: ServerResponse; out: Captured } {
  const out: Captured = { status: 0, headers: {}, body: undefined };
  const res = {
    headersSent: false,
    setHeader: () => {},
    writeHead(status: number, headers: Record<string, string> = {}) { out.status = status; out.headers = headers; this.headersSent = true; return this; },
    end(body?: unknown) { if (body !== undefined) { try { out.body = JSON.parse(body as string); } catch { out.body = body; } } },
  } as unknown as ServerResponse;
  return { res, out };
}

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('avatar API routing — degrades cleanly with no DB', () => {
  beforeEach(() => { delete process.env.DATABASE_URL; });

  it('POST /api/me/avatar → 503 db_disabled (no DB)', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('POST', '/api/me/avatar'), res);
    expect(out.status).toBe(503);
    expect((out.body as { error: string }).error).toBe('db_disabled');
  });

  it('DELETE /api/me/avatar → 503 db_disabled (no DB)', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('DELETE', '/api/me/avatar'), res);
    expect(out.status).toBe(503);
    expect((out.body as { error: string }).error).toBe('db_disabled');
  });

  it('GET /api/avatar/<uuid>.webp → 404 image-miss (no DB), NOT a JSON 503', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('GET', '/api/avatar/3f2504e0-4f89-41d3-9a0c-0305e82c3301.webp'), res);
    expect(out.status).toBe(404);
    expect(out.body).toBe('Not found');
  });

  it('OPTIONS preflight advertises DELETE (needed for avatar remove)', async () => {
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('OPTIONS', '/api/me/avatar'), res);
    expect(out.status).toBe(204);
    expect(out.headers['access-control-allow-methods']).toContain('DELETE');
  });
});

describe('privacy / boundary guards — nothing leaks onto the wire', () => {
  const messages = read('src/net/messages.ts');
  const serverCore = read('src/net/serverCore.ts');
  const repo = read('server/db/userAvatars.ts');
  const migration = read('server/db/migrations/0008_avatar_upload.sql');
  const proc = read('server/avatarProcess.ts');

  it('the WS protocol (messages.ts) carries no image BYTES / blob (only a URL is added in 17.3)', () => {
    // Stage 17.3 adds an OPTIONAL same-origin `avatarImageUrl` (a URL, not bytes).
    for (const needle of ['avatar_image', 'data:image', 'bytea', 'multipart', 'base64']) {
      expect(messages, `messages.ts must not mention ${needle}`).not.toContain(needle);
    }
  });

  it('the room payload (serverCore.ts) emits the avatar URL ONLY behind the same-origin gate', () => {
    // 17.3: the snapshot may carry avatarImageUrl, but only a validated same-origin
    // value — never raw bytes / a data URI.
    expect(serverCore).toContain('isSafeAvatarImageUrl(m.avatarImageUrl)');
    expect(serverCore).not.toMatch(/data:image|base64/i);
  });

  it('no user-controlled filename is stored (repo + migration)', () => {
    expect(repo).not.toMatch(/file_?name/i);
    expect(migration).not.toMatch(/file_?name/i);
  });

  it('ffmpeg is invoked via fixed stdin/stdout pipes, no shell, no path', () => {
    expect(proc).toContain("'pipe:0'");
    expect(proc).toContain("'pipe:1'");
    expect(proc).not.toContain('shell: true');
    expect(proc).not.toContain('shell:true');
  });

  it('the upload API accepts multipart only — never JSON base64 / a remote URL', () => {
    const api = read('server/api.ts');
    // The handler reads a raw multipart body; it does not JSON-parse the avatar,
    // and there is no url/base64 field parsed for the image.
    expect(api).toContain('multipartBoundary');
    expect(api).toContain('parseSingleFileMultipart');
    expect(api).not.toMatch(/avatar[^\n]*base64/i);
  });
});

describe('uploadAvatar client — always settles (no stuck "Uploading…")', () => {
  afterEach(() => vi.unstubAllGlobals());
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });
  const resp = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300, status, json: async () => body,
  });

  it('a stalled request is ABORTED by the timeout → a retryable `timeout` error (never hangs)', async () => {
    // fetch that only ever rejects when the AbortController fires — models a server hang.
    vi.stubGlobal('fetch', (_url: string, opts: { signal?: AbortSignal }) => new Promise((_res, rej) => {
      opts.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const r = await uploadAvatar('http://x', png(), 20); // 20 ms timeout
    expect(r).toEqual({ ok: false, error: 'timeout' });
  });

  it('a 200 with a URL succeeds; a 503 → unavailable; a 408 → timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, { avatarImageUrl: '/api/avatar/x.webp?v=1' })));
    expect(await uploadAvatar('http://x', png())).toEqual({ ok: true, avatarImageUrl: '/api/avatar/x.webp?v=1' });
    vi.stubGlobal('fetch', vi.fn(async () => resp(503, { error: 'unavailable' })));
    expect((await uploadAvatar('http://x', png())).ok).toBe(false);
    expect(await uploadAvatar('http://x', png())).toEqual({ ok: false, error: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => resp(408, { error: 'upload_timeout' })));
    expect(await uploadAvatar('http://x', png())).toEqual({ ok: false, error: 'server_timeout' });
  });

  it('a server 408 (server_timeout) is DISTINCT from the client AbortController timeout', async () => {
    // 408 = the server gave up receiving/processing → its own message ("smaller image").
    vi.stubGlobal('fetch', vi.fn(async () => resp(408, { error: 'upload_timeout' })));
    const server = await uploadAvatar('http://x', png());
    // AbortError = the CLIENT budget elapsed with no response at all.
    vi.stubGlobal('fetch', (_u: string, o: { signal?: AbortSignal }) => new Promise((_r, rej) => {
      o.signal?.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })));
    }));
    const client = await uploadAvatar('http://x', png(), 20);
    expect(server).toEqual({ ok: false, error: 'server_timeout' });
    expect(client).toEqual({ ok: false, error: 'timeout' });
  });

  it('a real fetch failure (not an abort) maps to `network`, and never throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed'); }));
    await expect(uploadAvatar('http://x', png())).resolves.toEqual({ ok: false, error: 'network' });
    await expect(deleteServerAvatar('http://x')).resolves.toBe(false);
  });
});

describe('avatar upload never hangs — source guards', () => {
  const api = read('src/net/avatarApi.ts');
  const panel = read('src/ui/menu/ProfilePanel.tsx');
  const server = read('server/api.ts');

  it('the client upload uses an AbortController timeout and always clears its timer', () => {
    expect(api).toContain('new AbortController()');
    expect(api).toContain('signal: controller.signal');
    expect(api).toMatch(/finally \{\s*clearTimeout\(timer\)/);
  });

  it('ProfilePanel clears the busy flag in finally and resets the file input on every pick', () => {
    const fn = panel.slice(panel.indexOf('function onPickSynced'), panel.indexOf('function onPickSynced') + 700);
    expect(fn).toContain("e.target.value = ''");        // same file can be re-picked after a failure
    expect(fn).toMatch(/finally \{\s*setSyncedBusy\(false\)/); // button never stuck disabled
    // timeout / network / compression map to their own clear messages.
    expect(panel).toContain("case 'timeout': return t('avatar.errTimeout')");
    expect(panel).toContain("case 'server_timeout': return t('avatar.errServerTimeout')");
    expect(panel).toContain("case 'compress_failed': return t('avatar.errCompress')");
    expect(panel).toContain("case 'compress_too_large': return t('avatar.errCompressTooLarge')");
    expect(panel).toContain("case 'network': return t('avatar.errNetwork')");
    // The busy button shows a PHASE (Preparing… → Uploading…), and resets it in finally.
    expect(panel).toContain('setSyncedPhase');
    expect(panel).toMatch(/syncedPhase === 'preparing' \? t\('avatar\.preparing'\)/);
    expect(fn).toContain("setSyncedPhase('preparing')");
    expect(fn).toMatch(/uploadAvatarImage\(file, \(\) => setSyncedPhase\('uploading'\)\)/);
    // The safe error code is surfaced in small text so a stuck user can report it.
    expect(panel).toContain('syncedErrorCode');
    expect(panel).toContain('avatar-error__code');
  });

  it('the server body read has a watchdog → a stalled upload returns 408, never pends forever', () => {
    expect(server).toContain('bodyTimeoutMs');
    expect(server).toMatch(/reason: 'timeout'/);
    expect(server).toContain("error: 'upload_timeout'"); // 408 → the client maps to server_timeout
  });

  it('every avatar-upload phase is bounded < the client budget and logged safely', () => {
    // Body read (12s) < ffmpeg (8s watchdog) < DB write (withTimeout) — all under the
    // client's 30s, so the client gets our 408/503, not its own AbortController timeout.
    expect(server).toContain('bodyTimeoutMs');
    expect(server).toContain('dbWriteTimeoutMs');
    expect(server).toMatch(/withTimeout\(upsertAvatar/);
    expect(server).toContain("error: 'processing_unavailable'"); // ffmpeg/DB unavailable/timeout → 503
    // Phase-timing logs exist for diagnosis and carry NO secrets (only phase + a number).
    expect(server).toContain('logAvatarPhase');
    for (const p of ['upload_start', 'body_read_start', 'ffmpeg_start', 'db_write_start', 'response_sent']) {
      expect(server, p).toContain(`logAvatarPhase('${p}'`);
    }
    const fn = server.slice(server.indexOf('function logAvatarPhase'), server.indexOf('function logAvatarPhase') + 300);
    expect(fn).not.toMatch(/email|token|session|filename|userId|\.bytes/i);
  });
});
