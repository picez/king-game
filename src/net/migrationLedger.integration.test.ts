import { describe, it, expect, afterAll } from 'vitest';
import { listMigrationFiles } from '../../server/db/migrationLedger';

// The database half of the migration ledger (Stage 40.1).
//
// SKIPPED unless TEST_DATABASE_URL points at a Postgres that `npm run db:migrate` has been
// run against — which is exactly what CI does before the suite. So this asserts what the
// REAL runner left behind, not a re-implementation of it.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('migration ledger (integration)', () => {
  afterAll(async () => {
    const { closeDb } = await import('../../server/db/client');
    await closeDb();
  });

  it('db:migrate recorded every shipped file, with the checksum of the file on disk', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const rows = (await conn!.sql`select name, checksum from schema_migrations`) as Array<{ name: string; checksum: string }>;
    const recorded = new Map(rows.map((r) => [r.name, r.checksum]));
    for (const f of listMigrationFiles()) {
      expect(recorded.get(f.name), f.name).toBe(f.checksum);
    }
  });

  it('the diagnostics probe reads that ledger as "current"', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { probeMigrationLedger } = await import('../../server/db/client');
    const files = listMigrationFiles();
    expect(await probeMigrationLedger(Date.now())).toEqual({
      state: 'current',
      expected: files.length,
      applied: files.length,
      latest: files[files.length - 1].name.replace(/\.sql$/, ''),
    });
  });
});
