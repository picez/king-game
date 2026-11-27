// ---------------------------------------------------------------------------
// Daily database backup to Cloudflare R2 (Stage 44.1).
//
// The server takes the copy itself (Render's Node runtime has no pg_dump): every
// BACKUP_TABLES table from ONE repeatable-read snapshot, as the same JSON the admin
// "download" produces, gzipped, one PUT to R2 under backups/db/. Old copies are
// pruned by src/net/backupPolicy.ts. Restore: `npm run db:restore -- <file>`.
//
// Off unless all four R2_* env vars are set; scheduled only in production (or
// DB_BACKUP=on), so a local server with prod keys never writes copies of a dev DB.
// ---------------------------------------------------------------------------

import { gzipSync } from 'node:zlib';
import type { AdminBackupStatus, AdminCloudBackup } from '../../src/net/admin';
import {
  BACKUP_CHECK_MS, BACKUP_FIRST_CHECK_MS, BACKUP_MANUAL_GAP_MS, BACKUP_PREFIX,
  backupKey, expiredBackups, isBackupDue, newestBackupAt, parseBackupKey,
} from '../../src/net/backupPolicy';
import { encodeKeyPath, signRequest } from './s3sig';

export interface R2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Override (tests / another S3 host); default https://<account>.r2.cloudflarestorage.com */
  endpoint?: string;
}

type Env = Record<string, string | undefined>;

export function r2SettingsFrom(env: Env): R2Settings | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = env.R2_ENDPOINT?.trim() || undefined;
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
}

/** DB_BACKUP=off → never; =on → always; otherwise only in production. */
export function backupsScheduled(env: Env): boolean {
  const mode = env.DB_BACKUP?.trim().toLowerCase();
  if (mode === 'off') return false;
  if (mode === 'on') return true;
  return env.NODE_ENV === 'production';
}

// ── tiny S3 client ──────────────────────────────────────────────────────────

export interface StoredObject { key: string; size: number; lastModified: string }

const xmlDecode = (v: string) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? xmlDecode(m[1]) : null;
};

export function r2Client(st: R2Settings, send: typeof fetch = fetch) {
  const base = `${(st.endpoint ?? `https://${st.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '')}/${encodeURIComponent(st.bucket)}`;
  async function call(method: string, url: string, what: string, body?: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
    const signed = signRequest({ method, url, headers, body, accessKeyId: st.accessKeyId, secretAccessKey: st.secretAccessKey, region: 'auto', now: new Date() });
    const res = await send(url, { method, headers: signed, body: body as BodyInit | undefined });
    if (!res.ok && !(method === 'GET' && res.status === 404 && what === 'download')) {
      throw new Error(`backup storage answered ${res.status} to ${what}`);
    }
    return res;
  }
  return {
    async list(prefix: string): Promise<StoredObject[]> {
      const found: StoredObject[] = [];
      let token: string | null = null;
      do {
        const q = new URLSearchParams({ 'list-type': '2', prefix });
        if (token) q.set('continuation-token', token);
        const xml = await (await call('GET', `${base}?${q}`, 'list')).text();
        for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
          const key = tag(block, 'Key');
          if (key) found.push({ key, size: Number(tag(block, 'Size') ?? 0), lastModified: tag(block, 'LastModified') ?? '' });
        }
        token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : null;
      } while (token);
      return found;
    },
    async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
      await call('PUT', `${base}/${encodeKeyPath(key)}`, 'upload', body, { 'content-type': contentType });
    },
    async get(key: string): Promise<Response | null> {
      const res = await call('GET', `${base}/${encodeKeyPath(key)}`, 'download');
      return res.status === 404 ? null : res;
    },
    async remove(key: string): Promise<void> {
      await call('DELETE', `${base}/${encodeKeyPath(key)}`, 'delete');
    },
  };
}

// ── run + schedule ──────────────────────────────────────────────────────────

/** Advisory lock: two instances (deploy overlap) never take a copy at once. */
const LOCK_KEY = 4_401_202_611;

let running = false;
let lastRun: AdminBackupStatus['lastRun'] = null;
let timers: ReturnType<typeof setTimeout>[] = [];

export class BackupError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}

/**
 * Takes one copy now. `due` (schedule only) re-checks inside the lock that the
 * newest copy is still a day old — the other instance may have just made one.
 */
export async function runBackup(reason: 'schedule' | 'manual', by: string, now = () => new Date()): Promise<{ key: string; bytes: number } | null> {
  const st = r2SettingsFrom(process.env);
  if (!st) throw new BackupError('backup_not_configured', 503);
  if (running) throw new BackupError('backup_running');
  running = true;
  const client = r2Client(st);
  try {
    const keys = (await client.list(BACKUP_PREFIX)).map((o) => o.key);
    if (reason === 'schedule' && !isBackupDue(keys, now())) return null;
    if (reason === 'manual') {
      const at = newestBackupAt(keys);
      if (at && now().getTime() - at.getTime() < BACKUP_MANUAL_GAP_MS) throw new BackupError('backup_too_soon', 429);
    }
    const { getDb } = await import('../db/client');
    const conn = await getDb();
    if (!conn) throw new BackupError('db_disabled', 503);
    const { dumpTables } = await import('./store');
    const { gitCommit } = await import('../diagnostics');
    type Tx = Parameters<typeof dumpTables>[0];
    const sql = conn.sql as unknown as { begin: <T>(opts: string, fn: (tx: Tx) => Promise<T>) => Promise<T> };
    const dump = await sql.begin('isolation level repeatable read read only', async (tx) => {
      const lock = await (tx as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ ok: boolean }>>)`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
      if (!lock[0]?.ok) return null;
      return dumpTables(tx, by, gitCommit());
    });
    if (!dump) return null;
    const body = gzipSync(Buffer.from(JSON.stringify(dump), 'utf8'));
    const key = backupKey(now());
    await client.put(key, body, 'application/gzip');
    for (const old of expiredBackups([...keys, key])) {
      try { await client.remove(old); } catch (e) { console.error('[King] backup prune failed', old, (e as Error).message); }
    }
    lastRun = { at: now().toISOString(), ok: true, reason, key, bytes: body.length, error: null };
    console.log(`[King] backup ${reason}: ${key} (${Math.round(body.length / 1024)} KB)`);
    return { key, bytes: body.length };
  } catch (e) {
    const refusal = e instanceof BackupError && (e.code === 'backup_too_soon' || e.code === 'backup_running');
    if (!refusal) {
      const msg = e instanceof Error ? e.message : String(e);
      lastRun = { at: now().toISOString(), ok: false, reason, key: null, bytes: null, error: msg };
      // "[King]" lines land in the admin "Errors" list (server/admin/errorSink.ts).
      console.error('[King] backup failed', msg);
    }
    throw e;
  } finally {
    running = false;
  }
}

export async function backupStatus(): Promise<AdminBackupStatus> {
  const st = r2SettingsFrom(process.env);
  const base = { configured: st !== null, scheduled: st !== null && backupsScheduled(process.env), running, lastRun };
  if (!st) return { ...base, backups: [], listError: null };
  try {
    const objects = await r2Client(st).list(BACKUP_PREFIX);
    const backups: AdminCloudBackup[] = objects
      .filter((o) => parseBackupKey(o.key))
      .sort((a, b) => (a.key < b.key ? 1 : -1))
      .map((o) => ({ key: o.key, size: o.size, at: parseBackupKey(o.key)!.toISOString() }));
    return { ...base, backups, listError: null };
  } catch (e) {
    return { ...base, backups: [], listError: e instanceof Error ? e.message : String(e) };
  }
}

/** The body of one of OUR copies, or null (unknown / foreign key → 404). */
export async function downloadBackup(key: string): Promise<Response | null> {
  const st = r2SettingsFrom(process.env);
  if (!st) throw new BackupError('backup_not_configured', 503);
  if (!parseBackupKey(key)) return null;
  return r2Client(st).get(key);
}

export function startBackupScheduler(): void {
  if (!r2SettingsFrom(process.env)) { console.log('[King] backup: R2 not configured — cloud backups off'); return; }
  if (!backupsScheduled(process.env)) { console.log('[King] backup: schedule off (not production / DB_BACKUP=off)'); return; }
  const tick = () => { runBackup('schedule', 'schedule').catch(() => { /* logged in runBackup */ }); };
  const first = setTimeout(() => {
    tick();
    const every = setInterval(tick, BACKUP_CHECK_MS);
    every.unref?.();
    timers.push(every);
  }, BACKUP_FIRST_CHECK_MS);
  first.unref?.();
  timers.push(first);
  console.log('[King] backup: daily cloud backup scheduled');
}

/** Tests only. */
export function resetBackupState(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  running = false;
  lastRun = null;
}
