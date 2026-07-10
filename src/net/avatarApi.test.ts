import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../../server/api';

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
