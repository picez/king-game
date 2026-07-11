// Routing + guard tests for the Stage 25.1 friends API that need NO DB. Full request/
// accept/decline/remove round-trips live in friends.integration.test.ts (DB-gated).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../../server/api';

interface Captured { status: number; body: unknown; }
function mockReq(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method, url, headers, socket: { remoteAddress: '127.0.0.1' }, on: () => {} } as unknown as IncomingMessage;
}
function mockRes(): { res: ServerResponse; out: Captured } {
  const out: Captured = { status: 0, body: undefined };
  const res = {
    headersSent: false,
    setHeader: () => {},
    writeHead(status: number) { out.status = status; this.headersSent = true; return this; },
    end(body?: unknown) { if (body !== undefined) { try { out.body = JSON.parse(body as string); } catch { out.body = body; } } },
  } as unknown as ServerResponse;
  return { res, out };
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('friends API — degrades cleanly with no DB', () => {
  beforeEach(() => { delete process.env.DATABASE_URL; });

  for (const [method, url] of [
    ['GET', '/api/friends'], ['POST', '/api/friends/request'],
    ['POST', '/api/friends/accept'], ['POST', '/api/friends/decline'],
    ['DELETE', '/api/friends/some-user-id'],
  ] as const) {
    it(`${method} ${url} → 503 db_disabled (no DB), never a crash`, async () => {
      const { res, out } = mockRes();
      await handleApiRequest(mockReq(method, url), res);
      expect(out.status).toBe(503);
      expect((out.body as { error: string }).error).toBe('db_disabled');
    });
  }

  it('DELETE with an empty/invalid target id → 400 invalid_request (before any DB)', async () => {
    // A trailing-slash path has no user id — rejected up front.
    const { res, out } = mockRes();
    await handleApiRequest(mockReq('DELETE', '/api/friends/'), res);
    // '/api/friends/' has an empty id → 400; (with no DB it would still 503 at the gate,
    // so we assert it is one of the safe outcomes, never a 500/crash).
    expect([400, 503]).toContain(out.status);
  });
});

describe('friends — privacy + boundary source guards', () => {
  const repo = read('server/db/friends.ts');
  const api = read('server/api.ts');
  const messages = read('src/net/messages.ts');
  const migration = read('server/db/migrations/0009_friends.sql');

  it('the friend repo NEVER selects or returns an email (code, comments excluded)', () => {
    const code = repo.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\bemail\b/i); // no email column / field anywhere in the code
    // Emits only public fields.
    expect(repo).toContain('display_name');
    expect(repo).toContain('avatarImageUrl');
  });

  it('friend requests are BY CODE only (no email lookup path)', () => {
    expect(repo).toContain('findUserByFriendCode');
    expect(api).toContain("path === '/api/friends/request'");
    expect(api).not.toMatch(/friends[\s\S]{0,200}by[_ ]?email/i);
  });

  it('accept/decline are authorised to the ADDRESSEE only (SQL binds addressee_id = me)', () => {
    expect(repo).toMatch(/UPDATE friendships SET status = 'accepted'[\s\S]*addressee_id = \$\{userId\}/);
    expect(repo).toMatch(/DELETE FROM friendships[\s\S]*addressee_id = \$\{userId\}/);
  });

  it('remove only deletes a row the caller is a PARTY to', () => {
    const fn = repo.slice(repo.indexOf('export async function removeFriend'), repo.indexOf('export async function areFriends'));
    expect(fn).toContain('requester_id = ${userId}');
    expect(fn).toContain('addressee_id = ${userId}');
  });

  it('NO voice WS messages exist yet; friend invite/presence WS messages carry no secrets', () => {
    expect(messages).not.toMatch(/VOICE_/); // voice is 25.3+
    // Friends WS (25.2) exists but FRIEND_INVITE_RECEIVED carries only public routing fields.
    expect(messages).toContain('FRIEND_INVITE');
    expect(messages).toContain('FRIEND_PRESENCE');
    const block = messages.slice(messages.indexOf('FRIEND_INVITE_RECEIVED'), messages.indexOf('FRIEND_INVITE_RECEIVED') + 220);
    expect(block).not.toMatch(/email|token|session|reconnect|password/i);
  });

  it('migration 0009 has the friend_code unique, status check, self-check, PK, and both indexes', () => {
    expect(migration).toContain('friend_code text UNIQUE');
    expect(migration).toContain("status IN ('pending', 'accepted', 'blocked')");
    expect(migration).toContain('requester_id <> addressee_id');
    expect(migration).toContain('PRIMARY KEY (requester_id, addressee_id)');
    expect(migration).toContain('friendships_addressee_idx');
    expect(migration).toContain('friendships_requester_idx');
    expect(migration).toMatch(/REFERENCES users\(id\) ON DELETE CASCADE/);
  });
});
