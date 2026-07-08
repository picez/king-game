// ---------------------------------------------------------------------------
// Client adaptor for the King stats + leaderboard API (read-only; Stage 5/5.2).
//
// SOFT by design, like profileApi: every call degrades gracefully and never
// throws. Each helper returns a small discriminated `Loadable` so the UI can
// show the right state:
//   • 'ok'              → data is present (may be an all-zero "no games yet")
//   • 'unauthenticated' → 401: no session → prompt to "Save progress"/sign in
//   • 'unavailable'     → 503/404: DB disabled or route missing → soft empty
//   • 'error'           → network/CORS/unknown → non-blocking retry state
//
// Stage 5.2: the server now returns a FLAT, fully-derived stats view (win rate,
// averages, best/worst, trump/negative round counts, per-mode breakdown) and a
// richer public leaderboard (display name + avatar + counters, with a `self`
// marker instead of a user id). The parser tolerates missing fields so older
// servers / partial rows never crash the UI. Only public, score-level data is
// read here; nothing logs cookies/tokens.
// ---------------------------------------------------------------------------

import type { Lang } from '../i18n';

/** Per-mode aggregate: rounds played under the mode + summed/avg score. */
export interface ModeStat {
  rounds: number;
  totalScore: number;
  averageScore: number | null;
}

/** My King stats — the flat, server-derived view. */
export interface KingStats {
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  /** 0–100 integer, or null when no games. Server-derived. */
  winRate: number | null;
  roundsPlayed: number;
  /** Cumulative sum of final game totals (King: higher is better). */
  totalScore: number;
  averageScore: number | null;
  /** Best (highest) single-game total, or null when no games yet. */
  bestScore: number | null;
  /** Worst (lowest) single-game total, or null when no games yet. */
  worstScore: number | null;
  trumpRoundsPlayed: number;
  negativeRoundsPlayed: number;
  surrenderedCount: number;
  /** False until RoundRecord carries `surrenderedBy` (no rules change yet). */
  surrenderedSupported: boolean;
  /** modeId → { rounds, totalScore, averageScore }. */
  modeBreakdown: Record<string, ModeStat>;
  /** ISO timestamp of the last completed game, or null. */
  lastGameAt: string | null;
}

/** One public leaderboard row — no user id; `self` marks the caller's own row. */
export interface LeaderboardEntry {
  displayName: string | null;
  avatar: string | null;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number | null;
  averageScore: number | null;
  bestScore: number | null;
  totalScore: number;
  lastGameAt: string | null;
  self: boolean;
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
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function parseModeBreakdown(raw: unknown): Record<string, ModeStat> {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const out: Record<string, ModeStat> = {};
  for (const [mode, v] of Object.entries(o)) {
    if (v && typeof v === 'object') {
      const ov = v as Record<string, unknown>;
      out[mode] = { rounds: num(ov.rounds), totalScore: num(ov.totalScore), averageScore: numOrNull(ov.averageScore) };
    } else if (typeof v === 'number') {
      // Legacy v1 server (modeId → score only): keep the score, rounds unknown.
      out[mode] = { rounds: 0, totalScore: v, averageScore: null };
    }
  }
  return out;
}

/** Flattens the API stats payload (`{ stats: <view> }`) into KingStats. */
export function parseKingStats(raw: unknown): KingStats {
  const top = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const s = (top.stats && typeof top.stats === 'object') ? top.stats as Record<string, unknown> : {};
  const gamesPlayed = num(s.gamesPlayed);
  const gamesWon = num(s.gamesWon);
  // winRate/averageScore: prefer the server value, else derive (older servers).
  const winRate = 'winRate' in s ? numOrNull(s.winRate) : (gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : null);
  return {
    gamesPlayed,
    gamesWon,
    gamesLost: num(s.gamesLost),
    winRate,
    roundsPlayed: num(s.roundsPlayed),
    totalScore: num(s.totalScore),
    averageScore: 'averageScore' in s ? numOrNull(s.averageScore) : (gamesPlayed > 0 ? Math.round(num(s.totalScore) / gamesPlayed) : null),
    bestScore: numOrNull(s.bestScore),
    worstScore: numOrNull(s.worstScore),
    trumpRoundsPlayed: num(s.trumpRoundsPlayed),
    negativeRoundsPlayed: num(s.negativeRoundsPlayed),
    surrenderedCount: num(s.surrenderedCount),
    surrenderedSupported: s.surrenderedSupported === true,
    modeBreakdown: parseModeBreakdown(s.modeBreakdown),
    lastGameAt: str(s.lastGameAt) ?? str(s.lastPlayedAt),
  };
}

/** GET /api/games/king/stats — the signed-in/guest user's own King stats. */
export async function fetchKingStats(base: string): Promise<Loadable<KingStats>> {
  const { status, data } = await getJson(base, '/api/games/king/stats');
  if (status === 200) return { state: 'ok', data: parseKingStats(data) };
  return failFor(status);
}

/** My Durak stats — outcome-only (no score/rounds); the flat server view. */
export interface DurakStats {
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  winRate: number | null;
  /** Times the user was the fool (== gamesLost). */
  foolCount: number;
  /** Games that ended in a draw. */
  drawCount: number;
  /** 0–100 integer, or null when no games. */
  foolRate: number | null;
  lastGameAt: string | null;
}

/** Flattens the API payload (`{ stats: <view> }`) into DurakStats. */
export function parseDurakStats(raw: unknown): DurakStats {
  const top = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const s = (top.stats && typeof top.stats === 'object') ? top.stats as Record<string, unknown> : {};
  const gamesPlayed = num(s.gamesPlayed);
  const gamesWon = num(s.gamesWon);
  const foolCount = num(s.foolCount);
  return {
    gamesPlayed,
    gamesWon,
    gamesLost: num(s.gamesLost),
    winRate: 'winRate' in s ? numOrNull(s.winRate) : (gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : null),
    foolCount,
    drawCount: num(s.drawCount),
    foolRate: 'foolRate' in s ? numOrNull(s.foolRate) : (gamesPlayed > 0 ? Math.round((foolCount / gamesPlayed) * 100) : null),
    lastGameAt: str(s.lastGameAt),
  };
}

/** GET /api/games/durak/stats — the signed-in/guest user's own Durak stats. */
export async function fetchDurakStats(base: string): Promise<Loadable<DurakStats>> {
  const { status, data } = await getJson(base, '/api/games/durak/stats');
  if (status === 200) return { state: 'ok', data: parseDurakStats(data) };
  return failFor(status);
}

/** My Deberc stats — team-outcome only (no score/rounds); the flat server view. */
export interface DebercStats {
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  winRate: number | null;
  /** Matches won via a деберц jackpot (instant win). */
  jackpotCount: number;
  /** 0–100 integer over games played, or null when no games. */
  jackpotRate: number | null;
  lastGameAt: string | null;
}

/** Flattens the API payload (`{ stats: <view> }`) into DebercStats. */
export function parseDebercStats(raw: unknown): DebercStats {
  const top = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const s = (top.stats && typeof top.stats === 'object') ? top.stats as Record<string, unknown> : {};
  const gamesPlayed = num(s.gamesPlayed);
  const gamesWon = num(s.gamesWon);
  const jackpotCount = num(s.jackpotCount);
  return {
    gamesPlayed,
    gamesWon,
    gamesLost: num(s.gamesLost),
    winRate: 'winRate' in s ? numOrNull(s.winRate) : (gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : null),
    jackpotCount,
    jackpotRate: 'jackpotRate' in s ? numOrNull(s.jackpotRate) : (gamesPlayed > 0 ? Math.round((jackpotCount / gamesPlayed) * 100) : null),
    lastGameAt: str(s.lastGameAt),
  };
}

/** GET /api/games/deberc/stats — the signed-in/guest user's own Deberc stats. */
export async function fetchDebercStats(base: string): Promise<Loadable<DebercStats>> {
  const { status, data } = await getJson(base, '/api/games/deberc/stats');
  if (status === 200) return { state: 'ok', data: parseDebercStats(data) };
  return failFor(status);
}

function parseLeaderboardRow(e: Record<string, unknown>): LeaderboardEntry {
  const gamesPlayed = num(e.gamesPlayed);
  const gamesWon = num(e.gamesWon);
  return {
    displayName: str(e.displayName),
    avatar: str(e.avatar),
    gamesPlayed,
    gamesWon,
    winRate: 'winRate' in e ? numOrNull(e.winRate) : (gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : null),
    averageScore: numOrNull(e.averageScore),
    bestScore: numOrNull(e.bestScore),
    totalScore: num(e.totalScore),
    lastGameAt: str(e.lastGameAt),
    self: e.self === true,
  };
}

/** One public Durak leaderboard row — no user id; `self` marks the caller. */
export interface DurakLeaderboardEntry {
  displayName: string | null;
  avatar: string | null;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number | null;
  foolCount: number;
  lastGameAt: string | null;
  self: boolean;
}

function parseDurakLeaderboardRow(e: Record<string, unknown>): DurakLeaderboardEntry {
  const gamesPlayed = num(e.gamesPlayed);
  const gamesWon = num(e.gamesWon);
  return {
    displayName: str(e.displayName),
    avatar: str(e.avatar),
    gamesPlayed,
    gamesWon,
    winRate: 'winRate' in e ? numOrNull(e.winRate) : (gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : null),
    foolCount: num(e.foolCount),
    lastGameAt: str(e.lastGameAt),
    self: e.self === true,
  };
}

/** GET /api/games/durak/leaderboard — public top Durak players. */
export async function fetchDurakLeaderboard(base: string): Promise<Loadable<DurakLeaderboardEntry[]>> {
  const { status, data } = await getJson(base, '/api/games/durak/leaderboard');
  if (status === 200) {
    const list = (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).leaderboard))
      ? (data as { leaderboard: unknown[] }).leaderboard : [];
    const rows = list
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map(parseDurakLeaderboardRow);
    return { state: 'ok', data: rows };
  }
  return failFor(status);
}

/** One public Deberc leaderboard row — no user id; `self` marks the caller. */
export interface DebercLeaderboardEntry {
  displayName: string | null;
  avatar: string | null;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number | null;
  jackpotCount: number;
  lastGameAt: string | null;
  self: boolean;
}

function parseDebercLeaderboardRow(e: Record<string, unknown>): DebercLeaderboardEntry {
  const gamesPlayed = num(e.gamesPlayed);
  const gamesWon = num(e.gamesWon);
  return {
    displayName: str(e.displayName),
    avatar: str(e.avatar),
    gamesPlayed,
    gamesWon,
    winRate: 'winRate' in e ? numOrNull(e.winRate) : (gamesPlayed > 0 ? Math.round((gamesWon / gamesPlayed) * 100) : null),
    jackpotCount: num(e.jackpotCount),
    lastGameAt: str(e.lastGameAt),
    self: e.self === true,
  };
}

/** GET /api/games/deberc/leaderboard — public top Deberc players. */
export async function fetchDebercLeaderboard(base: string): Promise<Loadable<DebercLeaderboardEntry[]>> {
  const { status, data } = await getJson(base, '/api/games/deberc/leaderboard');
  if (status === 200) {
    const list = (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).leaderboard))
      ? (data as { leaderboard: unknown[] }).leaderboard : [];
    const rows = list
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map(parseDebercLeaderboardRow);
    return { state: 'ok', data: rows };
  }
  return failFor(status);
}

/** GET /api/games/king/leaderboard — public top players (counters + avatar). */
export async function fetchKingLeaderboard(base: string): Promise<Loadable<LeaderboardEntry[]>> {
  const { status, data } = await getJson(base, '/api/games/king/leaderboard');
  if (status === 200) {
    const list = (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).leaderboard))
      ? (data as { leaderboard: unknown[] }).leaderboard : [];
    const rows = list
      .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
      .map(parseLeaderboardRow);
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

/** Per-mode rows present in the breakdown, in canonical order (Trump last). */
export function modeBreakdownRows(
  mb: Record<string, ModeStat>,
): Array<{ modeId: string; rounds: number; totalScore: number; averageScore: number | null }> {
  const rows: Array<{ modeId: string; rounds: number; totalScore: number; averageScore: number | null }> = [];
  const push = (modeId: string) => {
    const m = mb[modeId];
    if (m) rows.push({ modeId, rounds: m.rounds, totalScore: m.totalScore, averageScore: m.averageScore });
  };
  for (const modeId of MODE_ORDER) push(modeId);
  for (const modeId of Object.keys(mb)) {
    if (!(MODE_ORDER as readonly string[]).includes(modeId)) push(modeId);
  }
  return rows;
}
