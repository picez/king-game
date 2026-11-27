// ---------------------------------------------------------------------------
// Cloud backup policy (Stage 44.1) — pure: object keys, "is a copy due", which old
// copies to delete, and the restore plan. The server (server/admin/cloudBackup.ts)
// and the restore script (server/db/restore.ts) do the I/O around these.
// ---------------------------------------------------------------------------

import { BACKUP_FORMAT, BACKUP_TABLES } from './admin';

export const BACKUP_PREFIX = 'backups/db/';
/** One copy a day; the scheduler checks hourly, first 5 min after boot (not during the deploy). */
export const BACKUP_EVERY_MS = 24 * 60 * 60 * 1000;
export const BACKUP_CHECK_MS = 60 * 60 * 1000;
export const BACKUP_FIRST_CHECK_MS = 5 * 60 * 1000;
/** A manual copy at most once per 10 min. */
export const BACKUP_MANUAL_GAP_MS = 10 * 60 * 1000;
/** Kept: the 14 newest copies + the newest of each of the 8 seven-day windows (≈ 2 months). */
export const KEEP_DAILY = 14;
export const KEEP_WEEKLY = 8;

const KEY = /^backups\/db\/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.json\.gz$/;

/** backups/db/2026-11-27T10-05-00Z.json.gz (UTC, to the second). */
export function backupKey(at: Date): string {
  return `${BACKUP_PREFIX}${at.toISOString().slice(0, 19).replace(/:/g, '-')}Z.json.gz`;
}

export function parseBackupKey(key: string): Date | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

/** Our keys only (foreign objects under the prefix are ignored), newest first. */
export function backupKeysNewestFirst(keys: readonly string[]): string[] {
  return keys.filter((k) => parseBackupKey(k) !== null).sort().reverse();
}

export function newestBackupAt(keys: readonly string[]): Date | null {
  const k = backupKeysNewestFirst(keys)[0];
  return k ? parseBackupKey(k) : null;
}

/** Due when there is no copy or the newest one is at least a day old. */
export function isBackupDue(keys: readonly string[], now: Date, every = BACKUP_EVERY_MS): boolean {
  const at = newestBackupAt(keys);
  return at === null || now.getTime() - at.getTime() >= every;
}

/**
 * Keys to delete. Kept: the `daily` newest, plus the newest copy in each of the
 * `weekly` seven-day windows counted back from the newest copy. The newest copy is
 * never deleted; foreign keys are never touched.
 */
export function expiredBackups(keys: readonly string[], daily = KEEP_DAILY, weekly = KEEP_WEEKLY): string[] {
  const ours = backupKeysNewestFirst(keys);
  if (ours.length === 0) return [];
  const top = parseBackupKey(ours[0])!.getTime();
  const kept = new Set<string>([ours[0], ...ours.slice(0, daily)]);
  const seen = new Set<number>();
  for (const k of ours) {
    const w = Math.floor((top - parseBackupKey(k)!.getTime()) / (7 * BACKUP_EVERY_MS));
    if (w >= weekly || seen.has(w)) continue;
    seen.add(w);
    kept.add(k);
  }
  return ours.filter((k) => !kept.has(k));
}

// ── restore plan ────────────────────────────────────────────────────────────

export interface RestoreStep { table: string; rows: Record<string, unknown>[] }
export type RestorePlan = { ok: true; steps: RestoreStep[]; skipped: string[] } | { ok: false; error: string };

/**
 * Validates a parsed backup file and orders its tables for insertion. BACKUP_TABLES
 * is already foreign-key safe (users first, parents before children), so the plan
 * follows it; unknown tables are reported as skipped, never inserted.
 */
export function planRestore(dump: unknown): RestorePlan {
  if (!dump || typeof dump !== 'object') return { ok: false, error: 'not a JSON object' };
  const d = dump as { meta?: { format?: unknown }; tables?: unknown };
  if (d.meta?.format !== undefined && d.meta.format !== BACKUP_FORMAT) return { ok: false, error: `unknown format ${String(d.meta.format)}` };
  if (!d.tables || typeof d.tables !== 'object' || Array.isArray(d.tables)) return { ok: false, error: 'no "tables" object' };
  const tables = d.tables as Record<string, unknown>;
  const known = new Set<string>(BACKUP_TABLES);
  const steps: RestoreStep[] = [];
  for (const t of BACKUP_TABLES) {
    const rows = tables[t];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) {
      return { ok: false, error: `table ${t} is not an array of rows` };
    }
    steps.push({ table: t, rows: rows as Record<string, unknown>[] });
  }
  return { ok: true, steps, skipped: Object.keys(tables).filter((t) => !known.has(t)) };
}

/** The columns to insert: present both in the backup rows and in today's table. */
export function restoreColumns(rows: readonly Record<string, unknown>[], tableColumns: readonly string[]): string[] {
  const inRows = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) inRows.add(k);
  return tableColumns.filter((c) => inRows.has(c));
}

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
