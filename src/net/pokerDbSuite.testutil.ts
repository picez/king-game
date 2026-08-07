// ---------------------------------------------------------------------------
// TEST-ONLY helpers for the poker bankroll integration suites (not imported by any app/server code,
// and not collected by vitest — the runner only picks up `*.test.ts`).
//
// The poker economy has a cluster-wide resource that makes concurrently-running test FILES interfere
// when they share one Postgres: `reconcileOrphanedDebits` is GLOBAL and DB-authoritative — it refunds
// EVERY committed-but-unresolved durable match that is not in the protected set. That is exactly
// right in production (one process, one boot), but in the suite it happily refunds another file's
// in-flight match and fails it for reasons unrelated to the code under test. (This is a PRE-EXISTING
// hazard: the same flake reproduces on the 37.7.12 baseline.)
//
// `withPokerDbSuiteLock` removes it by serializing the poker DB files on a Postgres ADVISORY LOCK —
// cluster-wide, so it works across vitest workers, and released automatically if a worker dies.
// `scopedOrphanScan` adds second-order protection (every match the suite does not own is protected),
// so a file that forgets the lock still cannot sweep a neighbour's match.
// ---------------------------------------------------------------------------

/** The minimal shape of a postgres.js RESERVED connection (a session-pinned tagged template). */
type ReservedSql = ((strings: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>) & { release: () => void };

let reserved: ReservedSql | null = null;

/**
 * Take the poker-suite lock (a no-op without TEST_DATABASE_URL). An advisory lock belongs to a
 * SESSION, so it is taken on a RESERVED connection — otherwise the pool could try to unlock from a
 * different connection than the one that locked.
 */
export async function acquirePokerDbSuiteLock(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { getDb } = await import('../../server/db/client');
  const conn = await getDb();
  if (!conn) return;
  const pool = conn.sql as unknown as { reserve: () => Promise<ReservedSql> };
  reserved = await pool.reserve();
  await reserved`SELECT pg_advisory_lock(872113)`;
}

/** Release the poker-suite lock (safe when it was never taken). */
export async function releasePokerDbSuiteLock(): Promise<void> {
  const held = reserved;
  reserved = null;
  if (!held) return;
  try { await held`SELECT pg_advisory_unlock(872113)`; } finally { held.release(); }
}

/**
 * Register the suite lock for ONE poker DB integration file, at module scope:
 *
 *     withPokerDbSuiteLock(beforeAll, afterAll);
 *
 * The generous hook timeout covers waiting behind every other poker DB file.
 */
export function withPokerDbSuiteLock(
  beforeAll: (fn: () => Promise<void>, timeout?: number) => void,
  afterAll: (fn: () => Promise<void>, timeout?: number) => void,
): void {
  beforeAll(acquirePokerDbSuiteLock, 180_000);
  afterAll(releasePokerDbSuiteLock, 60_000);
}

/**
 * Run the production orphan scan scoped to the matches this suite owns.
 *
 * @param ownsMatch          true for a durable match this suite created (by matchId or roomCode).
 * @param protectedMatchIds  ids the CALLER wants protected — i.e. the set production would pass.
 */
export async function scopedOrphanScan(
  ownsMatch: (match: { matchId: string; roomCode: string }) => boolean,
  protectedMatchIds: Iterable<string> = [],
  protectedRoomCodes: ReadonlySet<string> = new Set(),
): Promise<Awaited<ReturnType<typeof import("../../server/pokerEscrow").reconcileOrphanedDebits>>> {
  const { reconcileOrphanedDebits } = await import('../../server/pokerEscrow');
  const { listUnsettledMatches } = await import('../../server/db/pokerWallet');
  const { valid, corrupt } = await listUnsettledMatches();
  const foreign = [...valid, ...corrupt].filter((m) => !ownsMatch(m)).map((m) => m.matchId);
  return reconcileOrphanedDebits(new Set([...protectedMatchIds, ...foreign]), protectedRoomCodes);
}

/**
 * (Stage 38.0.8) Disable the anti-dumping policy for a SETTLEMENT/RECOVERY suite.
 *
 * Those suites deliberately drive several paid matches for the SAME pair back to back to
 * exercise crash/settlement windows — the 15-minute pair cooldown would refuse that, and
 * refusing is not what they are testing. The policy has its own dedicated suites
 * (`pokerAntiDump*.test.ts`) which never call this. Always reset after each test so a
 * failure can never leak the disabled state into another file.
 */
export function withAntiDumpPolicyDisabled(
  beforeEachFn: (fn: () => void | Promise<void>) => void,
  afterEachFn: (fn: () => void | Promise<void>) => void,
): void {
  beforeEachFn(async () => {
    const m = await import('../../server/pokerAntiDump');
    m.__setAntiDumpPolicyDisabled(true);
  });
  afterEachFn(async () => {
    const m = await import('../../server/pokerAntiDump');
    m.__setAntiDumpPolicyDisabled(false);
  });
}
