// ---------------------------------------------------------------------------
// Lightweight production diagnostics (Stage 24.0).
//
// A SAFE, PUBLIC snapshot of server health for quickly diagnosing a prod deploy
// without logging into Render. Exposed at GET /health/diagnostics (see
// server/index.ts). The plain GET /health stays unchanged (byte-for-byte) for any
// existing monitor.
//
// PRIVACY BOUNDARY — this payload carries ONLY aggregate/operational facts. It must
// NEVER include: user ids, room codes, session ids, emails, avatar ids, chat text,
// hands/cards, reconnect tokens, or raw env values. Only counts, booleans, a version
// string, a short commit hash, and the (public) list of available game ids. The unit
// tests assert the serialized JSON contains none of the forbidden patterns.
//
// Cost: cheap and no-throw. It reads in-memory counters + a cached ffmpeg-readiness
// flag (probed ONCE at boot, never per request) and does NOT query the database.
// ---------------------------------------------------------------------------

import { GAME_TYPES, GAME_CATALOG } from '../src/games/catalog';

// ── ffmpeg readiness cache ───────────────────────────────────────────────────
// index.ts already probes ffmpeg ONCE at boot for its startup log; it calls
// setFfmpegReady() with the result so diagnostics can report it without ever
// spawning ffmpeg per request. null = not probed yet (boot still in flight).
let ffmpegReady: boolean | null = null;
export function setFfmpegReady(ok: boolean): void { ffmpegReady = ok; }
export function getFfmpegReady(): boolean | null { return ffmpegReady; }

/** The app version, from npm (set when started via an npm script), else null. */
export function serverVersion(): string | null {
  return process.env.npm_package_version?.trim() || null;
}

/** A short commit hash from the host's build env (Render/others), else null.
 *  Never exposes any other env value — only the commit, truncated. */
export function gitCommit(): string | null {
  const c = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.SOURCE_COMMIT || '';
  return c ? c.trim().slice(0, 12) : null;
}

/** The ids of games currently marked `available` in the public catalog. */
export function availableGameIds(): string[] {
  return GAME_TYPES.filter((id) => GAME_CATALOG[id].status === 'available');
}

/** Resolved database state: no DATABASE_URL / healthy / a failing probe / reachable but
 *  behind on migrations (required columns missing). */
export type DbState = 'enabled' | 'disabled' | 'error' | 'migration_required';

export interface DiagnosticsInput {
  version: string | null;
  commit: string | null;
  uptimeSeconds: number;
  /** Resolved from a cheap `select 1` probe: enabled (ok) / disabled / error. */
  db: DbState;
  /** Cached boot probe; null = not yet known. */
  ffmpegReady: boolean | null;
  rooms: { total: number; open: number; inGame: number };
  /** Live WebSocket client count. */
  connections: number;
  /** Voice ICE mode (Stage 25.6) — resolved by the caller from server/voiceIce.ts. NEVER a
   *  credential: this is the secret-free MODE only. */
  voiceIce: 'stun_only' | 'turn_configured';
}

export interface DiagnosticsResponse {
  status: 'ok';
  version: string | null;
  commit: string | null;
  uptime: number;
  db: DbState;
  rooms: { total: number; open: number; inGame: number };
  connections: number;
  games: { count: number; ids: string[] };
  /** Voice connectivity mode — `stun_only` (default) or `turn_configured`. No credentials. */
  voice: { ice: 'stun_only' | 'turn_configured' };
  avatarUploads: {
    status: 'enabled' | 'disabled' | 'unknown';
    reason: string | null;
    ffmpeg: boolean | 'unknown';
    database: boolean;
  };
}

/**
 * Build the safe diagnostics payload from already-gathered counters. Pure and
 * total (no I/O, never throws), so it is fully unit-testable. Avatar uploads need
 * BOTH a database AND ffmpeg; the reason names whichever is missing.
 */
export function buildDiagnostics(input: DiagnosticsInput): DiagnosticsResponse {
  // Avatar uploads need a HEALTHY database — 'error' or 'disabled' both mean "off".
  const dbUsable = input.db === 'enabled';
  const ffmpeg = input.ffmpegReady;
  let avatarStatus: 'enabled' | 'disabled' | 'unknown';
  let reason: string | null = null;
  if (ffmpeg === null) {
    avatarStatus = 'unknown';
    reason = 'ffmpeg_probe_pending';
  } else if (dbUsable && ffmpeg) {
    avatarStatus = 'enabled';
  } else {
    avatarStatus = 'disabled';
    reason = !dbUsable && !ffmpeg ? 'no_database_and_ffmpeg'
      : !dbUsable ? 'no_database'
        : 'no_ffmpeg';
  }

  const games = availableGameIds();
  return {
    status: 'ok',
    version: input.version,
    commit: input.commit,
    uptime: Math.round(input.uptimeSeconds),
    db: input.db,
    rooms: {
      total: input.rooms.total,
      open: input.rooms.open,
      inGame: input.rooms.inGame,
    },
    connections: input.connections,
    games: { count: games.length, ids: games },
    voice: { ice: input.voiceIce },
    avatarUploads: {
      status: avatarStatus,
      reason,
      ffmpeg: ffmpeg === null ? 'unknown' : ffmpeg,
      database: dbUsable,
    },
  };
}
