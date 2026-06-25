import { describe, it, expect } from 'vitest';
import type { GameState, Player, Score, RoundRecord } from '../models/types';

// Optional integration test for Stage 6 account promotion + guest→account merge.
// SKIPPED unless TEST_DATABASE_URL points at a migrated Postgres:
//
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/king npm test
//
// Exercises the repositories directly (NO Google network): promote-in-place for a
// first-time login, and the merge transaction for a returning Google account.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const rnd = () => Math.floor(Math.random() * 1e9);

function g3(totals: [number, number, number], history: RoundRecord[]): GameState {
  const players: Player[] = totals.map((_, i) => ({
    id: `player-${i}`, name: i === 2 ? 'Bot 1' : `P${i}`, hand: [], seatIndex: i,
    isDealer: false, type: i === 2 ? 'ai' : 'human', avatar: '😀',
  }));
  const scores: Record<string, Score> = {};
  totals.forEach((t, i) => { scores[`player-${i}`] = { playerId: `player-${i}`, roundScores: [], total: t }; });
  return {
    config: { playerCount: 3 } as GameState['config'], players, scores, modeQueue: [],
    currentRoundIdx: 0, currentRound: null as unknown as GameState['currentRound'], currentTrick: null,
    currentLeaderIdx: 0, dealerIndex: 0, status: 'game_finished', trumpSuit: null,
    kittyForExchange: [], dealerModes: {}, roundHistory: history,
  };
}
const rounds = (a: number) => [
  { roundNumber: 1, dealerId: 'player-0', modeId: 'no_hearts' as const, trumpOccurrence: 0, scoreByPlayer: { 'player-0': a, 'player-1': -10, 'player-2': -10 } },
  { roundNumber: 2, dealerId: 'player-2', modeId: 'trump' as const, trumpOccurrence: 1, scoreByPlayer: { 'player-0': 0, 'player-1': 0, 'player-2': 0 } },
];

describe.skipIf(!TEST_DATABASE_URL)('Stage 6 promote + merge (integration)', () => {
  it('promotes a guest in place on first Google login (stats preserved)', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const stats = await import('../../server/db/stats');
    const accounts = await import('../../server/db/authAccounts');

    const g = await users.getOrCreateGuest(`promote-${rnd()}`);
    await stats.recordFinishedGame(`PRM${rnd()}`, g3([-9, -25, -16], rounds(-9)), new Map([[0, g.id], [1, null]]));
    const before = await stats.getUserStats(g.id);
    expect(before.gamesPlayed).toBe(1);

    const sub = `sub-${rnd()}`;
    await users.promoteGuestToAccount(g.id, { email: 'p@ex.com', name: 'Promo', emailVerified: true });
    await accounts.linkProviderAccount(g.id, { provider: 'google', providerAccountId: sub, email: 'p@ex.com', name: 'Promo', picture: 'https://pic' });

    expect(await accounts.findUserByProviderAccount('google', sub)).toBe(g.id);
    const prof = await users.getProfile(g.id);
    expect(prof?.isGuest).toBe(false);
    const acct = await accounts.getAccountForUser(g.id);
    expect(acct).toMatchObject({ provider: 'google', email: 'p@ex.com' });
    // Same user row → stats untouched by promotion.
    expect((await stats.getUserStats(g.id)).gamesPlayed).toBe(1);
  });

  it('merges a guest into an existing Google account without duplicating stats', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const stats = await import('../../server/db/stats');
    const merge = await import('../../server/db/merge');

    // Existing real account E with 1 game; guest G2 with 1 game.
    const eId = await users.createAccountUser({ email: 'e@ex.com', name: 'Existing', emailVerified: true });
    await stats.recordFinishedGame(`EXI${rnd()}`, g3([-9, -25, -16], rounds(-9)), new Map([[0, eId], [1, null]]));
    const g2 = await users.getOrCreateGuest(`mergeguest-${rnd()}`);
    await stats.recordFinishedGame(`GST${rnd()}`, g3([-12, -30, -40], rounds(-12)), new Map([[0, g2.id], [1, null]]));

    const eBefore = await stats.getUserStats(eId);
    const gStats = await stats.getUserStats(g2.id);
    expect(eBefore.gamesPlayed).toBe(1);
    expect(gStats.gamesPlayed).toBe(1);

    const res = await merge.mergeGuestInto(g2.id, eId);
    expect(res.merged).toBe(true);

    const eAfter = await stats.getUserStats(eId);
    expect(eAfter.gamesPlayed).toBe(eBefore.gamesPlayed + gStats.gamesPlayed); // 2, not lost/dup
    expect(eAfter.gamesWon).toBe(eBefore.gamesWon + gStats.gamesWon);
    expect(eAfter.totalScore).toBe(eBefore.totalScore + gStats.totalScore);
    expect(eAfter.trumpRoundsPlayed).toBe(eBefore.trumpRoundsPlayed + gStats.trumpRoundsPlayed);
    expect(eAfter.bestScore).toBe(Math.max(eBefore.bestScore!, gStats.bestScore!));

    // Guest retired; its stats moved away.
    expect((await stats.getUserStats(g2.id)).gamesPlayed).toBe(0);
    expect((await users.getProfile(g2.id))?.isGuest).toBe(false);

    // Idempotent: a replayed merge is a no-op and never double-counts.
    const again = await merge.mergeGuestInto(g2.id, eId);
    expect(again.merged).toBe(false);
    expect((await stats.getUserStats(eId)).gamesPlayed).toBe(eAfter.gamesPlayed);
  });
});
