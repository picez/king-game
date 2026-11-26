// ---------------------------------------------------------------------------
// Admin panel + player feedback (Stage 44.0) — the SHARED, PURE contract.
//
// Server routes (server/admin/*) and the admin client (src/admin/*) both import
// from here, so a field renamed on one side breaks the typecheck on the other.
// Nothing here touches the network, the DB or the DOM.
// ---------------------------------------------------------------------------

/** The admin panel is served at /admin (the SPA renders its own lazy chunk there). */
export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

// ── who is an admin ─────────────────────────────────────────────────────────

/** Parses ADMIN_EMAILS ("a@x.com, B@y.com") into a lower-cased set. Empty = no admins. */
export function parseAdminEmails(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@')),
  );
}

// ── player feedback ─────────────────────────────────────────────────────────

export const FEEDBACK_KINDS = ['complaint', 'suggestion', 'bug'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_TEXT_MAX = 1000;
export const FEEDBACK_ABOUT_MAX = 40;

export interface FeedbackInput {
  kind: FeedbackKind;
  text: string;
  aboutPlayer: string | null;
  roomCode: string | null;
  gameType: string | null;
  context: { screen?: string; lang?: string; version?: string; ua?: string; size?: string };
}

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return s ? s.slice(0, max) : null;
};

/** Validates a POST /api/feedback body. Returns the clean input or an error code. */
export function parseFeedbackBody(body: Record<string, unknown>): FeedbackInput | { error: 'invalid_kind' | 'empty_text' } {
  const kind = body.kind;
  if (typeof kind !== 'string' || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) return { error: 'invalid_kind' };
  const text = clip(body.text, FEEDBACK_TEXT_MAX);
  if (!text || text.length < 3) return { error: 'empty_text' };
  const ctx = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>;
  const room = clip(body.roomCode, 8);
  return {
    kind: kind as FeedbackKind,
    text,
    aboutPlayer: clip(body.aboutPlayer, FEEDBACK_ABOUT_MAX),
    roomCode: room && /^[A-Z0-9]{3,8}$/i.test(room) ? room.toUpperCase() : null,
    gameType: clip(body.gameType, 20),
    context: {
      ...(clip(ctx.screen, 40) ? { screen: clip(ctx.screen, 40)! } : {}),
      ...(clip(ctx.lang, 8) ? { lang: clip(ctx.lang, 8)! } : {}),
      ...(clip(ctx.version, 20) ? { version: clip(ctx.version, 20)! } : {}),
      ...(clip(ctx.ua, 200) ? { ua: clip(ctx.ua, 200)! } : {}),
      ...(clip(ctx.size, 20) ? { size: clip(ctx.size, 20)! } : {}),
    },
  };
}

export type FeedbackStatus = 'open' | 'resolved';

/** A player's own feedback item (GET /api/me/feedback). */
export interface MyFeedbackItem {
  id: string;
  kind: FeedbackKind;
  text: string;
  status: FeedbackStatus;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

/** One inbox entry (GET /api/me/inbox). */
export interface InboxItem {
  id: string;
  kind: 'broadcast' | 'feedback_reply';
  title: string;
  text: string;
  /** For a reply: the player's original feedback text (clipped). */
  quote: string | null;
  createdAt: string;
  read: boolean;
}

export interface InboxResponse { items: InboxItem[]; unread: number }

export interface Announcement { id: string; text: string; url: string | null; expiresAt: string | null }

export const ANNOUNCEMENT_TEXT_MAX = 200;
export const BROADCAST_TITLE_MAX = 60;
export const BROADCAST_TEXT_MAX = 500;
export const REPLY_TEXT_MAX = 1000;
export const BAN_REASON_MAX = 200;

/** Only http(s) links may go into an announcement; anything else is dropped. */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString().slice(0, 300) : null;
  } catch { return null; }
}

export function clipText(v: unknown, max: number): string | null { return clip(v, max); }

// ── audit log ───────────────────────────────────────────────────────────────

export const ADMIN_ACTION_GROUPS = {
  moderation: ['user_ban', 'user_unban', 'nickname_reset', 'avatar_reset', 'user_delete', 'sessions_revoke'],
  players: ['user_view', 'chips_adjust', 'stats_reset'],
  games: ['room_close'],
  appeals: ['feedback_resolve', 'feedback_reopen', 'feedback_reply', 'error_resolve'],
  announcements: ['announcement_set', 'announcement_clear', 'broadcast_send'],
  system: ['backup_export'],
} as const;
export type AdminActionGroup = keyof typeof ADMIN_ACTION_GROUPS;
export type AdminActionKind = (typeof ADMIN_ACTION_GROUPS)[AdminActionGroup][number];
export const ADMIN_ACTION_KINDS: readonly AdminActionKind[] = Object.values(ADMIN_ACTION_GROUPS).flat();

/** Ukrainian labels for the log (the admin UI is Ukrainian-only, like the quiz admin). */
export const ADMIN_ACTION_LABEL: Record<AdminActionKind, string> = {
  user_ban: 'Бан', user_unban: 'Розбан', nickname_reset: 'Скидання ніка', avatar_reset: 'Скидання аватара',
  user_delete: 'Видалення акаунта', sessions_revoke: 'Вихід з усіх пристроїв',
  user_view: 'Перегляд картки', chips_adjust: 'Корекція фішок', stats_reset: 'Скидання статистики',
  room_close: 'Закриття кімнати',
  feedback_resolve: 'Звернення закрито', feedback_reopen: 'Звернення відкрито знову', feedback_reply: 'Відповідь на звернення',
  error_resolve: 'Помилку закрито',
  announcement_set: 'Оголошення', announcement_clear: 'Оголошення знято', broadcast_send: 'Розсилка',
  backup_export: 'Резервна копія',
};

export const ADMIN_GROUP_LABEL: Record<AdminActionGroup, string> = {
  moderation: 'Модерація', players: 'Гравці', games: 'Ігри', appeals: 'Звернення',
  announcements: 'Оголошення', system: 'Система',
};

export interface AdminLogRow {
  id: string;
  at: string;
  adminLabel: string | null;
  kind: string;
  targetUserId: string | null;
  targetLabel: string | null;
  details: Record<string, unknown>;
}

/** Kinds that belong to the chosen groups (empty selection = every kind). */
export function kindsForGroups(groups: readonly string[]): string[] {
  const known = groups.filter((g): g is AdminActionGroup => g in ADMIN_ACTION_GROUPS);
  if (known.length === 0) return [];
  return known.flatMap((g) => [...ADMIN_ACTION_GROUPS[g]]);
}

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // Formula-injection guard: a cell starting with = + - @ is prefixed with a quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV of log rows (UTF-8 BOM so Excel opens Cyrillic correctly). */
export function buildLogCsv(rows: readonly AdminLogRow[]): string {
  const head = ['Час', 'Адмін', 'Дія', 'Гравець', 'Деталі'];
  const lines = rows.map((r) => [
    r.at, r.adminLabel ?? '', ADMIN_ACTION_LABEL[r.kind as AdminActionKind] ?? r.kind, r.targetLabel ?? '', r.details,
  ].map(csvCell).join(','));
  return `﻿${[head.join(','), ...lines].join('\r\n')}\r\n`;
}

// ── server errors ───────────────────────────────────────────────────────────

/** Masks personal data out of an error text: emails, long hex/uuids, IPs, tokens. */
export function maskErrorText(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '<token>');
}

/** A stable grouping key for an error: where + masked message with digits folded. */
export function errorFingerprint(where: string, message: string): string {
  const norm = maskErrorText(message).replace(/\d+/g, 'N').slice(0, 200);
  let h = 2166136261;
  const src = `${where}|${norm}`;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${where}:${(h >>> 0).toString(16)}`;
}

// ── admin DTOs ──────────────────────────────────────────────────────────────

export interface AdminStats {
  users: { total: number; accounts: number; guests: number; new7: number; new30: number; banned: number; online: number };
  games: { today: number; d7: number; d30: number; total: number; byGame: { gameType: string; d30: number; total: number }[] };
  live: { rooms: number; inGame: number; lobby: number; connections: number; humans: number; bots: number };
  appeals: { openFeedback: number; newErrors: number };
}

export interface AdminHealth {
  version: string;
  commit: string | null;
  node: string;
  uptimeSec: number;
  memory: { rssMb: number; heapUsedMb: number; heapTotalMb: number };
  eventLoopLagMs: number;
  db: { sizeMb: number | null; tables: { name: string; rows: number }[] } | null;
  migrations: { applied: number; files: number } | null;
}

export interface MetricBucket { day: string; games: number; newUsers: number; activeUsers: number; players: number }
export interface AdminMetrics {
  period: number;
  buckets: MetricBucket[];
  summary: { dau: number; wau: number; mau: number; games: number; prevGames: number; newUsers: number; prevNewUsers: number };
  byGame: { gameType: string; games: number }[];
  byHour: number[];
  topPlayers: { userId: string; name: string; games: number }[];
}

export const METRIC_PERIODS = [7, 30, 90, 365] as const;

/** Every day between two dates inclusive, as YYYY-MM-DD (UTC). Pure; used to fill gaps. */
export function dayRange(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface AdminLiveRoom {
  code: string;
  gameType: string;
  started: boolean;
  hostName: string | null;
  players: { name: string; type: 'human' | 'ai'; connected: boolean; userId: string | null }[];
  spectators: number;
  capacity: number;
  createdAt: number | null;
  updatedAt: number | null;
  hasPassword: boolean;
}

export interface AdminUserRow {
  id: string;
  displayName: string | null;
  email: string | null;
  isGuest: boolean;
  createdAt: string;
  lastActive: string | null;
  games: number;
  banned: boolean;
  online: boolean;
}

export interface AdminUserDetail extends AdminUserRow {
  avatar: string | null;
  avatarImageUrl: string | null;
  friendCode: string | null;
  provider: string | null;
  ban: { reason: string | null; bannedAt: string; bannedBy: string | null } | null;
  sessions: number;
  chips: number | null;
  stats: { gameType: string; played: number; won: number }[];
  recentMatches: { matchId: string; gameType: string; startedAt: string; outcome: string; category: string }[];
  feedback: { id: string; kind: FeedbackKind; text: string; status: FeedbackStatus; createdAt: string }[];
  friends: number;
  isAdmin: boolean;
}

export interface AdminFeedbackRow {
  id: string;
  kind: FeedbackKind;
  text: string;
  status: FeedbackStatus;
  userId: string | null;
  authorLabel: string | null;
  isGuest: boolean;
  aboutPlayer: string | null;
  roomCode: string | null;
  gameType: string | null;
  context: Record<string, unknown>;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AdminErrorRow {
  id: string;
  where: string;
  message: string;
  stack: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
  status: 'new' | 'resolved';
}

export interface AdminBadge { feedback: number; complaints: number; errors: number; total: number }

export interface AdminBroadcastRow {
  id: string; title: string; text: string; recipients: 'all' | 'people';
  peopleCount: number; readCount: number; createdAt: string; createdBy: string | null;
}

export const BROADCAST_MIN_INTERVAL_MS = 10 * 60 * 1000;
export const BROADCAST_DAILY_MAX = 10;
export const FEEDBACK_HOURLY_MAX = 5;
export const BACKUP_TABLES = [
  'users', 'user_settings', 'user_game_settings', 'auth_accounts', 'games', 'game_players', 'rounds',
  'user_stats', 'friendships', 'poker_wallets', 'poker_ledger', 'poker_matches', 'poker_match_settlements',
  'online_matches', 'online_match_participants', 'user_bans', 'admin_actions', 'player_feedback',
  'server_errors', 'announcements', 'admin_broadcasts', 'inbox_items', 'activity_days',
] as const;
