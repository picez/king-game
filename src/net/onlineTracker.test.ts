// ---------------------------------------------------------------------------
// Stage 38.0.6 — the PURE tracker contract: normalization, zero-fill, invariants.
//
// Everything the server, the client parser and the UI rely on is decided here, so a
// drift in any of the three shows up as a failure in this file first.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  TRACKED_ONLINE_GAMES, ONLINE_CATEGORIES,
  buildOnlineTracker, parseTrackerPayload, emptyTracker, emptyCounters,
  normalizeCounters, winRateOf, safeCount, trackerIsEmpty,
  isTrackedOnlineGame, isOnlineCategory,
  type OnlineTracker, type RawParticipationRow,
} from './onlineTracker';

const row = (over: Partial<RawParticipationRow> = {}): RawParticipationRow => ({
  gameType: 'king', category: 'human_only', wins: 0, losses: 0, draws: 0, forfeits: 0, ...over,
});

/** Every cell of the matrix, so a test can sweep the whole thing. */
function cells(t: OnlineTracker) {
  const out = [...ONLINE_CATEGORIES.map((c) => ({ where: `overall/${c}`, c: t.overall[c] }))];
  for (const g of TRACKED_ONLINE_GAMES) {
    for (const c of ONLINE_CATEGORIES) out.push({ where: `${g}/${c}`, c: t.byGame[g][c] });
  }
  return out;
}

describe('the tracked scope is fixed and excludes Poker', () => {
  it('tracks exactly the six online non-Poker games', () => {
    expect([...TRACKED_ONLINE_GAMES]).toEqual(['king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one']);
    expect(TRACKED_ONLINE_GAMES).not.toContain('poker');
  });
  it('has exactly two categories and never a third', () => {
    expect([...ONLINE_CATEGORIES]).toEqual(['human_only', 'with_bots']);
  });
  it('guards reject anything else', () => {
    expect(isTrackedOnlineGame('poker')).toBe(false);
    expect(isTrackedOnlineGame('nonsense')).toBe(false);
    expect(isTrackedOnlineGame(7)).toBe(false);
    expect(isOnlineCategory('mixed')).toBe(false);
    expect(isOnlineCategory(null)).toBe(false);
  });
});

describe('the matrix is always complete and zero-filled', () => {
  it('an empty input still yields overall + 6 games × 2 categories', () => {
    const t = buildOnlineTracker([]);
    expect(Object.keys(t.byGame).sort()).toEqual([...TRACKED_ONLINE_GAMES].sort());
    expect(cells(t)).toHaveLength(14);
    for (const { where, c } of cells(t)) expect(c, where).toEqual(emptyCounters());
    expect(trackerIsEmpty(t)).toBe(true);
  });

  it('a single row leaves every OTHER combination at zero', () => {
    const t = buildOnlineTracker([row({ gameType: 'durak', category: 'with_bots', wins: 3, losses: 1 })]);
    expect(t.byGame.durak.with_bots).toEqual({ matches: 4, wins: 3, losses: 1, draws: 0, forfeits: 0, winRate: 75 });
    expect(t.byGame.durak.human_only).toEqual(emptyCounters());
    expect(t.byGame.king.with_bots).toEqual(emptyCounters());
    expect(trackerIsEmpty(t)).toBe(false);
  });

  it('emptyTracker() and buildOnlineTracker([]) agree exactly', () => {
    expect(buildOnlineTracker([])).toEqual(emptyTracker());
  });
});

describe('the invariants hold by construction', () => {
  it('matches is RECOMPUTED — a lying row cannot inflate it', () => {
    const t = buildOnlineTracker([row({ wins: 2, losses: 1, draws: 1, matches: 999 })]);
    expect(t.byGame.king.human_only.matches).toBe(4);
  });

  it('forfeits are clamped into losses', () => {
    const t = buildOnlineTracker([row({ losses: 2, forfeits: 5 })]);
    expect(t.byGame.king.human_only.forfeits).toBe(2);
    expect(t.byGame.king.human_only.losses).toBe(2);
  });

  it('every cell satisfies matches = wins + losses + draws and forfeits ≤ losses', () => {
    const t = buildOnlineTracker([
      row({ gameType: 'king', wins: 4, losses: 3, draws: 2, forfeits: 1 }),
      row({ gameType: 'tarneeb', category: 'with_bots', wins: 1, losses: 9, forfeits: 4 }),
      row({ gameType: 'fifty-one', draws: 6 }),
    ]);
    for (const { where, c } of cells(t)) {
      expect(c.matches, where).toBe(c.wins + c.losses + c.draws);
      expect(c.forfeits, where).toBeLessThanOrEqual(c.losses);
      for (const n of [c.matches, c.wins, c.losses, c.draws, c.forfeits]) {
        expect(Number.isSafeInteger(n), where).toBe(true);
        expect(n, where).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('winRate is null at zero matches and never NaN or Infinity', () => {
    expect(winRateOf(0, 0)).toBeNull();
    expect(winRateOf(5, 0)).toBeNull();
    expect(winRateOf(-3, -3)).toBeNull();
    expect(buildOnlineTracker([]).overall.human_only.winRate).toBeNull();
    for (const { where, c } of cells(buildOnlineTracker([row({ wins: 1, losses: 2 })]))) {
      expect(c.winRate === null || Number.isFinite(c.winRate), where).toBe(true);
    }
  });

  it('winRate is wins / matches as a rounded percentage', () => {
    expect(normalizeCounters({ wins: 1, losses: 2 }).winRate).toBe(33);
    expect(normalizeCounters({ wins: 1, losses: 1 }).winRate).toBe(50);
    expect(normalizeCounters({ wins: 3, losses: 0, draws: 0 }).winRate).toBe(100);
    expect(normalizeCounters({ wins: 0, losses: 4 }).winRate).toBe(0);
    // Draws are part of the denominator: 1 win in 1W/1L/2D = 25%.
    expect(normalizeCounters({ wins: 1, losses: 1, draws: 2 }).winRate).toBe(25);
  });

  it('garbage becomes 0, never NaN — and huge values stay safe integers', () => {
    expect(safeCount(NaN)).toBe(0);
    expect(safeCount(Infinity)).toBe(0);              // not finite → 0, never a huge number
    expect(safeCount(1e300)).toBe(Number.MAX_SAFE_INTEGER);   // finite but absurd → clamped
    expect(safeCount(-5)).toBe(0);
    expect(safeCount('7')).toBe(0);
    expect(safeCount(2.9)).toBe(2);
    expect(safeCount(undefined)).toBe(0);
    const c = normalizeCounters({ wins: NaN, losses: '3', draws: -1, forfeits: Infinity });
    expect(c).toEqual({ matches: 0, wins: 0, losses: 0, draws: 0, forfeits: 0, winRate: null });
  });
});

describe('overall is exactly the sum of the six games', () => {
  it('adds up across games within each category, and never across categories', () => {
    const t = buildOnlineTracker([
      row({ gameType: 'king', category: 'human_only', wins: 2, losses: 1 }),
      row({ gameType: 'durak', category: 'human_only', wins: 1, draws: 1 }),
      row({ gameType: 'deberc', category: 'with_bots', losses: 3, forfeits: 2 }),
    ]);
    expect(t.overall.human_only).toEqual({ matches: 5, wins: 3, losses: 1, draws: 1, forfeits: 0, winRate: 60 });
    expect(t.overall.with_bots).toEqual({ matches: 3, wins: 0, losses: 3, draws: 0, forfeits: 2, winRate: 0 });
  });

  it('the same game in BOTH categories stays separate', () => {
    const t = buildOnlineTracker([
      row({ gameType: 'preferans', category: 'human_only', wins: 5 }),
      row({ gameType: 'preferans', category: 'with_bots', losses: 5 }),
    ]);
    expect(t.byGame.preferans.human_only).toMatchObject({ matches: 5, wins: 5, losses: 0, winRate: 100 });
    expect(t.byGame.preferans.with_bots).toMatchObject({ matches: 5, wins: 0, losses: 5, winRate: 0 });
    expect(t.overall.human_only.matches).toBe(5);
    expect(t.overall.with_bots.matches).toBe(5);
  });

  it('overall equals the per-game sum for every generated matrix', () => {
    const t = buildOnlineTracker(TRACKED_ONLINE_GAMES.flatMap((g, i) => ONLINE_CATEGORIES.map((c, j) =>
      row({ gameType: g, category: c, wins: i + 1, losses: j + 1, draws: i, forfeits: j }))));
    for (const c of ONLINE_CATEGORIES) {
      const summed = TRACKED_ONLINE_GAMES.reduce((acc, g) => {
        const cell = t.byGame[g][c];
        return { w: acc.w + cell.wins, l: acc.l + cell.losses, d: acc.d + cell.draws, f: acc.f + cell.forfeits };
      }, { w: 0, l: 0, d: 0, f: 0 });
      expect(t.overall[c].wins, c).toBe(summed.w);
      expect(t.overall[c].losses, c).toBe(summed.l);
      expect(t.overall[c].draws, c).toBe(summed.d);
      expect(t.overall[c].forfeits, c).toBe(summed.f);
      expect(t.overall[c].matches, c).toBe(summed.w + summed.l + summed.d);
    }
  });
});

describe('unknown input is dropped FAIL CLOSED', () => {
  it('a Poker row never reaches the matrix or the overall row', () => {
    const t = buildOnlineTracker([
      row({ gameType: 'poker', wins: 50, losses: 50 }),
      row({ gameType: 'king', wins: 1 }),
    ]);
    expect(t.overall.human_only.matches).toBe(1);
    expect(Object.keys(t.byGame)).not.toContain('poker');
  });

  it('an unknown gameType or category is ignored, not bucketed', () => {
    const t = buildOnlineTracker([
      row({ gameType: 'chess', wins: 9 }),
      row({ category: 'mixed', wins: 9 }),
      row({ gameType: '', category: '', wins: 9 }),
    ]);
    expect(trackerIsEmpty(t)).toBe(true);
  });

  it('duplicate rows for the same cell ACCUMULATE rather than overwrite', () => {
    const t = buildOnlineTracker([row({ wins: 1 }), row({ wins: 2, losses: 1 })]);
    expect(t.byGame.king.human_only).toMatchObject({ matches: 4, wins: 3, losses: 1 });
  });
});

describe('parseTrackerPayload — the strict client-side parse', () => {
  it('round-trips a server payload exactly', () => {
    const built = buildOnlineTracker([
      row({ gameType: 'king', wins: 3, losses: 2, draws: 1, forfeits: 1 }),
      row({ gameType: 'tarneeb', category: 'with_bots', wins: 4 }),
    ]);
    expect(parseTrackerPayload({ tracker: built })).toEqual(built);
  });

  it('zero-fills everything that is missing', () => {
    expect(parseTrackerPayload({ tracker: { byGame: { king: { human_only: { wins: 2 } } } } }).byGame.king.human_only)
      .toEqual({ matches: 2, wins: 2, losses: 0, draws: 0, forfeits: 0, winRate: 100 });
    expect(parseTrackerPayload({})).toEqual(emptyTracker());
    expect(parseTrackerPayload(null)).toEqual(emptyTracker());
    expect(parseTrackerPayload('nope')).toEqual(emptyTracker());
    expect(parseTrackerPayload({ tracker: { byGame: 'broken' } })).toEqual(emptyTracker());
  });

  it('unknown keys in the payload are never read', () => {
    const parsed = parseTrackerPayload({
      tracker: {
        byGame: {
          king: { human_only: { wins: 1, bogus: 99 }, spectator: { wins: 99 } },
          poker: { human_only: { wins: 99, losses: 99 } },
          chess: { human_only: { wins: 99 } },
        },
        extra: 'ignored',
      },
    });
    expect(parsed.overall.human_only.matches).toBe(1);
    expect(Object.keys(parsed.byGame)).toEqual([...TRACKED_ONLINE_GAMES]);
    expect(Object.keys(parsed.byGame.king)).toEqual([...ONLINE_CATEGORIES]);
  });

  it('a hostile `overall` on the wire is ignored — it is re-derived locally', () => {
    const parsed = parseTrackerPayload({
      tracker: {
        overall: { human_only: { matches: 9999, wins: 9999, winRate: 100 }, with_bots: { matches: 9999 } },
        byGame: { king: { human_only: { wins: 1, losses: 1 } } },
      },
    });
    expect(parsed.overall.human_only).toEqual({ matches: 2, wins: 1, losses: 1, draws: 0, forfeits: 0, winRate: 50 });
    expect(parsed.overall.with_bots).toEqual(emptyCounters());
  });

  it('a NaN/negative/string on the wire can never produce NaN on screen', () => {
    const parsed = parseTrackerPayload({
      tracker: { byGame: { durak: { with_bots: { wins: 'x', losses: -4, draws: null, forfeits: NaN } } } },
    });
    expect(parsed.byGame.durak.with_bots).toEqual(emptyCounters());
    expect(parsed.byGame.durak.with_bots.winRate).toBeNull();
  });

  it('accepts a bare matrix (no `tracker` envelope) too', () => {
    const built = buildOnlineTracker([row({ wins: 1 })]);
    expect(parseTrackerPayload(built)).toEqual(built);
  });
});
