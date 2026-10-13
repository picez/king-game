// ---------------------------------------------------------------------------
// db:migrate — apply SQL migrations from server/db/migrations (Stage 1).
//
//   DATABASE_URL=postgres://… npm run db:migrate
//
// Migrations are plain .sql files applied in filename order. They are written to
// be idempotent (CREATE TABLE IF NOT EXISTS …) so re-running is safe. The driver
// is imported dynamically, so this file is harmless to load without Postgres.
// (drizzle-kit can author new migrations from schema.ts via `npm run db:generate`.)
//
// (Stage 40.1) The runner keeps a LEDGER — `schema_migrations`, see migrationLedger.ts.
// A file recorded with an unchanged checksum is skipped; a new file is applied; a file
// that changed since it was recorded is re-applied and reported. Each file and its ledger
// row commit in ONE transaction, so the ledger can never claim a migration that failed
// half-way. The first run against a database migrated before the ledger existed applies
// every file once more (as every run used to) and records them.
// ---------------------------------------------------------------------------

import {
  LEDGER_DDL, LEDGER_TABLE, listMigrationFiles, planMigrations,
} from './migrationLedger';

type Tx = {
  unsafe: (query: string, args?: unknown[]) => Promise<unknown>;
};
type Sql = Tx & {
  begin: (fn: (tx: Tx) => Promise<void>) => Promise<unknown>;
  end: (opts?: { timeout?: number }) => Promise<void>;
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[King] db:migrate — DATABASE_URL is not set. Nothing to do.');
    process.exit(1);
  }

  const files = listMigrationFiles();
  if (files.length === 0) {
    console.log('[King] db:migrate — no .sql migrations found.');
    return;
  }

  const postgres = (await import('postgres')).default;
  const sql = postgres(url, { max: 1, onnotice: () => { /* silence benign NOTICEs (e.g. IF NOT EXISTS skips) */ } }) as unknown as Sql;
  try {
    await sql.unsafe(LEDGER_DDL);
    const rows = (await sql.unsafe(`SELECT name, checksum FROM ${LEDGER_TABLE}`)) as Array<{ name: string; checksum: string }>;
    const recorded = new Map(rows.map((r) => [r.name, r.checksum]));

    let ran = 0;
    for (const { file, action } of planMigrations(files, recorded)) {
      if (action === 'skip') {
        console.log(`[King] db:migrate — already applied ${file.name}`);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(file.sql);
        await tx.unsafe(
          `INSERT INTO ${LEDGER_TABLE} (name, checksum) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
          [file.name, file.checksum],
        );
      });
      ran++;
      console.log(action === 'reapply'
        ? `[King] db:migrate — applied ${file.name} (file changed since it was recorded — re-applied)`
        : `[King] db:migrate — applied ${file.name}`);
    }
    console.log(`[King] db:migrate — done (${files.length} file(s)). ${ran} applied now, ${files.length - ran} already recorded.`);
  } catch (err) {
    console.error('[King] db:migrate — failed:', String(err));
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
