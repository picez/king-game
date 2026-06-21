// ---------------------------------------------------------------------------
// Storage selection — pure, driver-free helpers (Stage 2).
//
// Decides which room storage backend to use from env, and validates that the
// selected backend has what it needs. No fs/DB/driver imports here, so the
// decision logic is unit-testable without a database (the I/O wiring lives in
// server/storage.ts).
//
//   ROOM_STORAGE unset | 'file' → file store (default; current behaviour)
//   ROOM_STORAGE = 'memory'     → in-memory (no durability)
//   ROOM_STORAGE = 'pg'         → Postgres (requires DATABASE_URL; fail fast)
// ---------------------------------------------------------------------------

export type StorageKind = 'memory' | 'file' | 'pg';

/** Thrown when the selected storage backend is misconfigured. */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

/**
 * Maps the ROOM_STORAGE env value to a backend. Unknown/empty/unset values fall
 * back to 'file' to preserve the current default behaviour.
 */
export function resolveStorageKind(roomStorage: string | undefined): StorageKind {
  if (roomStorage === 'memory') return 'memory';
  if (roomStorage === 'pg') return 'pg';
  return 'file';
}

/**
 * Validates the environment for the chosen backend. Postgres requires a
 * DATABASE_URL — we fail fast with a clear message rather than silently falling
 * back, so a misconfigured `pg` deploy is obvious instead of quietly losing
 * persistence.
 */
export function assertStorageEnv(kind: StorageKind, env: { DATABASE_URL?: string }): void {
  if (kind === 'pg' && !env.DATABASE_URL) {
    throw new StorageConfigError(
      'ROOM_STORAGE=pg requires DATABASE_URL to be set. ' +
      'Set DATABASE_URL (and run `npm run db:migrate` first), ' +
      'or use ROOM_STORAGE=file (default) / ROOM_STORAGE=memory.',
    );
  }
}
