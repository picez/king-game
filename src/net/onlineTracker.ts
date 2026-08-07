// ---------------------------------------------------------------------------
// ONLINE participation tracker — the shared, PURE contract (Stage 38.0.6).
//
// One module, imported by BOTH sides, so the server, the client parser and every
// test agree on the same shape and the same arithmetic:
//   server/db/onlineMatches.ts  → raw grouped rows      → buildOnlineTracker()
//   server/api.ts               → GET /api/me/online-tracker
//   src/net/statsApi.ts         → parseTrackerPayload() → the same matrix again
//
// WHAT IT COUNTS
//   ONLY online matches — a local pass-and-play game never creates an
//   `online_matches` row, so local play is excluded by construction, not by a filter.
//   Poker is excluded on purpose at this stage: migration 0014 deliberately does not
//   record it (its real-chip economy is settled separately), so it can never appear.
//
// WHAT COUNTS AS A PLAYED MATCH
//   Only a TERMINAL participant outcome: win | loss | draw. `pending` is a match that
//   is still being played (or was abandoned without a result) and is NOT a played
//   match — the Stage 38.0.5 helper counted it with a bare `count(*)`, which is the
//   bug this stage fixes.
//   The ONE case that is already terminal while the match is still running is a
//   permanent leave: it writes `loss` + `forfeited = true` for that participant the
//   moment they quit, so it counts immediately and exactly once.
//
// CATEGORY
//   `human_only` vs `with_bots` is FROZEN at START_GAME and never recomputed (an AI
//   takeover of a departed human does not move a match between categories). The two
//   are always reported separately and are never summed together.
//
// INVARIANTS (structural, not merely asserted)
//   matches = wins + losses + draws        — `matches` is RECOMPUTED, never trusted;
//   forfeits ⊆ losses                      — clamped;
//   winRate = round(wins / matches * 100)  — null when matches = 0, so the UI shows
//                                            "—" instead of NaN/Infinity;
//   every number is a finite, non-negative safe integer;
//   an unknown gameType or category is DROPPED (fail closed) — never bucketed into
//   "other" and never allowed to inflate the overall row.
// ---------------------------------------------------------------------------

/**
 * The games the tracker reports. Deliberately NOT `GAME_TYPES`: Poker is a released
 * game but is out of scope here (see the header).
 */
export const TRACKED_ONLINE_GAMES = [
  'king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one',
] as const;
export type TrackedOnlineGame = typeof TRACKED_ONLINE_GAMES[number];

/** The frozen room composition. Always reported separately. */
export const ONLINE_CATEGORIES = ['human_only', 'with_bots'] as const;
export type OnlineCategory = typeof ONLINE_CATEGORIES[number];

export function isTrackedOnlineGame(v: unknown): v is TrackedOnlineGame {
  return typeof v === 'string' && (TRACKED_ONLINE_GAMES as readonly string[]).includes(v);
}
export function isOnlineCategory(v: unknown): v is OnlineCategory {
  return typeof v === 'string' && (ONLINE_CATEGORIES as readonly string[]).includes(v);
}

/** One cell of the matrix: what this account did in one game × one category. */
export interface OnlineCounters {
  /** Played matches = wins + losses + draws. Never includes a pending match. */
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  /** Technical losses from a permanent leave. Always a SUBSET of `losses`. */
  forfeits: number;
  /** 0–100 integer, or null when `matches` is 0 (the UI renders "—"). */
  winRate: number | null;
}

/** The two categories, always both present (zero-filled when unplayed). */
export interface OnlineCategorySplit {
  human_only: OnlineCounters;
  with_bots: OnlineCounters;
}

/** The whole stable matrix: overall + every tracked game, each × both categories. */
export interface OnlineTracker {
  overall: OnlineCategorySplit;
  byGame: Record<TrackedOnlineGame, OnlineCategorySplit>;
}

/** One grouped row as the repository returns it (before normalization). */
export interface RawParticipationRow {
  gameType: string;
  category: string;
  matches?: number;
  wins: number;
  losses: number;
  draws: number;
  forfeits: number;
}

const MAX = Number.MAX_SAFE_INTEGER;

/** Any input → a finite, non-negative safe integer. Garbage becomes 0, never NaN. */
export function safeCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  const n = Math.trunc(v);
  if (n <= 0) return 0;
  return n > MAX ? MAX : n;
}

export function emptyCounters(): OnlineCounters {
  return { matches: 0, wins: 0, losses: 0, draws: 0, forfeits: 0, winRate: null };
}

function emptySplit(): OnlineCategorySplit {
  return { human_only: emptyCounters(), with_bots: emptyCounters() };
}

/** A fully zero-filled matrix — the shape the UI can always render. */
export function emptyTracker(): OnlineTracker {
  const byGame = {} as Record<TrackedOnlineGame, OnlineCategorySplit>;
  for (const g of TRACKED_ONLINE_GAMES) byGame[g] = emptySplit();
  return { overall: emptySplit(), byGame };
}

/**
 * Sanitize + close the invariants for one cell. `matches` is RECOMPUTED from the
 * parts (so a legacy/partial row can never claim more matches than results), and
 * `forfeits` is clamped into `losses`.
 */
export function normalizeCounters(raw: {
  wins?: unknown; losses?: unknown; draws?: unknown; forfeits?: unknown;
}): OnlineCounters {
  const wins = safeCount(raw.wins);
  const losses = safeCount(raw.losses);
  const draws = safeCount(raw.draws);
  const forfeits = Math.min(safeCount(raw.forfeits), losses);
  const matches = wins + losses + draws;
  return { matches, wins, losses, draws, forfeits, winRate: winRateOf(wins, matches) };
}

/** 0–100 integer; null when nothing was played (never NaN, never Infinity). */
export function winRateOf(wins: number, matches: number): number | null {
  if (matches <= 0) return null;
  return Math.round((wins / matches) * 100);
}

function addInto(target: OnlineCounters, add: OnlineCounters): void {
  target.wins += add.wins;
  target.losses += add.losses;
  target.draws += add.draws;
  target.forfeits += add.forfeits;
  target.matches = target.wins + target.losses + target.draws;
  target.winRate = winRateOf(target.wins, target.matches);
}

/**
 * Raw grouped rows → the stable matrix.
 *
 * Rows may arrive in any order, with games/categories missing entirely; unknown
 * `gameType`/`category` values are dropped fail-closed. `overall` is computed as the
 * exact sum of the six per-game cells, so the two can never disagree.
 */
export function buildOnlineTracker(rows: readonly RawParticipationRow[]): OnlineTracker {
  const tracker = emptyTracker();
  for (const row of rows) {
    if (!isTrackedOnlineGame(row.gameType)) continue;   // Poker / unknown → dropped
    if (!isOnlineCategory(row.category)) continue;
    const cell = normalizeCounters(row);
    addInto(tracker.byGame[row.gameType][row.category], cell);
  }
  // OVERALL is derived, never read from the wire: it is exactly the six games summed.
  for (const g of TRACKED_ONLINE_GAMES) {
    for (const c of ONLINE_CATEGORIES) addInto(tracker.overall[c], tracker.byGame[g][c]);
  }
  return tracker;
}

/**
 * Strict parse of the `{ tracker: … }` API payload back into the matrix.
 *
 * Deliberately READ-ONLY over known keys: anything unknown in the payload is simply
 * never looked at, every missing combination is zero-filled, and the arithmetic is
 * re-closed locally — so a hostile/older/partial server can neither inject a new game
 * nor produce a NaN win rate on the client.
 */
export function parseTrackerPayload(raw: unknown): OnlineTracker {
  const top = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const t = (top.tracker && typeof top.tracker === 'object') ? top.tracker as Record<string, unknown> : top;
  const byGameRaw = (t.byGame && typeof t.byGame === 'object') ? t.byGame as Record<string, unknown> : {};

  const rows: RawParticipationRow[] = [];
  for (const game of TRACKED_ONLINE_GAMES) {
    const split = (byGameRaw[game] && typeof byGameRaw[game] === 'object')
      ? byGameRaw[game] as Record<string, unknown> : {};
    for (const category of ONLINE_CATEGORIES) {
      const cell = (split[category] && typeof split[category] === 'object')
        ? split[category] as Record<string, unknown> : {};
      rows.push({
        gameType: game,
        category,
        wins: safeCount(cell.wins),
        losses: safeCount(cell.losses),
        draws: safeCount(cell.draws),
        forfeits: safeCount(cell.forfeits),
      });
    }
  }
  // `overall` from the wire is ignored on purpose — it is re-derived from the parts.
  return buildOnlineTracker(rows);
}

/** True when this account has played nothing online at all (the zero/empty state). */
export function trackerIsEmpty(tracker: OnlineTracker): boolean {
  return ONLINE_CATEGORIES.every((c) => tracker.overall[c].matches === 0);
}
