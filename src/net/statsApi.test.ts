import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchKingStats, fetchKingLeaderboard, parseKingStats,
  winRatePct, averageScore, formatSigned, formatLastPlayed, modeBreakdownRows,
} from './statsApi';

const BASE = 'http://localhost:3001';

/** Stub global fetch with one canned Response-like object. */
function stubFetch(status: number, body: unknown, opts: { reject?: boolean } = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (opts.reject) throw new Error('network down');
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    } as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('parseKingStats — flattens the nested API payload', () => {
  it('reads the inner stats object and coerces types', () => {
    const parsed = parseKingStats({
      gameType: 'king',
      stats: {
        gamesPlayed: 5, gamesWon: 2, gamesLost: 3, roundsPlayed: 54,
        stats: { totalScore: -120, bestGameScore: -9, modeBreakdown: { trump: 16, no_hearts: -40 } },
        lastPlayedAt: '2026-06-20T10:00:00.000Z',
      },
    });
    expect(parsed.gamesPlayed).toBe(5);
    expect(parsed.bestGameScore).toBe(-9);
    expect(parsed.totalScore).toBe(-120);
    expect(parsed.modeBreakdown).toEqual({ trump: 16, no_hearts: -40 });
    expect(parsed.lastPlayedAt).toBe('2026-06-20T10:00:00.000Z');
  });

  it('defaults safely for an empty / no-games payload', () => {
    const parsed = parseKingStats({ stats: { gamesPlayed: 0, stats: {} } });
    expect(parsed.gamesPlayed).toBe(0);
    expect(parsed.bestGameScore).toBeNull();
    expect(parsed.modeBreakdown).toEqual({});
    expect(parsed.lastPlayedAt).toBeNull();
  });
});

describe('fetchKingStats — graceful state mapping', () => {
  it('200 → ok with parsed data', async () => {
    stubFetch(200, { stats: { gamesPlayed: 1, gamesWon: 1, stats: { totalScore: -9, bestGameScore: -9 }, lastPlayedAt: null } });
    const r = await fetchKingStats(BASE);
    expect(r.state).toBe('ok');
    if (r.state === 'ok') { expect(r.data.gamesPlayed).toBe(1); expect(r.data.gamesWon).toBe(1); }
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
  it('200 → ok with public rows only', async () => {
    stubFetch(200, { gameType: 'king', leaderboard: [
      { userId: 'u1', displayName: 'Alice', gamesPlayed: 3, gamesWon: 2 },
      { userId: 'u2', displayName: null, gamesPlayed: 1, gamesWon: 0 },
    ] });
    const r = await fetchKingLeaderboard(BASE);
    expect(r.state).toBe('ok');
    if (r.state === 'ok') {
      expect(r.data).toHaveLength(2);
      expect(r.data[0]).toEqual({ userId: 'u1', displayName: 'Alice', gamesPlayed: 3, gamesWon: 2 });
      // no extra/private keys leak through
      expect(Object.keys(r.data[0]).sort()).toEqual(['displayName', 'gamesPlayed', 'gamesWon', 'userId']);
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
    const rows = modeBreakdownRows({ trump: 16, no_hearts: -40, future_mode: -1 });
    expect(rows.map((r) => r.modeId)).toEqual(['no_hearts', 'trump', 'future_mode']);
    expect(rows[0].points).toBe(-40);
  });
});
