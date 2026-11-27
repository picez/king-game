// ---------------------------------------------------------------------------
// db:backup:local — copy the PRODUCTION database to this computer (Stage 44.3).
//
//   npm run db:backup:local
//
// Reads DATABASE_URL from .env.production.local (git-ignored), dumps every
// BACKUP_TABLES table from one read-only snapshot in the same format as the admin
// download / cloud copy, writes .data/prod-backups/<time>.json.gz (git-ignored)
// and deletes copies older than 30 days (the newest is always kept). Restore:
// `npm run db:restore -- .data/prod-backups/<file>` against an EMPTY database.
// Scheduled daily by scripts/schedule-local-backup.ps1 (Windows Task Scheduler).
// ---------------------------------------------------------------------------

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BACKUP_FORMAT, BACKUP_TABLES } from '../../src/net/admin';
import { expiredLocalBackups, localBackupName } from '../../src/net/backupPolicy';

const DIR = join(process.cwd(), '.data', 'prod-backups');

type Row = Record<string, unknown>;
type Tx = ((s: TemplateStringsArray, ...v: unknown[]) => Promise<Row[]>) & { (name: string): unknown };
type Sql = Tx & {
  begin: <T>(opts: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;
  end: (o?: { timeout?: number }) => Promise<void>;
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('[King] db:backup:local — DATABASE_URL is not set (.env.production.local).'); process.exit(1); }
  const postgres = (await import('postgres')).default;
  const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} }) as unknown as Sql;
  const started = Date.now();
  try {
    const { tables, counts } = await sql.begin('isolation level repeatable read read only', async (tx) => {
      const existing = new Set((await tx`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).map((r) => String(r.tablename)));
      const tables: Record<string, unknown[]> = {};
      const counts: Record<string, number> = {};
      for (const t of BACKUP_TABLES) {
        if (!existing.has(t)) continue;
        const rows = await tx`SELECT row_to_json(x)::text AS j FROM ${tx(t)} x`;
        tables[t] = rows.map((r) => JSON.parse(String(r.j)));
        counts[t] = rows.length;
      }
      return { tables, counts };
    });
    const migrations = (await sql`SELECT name FROM schema_migrations ORDER BY name`).map((r) => String(r.name));
    const now = new Date();
    const body = gzipSync(Buffer.from(JSON.stringify({
      meta: { format: BACKUP_FORMAT, version: 1, createdAt: now.toISOString(), by: 'local schedule', commit: null, migrations, counts },
      tables,
    }), 'utf8'));
    mkdirSync(DIR, { recursive: true });
    const file = join(DIR, localBackupName(now));
    writeFileSync(file, body);
    const gone = expiredLocalBackups(readdirSync(DIR), now);
    for (const name of gone) rmSync(join(DIR, name), { force: true });
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`[King] db:backup:local — ${now.toISOString()} saved ${file} (${Math.max(1, Math.round(body.length / 1024))} KB, ${rows} rows, ${Date.now() - started} ms); removed ${gone.length} old copy(ies).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(`[King] db:backup:local — ${new Date().toISOString()} FAILED:`, e instanceof Error ? e.message : e);
  process.exit(1);
});
