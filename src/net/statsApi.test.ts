import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchKingStats, fetchKingLeaderboard, parseKingStats,
  parseDurakStats, fetchDurakStats, fetchDurakLeaderboard,
  parseDebercStats, parseFiftyOneStats,
  parseTarneebStats, fetchTarneebStats, fetchTarneebLeaderboard,
  parsePreferansStats, fetchPreferansStats, fetchPreferansLeaderboard,
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

describe('parseDebercStats — combination stats (Stage 13.8)', () => {
  it('flattens outcome + combination counters', () => {
    const s = parseDebercStats({ stats: {
      gamesPlayed: 6, gamesWon: 4, gamesLost: 2, winRate: 67, jackpotCount: 1, jackpotRate: 17,
      combinations: { terz: 5, platina: 2, bella: 3, total: 10, handsPlayed: 40, handsWithMeld: 8, meldRate: 20 },
      lastGameAt: '2026-07-06T00:00:00Z',
    } });
    expect(s).toMatchObject({ gamesPlayed: 6, jackpotCount: 1 });
    expect(s.combinations).toEqual({ terz: 5, platina: 2, bella: 3, total: 10, handsPlayed: 40, handsWithMeld: 8, meldRate: 20 });
  });

  it('defaults every combination counter to 0 when the payload omits them (graceful)', () => {
    const s = parseDebercStats({ stats: { gamesPlayed: 3, gamesWon: 1, gamesLost: 2, jackpotCount: 0 } });
    expect(s.combinations).toEqual({ terz: 0, platina: 0, bella: 0, total: 0, handsPlayed: 0, handsWithMeld: 0, meldRate: null });
  });

  it('derives meldRate when the server omits it', () => {
    const s = parseDebercStats({ stats: { gamesPlayed: 2, combinations: { handsPlayed: 20, handsWithMeld: 5 } } });
    expect(s.combinations.meldRate).toBe(25);
  });

  it('is all-zero for an empty payload', () => {
    const s = parseDebercStats({});
    expect(s).toMatchObject({ gamesPlayed: 0, jackpotCount: 0 });
    expect(s.combinations.total).toBe(0);
  });
});

describe('parseTarneebStats — flat payload', () => {
  it('flattens outcome + contract + score fields', () => {
    const s = parseTarneebStats({ stats: {
      gamesPlayed: 6, gamesWon: 4, gamesLost: 2, winRate: 67,
      handsPlayed: 40, handsAsDeclarer: 12, contractsMade: 8, contractsFailed: 4, contractSuccessRate: 67,
      totalTeamScore: 180, averageTeamScore: 30, bestGameScore: 45, worstGameScore: -12,
      lastGameAt: '2026-07-08T00:00:00Z',
    } });
    expect(s).toMatchObject({
      gamesPlayed: 6, gamesWon: 4, winRate: 67, handsPlayed: 40, handsAsDeclarer: 12,
      contractsMade: 8, contractsFailed: 4, contractSuccessRate: 67,
      totalTeamScore: 180, averageTeamScore: 30, bestGameScore: 45, worstGameScore: -12,
    });
  });

  it('derives winRate/contractSuccessRate/average when the server omits them', () => {
    const s = parseTarneebStats({ stats: { gamesPlayed: 4, gamesWon: 3, contractsMade: 3, contractsFailed: 1, totalTeamScore: 100 } });
    expect(s.winRate).toBe(75);
    expect(s.contractSuccessRate).toBe(75);      // 3/(3+1)
    expect(s.averageTeamScore).toBe(25);         // 100/4
  });

  it('is all-zero/null for an empty payload', () => {
    const s = parseTarneebStats({});
    expect(s).toMatchObject({ gamesPlayed: 0, contractsMade: 0, winRate: null, contractSuccessRate: null });
    expect(s.bestGameScore).toBeNull();
    expect(s.worstGameScore).toBeNull();
  });
});

describe('fetchTarneebStats — graceful state mapping', () => {
  it('maps 200 → ok, 401 → unauthenticated, 503 → unavailable', async () => {
    stubFetch(200, { stats: { gamesPlayed: 1, gamesWon: 1 } });
    expect((await fetchTarneebStats(BASE)).state).toBe('ok');
    stubFetch(401, {});
    expect((await fetchTarneebStats(BASE)).state).toBe('unauthenticated');
    stubFetch(503, {});
    expect((await fetchTarneebStats(BASE)).state).toBe('unavailable');
  });
});

describe('parsePreferansStats — flat payload', () => {
  it('flattens outcome (incl. draws) + contract + score fields', () => {
    const s = parsePreferansStats({ stats: {
      gamesPlayed: 7, gamesWon: 3, gamesLost: 3, gamesDrawn: 1, winRate: 43,
      handsPlayed: 30, handsAsDeclarer: 11, contractsMade: 7, contractsFailed: 4, contractSuccessRate: 64,
      totalScore: 21, averageScore: 3, bestGameScore: 10, worstGameScore: -6,
      lastGameAt: '2026-07-10T00:00:00Z',
    } });
    expect(s).toMatchObject({
      gamesPlayed: 7, gamesWon: 3, gamesLost: 3, gamesDrawn: 1, winRate: 43,
      handsPlayed: 30, handsAsDeclarer: 11, contractsMade: 7, contractsFailed: 4, contractSuccessRate: 64,
      totalScore: 21, averageScore: 3, bestGameScore: 10, worstGameScore: -6,
    });
  });

  it('derives winRate/contractSuccessRate/average when the server omits them', () => {
    const s = parsePreferansStats({ stats: { gamesPlayed: 4, gamesWon: 2, contractsMade: 3, contractsFailed: 1, totalScore: 8 } });
    expect(s.winRate).toBe(50);
    expect(s.contractSuccessRate).toBe(75);  // 3/(3+1)
    expect(s.averageScore).toBe(2);          // 8/4
  });

  it('is all-zero/null for an empty payload', () => {
    const s = parsePreferansStats({});
    expect(s).toMatchObject({ gamesPlayed: 0, gamesDrawn: 0, contractsMade: 0, winRate: null, contractSuccessRate: null });
    expect(s.bestGameScore).toBeNull();
    expect(s.worstGameScore).toBeNull();
  });
});

describe('fetchPreferansStats — graceful state mapping', () => {
  it('maps 200 → ok, 401 → unauthenticated, 503 → unavailable', async () => {
    stubFetch(200, { stats: { gamesPlayed: 1, gamesWon: 1 } });
    expect((await fetchPreferansStats(BASE)).state).toBe('ok');
    stubFetch(401, {});
    expect((await fetchPreferansStats(BASE)).state).toBe('unauthenticated');
    stubFetch(503, {});
    expect((await fetchPreferansStats(BASE)).state).toBe('unavailable');
  });
});

describe('fetchPreferansLeaderboard', () => {
  it('parses public rows (no userId) and marks self', async () => {
    stubFetch(200, { leaderboard: [
      { displayName: 'Vera', avatar: '🦊', gamesPlayed: 9, gamesWon: 5, winRate: 56, contractsMade: 8, contractsFailed: 4, contractSuccessRate: 67, self: true },
    ] });
    const r = await fetchPreferansLeaderboard(BASE);
    expect(r.state).toBe('ok');
    if (r.state === 'ok') {
      expect(r.data[0]).toMatchObject({ displayName: 'Vera', gamesWon: 5, contractSuccessRate: 67, self: true });
      expect('userId' in r.data[0]).toBe(false);
    }
  });
  it('maps a 503 to unavailable and never throws', async () => {
    stubFetch(503, {});
    expect((await fetchPreferansLeaderboard(BASE)).state).toBe('unavailable');
  });
});

describe('fetchTarneebLeaderboard', () => {
  it('parses public rows (no userId) and marks self', async () => {
    stubFetch(200, { leaderboard: [
      { displayName: 'Sara', avatar: '🦉', gamesPlayed: 12, gamesWon: 8, winRate: 67, contractsMade: 10, contractsFailed: 5, contractSuccessRate: 67, self: true },
      { displayName: null, gamesPlayed: 2, gamesWon: 0, contractsMade: 0, contractsFailed: 1 },
    ] });
    const r = await fetchTarneebLeaderboard(BASE);
    expect(r.state).toBe('ok');
    if (r.state !== 'ok') return;
    expect(r.data).toHaveLength(2);
    expect(r.data[0]).toMatchObject({ displayName: 'Sara', contractsMade: 10, self: true });
    expect('userId' in (r.data[0] as object)).toBe(false);
    expect(r.data[1].contractSuccessRate).toBe(0); // derived from 0/(0+1)
  });

  it('maps 503 → unavailable', async () => {
    stubFetch(503, {});
    expect((await fetchTarneebLeaderboard(BASE)).state).toBe('unavailable');
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

describe('fetchDurakLeaderboard', () => {
  it('parses public rows (no userId) and marks self', async () => {
    stubFetch(200, { leaderboard: [
      { displayName: 'Alice', avatar: '🦊', gamesPlayed: 9, gamesWon: 6, winRate: 67, foolCount: 3, self: true },
      { displayName: null, gamesPlayed: 2, gamesWon: 0, foolCount: 2 },
    ] });
    const r = await fetchDurakLeaderboard(BASE);
    expect(r.state).toBe('ok');
    if (r.state !== 'ok') return;
    expect(r.data).toHaveLength(2);
    expect(r.data[0]).toMatchObject({ displayName: 'Alice', foolCount: 3, self: true });
    expect('userId' in (r.data[0] as object)).toBe(false);
    expect(r.data[1].winRate).toBe(0); // derived from 0/2
  });

  it('maps 503 → unavailable', async () => {
    stubFetch(503, {});
    expect((await fetchDurakLeaderboard(BASE)).state).toBe('unavailable');
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

describe('Stage 37.3 telemetry — parsers default new fields on OLD payloads', () => {
  it('parseKingStats: a legacy payload (no telemetry) defaults to 0 / {}', () => {
    const s = parseKingStats({ stats: { gamesPlayed: 3, gamesWon: 1 } });
    expect(s.perfectNegativeRounds).toEqual({});
    expect(s.trumpSweeps).toBe(0);
    expect(s.trumpLowTricks).toBe(0);
  });
  it('parseKingStats: reads the new telemetry when present', () => {
    const s = parseKingStats({ stats: { perfectNegativeRounds: { no_hearts: 2, bad: 'x' }, trumpSweeps: 4, trumpLowTricks: 1 } });
    expect(s.perfectNegativeRounds).toEqual({ no_hearts: 2 }); // non-numeric dropped
    expect(s.trumpSweeps).toBe(4);
    expect(s.trumpLowTricks).toBe(1);
  });
  it('parseDurakStats: legacy → 0; new → read', () => {
    expect(parseDurakStats({ stats: {} })).toMatchObject({ wonBySixes: 0, lostBySixes: 0 });
    expect(parseDurakStats({ stats: { wonBySixes: 2, lostBySixes: 3 } })).toMatchObject({ wonBySixes: 2, lostBySixes: 3 });
  });
  it('parseDebercStats: legacy → 0/null; new → read', () => {
    expect(parseDebercStats({ stats: {} })).toMatchObject({ gamesWithNoMeld: 0, gamesWonNoBeyt: 0, bestGameScore: null, worstGameScore: null });
    expect(parseDebercStats({ stats: { gamesWithNoMeld: 1, gamesWonNoBeyt: 2, bestGameScore: 520, worstGameScore: -30 } }))
      .toMatchObject({ gamesWithNoMeld: 1, gamesWonNoBeyt: 2, bestGameScore: 520, worstGameScore: -30 });
  });
  it('parseTarneebStats: legacy → 0; new → read', () => {
    expect(parseTarneebStats({ stats: {} })).toMatchObject({ cleanContractGames: 0, maxWinningBid: 0 });
    expect(parseTarneebStats({ stats: { cleanContractGames: 3, maxWinningBid: 13 } })).toMatchObject({ cleanContractGames: 3, maxWinningBid: 13 });
  });
  it('parseFiftyOneStats: legacy → 0; new → read', () => {
    expect(parseFiftyOneStats({ stats: {} })).toMatchObject({
      gamesWithInstantRoundWin: 0, gamesNeverOpened: 0, gamesWithTwoJokerDeal: 0, gamesWithNoHundred: 0,
    });
    expect(parseFiftyOneStats({ stats: { gamesWithInstantRoundWin: 1, gamesNeverOpened: 2, gamesWithTwoJokerDeal: 3, gamesWithNoHundred: 4 } }))
      .toMatchObject({ gamesWithInstantRoundWin: 1, gamesNeverOpened: 2, gamesWithTwoJokerDeal: 3, gamesWithNoHundred: 4 });
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
