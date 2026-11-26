// ---------------------------------------------------------------------------
// Stage 44.0 — the admin + feedback store against a REAL PostgreSQL.
//
// SKIPPED unless TEST_DATABASE_URL points at a database migrated through 0015:
//
//   docker run -d --name kg-pg-44 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kingtest \
//     -p 55437:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55437/kingtest npm run db:migrate
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:55437/kingtest \
//     npx vitest run src/net/admin.integration.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';

const URL_ = process.env.TEST_DATABASE_URL;
let seq = 0;

async function store() { process.env.DATABASE_URL = URL_; return import('../../server/admin/store'); }
async function sql() {
  process.env.DATABASE_URL = URL_;
  const { getDb } = await import('../../server/db/client');
  return (await getDb())!.sql as unknown as import('postgres').Sql;
}
async function newAccount(tag: string, email: string | null = null): Promise<string> {
  process.env.DATABASE_URL = URL_;
  const users = await import('../../server/db/users');
  return users.createAccountUser({ email, name: `ADM-${tag}-${seq++}`, emailVerified: !!email });
}
async function newSession(userId: string): Promise<void> {
  const { createSession } = await import('../../server/db/sessions');
  await createSession({ userId, tokenHash: `h-${randomUUID()}`, expiresAt: new Date(Date.now() + 3_600_000) });
}

describe.skipIf(!URL_)('admin store on Postgres (Stage 44.0)', () => {
  const adminEmail = `boss-${Date.now()}@example.com`;
  const emails = new Set([adminEmail]);
  let adminId = '';
  let actor = { id: '', label: '' };

  beforeAll(async () => {
    adminId = await newAccount('boss', adminEmail);
    const s = await store();
    const a = await s.isAdminUser(adminId, emails);
    expect(a).not.toBeNull();
    actor = a!;
  });

  it('only a listed, verified, non-guest, non-banned email is an admin', async () => {
    const s = await store();
    const other = await newAccount('nope', `x-${seq}@example.com`);
    expect(await s.isAdminUser(other, emails)).toBeNull();
    expect(await s.isAdminUser(adminId, new Set())).toBeNull();
  });

  it('ban revokes sessions + logs; a second ban is refused; unban lifts it', async () => {
    const s = await store();
    const db = await sql();
    const u = await newAccount('ban');
    await newSession(u);
    await s.banUser(actor, u, 'spam', emails);
    expect(await s.isBanned(u)).toBe(true);
    const [live] = await db`SELECT count(*) AS n FROM sessions WHERE user_id = ${u} AND revoked_at IS NULL`;
    expect(Number(live.n)).toBe(0);
    await expect(s.banUser(actor, u, 'again', emails)).rejects.toMatchObject({ code: 'already_banned' });
    await s.unbanUser(actor, u);
    expect(await s.isBanned(u)).toBe(false);
    const log = await s.listLog({ target: u }, 0);
    expect(log.rows.map((r) => r.kind)).toEqual(['user_unban', 'user_ban']);
  });

  it('refuses to act on yourself or another admin', async () => {
    const s = await store();
    await expect(s.banUser(actor, adminId, null, emails)).rejects.toMatchObject({ code: 'cannot_target_self' });
    const second = await newAccount('boss2', `boss2-${Date.now()}@example.com`);
    const both = new Set([adminEmail, (await (await sql())`SELECT email FROM users WHERE id = ${second}`)[0].email as string]);
    await expect(s.banUser(actor, second, null, both)).rejects.toMatchObject({ code: 'cannot_target_admin' });
  });

  it('feedback → admin list → reply lands in the inbox and resolves it; rate limit 5/h', async () => {
    const s = await store();
    const u = await newAccount('fb');
    const id = await s.createFeedback(u, { kind: 'complaint', text: 'Player X insults', aboutPlayer: 'X', roomCode: 'AB12', gameType: 'durak', context: { lang: 'uk' } });
    const open = await s.listFeedback('open', 'complaint', 0);
    expect(open.rows.some((r) => r.id === id && r.aboutPlayer === 'X' && r.roomCode === 'AB12')).toBe(true);
    await s.replyFeedback(actor, id, 'Thanks, we banned him');
    await expect(s.replyFeedback(actor, id, 'twice')).rejects.toMatchObject({ code: 'cannot_reply' });
    const mine = await s.myFeedback(u);
    expect(mine[0]).toMatchObject({ status: 'resolved', reply: 'Thanks, we banned him' });
    const inbox = await s.inbox(u);
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]).toMatchObject({ kind: 'feedback_reply', text: 'Thanks, we banned him', quote: 'Player X insults' });
    await s.setFeedbackStatus(actor, id, 'open');
    await s.setFeedbackStatus(actor, id, 'resolved');
    await expect(s.setFeedbackStatus(actor, id, 'resolved')).rejects.toMatchObject({ code: 'not_found_or_same' });
    await s.markInboxRead(u);
    expect((await s.inbox(u)).unread).toBe(0);
    for (let i = 0; i < 4; i++) await s.createFeedback(u, { kind: 'suggestion', text: `idea ${i}`, aboutPlayer: null, roomCode: null, gameType: null, context: {} });
    await expect(s.createFeedback(u, { kind: 'bug', text: 'one more', aboutPlayer: null, roomCode: null, gameType: null, context: {} }))
      .rejects.toMatchObject({ code: 'too_many' });
    const badge = await s.badge();
    expect(badge.feedback).toBeGreaterThanOrEqual(4);
  });

  it('server errors group by fingerprint while new; resolve opens a fresh row next time', async () => {
    const s = await store();
    const fp = `test:${randomUUID()}`;
    await s.upsertErrors([{ fingerprint: fp, where: 'test', message: 'boom', stack: null, count: 2 }]);
    await s.upsertErrors([{ fingerprint: fp, where: 'test', message: 'boom', stack: 'at x', count: 3 }]);
    const list = await s.listErrors('new', 0);
    const row = list.rows.find((r) => r.message === 'boom' && r.where === 'test' && r.count === 5);
    expect(row).toBeTruthy();
    await s.resolveError(actor, row!.id);
    await s.upsertErrors([{ fingerprint: fp, where: 'test', message: 'boom', stack: null, count: 1 }]);
    const again = await s.listErrors('new', 0);
    expect(again.rows.filter((r) => r.where === 'test' && r.message === 'boom').some((r) => r.count === 1)).toBe(true);
  });

  it('announcement set → current → clear', async () => {
    const s = await store();
    await s.setAnnouncement(actor, 'Expiring', null, new Date(Date.now() + 86_400_000));
    expect(await s.currentAnnouncement()).toMatchObject({ text: 'Expiring' });
    await s.setAnnouncement(actor, 'Maintenance at 22:00', 'https://example.com', null);
    expect(await s.currentAnnouncement()).toMatchObject({ text: 'Maintenance at 22:00', url: 'https://example.com' });
    await s.clearAnnouncement(actor);
    expect(await s.currentAnnouncement()).toBeNull();
  });

  it('broadcast to chosen people reaches their inbox; a second one within 10 min is refused', async () => {
    const s = await store();
    const db = await sql();
    await db`DELETE FROM admin_broadcasts WHERE created_at > now() - interval '1 day'`;
    const a = await newAccount('bc-a');
    const b = await newAccount('bc-b');
    expect(await s.sendBroadcast(actor, 'Hello', 'New game soon', [a, b])).toBe(2);
    expect((await s.inbox(a)).items[0]).toMatchObject({ kind: 'broadcast', title: 'Hello' });
    await expect(s.sendBroadcast(actor, 'Again', 'x', [a])).rejects.toMatchObject({ code: 'too_soon' });
    expect((await s.listBroadcasts())[0]).toMatchObject({ title: 'Hello', peopleCount: 2 });
  });

  it('users: search, detail, nickname reset, chips adjust, stats reset guard, delete with confirm', async () => {
    const s = await store();
    const u = await newAccount('card');
    const name = (await (await sql())`SELECT display_name FROM users WHERE id = ${u}`)[0].display_name as string;
    const found = await s.listUsers(name, 0, 'accounts', new Set([u]));
    expect(found.rows[0]).toMatchObject({ id: u, online: true, banned: false });
    const d = await s.userDetail(u, new Set(), emails);
    expect(d).toMatchObject({ id: u, isAdmin: false, chips: null });
    const fresh = await s.resetNickname(actor, u, emails);
    expect(fresh).toMatch(/^Гравець-/);
    expect(await s.adjustChips(actor, u, 500, 'compensation', randomUUID())).toBe(500);
    await expect(s.adjustChips(actor, u, -1000, 'oops', randomUUID())).rejects.toMatchObject({ code: 'insufficient_chips' });
    await expect(s.resetStats(actor, u, 'king', emails)).rejects.toMatchObject({ code: 'nothing_to_reset' });
    await expect(s.deleteUser(actor, u, 'wrong', emails)).rejects.toMatchObject({ code: 'confirm_mismatch' });
    await s.deleteUser(actor, u, fresh, emails);
    expect(await s.userDetail(u, new Set(), emails)).toBeNull();
    const log = await s.listLog({ groups: ['moderation'], q: fresh }, 0);
    expect(log.rows.some((r) => r.kind === 'user_delete')).toBe(true);
    const csvRows = await s.exportLog({ groups: ['players'] });
    expect(csvRows.some((r) => r.kind === 'chips_adjust')).toBe(true);
  });

  it('stats, metrics and health queries run; backup lists tables and logs itself', async () => {
    const s = await store();
    await s.touchActivity(adminId);
    const st = await s.dbStats();
    expect(st.users.total).toBeGreaterThan(0);
    const m = await s.metrics(7, new Date());
    expect(m.buckets).toHaveLength(7);
    expect(m.summary.dau).toBeGreaterThanOrEqual(1);
    expect((await s.dbHealth()).tables.length).toBeGreaterThan(0);
    const dump = await s.exportBackup(actor);
    expect(Object.keys(dump.tables)).toContain('users');
    expect(Object.keys(dump.tables)).not.toContain('sessions');
    const logRow = (dump.tables.admin_actions as { details: unknown }[])[0];
    expect(typeof logRow.details).toBe('object'); // jsonb stays an object for a faithful restore
  });
});
