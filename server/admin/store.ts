// ---------------------------------------------------------------------------
// Admin + feedback repository (Stage 44.0). Raw SQL through postgres.js — the
// same driver the rest of server/db uses. Every function needs DATABASE_URL; the
// HTTP layer only reaches here after the API-wide db gate.
//
// Every admin WRITE logs into admin_actions in the SAME transaction as the change,
// so the audit log can never claim an action that rolled back (or miss one).
// ---------------------------------------------------------------------------

import type { Sql, TransactionSql } from 'postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { getDb } from '../db/client';
import {
  BACKUP_FORMAT, BACKUP_TABLES, BROADCAST_DAILY_MAX, BROADCAST_MIN_INTERVAL_MS, FEEDBACK_HOURLY_MAX, dayRange, kindsForGroups,
  type AdminActionKind, type AdminBadge, type AdminBroadcastRow, type AdminErrorRow, type AdminFeedbackRow,
  type AdminLogRow, type AdminMetrics, type AdminSolitaireRow, type AdminSolitaireSummary, type AdminUserDetail, type AdminUserRow, type Announcement,
  type FeedbackInput, type FeedbackStatus, type InboxResponse, type MyFeedbackItem,
} from '../../src/net/admin';

type Q = Sql | TransactionSql;

async function sql(): Promise<Sql> {
  const conn = await getDb();
  if (!conn) throw new Error('admin store requires DATABASE_URL');
  return conn.sql as unknown as Sql;
}
async function drizzle(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('admin store requires DATABASE_URL');
  return conn.db as PostgresJsDatabase;
}

const iso = (d: unknown): string => (d instanceof Date ? d.toISOString() : String(d));
const isoOrNull = (d: unknown): string | null => (d == null ? null : iso(d));
const num = (v: unknown): number => Number(v ?? 0) || 0;
/** drizzle swaps postgres.js's json parser for a pass-through, so jsonb can arrive as text. */
const jsonObj = (v: unknown): Record<string, unknown> => {
  if (v && typeof v === 'object') return v as Record<string, unknown>;
  if (typeof v === 'string') { try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
  return {};
};

/** Thrown for an expected refusal; the route maps `code` → HTTP status. */
export class AdminError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

// ── identity ────────────────────────────────────────────────────────────────

export interface Actor { id: string; label: string }

/** True when the user is a verified, non-guest account whose email is listed. */
export async function isAdminUser(userId: string, emails: Set<string>): Promise<Actor | null> {
  if (emails.size === 0) return null;
  const s = await sql();
  const rows = await s`
    SELECT u.display_name, lower(u.email) AS email, u.email_verified, u.is_guest,
           (SELECT lower(a.email_at_provider) FROM auth_accounts a WHERE a.user_id = u.id AND a.provider = 'google' LIMIT 1) AS google_email
    FROM users u WHERE u.id = ${userId} AND u.deleted_at IS NULL LIMIT 1`;
  const r = rows[0];
  if (!r || r.is_guest) return null;
  // A Google-linked email is verified by construction (isLinkableIdentity refuses others).
  const ok = (r.google_email && emails.has(r.google_email)) || (r.email_verified && r.email && emails.has(r.email));
  if (!ok) return null;
  if (await isBanned(userId)) return null;
  return { id: userId, label: r.display_name ?? r.google_email ?? r.email ?? 'admin' };
}

/** A user's email (users.email, else the Google one), lower-cased, or null. */
async function emailOf(q: Q, userId: string): Promise<string | null> {
  const rows = await q`
    SELECT coalesce(lower(u.email), (SELECT lower(a.email_at_provider) FROM auth_accounts a WHERE a.user_id = u.id LIMIT 1)) AS email
    FROM users u WHERE u.id = ${userId}`;
  return (rows[0]?.email as string | null) ?? null;
}

export async function isBanned(userId: string): Promise<boolean> {
  const s = await sql();
  const rows = await s`SELECT 1 FROM user_bans WHERE user_id = ${userId} LIMIT 1`;
  return rows.length > 0;
}

async function labelOf(q: Q, userId: string): Promise<string | null> {
  const rows = await q`SELECT display_name, is_guest FROM users WHERE id = ${userId}`;
  if (!rows[0]) return null;
  return rows[0].display_name ?? (rows[0].is_guest ? 'Гість' : null);
}

export async function logAction(
  q: Q, actor: Actor, kind: AdminActionKind,
  target: { id: string; label: string | null } | null, details: Record<string, unknown> = {},
): Promise<void> {
  await q`
    INSERT INTO admin_actions (admin_id, admin_label, kind, target_user_id, target_label, details)
    VALUES (${actor.id}, ${actor.label}, ${kind}, ${target?.id ?? null}, ${target?.label ?? null}, ${JSON.stringify(details)}::jsonb)`;
}

/** Records the user as active today (DAU/WAU/MAU). Cheap: one idempotent insert. */
export async function touchActivity(userId: string): Promise<void> {
  const s = await sql();
  await s`INSERT INTO activity_days (user_id, day) VALUES (${userId}, (now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING`;
}

// ── stats / metrics / health ────────────────────────────────────────────────

export async function dbStats(): Promise<{
  users: { total: number; accounts: number; guests: number; new7: number; new30: number; banned: number };
  games: { today: number; d7: number; d30: number; total: number; byGame: { gameType: string; d30: number; total: number }[] };
}> {
  const s = await sql();
  const [u] = await s`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE NOT is_guest) AS accounts,
           count(*) FILTER (WHERE is_guest) AS guests,
           count(*) FILTER (WHERE created_at > now() - interval '7 days') AS new7,
           count(*) FILTER (WHERE created_at > now() - interval '30 days') AS new30,
           (SELECT count(*) FROM user_bans) AS banned
    FROM users WHERE deleted_at IS NULL`;
  const [g] = await s`
    SELECT count(*) FILTER (WHERE started_at >= date_trunc('day', now())) AS today,
           count(*) FILTER (WHERE started_at > now() - interval '7 days') AS d7,
           count(*) FILTER (WHERE started_at > now() - interval '30 days') AS d30,
           count(*) AS total
    FROM online_matches`;
  const by = await s`
    SELECT game_type, count(*) FILTER (WHERE started_at > now() - interval '30 days') AS d30, count(*) AS total
    FROM online_matches GROUP BY game_type ORDER BY total DESC`;
  return {
    users: { total: num(u.total), accounts: num(u.accounts), guests: num(u.guests), new7: num(u.new7), new30: num(u.new30), banned: num(u.banned) },
    games: {
      today: num(g.today), d7: num(g.d7), d30: num(g.d30), total: num(g.total),
      byGame: by.map((r) => ({ gameType: String(r.game_type), d30: num(r.d30), total: num(r.total) })),
    },
  };
}

export async function badge(): Promise<AdminBadge> {
  const s = await sql();
  const [r] = await s`
    SELECT (SELECT count(*) FROM player_feedback WHERE status = 'open' AND kind <> 'complaint') AS feedback,
           (SELECT count(*) FROM player_feedback WHERE status = 'open' AND kind = 'complaint') AS complaints,
           (SELECT count(*) FROM server_errors WHERE status = 'new') AS errors`;
  const b = { feedback: num(r.feedback), complaints: num(r.complaints), errors: num(r.errors) };
  return { ...b, total: b.feedback + b.complaints + b.errors };
}

const metricsCache = new Map<number, { at: number; value: AdminMetrics }>();
const METRICS_TTL_MS = 5 * 60 * 1000;

export async function metrics(period: number, now = new Date()): Promise<AdminMetrics> {
  const hit = metricsCache.get(period);
  if (hit && now.getTime() - hit.at < METRICS_TTL_MS) return hit.value;
  const s = await sql();
  const to = now.toISOString().slice(0, 10);
  const fromD = new Date(now); fromD.setUTCDate(fromD.getUTCDate() - (period - 1));
  const from = fromD.toISOString().slice(0, 10);
  const prevFromD = new Date(fromD); prevFromD.setUTCDate(prevFromD.getUTCDate() - period);
  const prevFrom = prevFromD.toISOString().slice(0, 10);

  const games = await s`
    SELECT (started_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n
    FROM online_matches WHERE started_at >= ${from}::date GROUP BY 1`;
  const players = await s`
    SELECT (m.started_at AT TIME ZONE 'UTC')::date AS day, count(DISTINCT p.user_id) AS n
    FROM online_matches m JOIN online_match_participants p USING (match_id)
    WHERE m.started_at >= ${from}::date AND p.user_id IS NOT NULL GROUP BY 1`;
  const newUsers = await s`
    SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS n
    FROM users WHERE created_at >= ${from}::date GROUP BY 1`;
  const active = await s`
    SELECT day, count(*) AS n FROM activity_days WHERE day >= ${from}::date GROUP BY 1`;
  const key = (r: { day: unknown }) => (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10));
  const toMap = (rows: readonly { day: unknown; n: unknown }[]) => new Map(rows.map((r) => [key(r), num(r.n)]));
  const gm = toMap(games as never), pm = toMap(players as never), um = toMap(newUsers as never), am = toMap(active as never);
  const buckets = dayRange(from, to).map((day) => ({
    day, games: gm.get(day) ?? 0, players: pm.get(day) ?? 0, newUsers: um.get(day) ?? 0, activeUsers: am.get(day) ?? 0,
  }));

  const [sum] = await s`
    SELECT (SELECT count(DISTINCT user_id) FROM activity_days WHERE day = (now() AT TIME ZONE 'UTC')::date) AS dau,
           (SELECT count(DISTINCT user_id) FROM activity_days WHERE day > (now() AT TIME ZONE 'UTC')::date - 7) AS wau,
           (SELECT count(DISTINCT user_id) FROM activity_days WHERE day > (now() AT TIME ZONE 'UTC')::date - 30) AS mau,
           (SELECT count(*) FROM online_matches WHERE started_at >= ${prevFrom}::date AND started_at < ${from}::date) AS prev_games,
           (SELECT count(*) FROM users WHERE created_at >= ${prevFrom}::date AND created_at < ${from}::date) AS prev_users`;
  const byGame = await s`
    SELECT game_type, count(*) AS n FROM online_matches WHERE started_at >= ${from}::date GROUP BY 1 ORDER BY 2 DESC`;
  const byHourRows = await s`
    SELECT extract(hour FROM started_at AT TIME ZONE 'Europe/Kyiv')::int AS h, count(*) AS n
    FROM online_matches WHERE started_at >= ${from}::date GROUP BY 1`;
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const r of byHourRows) byHour[num(r.h)] = num(r.n);
  const top = await s`
    SELECT p.user_id, coalesce(u.display_name, 'Гравець') AS name, count(*) AS n
    FROM online_match_participants p JOIN online_matches m USING (match_id) JOIN users u ON u.id = p.user_id
    WHERE m.started_at >= ${from}::date GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`;

  const value: AdminMetrics = {
    period,
    buckets,
    summary: {
      dau: num(sum.dau), wau: num(sum.wau), mau: num(sum.mau),
      games: buckets.reduce((a, b) => a + b.games, 0), prevGames: num(sum.prev_games),
      newUsers: buckets.reduce((a, b) => a + b.newUsers, 0), prevNewUsers: num(sum.prev_users),
    },
    byGame: byGame.map((r) => ({ gameType: String(r.game_type), games: num(r.n) })),
    byHour,
    topPlayers: top.map((r) => ({ userId: String(r.user_id), name: String(r.name), games: num(r.n) })),
  };
  metricsCache.set(period, { at: now.getTime(), value });
  return value;
}

let healthCache: { at: number; value: { sizeMb: number | null; tables: { name: string; rows: number }[] } } | null = null;

export async function dbHealth(): Promise<{ sizeMb: number | null; tables: { name: string; rows: number }[] }> {
  if (healthCache && Date.now() - healthCache.at < 60_000) return healthCache.value;
  const s = await sql();
  const [size] = await s`SELECT pg_database_size(current_database()) AS b`;
  const rows = await s`
    SELECT relname AS name, n_live_tup AS rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 30`;
  const value = {
    sizeMb: size ? Math.round(num(size.b) / 1024 / 1024 * 10) / 10 : null,
    tables: rows.map((r) => ({ name: String(r.name), rows: num(r.rows) })),
  };
  healthCache = { at: Date.now(), value };
  return value;
}

// ── users ───────────────────────────────────────────────────────────────────

export const USERS_PAGE = 30;

export async function listUsers(q: string, page: number, filter: 'all' | 'accounts' | 'guests' | 'banned', online: Set<string>): Promise<{ rows: AdminUserRow[]; total: number }> {
  const s = await sql();
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const hasQ = q.trim().length > 0;
  const exact = /^[0-9a-f-]{36}$/i.test(q.trim()) ? q.trim() : null;
  const where = s`
    u.deleted_at IS NULL
    ${filter === 'accounts' ? s`AND NOT u.is_guest` : filter === 'guests' ? s`AND u.is_guest` : filter === 'banned' ? s`AND b.user_id IS NOT NULL` : s``}
    ${hasQ ? s`AND (u.display_name ILIKE ${like} OR u.email ILIKE ${like} OR u.friend_code ILIKE ${like}
        OR EXISTS (SELECT 1 FROM auth_accounts a WHERE a.user_id = u.id AND a.email_at_provider ILIKE ${like})
        ${exact ? s`OR u.id = ${exact}::uuid` : s``})` : s``}`;
  const rows = await s`
    SELECT u.id, u.display_name, u.is_guest, u.created_at,
           coalesce(u.email, (SELECT a.email_at_provider FROM auth_accounts a WHERE a.user_id = u.id LIMIT 1)) AS email,
           (SELECT max(day) FROM activity_days d WHERE d.user_id = u.id) AS last_active,
           (SELECT coalesce(sum(games_played), 0) FROM user_stats st WHERE st.user_id = u.id) AS games,
           b.user_id IS NOT NULL AS banned
    FROM users u LEFT JOIN user_bans b ON b.user_id = u.id
    WHERE ${where}
    ORDER BY (SELECT max(day) FROM activity_days d WHERE d.user_id = u.id) DESC NULLS LAST, u.created_at DESC
    LIMIT ${USERS_PAGE} OFFSET ${Math.max(0, page) * USERS_PAGE}`;
  const [c] = await s`SELECT count(*) AS n FROM users u LEFT JOIN user_bans b ON b.user_id = u.id WHERE ${where}`;
  return {
    total: num(c.n),
    rows: rows.map((r) => ({
      id: String(r.id), displayName: r.display_name ?? null, email: r.email ?? null, isGuest: !!r.is_guest,
      createdAt: iso(r.created_at), lastActive: isoOrNull(r.last_active), games: num(r.games),
      banned: !!r.banned, online: online.has(String(r.id)),
    })),
  };
}

export async function userDetail(id: string, online: Set<string>, emails: Set<string>): Promise<AdminUserDetail | null> {
  const s = await sql();
  const [u] = await s`
    SELECT u.id, u.display_name, u.is_guest, u.created_at, u.friend_code,
           coalesce(u.email, a.email_at_provider) AS email, a.provider,
           st.avatar, av.id AS avatar_id, av.version AS avatar_version,
           (SELECT max(day) FROM activity_days d WHERE d.user_id = u.id) AS last_active,
           (SELECT count(*) FROM sessions x WHERE x.user_id = u.id AND x.revoked_at IS NULL AND x.expires_at > now()) AS sessions,
           (SELECT balance FROM poker_wallets w WHERE w.user_id = u.id) AS chips,
           (SELECT count(*) FROM friendships f WHERE f.status = 'accepted' AND (f.requester_id = u.id OR f.addressee_id = u.id)) AS friends,
           b.reason AS ban_reason, b.banned_at, (SELECT display_name FROM users z WHERE z.id = b.banned_by) AS banned_by
    FROM users u
    LEFT JOIN LATERAL (SELECT provider, email_at_provider FROM auth_accounts WHERE user_id = u.id LIMIT 1) a ON true
    LEFT JOIN user_settings st ON st.user_id = u.id
    LEFT JOIN user_avatars av ON av.user_id = u.id
    LEFT JOIN user_bans b ON b.user_id = u.id
    WHERE u.id = ${id} AND u.deleted_at IS NULL`;
  if (!u) return null;
  const stats = await s`SELECT game_type, games_played, games_won FROM user_stats WHERE user_id = ${id} ORDER BY games_played DESC`;
  const matches = await s`
    SELECT m.match_id, m.game_type, m.started_at, m.category, p.outcome, p.forfeited
    FROM online_match_participants p JOIN online_matches m USING (match_id)
    WHERE p.user_id = ${id} ORDER BY m.started_at DESC LIMIT 20`;
  const fb = await s`SELECT id, kind, text, status, created_at FROM player_feedback WHERE user_id = ${id} ORDER BY created_at DESC LIMIT 20`;
  const email = (u.email as string | null)?.toLowerCase() ?? null;
  return {
    id: String(u.id), displayName: u.display_name ?? null, email: u.email ?? null, isGuest: !!u.is_guest,
    createdAt: iso(u.created_at), lastActive: isoOrNull(u.last_active),
    games: stats.reduce((a, r) => a + num(r.games_played), 0),
    banned: u.banned_at != null, online: online.has(id),
    avatar: u.avatar ?? null,
    avatarImageUrl: u.avatar_id ? `/api/avatar/${u.avatar_id}.webp?v=${u.avatar_version}` : null,
    friendCode: u.friend_code ?? null, provider: u.provider ?? null,
    ban: u.banned_at ? { reason: u.ban_reason ?? null, bannedAt: iso(u.banned_at), bannedBy: u.banned_by ?? null } : null,
    sessions: num(u.sessions), chips: u.chips == null ? null : num(u.chips), friends: num(u.friends),
    stats: stats.map((r) => ({ gameType: String(r.game_type), played: num(r.games_played), won: num(r.games_won) })),
    recentMatches: matches.map((r) => ({
      matchId: String(r.match_id), gameType: String(r.game_type), startedAt: iso(r.started_at),
      outcome: r.forfeited ? 'forfeit' : String(r.outcome), category: String(r.category),
    })),
    feedback: fb.map((r) => ({ id: String(r.id), kind: r.kind, text: String(r.text), status: r.status, createdAt: iso(r.created_at) })),
    isAdmin: !!email && emails.has(email),
  };
}

/** Refuses an action on oneself or on another admin. */
async function guardTarget(q: Q, actor: Actor, targetId: string, emails: Set<string>): Promise<string | null> {
  if (targetId === actor.id) throw new AdminError('cannot_target_self', 409);
  const label = await labelOf(q, targetId);
  if (label === null) {
    const exists = await q`SELECT 1 FROM users WHERE id = ${targetId}`;
    if (exists.length === 0) throw new AdminError('not_found', 404);
  }
  const email = await emailOf(q, targetId);
  if (email && emails.has(email)) throw new AdminError('cannot_target_admin', 409);
  return label;
}

export async function banUser(actor: Actor, targetId: string, reason: string | null, emails: Set<string>): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const label = await guardTarget(tx, actor, targetId, emails);
    const ins = await tx`
      INSERT INTO user_bans (user_id, reason, banned_by) VALUES (${targetId}, ${reason}, ${actor.id})
      ON CONFLICT (user_id) DO NOTHING RETURNING user_id`;
    if (ins.length === 0) throw new AdminError('already_banned', 409);
    await tx`UPDATE sessions SET revoked_at = now() WHERE user_id = ${targetId} AND revoked_at IS NULL`;
    await logAction(tx, actor, 'user_ban', { id: targetId, label }, { reason });
  });
}

export async function unbanUser(actor: Actor, targetId: string): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const del = await tx`DELETE FROM user_bans WHERE user_id = ${targetId} RETURNING reason`;
    if (del.length === 0) throw new AdminError('not_banned', 409);
    await logAction(tx, actor, 'user_unban', { id: targetId, label: await labelOf(tx, targetId) }, { previousReason: del[0].reason ?? null });
  });
}

export async function resetNickname(actor: Actor, targetId: string, emails: Set<string>): Promise<string> {
  const s = await sql();
  return s.begin(async (tx) => {
    const label = await guardTarget(tx, actor, targetId, emails);
    const fresh = `Гравець-${targetId.slice(0, 4).toUpperCase()}`;
    await tx`UPDATE users SET display_name = ${fresh}, updated_at = now() WHERE id = ${targetId}`;
    await logAction(tx, actor, 'nickname_reset', { id: targetId, label }, { from: label, to: fresh });
    return fresh;
  }) as Promise<string>;
}

export async function resetAvatar(actor: Actor, targetId: string, emails: Set<string>): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const label = await guardTarget(tx, actor, targetId, emails);
    await tx`DELETE FROM user_avatars WHERE user_id = ${targetId}`;
    await tx`UPDATE user_settings SET avatar = NULL, updated_at = now() WHERE user_id = ${targetId}`;
    await logAction(tx, actor, 'avatar_reset', { id: targetId, label });
  });
}

export async function revokeSessions(actor: Actor, targetId: string, emails: Set<string>): Promise<number> {
  const s = await sql();
  return s.begin(async (tx) => {
    const label = await guardTarget(tx, actor, targetId, emails);
    const r = await tx`UPDATE sessions SET revoked_at = now() WHERE user_id = ${targetId} AND revoked_at IS NULL RETURNING id`;
    await logAction(tx, actor, 'sessions_revoke', { id: targetId, label }, { count: r.length });
    return r.length;
  }) as Promise<number>;
}

/** Deletes the account. `confirm` must equal the current display name (or the id for a nameless user). */
export async function deleteUser(actor: Actor, targetId: string, confirm: string, emails: Set<string>): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const label = await guardTarget(tx, actor, targetId, emails);
    if (confirm.trim() !== (label ?? targetId)) throw new AdminError('confirm_mismatch', 400);
    await logAction(tx, actor, 'user_delete', { id: targetId, label }, {});
    // admin_actions.target_user_id is ON DELETE SET NULL — the label above keeps the row readable.
    await tx`DELETE FROM users WHERE id = ${targetId}`;
  });
}

export async function resetStats(actor: Actor, targetId: string, gameType: string, emails: Set<string>): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const label = await guardTarget(tx, actor, targetId, emails);
    const r = await tx`DELETE FROM user_stats WHERE user_id = ${targetId} AND game_type = ${gameType} RETURNING games_played`;
    if (r.length === 0) throw new AdminError('nothing_to_reset', 409);
    await logAction(tx, actor, 'stats_reset', { id: targetId, label }, { gameType, gamesPlayed: num(r[0].games_played) });
  });
}

export async function adjustChips(actor: Actor, targetId: string, amount: number, reason: string, opId: string): Promise<number> {
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 10_000_000) throw new AdminError('invalid_amount');
  const s = await sql();
  const label = await labelOf(s, targetId);
  const guest = await s`SELECT is_guest FROM users WHERE id = ${targetId}`;
  if (!guest[0]) throw new AdminError('not_found', 404);
  if (guest[0].is_guest) throw new AdminError('guest_has_no_wallet', 409);
  const db = await drizzle();
  const { adjustWalletTx, InsufficientChipsError } = await import('../db/pokerWallet');
  try {
    return await db.transaction(async (tx) => {
      const r = await adjustWalletTx(tx as unknown as PostgresJsDatabase, targetId, amount, 'admin_adjust', `admin:${opId}`);
      await tx.execute(
        (await import('drizzle-orm')).sql`INSERT INTO admin_actions (admin_id, admin_label, kind, target_user_id, target_label, details)
          VALUES (${actor.id}, ${actor.label}, 'chips_adjust', ${targetId}, ${label}, ${JSON.stringify({ amount, reason, balance: r.balance, applied: r.applied })}::jsonb)`,
      );
      return r.balance;
    });
  } catch (e) {
    if (e instanceof InsufficientChipsError) throw new AdminError('insufficient_chips', 409);
    throw e;
  }
}

/** A throttled view row: at most one per admin+target per 10 minutes. */
export async function logUserView(actor: Actor, targetId: string): Promise<void> {
  const s = await sql();
  const recent = await s`
    SELECT 1 FROM admin_actions WHERE admin_id = ${actor.id} AND kind = 'user_view' AND target_user_id = ${targetId}
      AND at > now() - interval '10 minutes' LIMIT 1`;
  if (recent.length) return;
  await logAction(s, actor, 'user_view', { id: targetId, label: await labelOf(s, targetId) });
}

export async function logRoomClose(actor: Actor, code: string, details: Record<string, unknown>): Promise<void> {
  const s = await sql();
  await logAction(s, actor, 'room_close', null, { code, ...details });
}

// ── solitaire (verified wins) ───────────────────────────────────────────────

export const SOLITAIRE_PAGE = 50;

export async function solitaireSummary(): Promise<AdminSolitaireSummary[]> {
  const s = await sql();
  const rows = await s`
    SELECT variant, count(*)::int AS wins, count(DISTINCT user_id)::int AS players,
           count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')::int AS today,
           min(duration_ms)::int AS best
    FROM solitaire_results GROUP BY variant ORDER BY wins DESC`;
  return rows.map((r) => ({ variant: String(r.variant), wins: num(r.wins), players: num(r.players), today: num(r.today), bestMs: r.best == null ? null : num(r.best) }));
}

export async function listSolitaire(page: number, variant: string | null): Promise<{ rows: AdminSolitaireRow[]; total: number }> {
  const s = await sql();
  const where = variant ? s`WHERE r.variant = ${variant}` : s``;
  const [t] = await s`SELECT count(*)::int AS n FROM solitaire_results r ${where}`;
  const rows = await s`
    SELECT r.id, r.created_at, r.user_id, u.display_name, r.variant, r.daily::text AS daily, r.duration_ms, r.moves, r.undos, r.hints
    FROM solitaire_results r JOIN users u ON u.id = r.user_id ${where}
    ORDER BY r.created_at DESC LIMIT ${SOLITAIRE_PAGE} OFFSET ${page * SOLITAIRE_PAGE}`;
  return {
    total: num(t.n),
    rows: rows.map((r) => ({
      id: String(r.id), at: iso(r.created_at), userId: String(r.user_id), user: String(r.display_name ?? '—'),
      variant: String(r.variant), daily: r.daily == null ? null : String(r.daily),
      ms: num(r.duration_ms), moves: num(r.moves), undos: num(r.undos), hints: num(r.hints),
    })),
  };
}

/** Removes a (suspected) cheated result; logged with the reason in the same transaction. */
export async function deleteSolitaireResult(actor: Actor, id: string, reason: string): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const rows = await tx`DELETE FROM solitaire_results r USING users u WHERE r.id = ${id} AND u.id = r.user_id
      RETURNING r.user_id, u.display_name, r.variant, r.duration_ms, r.moves, r.daily::text AS daily`;
    const r = rows[0];
    if (!r) throw new AdminError('not_found', 404);
    await logAction(tx, actor, 'solitaire_delete', { id: String(r.user_id), label: String(r.display_name ?? '') },
      { variant: r.variant, ms: num(r.duration_ms), moves: num(r.moves), daily: r.daily ?? null, reason });
  });
}

// ── feedback (player side) ──────────────────────────────────────────────────

export async function createFeedback(userId: string, input: FeedbackInput): Promise<string> {
  const s = await sql();
  const [c] = await s`SELECT count(*) AS n FROM player_feedback WHERE user_id = ${userId} AND created_at > now() - interval '1 hour'`;
  if (num(c.n) >= FEEDBACK_HOURLY_MAX) throw new AdminError('too_many', 429);
  const label = await labelOf(s, userId);
  const [row] = await s`
    INSERT INTO player_feedback (user_id, author_label, kind, text, about_player, room_code, game_type, context)
    VALUES (${userId}, ${label}, ${input.kind}, ${input.text}, ${input.aboutPlayer}, ${input.roomCode}, ${input.gameType}, ${JSON.stringify(input.context)}::jsonb)
    RETURNING id`;
  return String(row.id);
}

export async function myFeedback(userId: string): Promise<MyFeedbackItem[]> {
  const s = await sql();
  const rows = await s`
    SELECT id, kind, text, status, reply, replied_at, created_at FROM player_feedback
    WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 30`;
  return rows.map((r) => ({
    id: String(r.id), kind: r.kind, text: String(r.text), status: r.status,
    reply: r.reply ?? null, repliedAt: isoOrNull(r.replied_at), createdAt: iso(r.created_at),
  }));
}

export async function inbox(userId: string): Promise<InboxResponse> {
  const s = await sql();
  const rows = await s`
    SELECT i.id, i.kind, i.created_at, i.read_at, b.title, b.text AS btext, f.reply, f.text AS ftext
    FROM inbox_items i
    LEFT JOIN admin_broadcasts b ON b.id = i.broadcast_id
    LEFT JOIN player_feedback f ON f.id = i.feedback_id
    WHERE i.user_id = ${userId} ORDER BY i.created_at DESC LIMIT 50`;
  const items = rows.map((r) => ({
    id: String(r.id), kind: r.kind,
    title: r.kind === 'broadcast' ? String(r.title ?? '') : '',
    text: r.kind === 'broadcast' ? String(r.btext ?? '') : String(r.reply ?? ''),
    quote: r.kind === 'feedback_reply' ? String(r.ftext ?? '').slice(0, 160) : null,
    createdAt: iso(r.created_at), read: r.read_at != null,
  }));
  return { items, unread: items.filter((i) => !i.read).length };
}

export async function markInboxRead(userId: string): Promise<void> {
  const s = await sql();
  await s`UPDATE inbox_items SET read_at = now() WHERE user_id = ${userId} AND read_at IS NULL`;
}

// ── feedback (admin side) ───────────────────────────────────────────────────

export const FEEDBACK_PAGE = 25;

export async function listFeedback(status: FeedbackStatus, kind: 'complaint' | 'other' | 'all', page: number): Promise<{ rows: AdminFeedbackRow[]; total: number }> {
  const s = await sql();
  const where = s`f.status = ${status} ${kind === 'complaint' ? s`AND f.kind = 'complaint'` : kind === 'other' ? s`AND f.kind <> 'complaint'` : s``}`;
  const rows = await s`
    SELECT f.*, coalesce(u.display_name, f.author_label) AS author, coalesce(u.is_guest, true) AS is_guest
    FROM player_feedback f LEFT JOIN users u ON u.id = f.user_id
    WHERE ${where}
    ORDER BY ${status === 'open' ? s`f.created_at ASC` : s`f.resolved_at DESC NULLS LAST`}
    LIMIT ${FEEDBACK_PAGE} OFFSET ${Math.max(0, page) * FEEDBACK_PAGE}`;
  const [c] = await s`SELECT count(*) AS n FROM player_feedback f WHERE ${where}`;
  return {
    total: num(c.n),
    rows: rows.map((r) => ({
      id: String(r.id), kind: r.kind, text: String(r.text), status: r.status,
      userId: r.user_id ? String(r.user_id) : null, authorLabel: r.author ?? null, isGuest: !!r.is_guest,
      aboutPlayer: r.about_player ?? null, roomCode: r.room_code ?? null, gameType: r.game_type ?? null,
      context: jsonObj(r.context),
      reply: r.reply ?? null, repliedAt: isoOrNull(r.replied_at), createdAt: iso(r.created_at), resolvedAt: isoOrNull(r.resolved_at),
    })),
  };
}

export async function setFeedbackStatus(actor: Actor, id: string, status: FeedbackStatus): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const r = await tx`
      UPDATE player_feedback SET status = ${status},
        resolved_by = ${status === 'resolved' ? actor.id : null}, resolved_at = ${status === 'resolved' ? tx`now()` : tx`NULL`}
      WHERE id = ${id} AND status <> ${status} RETURNING user_id, author_label, kind`;
    if (r.length === 0) throw new AdminError('not_found_or_same', 404);
    await logAction(tx, actor, status === 'resolved' ? 'feedback_resolve' : 'feedback_reopen',
      r[0].user_id ? { id: String(r[0].user_id), label: r[0].author_label ?? null } : null, { feedbackId: id, kind: r[0].kind });
  });
}

/** One reply per item; it resolves the item and lands in the author's inbox. */
export async function replyFeedback(actor: Actor, id: string, text: string): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const r = await tx`
      UPDATE player_feedback SET reply = ${text}, replied_at = now(), status = 'resolved', resolved_by = ${actor.id}, resolved_at = now()
      WHERE id = ${id} AND reply IS NULL AND user_id IS NOT NULL RETURNING user_id, author_label`;
    if (r.length === 0) throw new AdminError('cannot_reply', 409);
    await tx`INSERT INTO inbox_items (user_id, kind, feedback_id) VALUES (${r[0].user_id}, 'feedback_reply', ${id})`;
    await logAction(tx, actor, 'feedback_reply', { id: String(r[0].user_id), label: r[0].author_label ?? null }, { feedbackId: id, text });
  });
}

// ── server errors ───────────────────────────────────────────────────────────

export interface ErrorBatchItem { fingerprint: string; where: string; message: string; stack: string | null; count: number }

export async function upsertErrors(items: readonly ErrorBatchItem[]): Promise<void> {
  if (items.length === 0) return;
  const s = await sql();
  for (const e of items) {
    await s`
      INSERT INTO server_errors (fingerprint, "where", message, stack, count)
      VALUES (${e.fingerprint}, ${e.where}, ${e.message}, ${e.stack}, ${e.count})
      ON CONFLICT (fingerprint) WHERE status = 'new'
      DO UPDATE SET count = server_errors.count + EXCLUDED.count, last_at = now(), stack = coalesce(EXCLUDED.stack, server_errors.stack)`;
  }
  await s`DELETE FROM server_errors WHERE last_at < now() - interval '30 days'`;
}

export async function listErrors(status: 'new' | 'resolved', page: number): Promise<{ rows: AdminErrorRow[]; total: number }> {
  const s = await sql();
  const rows = await s`
    SELECT * FROM server_errors WHERE status = ${status} ORDER BY last_at DESC
    LIMIT ${FEEDBACK_PAGE} OFFSET ${Math.max(0, page) * FEEDBACK_PAGE}`;
  const [c] = await s`SELECT count(*) AS n FROM server_errors WHERE status = ${status}`;
  return {
    total: num(c.n),
    rows: rows.map((r) => ({
      id: String(r.id), where: String(r.where), message: String(r.message), stack: r.stack ?? null,
      count: num(r.count), firstAt: iso(r.first_at), lastAt: iso(r.last_at), status: r.status,
    })),
  };
}

export async function resolveError(actor: Actor, id: string): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const r = await tx`UPDATE server_errors SET status = 'resolved', resolved_by = ${actor.id}, resolved_at = now()
      WHERE id = ${id} AND status = 'new' RETURNING "where", message`;
    if (r.length === 0) throw new AdminError('not_found', 404);
    await logAction(tx, actor, 'error_resolve', null, { where: r[0].where, message: String(r[0].message).slice(0, 200) });
  });
}

// ── announcement ────────────────────────────────────────────────────────────

let annCache: { at: number; value: Announcement | null } | null = null;

export async function currentAnnouncement(): Promise<Announcement | null> {
  if (annCache && Date.now() - annCache.at < 60_000) return annCache.value;
  const s = await sql();
  const [r] = await s`
    SELECT id, text, url, expires_at FROM announcements
    WHERE cleared_at IS NULL AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC LIMIT 1`;
  const value = r ? { id: String(r.id), text: String(r.text), url: r.url ?? null, expiresAt: isoOrNull(r.expires_at) } : null;
  annCache = { at: Date.now(), value };
  return value;
}

export async function setAnnouncement(actor: Actor, text: string, url: string | null, expiresAt: Date | null): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    await tx`UPDATE announcements SET cleared_at = now() WHERE cleared_at IS NULL`;
    await tx`INSERT INTO announcements (text, url, expires_at, created_by) VALUES (${text}, ${url}, ${expiresAt ? expiresAt.toISOString() : null}::timestamptz, ${actor.id})`;
    await logAction(tx, actor, 'announcement_set', null, { text, url, expiresAt: expiresAt?.toISOString() ?? null });
  });
  annCache = null;
}

export async function clearAnnouncement(actor: Actor): Promise<void> {
  const s = await sql();
  await s.begin(async (tx) => {
    const r = await tx`UPDATE announcements SET cleared_at = now() WHERE cleared_at IS NULL RETURNING text`;
    if (r.length === 0) throw new AdminError('nothing_to_clear', 409);
    await logAction(tx, actor, 'announcement_clear', null, { text: r[0].text });
  });
  annCache = null;
}

export async function announcementHistory(): Promise<{ id: string; text: string; url: string | null; createdAt: string; clearedAt: string | null; expiresAt: string | null }[]> {
  const s = await sql();
  const rows = await s`SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20`;
  return rows.map((r) => ({
    id: String(r.id), text: String(r.text), url: r.url ?? null, createdAt: iso(r.created_at),
    clearedAt: isoOrNull(r.cleared_at), expiresAt: isoOrNull(r.expires_at),
  }));
}

// ── broadcasts ──────────────────────────────────────────────────────────────

export async function listBroadcasts(): Promise<AdminBroadcastRow[]> {
  const s = await sql();
  const rows = await s`
    SELECT b.*, (SELECT display_name FROM users u WHERE u.id = b.created_by) AS author,
           (SELECT count(*) FROM inbox_items i WHERE i.broadcast_id = b.id AND i.read_at IS NOT NULL) AS read_count
    FROM admin_broadcasts b ORDER BY b.created_at DESC LIMIT 30`;
  return rows.map((r) => ({
    id: String(r.id), title: String(r.title), text: String(r.text), recipients: r.recipients,
    peopleCount: num(r.people_count), readCount: num(r.read_count), createdAt: iso(r.created_at), createdBy: r.author ?? null,
  }));
}

/** Recipients of "all": every non-banned user seen in the last 90 days (guests included). */
export async function broadcastAudience(): Promise<number> {
  const s = await sql();
  const [r] = await s`
    SELECT count(DISTINCT d.user_id) AS n FROM activity_days d
    WHERE d.day > (now() AT TIME ZONE 'UTC')::date - 90 AND NOT EXISTS (SELECT 1 FROM user_bans b WHERE b.user_id = d.user_id)`;
  return num(r.n);
}

export async function sendBroadcast(actor: Actor, title: string, text: string, people: string[] | null): Promise<number> {
  const s = await sql();
  return s.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(4404401)`;
    const [last] = await tx`SELECT max(created_at) AS at, count(*) FILTER (WHERE created_at > now() - interval '1 day') AS day FROM admin_broadcasts`;
    if (last.at && Date.now() - new Date(last.at as string).getTime() < BROADCAST_MIN_INTERVAL_MS) throw new AdminError('too_soon', 429);
    if (num(last.day) >= BROADCAST_DAILY_MAX) throw new AdminError('daily_limit', 429);
    const [b] = await tx`
      INSERT INTO admin_broadcasts (created_by, title, text, recipients) VALUES (${actor.id}, ${title}, ${text}, ${people ? 'people' : 'all'})
      RETURNING id`;
    const ins = people
      ? await tx`
          INSERT INTO inbox_items (user_id, kind, broadcast_id)
          SELECT u.id, 'broadcast', ${b.id} FROM users u
          WHERE u.id = ANY(${people}::uuid[]) AND u.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM user_bans x WHERE x.user_id = u.id)
          ON CONFLICT DO NOTHING RETURNING id`
      : await tx`
          INSERT INTO inbox_items (user_id, kind, broadcast_id)
          SELECT DISTINCT d.user_id, 'broadcast', ${b.id}::uuid FROM activity_days d
          WHERE d.day > (now() AT TIME ZONE 'UTC')::date - 90 AND NOT EXISTS (SELECT 1 FROM user_bans x WHERE x.user_id = d.user_id)
          ON CONFLICT DO NOTHING RETURNING id`;
    await tx`UPDATE admin_broadcasts SET people_count = ${ins.length} WHERE id = ${b.id}`;
    await logAction(tx, actor, 'broadcast_send', null, { title, text, recipients: people ? 'people' : 'all', delivered: ins.length });
    return ins.length;
  }) as Promise<number>;
}

// ── audit log ───────────────────────────────────────────────────────────────

export const LOG_PAGE = 50;

export interface LogFilter { admin?: string; groups?: string[]; from?: string; to?: string; q?: string; target?: string }

function logWhere(s: Sql, f: LogFilter) {
  const kinds = kindsForGroups(f.groups ?? []);
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = day(f.from), to = day(f.to);
  return s`true
    ${f.admin && /^[0-9a-f-]{36}$/i.test(f.admin) ? s`AND admin_id = ${f.admin}::uuid` : s``}
    ${f.target && /^[0-9a-f-]{36}$/i.test(f.target) ? s`AND target_user_id = ${f.target}::uuid` : s``}
    ${kinds.length ? s`AND kind = ANY(${kinds})` : s``}
    ${from ? s`AND at >= (${from}::date AT TIME ZONE 'Europe/Kyiv')` : s``}
    ${to ? s`AND at < ((${to}::date + 1) AT TIME ZONE 'Europe/Kyiv')` : s``}
    ${like ? s`AND (admin_label ILIKE ${like} OR target_label ILIKE ${like} OR details::text ILIKE ${like})` : s``}`;
}

const toLogRow = (r: Record<string, unknown>): AdminLogRow => ({
  id: String(r.id), at: iso(r.at), adminLabel: (r.admin_label as string) ?? null, kind: String(r.kind),
  targetUserId: r.target_user_id ? String(r.target_user_id) : null, targetLabel: (r.target_label as string) ?? null,
  details: jsonObj(r.details),
});

export async function listLog(f: LogFilter, page: number): Promise<{ rows: AdminLogRow[]; total: number; admins: { id: string; label: string }[] }> {
  const s = await sql();
  const where = logWhere(s, f);
  const rows = await s`SELECT * FROM admin_actions WHERE ${where} ORDER BY at DESC LIMIT ${LOG_PAGE} OFFSET ${Math.max(0, page) * LOG_PAGE}`;
  const [c] = await s`SELECT count(*) AS n FROM admin_actions WHERE ${where}`;
  const admins = await s`SELECT DISTINCT ON (admin_id) admin_id, admin_label FROM admin_actions WHERE admin_id IS NOT NULL ORDER BY admin_id, at DESC`;
  return {
    rows: rows.map(toLogRow), total: num(c.n),
    admins: admins.map((r) => ({ id: String(r.admin_id), label: String(r.admin_label ?? '—') })),
  };
}

export async function exportLog(f: LogFilter): Promise<AdminLogRow[]> {
  const s = await sql();
  const rows = await s`SELECT * FROM admin_actions WHERE ${logWhere(s, f)} ORDER BY at DESC LIMIT 10000`;
  return rows.map(toLogRow);
}

// ── backup ──────────────────────────────────────────────────────────────────

/** Every row of the listed tables (sessions and avatar bytes excluded) as one object. */
export interface BackupDump {
  meta: { format: typeof BACKUP_FORMAT; version: number; createdAt: string; by: string; commit: string | null; migrations: string[]; counts: Record<string, number> };
  tables: Record<string, unknown[]>;
}

/**
 * Every BACKUP_TABLES table as JSON rows. Pass a REPEATABLE READ transaction to get
 * all tables from one snapshot (the cloud backup does), so foreign keys line up.
 */
export async function dumpTables(q: Q, by: string, commit: string | null): Promise<BackupDump> {
  const existing = new Set((await q`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).map((r) => String(r.tablename)));
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    if (!existing.has(t)) continue;
    // row_to_json keeps jsonb as real objects (drizzle's pass-through parser would give text).
    const rows = await q`SELECT row_to_json(x)::text AS j FROM ${q(t)} x`;
    tables[t] = rows.map((r) => JSON.parse(String(r.j)));
    counts[t] = rows.length;
  }
  const migrations = existing.has('schema_migrations')
    ? (await q`SELECT name FROM schema_migrations ORDER BY name`).map((r) => String(r.name))
    : [];
  return { meta: { format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), by, commit, migrations, counts }, tables };
}

export async function exportBackup(actor: Actor, commit: string | null = null): Promise<BackupDump> {
  const s = await sql();
  const dump = await dumpTables(s, actor.label, commit);
  await logAction(s, actor, 'backup_export', null, { tables: Object.keys(dump.tables).length, rows: Object.values(dump.meta.counts).reduce((a, b) => a + b, 0) });
  return dump;
}
