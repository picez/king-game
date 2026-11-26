// Admin + feedback HTTP surface WITHOUT a database: everything degrades to 503, never a
// crash; the admin gate is not discoverable; guards that need no DB.
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleApiRequest } from '../../server/api';
import { adminRateOk, resetAdminRate } from '../../server/admin/routes';
import { clearPendingErrors, pendingErrors, reportServerError, splitLogLine } from '../../server/admin/errorSink';

function mockReq(method: string, url: string): IncomingMessage {
  return { method, url, headers: {}, socket: { remoteAddress: '127.0.0.1' }, on: () => {} } as unknown as IncomingMessage;
}
function mockRes() {
  const out: { status: number; body: unknown } = { status: 0, body: undefined };
  const res = {
    headersSent: false, setHeader: () => {},
    writeHead(status: number) { out.status = status; this.headersSent = true; return this; },
    end(body?: unknown) { if (body !== undefined) { try { out.body = JSON.parse(body as string); } catch { out.body = body; } } },
  } as unknown as ServerResponse;
  return { res, out };
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('admin API — no DB', () => {
  beforeEach(() => { delete process.env.DATABASE_URL; });
  for (const [m, u] of [
    ['GET', '/api/admin/stats'], ['GET', '/api/admin/users'], ['POST', '/api/admin/users/x/ban'],
    ['GET', '/api/announcement'], ['POST', '/api/feedback'], ['GET', '/api/me/inbox'],
  ] as const) {
    it(`${m} ${u} → 503 db_disabled`, async () => {
      const { res, out } = mockRes();
      await handleApiRequest(mockReq(m, u), res);
      expect(out.status).toBe(503);
    });
  }
});

describe('admin guards', () => {
  it('per-admin write limit is 30/min, reads 120/min, per admin', () => {
    resetAdminRate();
    const t = 1_000_000;
    for (let i = 0; i < 30; i++) expect(adminRateOk('a', 'write', t)).toBe(true);
    expect(adminRateOk('a', 'write', t)).toBe(false);
    expect(adminRateOk('b', 'write', t)).toBe(true);
    expect(adminRateOk('a', 'write', t + 61_000)).toBe(true);
    for (let i = 0; i < 120; i++) expect(adminRateOk('c', 'read', t)).toBe(true);
    expect(adminRateOk('c', 'read', t)).toBe(false);
  });

  it('a non-admin gets the SAME 404 as an unknown route (source guard)', () => {
    const src = read('server/admin/routes.ts');
    expect(src).toMatch(/if \(!userId\) return notFound\(\)/);
    expect(src).toMatch(/if \(!actor\) return notFound\(\)/);
  });

  it('every admin write in the store logs into admin_actions', () => {
    const src = read('server/admin/store.ts');
    for (const fn of ['banUser', 'unbanUser', 'resetNickname', 'resetAvatar', 'revokeSessions', 'deleteUser', 'resetStats',
      'setFeedbackStatus', 'replyFeedback', 'resolveError', 'setAnnouncement', 'clearAnnouncement', 'sendBroadcast', 'exportBackup']) {
      const body = src.slice(src.indexOf(`export async function ${fn}(`));
      const end = body.indexOf('\nexport ', 10);
      expect(body.slice(0, end > 0 ? end : undefined), fn).toMatch(/logAction\(/);
    }
    expect(src).toContain("'chips_adjust'");
  });

  it('a ban blocks the guest session and the Google sign-in', () => {
    const api = read('server/api.ts');
    expect(api).toContain("if (await isBanned(user.id).catch(() => false)) return json(res, 403, { error: 'banned' }");
    expect(api).toMatch(/redirectLogin\(req, res, 'banned'/);
  });

  it('the backup never exports sessions or avatar bytes', () => {
    const src = read('src/net/admin.ts');
    const list = src.slice(src.indexOf('BACKUP_TABLES'));
    expect(list).not.toMatch(/'sessions'|'user_avatars'|'rooms'/);
  });
});

describe('server error capture', () => {
  it('splits a [King] log line into where + message; ignores foreign lines', () => {
    expect(splitLogLine(['[King] DB error on GET /api/me → boom'])).toMatchObject({ where: 'DB error on GET /api/me' });
    expect(splitLogLine(['something else'])).toBeNull();
  });
  it('groups repeats by fingerprint and masks personal data', () => {
    clearPendingErrors();
    reportServerError('api', new Error('failed for a@b.com after 10ms'));
    reportServerError('api', new Error('failed for c@d.com after 20ms'));
    const p = pendingErrors();
    expect(p).toHaveLength(1);
    expect(p[0].count).toBe(2);
    expect(p[0].message).toContain('<email>');
    clearPendingErrors();
  });
});
