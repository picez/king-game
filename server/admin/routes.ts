// ---------------------------------------------------------------------------
// /api/admin/* + the player-side feedback/inbox/announcement routes (Stage 44.0).
//
// Gate: the session user must be a verified, non-guest account whose email is in
// ADMIN_EMAILS (and not banned). Anyone else gets the SAME 404 an unknown route
// gets — the admin surface is not discoverable. Per-admin rate limits: reads
// 120/min, writes 30/min.
// ---------------------------------------------------------------------------

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  ANNOUNCEMENT_TEXT_MAX, BAN_REASON_MAX, BROADCAST_TEXT_MAX, BROADCAST_TITLE_MAX, METRIC_PERIODS, REPLY_TEXT_MAX,
  clipText, parseAdminEmails, parseFeedbackBody, safeUrl, type AdminHealth, type AdminStats,
} from '../../src/net/admin';
import { GAME_TYPES } from '../../src/games/catalog';
import { adminRuntime, eventLoopLagMs } from './runtime';
import { gitCommit, serverVersion } from '../diagnostics';

export interface RouteHelpers {
  req: IncomingMessage;
  res: ServerResponse;
  path: string;
  method: string;
  query: URLSearchParams;
  json: (status: number, body: unknown, headers?: Record<string, string>) => void;
  readBody: () => Promise<Record<string, unknown>>;
  resolveUserId: () => Promise<string | null>;
  /** CORS headers for a response written directly (not through json). */
  cors?: () => Record<string, string>;
}

export function adminEmails(): Set<string> { return parseAdminEmails(process.env.ADMIN_EMAILS); }

// ── per-admin rate limit ────────────────────────────────────────────────────

const LIMITS = { read: 120, write: 30 } as const;
const hits = new Map<string, number[]>();
export function adminRateOk(adminId: string, kind: 'read' | 'write', now = Date.now()): boolean {
  const key = `${kind}:${adminId}`;
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= LIMITS[kind]) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  return true;
}
export function resetAdminRate(): void { hits.clear(); }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pageOf = (q: URLSearchParams) => Math.max(0, Math.min(10_000, Number(q.get('page') ?? 0) || 0));

// ── player-side routes ──────────────────────────────────────────────────────

/** Handles the public/player routes. Returns false when the path is not one of them. */
export async function handlePlayerFeedbackRoutes(h: RouteHelpers): Promise<boolean> {
  const { path, method } = h;
  if (path === '/api/announcement' && method === 'GET') {
    const { currentAnnouncement } = await import('./store');
    h.json(200, { announcement: await currentAnnouncement() });
    return true;
  }
  const mine = path === '/api/feedback' || path === '/api/me/feedback' || path === '/api/me/inbox' || path === '/api/me/inbox/read';
  if (!mine) return false;
  const userId = await h.resolveUserId();
  if (!userId) { h.json(401, { error: 'unauthenticated' }); return true; }
  const store = await import('./store');
  if (path === '/api/feedback' && method === 'POST') {
    const parsed = parseFeedbackBody(await h.readBody());
    if ('error' in parsed) { h.json(400, { error: parsed.error }); return true; }
    if (await store.isBanned(userId)) { h.json(403, { error: 'banned' }); return true; }
    try {
      const id = await store.createFeedback(userId, parsed);
      h.json(201, { ok: true, id });
    } catch (e) {
      if (e instanceof store.AdminError) { h.json(e.status, { error: e.code }); return true; }
      throw e;
    }
    return true;
  }
  if (path === '/api/me/feedback' && method === 'GET') { h.json(200, { items: await store.myFeedback(userId) }); return true; }
  if (path === '/api/me/inbox' && method === 'GET') { h.json(200, await store.inbox(userId)); return true; }
  if (path === '/api/me/inbox/read' && method === 'POST') { await store.markInboxRead(userId); h.json(200, { ok: true }); return true; }
  h.json(405, { error: 'method_not_allowed' });
  return true;
}

// ── admin routes ────────────────────────────────────────────────────────────

export async function handleAdminRoutes(h: RouteHelpers): Promise<void> {
  const notFound = () => h.json(404, { error: 'not_found' });
  const userId = await h.resolveUserId();
  if (!userId) return notFound();
  const store = await import('./store');
  const emails = adminEmails();
  let actor: Awaited<ReturnType<typeof store.isAdminUser>>;
  try { actor = await store.isAdminUser(userId, emails); } catch { return notFound(); }
  if (!actor) return notFound();

  const write = h.method !== 'GET';
  if (!adminRateOk(actor.id, write ? 'write' : 'read')) return h.json(429, { error: 'rate_limited' });

  const seg = h.path.slice('/api/admin'.length).split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b, c] = seg;
  const m = h.method;
  const rt = adminRuntime();
  const online = () => new Set(rt.onlineUserIds());

  try {
    // ── overview
    if (a === 'me' && m === 'GET') return h.json(200, { id: actor.id, label: actor.label });
    if (a === 'badge' && m === 'GET') return h.json(200, await store.badge());
    if (a === 'stats' && m === 'GET') {
      const db = await store.dbStats();
      const rooms = rt.liveRooms();
      const humans = rooms.reduce((n, r) => n + r.players.filter((p) => p.type === 'human').length, 0);
      const bots = rooms.reduce((n, r) => n + r.players.filter((p) => p.type === 'ai').length, 0);
      const bd = await store.badge();
      const stats: AdminStats = {
        users: { ...db.users, online: rt.onlineUserIds().length },
        games: db.games,
        live: {
          rooms: rooms.length, inGame: rooms.filter((r) => r.started).length, lobby: rooms.filter((r) => !r.started).length,
          connections: rt.connections(), humans, bots,
        },
        appeals: { openFeedback: bd.feedback + bd.complaints, newErrors: bd.errors },
      };
      return h.json(200, stats);
    }
    if (a === 'health' && m === 'GET') {
      const mem = process.memoryUsage();
      let db: AdminHealth['db'] = null;
      try { db = await store.dbHealth(); } catch { db = null; }
      let migrations: AdminHealth['migrations'] = null;
      try {
        const { listMigrationFiles } = await import('../db/migrationLedger');
        const { getDb } = await import('../db/client');
        const conn = await getDb();
        const rows = conn ? (await conn.sql`select count(*) as n from schema_migrations`) as Array<{ n: string }> : [];
        migrations = { applied: Number(rows[0]?.n ?? 0), files: listMigrationFiles().length };
      } catch { migrations = null; }
      const health: AdminHealth = {
        version: serverVersion() ?? 'dev', commit: gitCommit(), node: process.version,
        uptimeSec: Math.round(process.uptime()),
        memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), heapTotalMb: Math.round(mem.heapTotal / 1048576) },
        eventLoopLagMs: eventLoopLagMs(), db, migrations,
      };
      return h.json(200, health);
    }
    if (a === 'metrics' && m === 'GET') {
      const p = Number(h.query.get('period') ?? 30);
      const period = (METRIC_PERIODS as readonly number[]).includes(p) ? p : 30;
      return h.json(200, await store.metrics(period));
    }

    // ── live rooms
    if (a === 'live' && !b && m === 'GET') return h.json(200, { rooms: rt.liveRooms() });
    if (a === 'live' && b && c === 'close' && m === 'POST') {
      const body = await h.readBody();
      const reason = clipText(body.reason, 120) ?? '';
      const room = rt.liveRooms().find((r) => r.code === b.toUpperCase());
      if (!room || !rt.closeRoom(room.code, reason)) return h.json(404, { error: 'room_not_found' });
      await store.logRoomClose(actor, room.code, { gameType: room.gameType, started: room.started, players: room.players.map((p) => p.name), reason });
      return h.json(200, { ok: true });
    }

    // ── users
    if (a === 'users' && !b && m === 'GET') {
      const f = h.query.get('filter');
      const filter = f === 'accounts' || f === 'guests' || f === 'banned' ? f : 'all';
      return h.json(200, { ...(await store.listUsers(h.query.get('q') ?? '', pageOf(h.query), filter, online())), pageSize: store.USERS_PAGE });
    }
    if (a === 'users' && b) {
      if (!UUID.test(b)) return h.json(400, { error: 'invalid_id' });
      if (!c && m === 'GET') {
        const d = await store.userDetail(b, online(), emails);
        if (!d) return h.json(404, { error: 'not_found' });
        await store.logUserView(actor, b);
        return h.json(200, d);
      }
      const body = m === 'GET' ? {} : await h.readBody();
      if (c === 'ban' && m === 'POST') {
        await store.banUser(actor, b, clipText(body.reason, BAN_REASON_MAX), emails);
        const kicked = rt.kickUser(b);
        return h.json(200, { ok: true, kicked });
      }
      if (c === 'ban' && m === 'DELETE') { await store.unbanUser(actor, b); return h.json(200, { ok: true }); }
      if (c === 'reset-nickname' && m === 'POST') return h.json(200, { ok: true, displayName: await store.resetNickname(actor, b, emails) });
      if (c === 'reset-avatar' && m === 'POST') { await store.resetAvatar(actor, b, emails); return h.json(200, { ok: true }); }
      if (c === 'revoke-sessions' && m === 'POST') {
        const n = await store.revokeSessions(actor, b, emails);
        rt.kickUser(b);
        return h.json(200, { ok: true, revoked: n });
      }
      if (c === 'reset-stats' && m === 'POST') {
        const g = String(body.gameType ?? '');
        if (!(GAME_TYPES as readonly string[]).includes(g) && g !== 'tarneeb-solo') return h.json(400, { error: 'invalid_game' });
        await store.resetStats(actor, b, g, emails);
        return h.json(200, { ok: true });
      }
      if (c === 'chips' && m === 'POST') {
        const amount = Number(body.amount);
        const reason = clipText(body.reason, 200);
        if (!reason) return h.json(400, { error: 'reason_required' });
        const opId = typeof body.opId === 'string' && UUID.test(body.opId) ? body.opId : randomUUID();
        return h.json(200, { ok: true, balance: await store.adjustChips(actor, b, amount, reason, opId) });
      }
      if (!c && m === 'DELETE') {
        await store.deleteUser(actor, b, String(body.confirm ?? ''), emails);
        rt.kickUser(b);
        return h.json(200, { ok: true });
      }
    }

    // ── appeals: feedback + errors
    if (a === 'feedback' && !b && m === 'GET') {
      const status = h.query.get('status') === 'resolved' ? 'resolved' : 'open';
      const k = h.query.get('kind');
      const kind = k === 'complaint' || k === 'other' ? k : 'all';
      return h.json(200, { ...(await store.listFeedback(status, kind, pageOf(h.query))), pageSize: store.FEEDBACK_PAGE });
    }
    if (a === 'feedback' && b && m === 'POST') {
      if (!UUID.test(b)) return h.json(400, { error: 'invalid_id' });
      if (c === 'resolve') { await store.setFeedbackStatus(actor, b, 'resolved'); return h.json(200, { ok: true }); }
      if (c === 'reopen') { await store.setFeedbackStatus(actor, b, 'open'); return h.json(200, { ok: true }); }
      if (c === 'reply') {
        const text = clipText((await h.readBody()).text, REPLY_TEXT_MAX);
        if (!text) return h.json(400, { error: 'empty_text' });
        await store.replyFeedback(actor, b, text);
        return h.json(200, { ok: true });
      }
    }
    if (a === 'errors' && !b && m === 'GET') {
      const status = h.query.get('status') === 'resolved' ? 'resolved' : 'new';
      return h.json(200, { ...(await store.listErrors(status, pageOf(h.query))), pageSize: store.FEEDBACK_PAGE });
    }
    if (a === 'errors' && b && c === 'resolve' && m === 'POST') {
      if (!UUID.test(b)) return h.json(400, { error: 'invalid_id' });
      await store.resolveError(actor, b);
      return h.json(200, { ok: true });
    }

    // ── announcement
    if (a === 'announcement') {
      if (m === 'GET') return h.json(200, { current: await store.currentAnnouncement(), history: await store.announcementHistory() });
      if (m === 'PUT') {
        const body = await h.readBody();
        const text = clipText(body.text, ANNOUNCEMENT_TEXT_MAX);
        if (!text) return h.json(400, { error: 'empty_text' });
        const days = Number(body.days);
        const expires = Number.isFinite(days) && days > 0 ? new Date(Date.now() + Math.min(365, days) * 86_400_000) : null;
        await store.setAnnouncement(actor, text, safeUrl(body.url), expires);
        return h.json(200, { ok: true });
      }
      if (m === 'DELETE') { await store.clearAnnouncement(actor); return h.json(200, { ok: true }); }
    }

    // ── broadcasts
    if (a === 'broadcasts' && m === 'GET') {
      return h.json(200, { history: await store.listBroadcasts(), audience: await store.broadcastAudience() });
    }
    if (a === 'broadcasts' && m === 'POST') {
      const body = await h.readBody();
      const title = clipText(body.title, BROADCAST_TITLE_MAX);
      const text = clipText(body.text, BROADCAST_TEXT_MAX);
      if (!title || !text) return h.json(400, { error: 'empty_text' });
      let people: string[] | null = null;
      if (Array.isArray(body.people)) {
        people = body.people.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 500);
        if (people.length === 0) return h.json(400, { error: 'no_recipients' });
      }
      return h.json(200, { ok: true, delivered: await store.sendBroadcast(actor, title, text, people) });
    }

    // ── audit log
    if (a === 'log' && m === 'GET') {
      const f = {
        admin: h.query.get('admin') ?? undefined, target: h.query.get('target') ?? undefined,
        groups: (h.query.get('groups') ?? '').split(',').filter(Boolean),
        from: h.query.get('from') ?? undefined, to: h.query.get('to') ?? undefined,
        q: (h.query.get('q') ?? '').slice(0, 100) || undefined,
      };
      if (b === 'export') return h.json(200, { rows: await store.exportLog(f) });
      return h.json(200, { ...(await store.listLog(f, pageOf(h.query))), pageSize: store.LOG_PAGE });
    }

    // ── backup (download)
    if (a === 'backup' && m === 'GET') {
      const dump = await store.exportBackup(actor, gitCommit());
      const name = `card-majlis-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      return h.json(200, dump, { 'content-disposition': `attachment; filename="${name}"` });
    }

    // ── cloud backups (Stage 44.1, R2)
    if (a === 'backups') {
      const cloud = await import('./cloudBackup');
      try {
        if (!b && m === 'GET') return h.json(200, await cloud.backupStatus());
        if (b === 'run' && m === 'POST') {
          const made = await cloud.runBackup('manual', actor.label);
          const s = await (await import('../db/client')).getDb();
          if (s) await store.logAction(s.sql as never, actor, 'backup_cloud_run', null, { key: made?.key ?? null, bytes: made?.bytes ?? null });
          return h.json(200, { ok: true, key: made?.key ?? null, bytes: made?.bytes ?? null });
        }
        if (b === 'download' && m === 'GET') {
          const key = h.query.get('key') ?? '';
          const res = await cloud.downloadBackup(key);
          if (!res) return notFound();
          const bytes = new Uint8Array(await res.arrayBuffer());
          const s = await (await import('../db/client')).getDb();
          if (s) await store.logAction(s.sql as never, actor, 'backup_cloud_download', null, { key });
          h.res.writeHead(200, {
            ...(h.cors?.() ?? {}),
            'content-type': 'application/gzip',
            'content-length': String(bytes.length),
            'content-disposition': `attachment; filename="${key.split('/').pop()}"`,
            'cache-control': 'no-store',
          });
          h.res.end(bytes);
          return;
        }
      } catch (e) {
        if (e instanceof cloud.BackupError) return h.json(e.status, { error: e.code });
        throw e;
      }
      return notFound();
    }

    return notFound();
  } catch (e) {
    if (e instanceof store.AdminError) return h.json(e.status, { error: e.code });
    throw e;
  }
}
