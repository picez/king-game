// ---------------------------------------------------------------------------
// db:migrate — apply SQL migrations from server/db/migrations (Stage 1).
//
//   DATABASE_URL=postgres://… npm run db:migrate
//
// Migrations are plain .sql files applied in filename order. They are written to
// be idempotent (CREATE TABLE IF NOT EXISTS …) so re-running is safe. The driver
// is imported dynamically, so this file is harmless to load without Postgres.
// (drizzle-kit can author new migrations from schema.ts via `npm run db:generate`.)
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[King] db:migrate — DATABASE_URL is not set. Nothing to do.');
    process.exit(1);
  }

  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    : [];
  if (files.length === 0) {
    console.log('[King] db:migrate — no .sql migrations found.');
    return;
  }

  const postgres = (await import('postgres')).default;
  const sql = postgres(url, { max: 1, onnotice: () => { /* silence benign NOTICEs (e.g. IF NOT EXISTS skips) */ } });
  try {
    for (const f of files) {
      await sql.unsafe(readFileSync(join(dir, f), 'utf8'));
      console.log(`[King] db:migrate — applied ${f}`);
    }
    console.log(`[King] db:migrate — done (${files.length} file(s)).`);
  } catch (err) {
    console.error('[King] db:migrate — failed:', String(err));
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
