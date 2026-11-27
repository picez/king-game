// ---------------------------------------------------------------------------
// Ranked solitaire contract (S3), shared by the client and the server.
//
// POST /api/solitaire/start  {variant, daily}         → {seed, daily, token}
// POST /api/solitaire/result {token, moves, undos, hints, elapsedMs} → {ok, ms, rank}
// GET  /api/solitaire/leaderboard?variant=&board=time|moves|wins|daily[&day=]
//
// The server picks the seed and signs {user, variant, seed, daily, startedAt};
// a result counts only when its moves replay to a WIN from that seed. The ranked
// time is the server's wall clock between start and result (never less than the
// client's own clock), so a time cannot be typed in.
// ---------------------------------------------------------------------------

import { isVariantKey, type Move, type VariantKey } from './engine';

export const LEADER_BOARDS = ['time', 'moves', 'wins', 'daily'] as const;
export type LeaderBoard = typeof LEADER_BOARDS[number];
export const isLeaderBoard = (v: unknown): v is LeaderBoard => typeof v === 'string' && (LEADER_BOARDS as readonly string[]).includes(v);

/** A start token is valid this long (a game left overnight can still be finished). */
export const TOKEN_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** No human plays faster than this per move (tap + animation). */
export const MIN_MS_PER_MOVE = 150;
export const MAX_MOVES = 5000;

export interface StartResponse { seed: number; daily: string | null; token: string }

export interface ResultBody { token: string; moves: Move[]; undos: number; hints: number; elapsedMs: number }

export interface LeaderRow {
  rank: number;
  displayName: string;
  avatar: string | null;
  /** time / daily: best ms; moves: fewest moves; wins: number of wins. */
  value: number;
  /** The moves and the time of that game (null on the wins board). */
  moves: number | null;
  ms: number | null;
  self: boolean;
}

export interface LeaderboardResponse { variant: VariantKey; board: LeaderBoard; day: string | null; rows: LeaderRow[]; me: LeaderRow | null }

const MOVE_KEYS = new Set(['t', 'from', 'n', 'to', 'ids', 'id']);

/** Shape-checks a result body (the replay then checks the meaning). */
export function parseResultBody(b: unknown): ResultBody | null {
  if (!b || typeof b !== 'object') return null;
  const r = b as Record<string, unknown>;
  if (typeof r.token !== 'string' || r.token.length > 1000 || !Array.isArray(r.moves)) return null;
  if (r.moves.length === 0 || r.moves.length > MAX_MOVES) return null;
  for (const m of r.moves) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    if (Object.keys(m).some((k) => !MOVE_KEYS.has(k))) return null;
  }
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { token: r.token, moves: r.moves as Move[], undos: n(r.undos), hints: n(r.hints), elapsedMs: n(r.elapsedMs) };
}

export interface TokenPayload { u: string; v: VariantKey; s: number; d: string | null; t: number }

export function isTokenPayload(p: unknown): p is TokenPayload {
  if (!p || typeof p !== 'object') return false;
  const x = p as Record<string, unknown>;
  return typeof x.u === 'string' && isVariantKey(x.v) && typeof x.s === 'number' && (x.d === null || typeof x.d === 'string') && typeof x.t === 'number';
}

/**
 * The ranked time = the server's wall clock from the start token to the result.
 * It cannot be typed in; a pause (phone locked) counts, like a chess clock. A
 * result faster than the per-move floor is refused as not humanly possible.
 */
export function rankedMs(startedAt: number, now: number, moves: number): { ok: true; ms: number } | { ok: false } {
  const wall = now - startedAt;
  if (!Number.isFinite(wall) || wall < moves * MIN_MS_PER_MOVE) return { ok: false };
  return { ok: true, ms: Math.max(1, Math.round(wall)) };
}
