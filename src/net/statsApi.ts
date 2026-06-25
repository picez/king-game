// ---------------------------------------------------------------------------
// Client adaptor for the Stage 5 King stats + leaderboard API (read-only).
//
// SOFT by design, like profileApi: every call degrades gracefully and never
// throws. Each helper returns a small discriminated `Loadable` so the UI can
// show the right state:
//   • 'ok'              → data is present (may be an all-zero "no games yet")
//   • 'unauthenticated' → 401: no session → prompt to "Save progress"/sign in
//   • 'unavailable'     → 503/404: DB disabled or route missing → soft empty
//   • 'error'           → network/CORS/unknown → non-blocking retry state
//
// Only public, score-level data is read here. The leaderboard exposes display
// name + counters only (no userId-as-identity, no email/session). Nothing here
// logs cookies/tokens. Pure derivations (win rate, averages, date formatting)
// are exported separately so they are unit-tested without a network.
// ---------------------------------------------------------------------------

import type { Lang } from '../i18n';

/** My King stats (flattened from the API's `{ stats: { …, stats: {…} } }`). */
export interface KingStats {
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  roundsPlayed: number;
  /** Cumulative sum of final game totals (King: higher is better). */
  totalScore: number;
  /** Best (highest) single-game total, or null when no games yet. */
  bestGameScore: number | null;
  /** modeId → cumulative score under that mode (King-specific). */
  modeBreakdown: Record<string, number>;
  /** ISO timestamp of the last completed game, or null. */
  lastPlayedAt: string | null;
}

/** One public leaderboard row (no identity/private fields). */
export interface LeaderboardEntry {
  userId: string;
  displayName: string | null;
  gamesPlayed: number;
  gamesWon: number;
}

export type Loadable<T> =
  | { state: 'ok'; data: T }
  | { state: 'unauthenticated' }
  | { state: 'unavailable' }
  | { state: 'error' };

/** Maps an HTTP status (0 = network failure) to a Loadable failure state. */
function failFor(status: number): Loadable<never> {
  if (status === 401) return { state: 'unauthenticated' };
  if (status === 503 || status === 404) return { state: 'unavailable' };
  return { state: 'error' };
}

/** A single GET: credentials included (cookie), JSON, never throws. */
async function getJson(base: string, path: string): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(`${base}${path}`, {
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* empty/non-JSON body */ }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Flattens the API stats payload into a flat, well-typed KingStats. */
export function parseKingStats(raw: unknown): KingStats {
  const top = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const s = (top.stats && typeof top.stats === 'object') ? top.stats as Record<string, unknown> : {};
  const inner = (s.stats && typeof s.stats === 'object') ? s.stats as Record<string, unknown> : {};
  const mbRaw = (inner.modeBreakdown && typeof inner.modeBreakdown === 'object')
    ? inner.modeBreakdown as Record<string, unknown> : {};
  const modeBreakdown: Record<string, number> = {};
  for (const [k, v] of Object.entries(mbRaw)) if (typeof v === 'number') modeBreakdown[k] = v;
  return {
    gamesPlayed: num(s.gamesPlayed),
    gamesWon: num(s.gamesWon),
    gamesLost: num(s.gamesLost),
    roundsPlayed: num(s.roundsPlayed),
    totalScore: num(inner.totalScore),
    bestGameScore: typeof inner.bestGameScore === 'number' ? inner.bestGameScore : null,
    modeBreakdown,
    lastPlayedAt: typeof s.lastPlayedAt === 'string' ? s.lastPlayedAt : null,
  };
}

/** GET /api/games/king/stats — the signed-in/guest user's own King stats. */
export async function fetchKingStats(base: string): Promise<Loadable<KingStats>> {
  const { status, data } = await getJson(base, '/api/games/king/stats');
  if (status === 200) return { state: 'ok', data: parseKingStats(data) };
  return failFor(status);
}

/** GET /api/games/king/leaderboard — public top players (counters only). */
export async function fetchKingLeaderboard(base: string): Promise<Loadable<LeaderboardEntry[]>> {
  const { status, data } = await getJson(base, '/api/games/king/leaderboard');
  if (status === 200) {
    const list = (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).leaderboard))
      ? (data as { leaderboard: unknown[] }).leaderboard : [];
    const rows: LeaderboardEntry[] = list
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map((e) => ({
        userId: typeof e.userId === 'string' ? e.userId : '',
        displayName: typeof e.displayName === 'string' ? e.displayName : null,
        gamesPlayed: num(e.gamesPlayed),
        gamesWon: num(e.gamesWon),
      }));
    return { state: 'ok', data: rows };
  }
  return failFor(status);
}

// ── Pure derivations (no I/O; unit-tested) ──────────────────────────────────

/** Win rate as a 0–100 integer percentage, or null when no games played. */
export function winRatePct(won: number, played: number): number | null {
  if (played <= 0) return null;
  return Math.round((won / played) * 100);
}

/** Average final score (rounded), or null when no games played. */
export function averageScore(totalScore: number, played: number): number | null {
  if (played <= 0) return null;
  return Math.round(totalScore / played);
}

/** A signed integer label (`+8`, `-40`, `0`) — King totals can be either sign. */
export function formatSigned(n: number | null): string {
  if (n == null) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Short, locale-aware date for the last game, or null. Never throws (a bad ISO
 * or an environment without Intl falls back to the date part of the string).
 */
export function formatLastPlayed(iso: string | null, lang: Lang): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

/** Ordered King modes for the per-mode breakdown (Trump last, like the tracker). */
export const MODE_ORDER = [
  'no_tricks', 'no_hearts', 'no_jacks', 'no_queens', 'king_of_hearts', 'last_two_tricks', 'trump',
] as const;

/** Per-mode rows present in the breakdown, in canonical order (points, not counts). */
export function modeBreakdownRows(mb: Record<string, number>): Array<{ modeId: string; points: number }> {
  const rows: Array<{ modeId: string; points: number }> = [];
  for (const modeId of MODE_ORDER) {
    if (modeId in mb) rows.push({ modeId, points: mb[modeId] });
  }
  // Any unknown future modes appended after the known ones.
  for (const [modeId, points] of Object.entries(mb)) {
    if (!(MODE_ORDER as readonly string[]).includes(modeId)) rows.push({ modeId, points });
  }
  return rows;
}
