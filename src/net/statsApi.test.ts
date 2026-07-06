import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchKingStats, fetchKingLeaderboard, parseKingStats,
  parseDurakStats, fetchDurakStats,
  winRatePct, averageScore, formatSigned, formatLastPlayed, modeBreakdownRows,
} from './statsApi';

const BASE = 'http://localhost:3001';

/** Stub global fetch with one canned Response-like object. */
function stubFetch(status: number, body: unknown, opts: { reject?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (opts.reject) throw new Error('network down');
    return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('parseKingStats — flat v2 payload', () => {
  it('reads the derived view incl. best/worst/trump/negative + per-mode breakdown', () => {
    const parsed = parseKingStats({
      gameType: 'king',
      stats: {
        statsVersion: 2,
        gamesPlayed: 5, gamesWon: 2, gamesLost: 3, winRate: 40, roundsPlayed: 54,
        totalScore: -120, averageScore: -24, bestScore: -9, worstScore: -60,
        trumpRoundsPlayed: 9, negativeRoundsPlayed: 45, surrenderedCount: 0, surrenderedSupported: false,
        modeBreakdown: { trump: { rounds: 9, totalScore: 16, averageScore: 2 }, no_hearts: { rounds: 9, totalScore: -40, averageScore: -4 } },
        lastGameAt: '2026-06-20T10:00:00.000Z',
      },
    });
    expect(parsed.gamesPlayed).toBe(5);
    expect(parsed.winRate).toBe(40);
    expect(parsed.bestScore).toBe(-9);
    expect(parsed.worstScore).toBe(-60);
    expect(parsed.trumpRoundsPlayed).toBe(9);
    expect(parsed.negativeRoundsPlayed).toBe(45);
    expect(parsed.modeBreakdown.no_hearts).toEqual({ rounds: 9, totalScore: -40, averageScore: -4 });
    expect(parsed.lastGameAt).toBe('2026-06-20T10:00:00.000Z');
  });

  it('defaults safely for an empty / no-games payload', () => {
    const parsed = parseKingStats({ stats: { gamesPlayed: 0 } });
    expect(parsed.gamesPlayed).toBe(0);
    expect(parsed.bestScore).toBeNull();
    expect(parsed.worstScore).toBeNull();
    expect(parsed.winRate).toBeNull();
    expect(parsed.modeBreakdown).toEqual({});
    expect(parsed.lastGameAt).toBeNull();
  });

  it('tolerates a legacy payload (modeBreakdown as numbers, lastPlayedAt, no winRate)', () => {
    const parsed = parseKingStats({
      stats: {
        gamesPlayed: 2, gamesWon: 1, totalScore: -30,
        modeBreakdown: { no_hearts: -20, trump: 8 },
        lastPlayedAt: '2026-06-01T00:00:00.000Z',
      },
    });
    expect(parsed.winRate).toBe(50);                 // derived client-side
    expect(parsed.averageScore).toBe(-15);           // derived client-side
    expect(parsed.modeBreakdown.no_hearts).toEqual({ rounds: 0, totalScore: -20, averageScore: null });
    expect(parsed.lastGameAt).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('parseDurakStats — flat payload', () => {
  it('flattens outcome fields', () => {
    const s = parseDurakStats({ stats: { gamesPlayed: 10, gamesWon: 7, gamesLost: 3, winRate: 70, foolCount: 3, drawCount: 1, foolRate: 30, lastGameAt: '2026-07-06T00:00:00Z' } });
    expect(s).toMatchObject({ gamesPlayed: 10, gamesWon: 7, gamesLost: 3, winRate: 70, foolCount: 3, drawCount: 1, foolRate: 30 });
  });

  it('derives winRate/foolRate when the server omits them', () => {
    const s = parseDurakStats({ stats: { gamesPlayed: 4, gamesWon: 3, gamesLost: 1, foolCount: 1, drawCount: 0 } });
    expect(s.winRate).toBe(75);
    expect(s.foolRate).toBe(25);
  });

  it('is all-zero for an empty payload', () => {
    const s = parseDurakStats({});
    expect(s).toMatchObject({ gamesPlayed: 0, gamesWon: 0, foolCount: 0, winRate: null, foolRate: null });
  });
});

describe('fetchDurakStats — graceful state mapping', () => {
  it('maps 200 → ok, 401 → unauthenticated, 503 → unavailable', async () => {
    stubFetch(200, { stats: { gamesPlayed: 1, gamesWon: 1 } });
    expect((await fetchDurakStats(BASE)).state).toBe('ok');
    stubFetch(401, {});
    expect((await fetchDurakStats(BASE)).state).toBe('unauthenticated');
    stubFetch(503, {});
    expect((await fetchDurakStats(BASE)).state).toBe('unavailable');
  });
});

describe('fetchKingStats — graceful state mapping', () => {
  it('200 → ok with parsed data', async () => {
    stubFetch(200, { stats: { gamesPlayed: 1, gamesWon: 1, winRate: 100, totalScore: -9, bestScore: -9, worstScore: -9 } });
    const r = await fetchKingStats(BASE);
    expect(r.state).toBe('ok');
    if (r.state === 'ok') { expect(r.data.gamesPlayed).toBe(1); expect(r.data.winRate).toBe(100); }
  });
  it('401 → unauthenticated', async () => {
    stubFetch(401, { error: 'unauthenticated' });
    expect((await fetchKingStats(BASE)).state).toBe('unauthenticated');
  });
  it('503 → unavailable (DB disabled)', async () => {
    stubFetch(503, { error: 'db_disabled' });
    expect((await fetchKingStats(BASE)).state).toBe('unavailable');
  });
  it('network error → error', async () => {
    stubFetch(0, null, { reject: true });
    expect((await fetchKingStats(BASE)).state).toBe('error');
  });
});

describe('fetchKingLeaderboard', () => {
  it('200 → ok with public rows (avatar + self, no userId)', async () => {
    stubFetch(200, { gameType: 'king', leaderboard: [
      { displayName: 'Alice', avatar: '🦊', gamesPlayed: 3, gamesWon: 2, winRate: 67, averageScore: -20, bestScore: -9, totalScore: -60, lastGameAt: '2026-06-20T10:00:00.000Z', self: true },
      { displayName: null, avatar: null, gamesPlayed: 1, gamesWon: 0, winRate: 0, averageScore: -50, bestScore: -50, totalScore: -50, lastGameAt: null, self: false },
    ] });
    const r = await fetchKingLeaderboard(BASE);
    expect(r.state).toBe('ok');
    if (r.state === 'ok') {
      expect(r.data).toHaveLength(2);
      expect(r.data[0]).toMatchObject({ displayName: 'Alice', avatar: '🦊', winRate: 67, bestScore: -9, self: true });
      // No private id leaks through.
      expect('userId' in r.data[0]).toBe(false);
      expect(r.data[1].self).toBe(false);
    }
  });
  it('503 → unavailable', async () => {
    stubFetch(503, { error: 'db_disabled' });
    expect((await fetchKingLeaderboard(BASE)).state).toBe('unavailable');
  });
});

describe('pure derivations', () => {
  it('winRatePct rounds and guards zero games', () => {
    expect(winRatePct(2, 5)).toBe(40);
    expect(winRatePct(1, 3)).toBe(33);
    expect(winRatePct(0, 0)).toBeNull();
  });
  it('averageScore rounds and guards zero games', () => {
    expect(averageScore(-120, 5)).toBe(-24);
    expect(averageScore(0, 0)).toBeNull();
  });
  it('formatSigned shows the sign (King totals can be either)', () => {
    expect(formatSigned(8)).toBe('+8');
    expect(formatSigned(-40)).toBe('-40');
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(null)).toBe('—');
  });
  it('formatLastPlayed returns a short date or null', () => {
    expect(formatLastPlayed(null, 'en')).toBeNull();
    expect(formatLastPlayed('not-a-date', 'en')).toBeNull();
    expect(formatLastPlayed('2026-06-20T10:00:00.000Z', 'en')).toBeTruthy();
  });
  it('modeBreakdownRows orders known modes (Trump last) and appends unknowns', () => {
    const rows = modeBreakdownRows({
      trump: { rounds: 9, totalScore: 16, averageScore: 2 },
      no_hearts: { rounds: 9, totalScore: -40, averageScore: -4 },
      future_mode: { rounds: 1, totalScore: -1, averageScore: -1 },
    });
    expect(rows.map((r) => r.modeId)).toEqual(['no_hearts', 'trump', 'future_mode']);
    expect(rows[0]).toMatchObject({ rounds: 9, totalScore: -40, averageScore: -4 });
  });
});
