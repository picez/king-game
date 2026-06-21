// ---------------------------------------------------------------------------
// Lazy Postgres connection + health check (Stage 1; Postgres is OPTIONAL).
//
// The driver (`postgres`) and drizzle are imported DYNAMICALLY, only when
// DATABASE_URL is set and a DB operation is requested. So:
//   • no DATABASE_URL → these modules are never loaded; the server behaves
//     exactly as the file/memory MVP.
//   • DATABASE_URL set but driver/connection broken → health reports an error
//     instead of crashing the process.
// ---------------------------------------------------------------------------

// Minimal structural types so this file needs no static driver import.
type Sql = ((strings: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>) & {
  end: (opts?: { timeout?: number }) => Promise<void>;
  unsafe: (query: string) => Promise<unknown>;
};
type Drizzle = unknown;

let cached: { sql: Sql; db: Drizzle } | null = null;

/** True when a Postgres connection string is configured. */
export function isDbEnabled(): boolean {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
}

/**
 * Returns a cached { sql, db } pair, creating it on first use. Returns null when
 * no DATABASE_URL is set. The connection is lazy (postgres.js connects on the
 * first query), so constructing it never throws on a bad URL.
 */
export async function getDb(): Promise<{ sql: Sql; db: Drizzle } | null> {
  if (!isDbEnabled()) return null;
  if (cached) return cached;
  const postgres = (await import('postgres')).default as unknown as (url: string, opts?: Record<string, unknown>) => Sql;
  const { drizzle } = (await import('drizzle-orm/postgres-js')) as { drizzle: (sql: Sql) => Drizzle };
  const sql = postgres(process.env.DATABASE_URL as string, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => { /* silence NOTICE noise */ },
  });
  cached = { sql, db: drizzle(sql) };
  return cached;
}

export type DbHealth =
  | { state: 'disabled' }
  | { state: 'ok' }
  | { state: 'error'; error: string };

/**
 * Quick liveness probe used by /health. Runs `select 1`. Never throws — a
 * failure is reported as { state: 'error' } so the HTTP endpoint stays up.
 */
export async function checkDbHealth(): Promise<DbHealth> {
  if (!isDbEnabled()) return { state: 'disabled' };
  try {
    const conn = await getDb();
    if (!conn) return { state: 'disabled' };
    await conn.sql`select 1`;
    return { state: 'ok' };
  } catch (err) {
    return { state: 'error', error: String((err as Error)?.message ?? err) };
  }
}

/** Closes the pooled connection (for graceful shutdown / scripts). */
export async function closeDb(): Promise<void> {
  if (!cached) return;
  try { await cached.sql.end({ timeout: 5 }); } catch { /* ignore */ }
  cached = null;
}
