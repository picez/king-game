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

/**
 * Classify a DB error for a SAFE client code (no SQL / params / secrets):
 *   • 42703 undefined_column / 42P01 undefined_relation → the DB is reachable but its
 *     SCHEMA is behind the code (missing migrations) → 'migration_required';
 *   • anything else (connection drop, timeout, …) → 'db_error' (transient).
 * Postgres.js attaches the SQLSTATE as `err.code`.
 */
export function classifyDbError(err: unknown): 'migration_required' | 'db_error' {
  const code = (err as { code?: unknown } | null)?.code;
  return code === '42703' || code === '42P01' ? 'migration_required' : 'db_error';
}

/** Columns the profile reader (`getProfile`) needs — added by migrations 0005–0008.
 *  A production DB missing any of these throws 42703 on GET /api/me. */
export const REQUIRED_USER_SETTINGS_COLUMNS = [
  'animation_preference', 'favorite_game', 'card_face_theme', 'avatar_image_version',
] as const;

// Short-TTL cache so repeated /health/diagnostics calls don't probe the schema each time.
const SCHEMA_PROBE_TTL_MS = 30_000;
let dbStateCache: { state: 'enabled' | 'disabled' | 'error' | 'migration_required'; at: number } | null = null;

/**
 * Resolve the DB state for diagnostics: 'disabled' (no URL) / 'error' (`select 1` failed)
 * / 'migration_required' (up but a required user_settings column is missing) / 'enabled'.
 * A cheap `information_schema` lookup, cached for {@link SCHEMA_PROBE_TTL_MS}. Never throws.
 */
export async function probeDbState(
  now: number,
): Promise<'enabled' | 'disabled' | 'error' | 'migration_required'> {
  if (!isDbEnabled()) return 'disabled';
  if (dbStateCache && now - dbStateCache.at < SCHEMA_PROBE_TTL_MS) return dbStateCache.state;
  let state: 'enabled' | 'disabled' | 'error' | 'migration_required';
  try {
    const conn = await getDb();
    if (!conn) {
      state = 'disabled';
    } else {
      await conn.sql`select 1`;
      const rows = (await conn.sql`
        select column_name from information_schema.columns
        where table_name = 'user_settings'
          and column_name = any(${REQUIRED_USER_SETTINGS_COLUMNS as unknown as string[]})
      `) as unknown as Array<{ column_name: string }>;
      state = rows.length >= REQUIRED_USER_SETTINGS_COLUMNS.length ? 'enabled' : 'migration_required';
    }
  } catch {
    state = 'error';
  }
  dbStateCache = { state, at: now };
  return state;
}

/** Closes the pooled connection (for graceful shutdown / scripts). */
export async function closeDb(): Promise<void> {
  if (!cached) return;
  try { await cached.sql.end({ timeout: 5 }); } catch { /* ignore */ }
  cached = null;
}
