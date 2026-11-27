// Stage 44.1 — cloud backup: SigV4 signer, key/retention policy, restore plan,
// the R2 client against a fake fetch, and the source guards.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { awsEncode, encodeKeyPath, signRequest, sha256Hex } from '../../server/admin/s3sig';
import { backupsScheduled, r2Client, r2SettingsFrom } from '../../server/admin/cloudBackup';
import {
  BACKUP_EVERY_MS, backupKey, chunks, expiredBackups, expiredLocalBackups, localBackupName, parseLocalBackupName, isBackupDue, parseBackupKey, planRestore, restoreColumns,
} from './backupPolicy';
import { BACKUP_FORMAT, BACKUP_TABLES } from './admin';

const DAY = BACKUP_EVERY_MS;

describe('SigV4 signer', () => {
  it('matches the AWS S3 documentation example (GET Object with Range)', () => {
    const h = signRequest({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { Range: 'bytes=0-9' },
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
      + 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(h['x-amz-content-sha256']).toBe(sha256Hex(''));
    expect(h.host).toBeUndefined();
  });

  it('encodes keys segment by segment, RFC 3986 strict', () => {
    expect(awsEncode("a b!'()*")).toBe('a%20b%21%27%28%29%2A');
    expect(encodeKeyPath('backups/db/x y.json.gz')).toBe('backups/db/x%20y.json.gz');
  });
});

describe('backup policy', () => {
  const at = (iso: string) => backupKey(new Date(iso));

  it('round-trips a key and ignores foreign objects', () => {
    const k = at('2026-11-27T10:05:00.123Z');
    expect(k).toBe('backups/db/2026-11-27T10-05-00Z.json.gz');
    expect(parseBackupKey(k)?.toISOString()).toBe('2026-11-27T10:05:00.000Z');
    expect(parseBackupKey('backups/db/notes.txt')).toBeNull();
  });

  it('is due with no copy or a day-old copy', () => {
    const now = new Date('2026-11-27T12:00:00Z');
    expect(isBackupDue([], now)).toBe(true);
    expect(isBackupDue([at('2026-11-27T01:00:00Z')], now)).toBe(false);
    expect(isBackupDue([at('2026-11-26T12:00:00Z')], now)).toBe(true);
    expect(isBackupDue(['backups/db/foreign'], now)).toBe(true);
  });

  it('keeps 14 newest + one per week for 8 weeks, never the newest, never foreign keys', () => {
    const top = new Date('2026-11-27T03:00:00Z').getTime();
    const keys = Array.from({ length: 90 }, (_, i) => backupKey(new Date(top - i * DAY)));
    const gone = new Set(expiredBackups([...keys, 'backups/db/foreign.bin']));
    const kept = keys.filter((k) => !gone.has(k));
    expect(gone.has('backups/db/foreign.bin')).toBe(false);
    expect(kept.slice(0, 14)).toEqual(keys.slice(0, 14));
    expect(kept.length).toBe(14 + 6); // weeks 0–1 already covered by the 14 dailies
    expect(kept.every((k) => top - parseBackupKey(k)!.getTime() < 8 * 7 * DAY)).toBe(true);
    expect(expiredBackups([keys[0]], 0, 0)).toEqual([]);
  });
});

describe('restore plan', () => {
  it('orders tables by BACKUP_TABLES, skips unknown ones, validates rows', () => {
    const plan = planRestore({
      meta: { format: BACKUP_FORMAT },
      tables: { game_players: [{ id: 2 }], users: [{ id: 1 }], sessions: [{ x: 1 }] },
    });
    expect(plan.ok && plan.steps.map((s) => s.table)).toEqual(['users', 'game_players']);
    expect(plan.ok && plan.skipped).toEqual(['sessions']);
    expect(planRestore({ meta: { format: 'other' }, tables: {} }).ok).toBe(false);
    expect(planRestore({ tables: { users: [1] } }).ok).toBe(false);
    expect(planRestore({ tables: { users: [] } }).ok).toBe(true); // legacy 44.0 download (no format)
  });

  it('BACKUP_TABLES lists parents before children', () => {
    const order = (t: string) => BACKUP_TABLES.indexOf(t as (typeof BACKUP_TABLES)[number]);
    const fk: Array<[string, string]> = [
      ['users', 'user_settings'], ['games', 'game_players'], ['games', 'rounds'],
      ['online_matches', 'online_match_participants'], ['admin_broadcasts', 'inbox_items'], ['player_feedback', 'inbox_items'],
    ];
    for (const [parent, child] of fk) expect(order(parent)).toBeLessThan(order(child));
  });

  it('inserts only columns both sides know; chunks', () => {
    expect(restoreColumns([{ a: 1, old: 2 }, { b: 3 }], ['a', 'b', 'new'])).toEqual(['a', 'b']);
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('R2 settings + client', () => {
  it('needs all four env vars; schedules only in production unless DB_BACKUP says so', () => {
    const env = { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' };
    expect(r2SettingsFrom(env)?.bucket).toBe('b');
    expect(r2SettingsFrom({ ...env, R2_BUCKET: ' ' })).toBeNull();
    expect(backupsScheduled({ NODE_ENV: 'production' })).toBe(true);
    expect(backupsScheduled({ NODE_ENV: 'development' })).toBe(false);
    expect(backupsScheduled({ NODE_ENV: 'production', DB_BACKUP: 'off' })).toBe(false);
    expect(backupsScheduled({ DB_BACKUP: 'on' })).toBe(true);
  });

  it('lists (with pagination), puts and deletes through signed requests', async () => {
    const calls: Array<{ method: string; url: string; auth: string | undefined }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ method: String(init.method), url, auth: headers.authorization });
      if (init.method === 'GET' && url.includes('list-type=2')) {
        const page2 = url.includes('continuation-token=');
        const xml = page2
          ? '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>backups/db/b</Key><Size>7</Size></Contents></ListBucketResult>'
          : '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>t&amp;1</NextContinuationToken><Contents><Key>backups/db/a</Key><Size>5</Size><LastModified>x</LastModified></Contents></ListBucketResult>';
        return new Response(xml, { status: 200 });
      }
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const c = r2Client({ accountId: 'acc', accessKeyId: 'k', secretAccessKey: 's', bucket: 'bk' }, fake);
    const list = await c.list('backups/db/');
    expect(list.map((o) => [o.key, o.size])).toEqual([['backups/db/a', 5], ['backups/db/b', 7]]);
    expect(calls[1].url).toContain('continuation-token=t%261');
    await c.put('backups/db/x.json.gz', new Uint8Array([1, 2]), 'application/gzip');
    await c.remove('backups/db/x.json.gz');
    expect(calls.map((x) => x.method)).toEqual(['GET', 'GET', 'PUT', 'DELETE']);
    expect(calls[2].url).toBe('https://acc.r2.cloudflarestorage.com/bk/backups/db/x.json.gz');
    expect(calls.every((x) => x.auth?.startsWith('AWS4-HMAC-SHA256 Credential=k/'))).toBe(true);
  });

  it('a non-2xx answer becomes an error naming the operation', async () => {
    const fake = (async () => new Response('', { status: 403 })) as unknown as typeof fetch;
    const c = r2Client({ accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' }, fake);
    await expect(c.list('p')).rejects.toThrow('backup storage answered 403 to list');
  });
});

describe('wiring guards', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('the server starts the scheduler only with a database', () => {
    expect(src('server/index.ts')).toMatch(/if \(isDbEnabled\(\)\) startBackupScheduler\(\);/);
  });
  it('the copy is one repeatable-read snapshot under an advisory lock, gzipped', () => {
    const s = src('server/admin/cloudBackup.ts');
    expect(s).toContain("'isolation level repeatable read read only'");
    expect(s).toContain('pg_try_advisory_xact_lock');
    expect(s).toContain('gzipSync');
    expect(gunzipSync).toBeTypeOf('function');
  });
  it('downloads only our own keys and logs every manual action', () => {
    const r = src('server/admin/routes.ts');
    expect(r).toContain("'backup_cloud_run'");
    expect(r).toContain("'backup_cloud_download'");
    expect(src('server/admin/cloudBackup.ts')).toMatch(/if \(!parseBackupKey\(key\)\) return null;/);
  });
  it('restore runs in one transaction and refuses a non-empty database without --force', () => {
    const s = src('server/db/restore.ts');
    expect(s).toContain('sql.begin(');
    expect(s).toContain("(use --force to replace it)");
    expect(src('package.json')).toContain('"db:restore": "tsx server/db/restore.ts"');
  });
});

describe('local copies (Stage 44.3)', () => {
  it('names round-trip, a pre-migration prefix is allowed, other files are ignored', () => {
    const n = localBackupName(new Date('2026-11-27T11:35:41.243Z'));
    expect(n).toBe('2026-11-27T11-35-41Z.json.gz');
    expect(parseLocalBackupName(n)?.toISOString()).toBe('2026-11-27T11:35:41.000Z');
    expect(parseLocalBackupName('pre-0015-2026-11-27T11-31-54Z.json.gz')).not.toBeNull();
    expect(parseLocalBackupName('backup.log')).toBeNull();
  });

  it('deletes copies older than 30 days, never the newest, never foreign files', () => {
    const now = new Date('2026-12-31T12:00:00Z');
    const day = (iso: string) => localBackupName(new Date(iso));
    const names = [day('2026-12-30T12:00:00Z'), day('2026-12-01T13:00:00Z'), day('2026-11-30T11:00:00Z'), 'pre-0015-2026-11-01T00-00-00Z.json.gz', 'backup.log'];
    expect(expiredLocalBackups(names, now)).toEqual([day('2026-11-30T11:00:00Z'), 'pre-0015-2026-11-01T00-00-00Z.json.gz']);
    expect(expiredLocalBackups([day('2020-01-01T00:00:00Z')], now)).toEqual([]);
  });

  it('the local copy is a read-only snapshot from .env.production.local, kept out of git', () => {
    expect(readFileSync('package.json', 'utf8')).toContain('"db:backup:local": "tsx --env-file=.env.production.local server/db/backupLocal.ts"');
    expect(readFileSync('server/db/backupLocal.ts', 'utf8')).toContain("'isolation level repeatable read read only'");
    const ignore = readFileSync('.gitignore', 'utf8');
    expect(ignore).toMatch(/^\.env\*$/m);
    expect(ignore).toMatch(/^\.data\/$/m);
  });
});
