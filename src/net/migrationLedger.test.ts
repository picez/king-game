// ---------------------------------------------------------------------------
// The migration ledger (Stage 40.1) — the pure half: what counts as "the same file",
// what the runner does with each file, and how the ledger is summarised for diagnostics.
// The database half is migrationLedger.integration.test.ts (runs in CI against Postgres).
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LEDGER_DDL, LEDGER_TABLE, listMigrationFiles, migrationChecksum, planMigrations, summarizeLedger,
  type MigrationFile,
} from '../../server/db/migrationLedger';

const file = (name: string, sql: string): MigrationFile => ({ name, sql, checksum: migrationChecksum(sql) });

describe('migration files', () => {
  const files = listMigrationFiles();

  it('lists the shipped .sql files in filename order, with no gap in the numbering', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    expect(files.map((f) => f.name)).toEqual([...files.map((f) => f.name)].sort());
    files.forEach((f, i) => expect(f.name.startsWith(String(i).padStart(4, '0') + '_'), f.name).toBe(true));
  });

  it('the checksum ignores line endings — a CRLF checkout is the same migration', () => {
    expect(migrationChecksum('a;\r\nb;\r\n')).toBe(migrationChecksum('a;\nb;\n'));
    expect(migrationChecksum('a;\nb;\n')).not.toBe(migrationChecksum('a;\nc;\n'));
    expect(migrationChecksum('x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a missing directory is an empty list, not a crash', () => {
    expect(listMigrationFiles(join(process.cwd(), 'no-such-migrations-dir'))).toEqual([]);
  });

  it('the ledger is NOT a numbered migration: the runner creates it, idempotently', () => {
    expect(LEDGER_DDL).toContain(`CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE}`);
    for (const f of files) expect(f.sql, f.name).not.toContain(LEDGER_TABLE);
  });
});

describe('planMigrations', () => {
  const a = file('0000_a.sql', 'create table a();');
  const b = file('0001_b.sql', 'create table b();');

  it('an empty ledger applies everything, in order (also the first run on a pre-ledger DB)', () => {
    expect(planMigrations([a, b], new Map()).map((s) => [s.file.name, s.action]))
      .toEqual([['0000_a.sql', 'apply'], ['0001_b.sql', 'apply']]);
  });

  it('a recorded file with the same checksum is skipped; a new one is applied', () => {
    expect(planMigrations([a, b], new Map([[a.name, a.checksum]])).map((s) => s.action)).toEqual(['skip', 'apply']);
  });

  it('a file edited after it was recorded is re-applied, and says so', () => {
    expect(planMigrations([a], new Map([[a.name, 'an-older-checksum']]))[0].action).toBe('reapply');
  });

  it('a ledger row for a file this build does not ship changes nothing', () => {
    const plan = planMigrations([a], new Map([[a.name, a.checksum], ['9999_future.sql', 'x']]));
    expect(plan.map((s) => s.action)).toEqual(['skip']);
  });
});

describe('summarizeLedger', () => {
  const shipped = ['0000_a.sql', '0001_b.sql', '0002_c.sql'];

  it('no ledger table → unrecorded, with no claim about the schema', () => {
    expect(summarizeLedger(shipped, null)).toEqual({ state: 'unrecorded', expected: 3, applied: null, latest: null });
  });

  it('everything recorded → current', () => {
    expect(summarizeLedger(shipped, [...shipped].reverse()))
      .toEqual({ state: 'current', expected: 3, applied: 3, latest: '0002_c' });
  });

  it('a shipped file missing from the ledger → behind', () => {
    expect(summarizeLedger(shipped, ['0000_a.sql', '0001_b.sql']))
      .toEqual({ state: 'behind', expected: 3, applied: 2, latest: '0001_b' });
    expect(summarizeLedger(shipped, [])).toEqual({ state: 'behind', expected: 3, applied: 0, latest: null });
  });

  it('rows this build does not ship are not counted (a rolled-back deploy stays honest)', () => {
    expect(summarizeLedger(shipped, [...shipped, '0003_newer.sql']))
      .toEqual({ state: 'current', expected: 3, applied: 3, latest: '0002_c' });
  });
});

describe('the runner uses the ledger', () => {
  const src = readFileSync(join(process.cwd(), 'server/db/migrate.ts'), 'utf8');

  it('a file and its ledger row commit together', () => {
    const tx = src.slice(src.indexOf('sql.begin('), src.indexOf('ran++'));
    expect(tx).toContain('tx.unsafe(file.sql)');
    expect(tx).toContain('INSERT INTO ${LEDGER_TABLE}');
  });

  it('still ends with the file count the smoke docs quote', () => {
    expect(src).toContain('done (${files.length} file(s))');
  });
});
