// ---------------------------------------------------------------------------
// db:restore — load a backup file into a database (Stage 44.1).
//
//   DATABASE_URL=postgres://… npm run db:migrate
//   DATABASE_URL=postgres://… npm run db:restore -- backup.json.gz [--force]
//
// Accepts the cloud copy (.json.gz) and the admin download (.json). Runs in ONE
// transaction: either every row lands or nothing does. Refuses a database that
// already holds data in any backup table unless --force, which first empties
// exactly those tables (TRUNCATE … CASCADE). Columns are matched by name, so a
// copy from an older schema restores into a newer one (new columns get defaults).
// Sessions are not in a backup: everyone signs in again after a restore.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { chunks, planRestore, restoreColumns } from '../../src/net/backupPolicy';

type Tx = {
  unsafe: (query: string, args?: unknown[]) => Promise<Array<Record<string, unknown>>>;
};
type Sql = Tx & {
  begin: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  end: (opts?: { timeout?: number }) => Promise<void>;
};

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const file = args.find((a) => !a.startsWith('--'));
  const url = process.env.DATABASE_URL;
  if (!file) { console.error('[King] db:restore — usage: npm run db:restore -- <backup.json[.gz]> [--force]'); process.exit(1); }
  if (!url) { console.error('[King] db:restore — DATABASE_URL is not set.'); process.exit(1); }

  const raw = readFileSync(file);
  const text = (raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw).toString('utf8');
  const plan = planRestore(JSON.parse(text));
  if (!plan.ok) { console.error(`[King] db:restore — not a Card Majlis backup: ${plan.error}`); process.exit(1); }
  if (plan.skipped.length) console.warn(`[King] db:restore — skipping unknown tables: ${plan.skipped.join(', ')}`);

  const postgres = (await import('postgres')).default;
  const sql = postgres(url, { max: 1, onnotice: () => { /* quiet */ } }) as unknown as Sql;
  try {
    const total = await sql.begin(async (tx) => {
      const existing = new Set((await tx.unsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).map((r) => String(r.tablename)));
      const missing = plan.steps.filter((s) => !existing.has(s.table)).map((s) => s.table);
      if (missing.length) throw new Error(`tables missing — run "npm run db:migrate" first: ${missing.join(', ')}`);

      const busy: string[] = [];
      for (const s of plan.steps) {
        const r = await tx.unsafe(`SELECT EXISTS (SELECT 1 FROM ${quote(s.table)}) AS has`);
        if (r[0]?.has) busy.push(s.table);
      }
      if (busy.length && !force) throw new Error(`the database already has data in: ${busy.join(', ')} (use --force to replace it)`);
      if (busy.length) await tx.unsafe(`TRUNCATE ${plan.steps.map((s) => quote(s.table)).join(', ')} CASCADE`);

      let n = 0;
      for (const s of plan.steps) {
        if (s.rows.length === 0) continue;
        const cols = (await tx.unsafe(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`,
          [s.table],
        )).map((r) => String(r.column_name));
        const use = restoreColumns(s.rows, cols).map(quote).join(', ');
        for (const part of chunks(s.rows, 500)) {
          await tx.unsafe(
            `INSERT INTO ${quote(s.table)} (${use}) SELECT ${use} FROM json_populate_recordset(NULL::${quote(s.table)}, $1::text::json)`,
            [JSON.stringify(part)],
          );
        }
        n += s.rows.length;
        console.log(`[King] db:restore — ${s.table}: ${s.rows.length}`);
      }
      return n;
    });
    console.log(`[King] db:restore — done: ${total} row(s) in ${plan.steps.length} table(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error('[King] db:restore — FAILED, nothing was changed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
