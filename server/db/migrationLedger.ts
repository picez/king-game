// ---------------------------------------------------------------------------
// Migration ledger (Stage 40.1) — which .sql files were applied to THIS database.
//
// Until this stage `db:migrate` re-ran every file on every invocation and recorded
// nothing, so the only proof of what a production database had received was the
// terminal transcript of whoever ran it. The ledger is one table:
//
//   schema_migrations(name PRIMARY KEY, checksum, applied_at)
//
// It is created by the RUNNER itself (not by a numbered .sql file), because it has to
// exist before the first file is applied and must not shift the 0000–00NN numbering.
//
// Everything here is pure or file-system only — no database driver — so it loads
// without Postgres and is unit-testable. The runner (migrate.ts) and the diagnostics
// probe (client.ts) do the I/O.
//
// PRIVACY: a migration file name is public (it is in the repository). The ledger
// carries nothing about users, rooms or sessions, so its summary is safe for
// /health/diagnostics.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export const LEDGER_TABLE = 'schema_migrations';

/** Idempotent, so the runner can issue it on every invocation. */
export const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
  name        text PRIMARY KEY,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now()
)`;

export interface MigrationFile { name: string; sql: string; checksum: string; }

/** sha256 of the file with line endings normalised, so a Windows checkout (CRLF) and the
 *  Linux deploy (LF) of the same commit agree on what "the same migration" is. */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** The .sql migrations in filename order. A missing directory is an empty list. */
export function listMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => {
    const sql = readFileSync(join(dir, name), 'utf8');
    return { name, sql, checksum: migrationChecksum(sql) };
  });
}

/**
 * What the runner does with one file:
 *   apply   — not in the ledger. This is also every file on the FIRST run against a
 *             database migrated before the ledger existed; the files are idempotent, so
 *             that run is the old behaviour plus a record.
 *   skip    — recorded with the same checksum.
 *   reapply — recorded, but the file has changed since. Re-running is what the runner
 *             did unconditionally before the ledger, and the files are written to allow
 *             it; the difference now is that it is logged instead of silent.
 */
export type MigrationAction = 'apply' | 'skip' | 'reapply';
export interface MigrationStep { file: MigrationFile; action: MigrationAction; }

export function planMigrations(
  files: readonly MigrationFile[],
  recorded: ReadonlyMap<string, string>,
): MigrationStep[] {
  return files.map((file) => {
    const checksum = recorded.get(file.name);
    const action: MigrationAction = checksum === undefined ? 'apply'
      : checksum === file.checksum ? 'skip' : 'reapply';
    return { file, action };
  });
}

/**
 * The ledger as /health/diagnostics reports it.
 *   current    — every migration this build ships is recorded.
 *   behind     — the ledger exists but at least one shipped migration is not in it.
 *   unrecorded — there is no ledger table: `db:migrate` has not been run since the ledger
 *                was introduced. It says NOTHING about the schema either way.
 */
export interface MigrationStatus {
  state: 'current' | 'behind' | 'unrecorded';
  /** Migrations shipped with this build. */
  expected: number;
  /** Shipped migrations found in the ledger; null when there is no ledger. */
  applied: number | null;
  /** The highest shipped migration found in the ledger, without `.sql`. */
  latest: string | null;
}

export function summarizeLedger(
  expectedNames: readonly string[],
  recordedNames: readonly string[] | null,
): MigrationStatus {
  const expected = expectedNames.length;
  if (recordedNames === null) return { state: 'unrecorded', expected, applied: null, latest: null };
  const recorded = new Set(recordedNames);
  const present = expectedNames.filter((n) => recorded.has(n)).sort();
  return {
    state: present.length === expected ? 'current' : 'behind',
    expected,
    applied: present.length,
    latest: present.length > 0 ? present[present.length - 1].replace(/\.sql$/, '') : null,
  };
}
