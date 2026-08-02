// ---------------------------------------------------------------------------
// Stage 38.0.5 — the durable ONLINE match model on a REAL PostgreSQL.
//
// SKIPPED unless TEST_DATABASE_URL points at a database migrated through 0014:
//
//   docker run -d --name kg-pg-3805 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kingtest \
//     -p 55433:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55433/kingtest npm run db:migrate
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:55433/kingtest \
//     npx vitest run src/net/onlineMatches.integration.test.ts
//
// What is proven here (the guarantees the feature is built on):
//   • the schema constraints actually reject every impossible shape;
//   • exactly-once account attribution — one account, one seat per match;
//   • a concurrent duplicate forfeit produces ONE loss;
//   • a committed forfeit survives a "restart" (a fresh read) unchanged;
//   • the finish never rewrites a forfeited row and never gives it a second result;
//   • both categories (human_only / with_bots) round-trip for ALL SIX game types.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildOnlineMatchMeta, type OnlineMatchSeat } from './onlineMatch';
import type { GameType } from '../games/catalog';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const GAME_TYPES: GameType[] = ['king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one'];

let idSeq = 0;
const nextMatchId = (tag: string) => `om-${tag}-${Date.now().toString(36)}-${idSeq++}`;

const humanSeat = (seat: number, userId: string | null): OnlineMatchSeat => ({ seat, type: 'human', userId });
const aiSeat = (seat: number): OnlineMatchSeat => ({ seat, type: 'ai', userId: null });

function metaFor(matchId: string, gameType: GameType, seats: OnlineMatchSeat[], roomCode = 'AB12') {
  return buildOnlineMatchMeta({ matchId, gameType, roomCode, startedAt: Date.now(), seats });
}

describe.skipIf(!TEST_DATABASE_URL)('online match repository (real PostgreSQL)', () => {
  it('records the start idempotently and fails CLOSED on a conflicting record', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const repo = await import('../../server/db/onlineMatches');
    const A = await users.createAccountUser({ email: null, name: 'OM-A', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'OM-B', emailVerified: false });

    const id = nextMatchId('start');
    const meta = metaFor(id, 'king', [humanSeat(0, A), humanSeat(1, B), humanSeat(2, null)]);

    expect(await repo.recordOnlineMatchStart(meta)).toBe('recorded');
    // A duplicate START (a retry / a restart replay) creates nothing new.
    expect(await repo.recordOnlineMatchStart(meta)).toBe('already_exists');

    const header = await repo.getOnlineMatch(id);
    expect(header).toEqual({ roomCode: 'AB12', gameType: 'king', category: 'human_only', playerCount: 3, status: 'active' });
    const rows = await repo.listOnlineMatchParticipants(id);
    expect(rows).toEqual([
      { seatIndex: 0, userId: A, memberType: 'human', outcome: 'pending', forfeited: false },
      { seatIndex: 1, userId: B, memberType: 'human', outcome: 'pending', forfeited: false },
      { seatIndex: 2, userId: null, memberType: 'human', outcome: 'pending', forfeited: false },
    ]);

    // The SAME id describing a DIFFERENT match is never overwritten.
    expect(await repo.recordOnlineMatchStart(metaFor(id, 'king', [humanSeat(0, A), humanSeat(1, B), humanSeat(2, null)], 'ZZZZ'))).toBe('conflict');
    expect(await repo.recordOnlineMatchStart(metaFor(id, 'durak', [humanSeat(0, A), humanSeat(1, B), humanSeat(2, null)]))).toBe('conflict');
    expect(await repo.recordOnlineMatchStart(metaFor(id, 'king', [humanSeat(0, A), humanSeat(1, B), aiSeat(2)]))).toBe('conflict');
    expect(await repo.recordOnlineMatchStart(metaFor(id, 'king', [humanSeat(0, B), humanSeat(1, A), humanSeat(2, null)]))).toBe('conflict');
    // …and the stored row is still the original.
    expect(await repo.getOnlineMatch(id)).toEqual({ roomCode: 'AB12', gameType: 'king', category: 'human_only', playerCount: 3, status: 'active' });
  });

  it('applies a permanent forfeit EXACTLY once — repeats, restarts and races included', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const repo = await import('../../server/db/onlineMatches');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const A = await users.createAccountUser({ email: null, name: 'OM-F1', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'OM-F2', emailVerified: false });

    const id = nextMatchId('forfeit');
    await repo.recordOnlineMatchStart(metaFor(id, 'durak', [humanSeat(0, A), humanSeat(1, B)]));

    const at = new Date();
    expect(await repo.applyPermanentForfeitTx({ matchId: id, seatIndex: 1, userId: B, at })).toBe('applied');
    // A duplicate delivery / a retry after a lost ACK / a replay after a restart.
    expect(await repo.applyPermanentForfeitTx({ matchId: id, seatIndex: 1, userId: B, at: new Date() })).toBe('already_applied');

    // A CONCURRENT duplicate pair still leaves exactly one loss.
    const [r1, r2] = await Promise.all([
      repo.applyPermanentForfeitTx({ matchId: id, seatIndex: 1, userId: B, at: new Date() }),
      repo.applyPermanentForfeitTx({ matchId: id, seatIndex: 1, userId: B, at: new Date() }),
    ]);
    expect([r1, r2].every((r) => r === 'already_applied')).toBe(true);

    const losses = await conn!.sql`
      SELECT count(*)::int AS n FROM online_match_participants
      WHERE match_id = ${id} AND outcome = 'loss' AND forfeited = true`;
    expect((losses as unknown as Array<{ n: number }>)[0].n).toBe(1);

    // A "restart" (a completely fresh read) sees the same single, timestamped loss.
    const rows = await repo.listOnlineMatchParticipants(id);
    expect(rows[1]).toEqual({ seatIndex: 1, userId: B, memberType: 'human', outcome: 'loss', forfeited: true });
    expect(rows[0].outcome).toBe('pending');   // the other player is untouched
  });

  it('refuses to attribute a forfeit to the wrong seat, the wrong account or a bot', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const repo = await import('../../server/db/onlineMatches');
    const A = await users.createAccountUser({ email: null, name: 'OM-W1', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'OM-W2', emailVerified: false });

    const id = nextMatchId('wrong');
    await repo.recordOnlineMatchStart(metaFor(id, 'deberc', [humanSeat(0, A), humanSeat(1, B), aiSeat(2)]));

    expect(await repo.applyPermanentForfeitTx({ matchId: id, seatIndex: 1, userId: A, at: new Date() })).toBe('conflict'); // wrong account
    expect(await repo.applyPermanentForfeitTx({ matchId: id, seatIndex: 5, userId: A, at: new Date() })).toBe('conflict'); // no such seat
    expect(await repo.applyPermanentForfeitTx({ matchId: id, seatIndex: 2, userId: null, at: new Date() })).toBe('conflict'); // a BOT seat
    expect(await repo.applyPermanentForfeitTx({ matchId: 'no-such-match', seatIndex: 0, userId: A, at: new Date() })).toBe('conflict');

    // Nothing moved.
    expect((await repo.listOnlineMatchParticipants(id)).every((r) => r.outcome === 'pending' && !r.forfeited)).toBe(true);
  });

  it('the FINISH never overwrites a forfeit and never gives the leaver a second result', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const repo = await import('../../server/db/onlineMatches');
    const A = await users.createAccountUser({ email: null, name: 'OM-Z1', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'OM-Z2', emailVerified: false });
    const C = await users.createAccountUser({ email: null, name: 'OM-Z3', emailVerified: false });

    const id = nextMatchId('finish');
    await repo.recordOnlineMatchStart(metaFor(id, 'king', [humanSeat(0, A), humanSeat(1, B), humanSeat(2, C)]));
    await repo.applyPermanentForfeitTx({ matchId: id, seatIndex: 1, userId: B, at: new Date() });

    // The replacement bot on seat 1 goes on to WIN — the leaver must NOT become a winner.
    const res = await repo.recordOnlineMatchFinish(id, new Map([
      [0, 'loss' as const], [1, 'win' as const], [2, 'loss' as const],
    ]), new Date());
    expect(res.settled).toBe(2);                       // seats 0 and 2 only

    const rows = await repo.listOnlineMatchParticipants(id);
    expect(rows[1]).toEqual({ seatIndex: 1, userId: B, memberType: 'human', outcome: 'loss', forfeited: true });
    expect(rows[0].outcome).toBe('loss');
    expect(rows[2].outcome).toBe('loss');
    expect((await repo.getOnlineMatch(id))!.status).toBe('finished');

    // A rebroadcast / restart replay settles nothing more.
    expect((await repo.recordOnlineMatchFinish(id, new Map([[0, 'win' as const]]), new Date())).settled).toBe(0);
    expect((await repo.listOnlineMatchParticipants(id))[0].outcome).toBe('loss');
  });

  it('enforces exactly-once ACCOUNT attribution per match', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const repo = await import('../../server/db/onlineMatches');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const A = await users.createAccountUser({ email: null, name: 'OM-U1', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'OM-U2', emailVerified: false });

    const id = nextMatchId('uq');
    await repo.recordOnlineMatchStart(metaFor(id, 'durak', [humanSeat(0, A), humanSeat(1, B)]));
    // The SAME account cannot hold a second seat in the SAME match.
    await expect(conn!.sql`
      INSERT INTO online_match_participants (match_id, seat_index, user_id, member_type)
      VALUES (${id}, 2, ${A}, 'human')`).rejects.toThrow();
    // …but it may hold a seat in a DIFFERENT match.
    const other = nextMatchId('uq2');
    expect(await repo.recordOnlineMatchStart(metaFor(other, 'durak', [humanSeat(0, A), humanSeat(1, B)]))).toBe('recorded');
  });

  it('the schema rejects every impossible participant/match shape', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const repo = await import('../../server/db/onlineMatches');
    const { getDb } = await import('../../server/db/client');
    const conn = await getDb();
    const id = nextMatchId('ck');
    await repo.recordOnlineMatchStart(metaFor(id, 'tarneeb', [humanSeat(0, null), humanSeat(1, null), humanSeat(2, null), humanSeat(3, null)]));

    // A bad category / status / player count / finished-shape on the match row.
    await expect(conn!.sql`INSERT INTO online_matches (match_id, room_code, game_type, category, player_count) VALUES ('bad-cat','AB','king','mixed',3)`).rejects.toThrow();
    await expect(conn!.sql`INSERT INTO online_matches (match_id, room_code, game_type, category, player_count, status) VALUES ('bad-st','AB','king','human_only',3,'weird')`).rejects.toThrow();
    await expect(conn!.sql`INSERT INTO online_matches (match_id, room_code, game_type, category, player_count) VALUES ('bad-pc','AB','king','human_only',9)`).rejects.toThrow();
    await expect(conn!.sql`INSERT INTO online_matches (match_id, room_code, game_type, category, player_count, status) VALUES ('bad-fin','AB','king','human_only',3,'finished')`).rejects.toThrow();

    // A bad seat index / member type / outcome on the participant row.
    await expect(conn!.sql`INSERT INTO online_match_participants (match_id, seat_index, member_type) VALUES (${id}, 9, 'human')`).rejects.toThrow();
    await expect(conn!.sql`INSERT INTO online_match_participants (match_id, seat_index, member_type) VALUES (${id}, 4, 'ghost')`).rejects.toThrow();
    await expect(conn!.sql`INSERT INTO online_match_participants (match_id, seat_index, member_type, outcome) VALUES (${id}, 4, 'human', 'maybe')`).rejects.toThrow();
    // A forfeit that is not a timestamped LOSS is impossible.
    await expect(conn!.sql`INSERT INTO online_match_participants (match_id, seat_index, member_type, outcome, forfeited) VALUES (${id}, 4, 'human', 'win', true)`).rejects.toThrow();
    await expect(conn!.sql`INSERT INTO online_match_participants (match_id, seat_index, member_type, outcome, forfeited) VALUES (${id}, 4, 'human', 'loss', true)`).rejects.toThrow();
    // A bot seat can never hold an account and can never forfeit.
    await expect(conn!.sql`INSERT INTO online_match_participants (match_id, seat_index, member_type, outcome, forfeited, forfeited_at) VALUES (${id}, 4, 'ai', 'loss', true, now())`).rejects.toThrow();
    // A participant with no parent match is impossible (FK).
    await expect(conn!.sql`INSERT INTO online_match_participants (match_id, seat_index, member_type) VALUES ('ghost-match', 0, 'human')`).rejects.toThrow();
  });

  it('round-trips human_only AND with_bots for all six online game types', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const repo = await import('../../server/db/onlineMatches');

    for (const gt of GAME_TYPES) {
      const A = await users.createAccountUser({ email: null, name: `OM-${gt}-A`, emailVerified: false });
      const B = await users.createAccountUser({ email: null, name: `OM-${gt}-B`, emailVerified: false });

      // human_only: a permanent leave records a loss; the other player finishes normally.
      const pure = nextMatchId(`pure-${gt}`);
      expect(await repo.recordOnlineMatchStart(metaFor(pure, gt, [humanSeat(0, A), humanSeat(1, B)]))).toBe('recorded');
      expect((await repo.getOnlineMatch(pure))!.category).toBe('human_only');
      expect(await repo.applyPermanentForfeitTx({ matchId: pure, seatIndex: 0, userId: A, at: new Date() })).toBe('applied');
      await repo.recordOnlineMatchFinish(pure, new Map([[0, 'win' as const], [1, 'win' as const]]), new Date());
      const pureRows = await repo.listOnlineMatchParticipants(pure);
      expect(pureRows[0]).toMatchObject({ outcome: 'loss', forfeited: true });
      expect(pureRows[1]).toMatchObject({ outcome: 'win', forfeited: false });

      // with_bots: the category is frozen; the bot seat never carries an account.
      const mixed = nextMatchId(`mixed-${gt}`);
      expect(await repo.recordOnlineMatchStart(metaFor(mixed, gt, [humanSeat(0, A), humanSeat(1, B), aiSeat(2)]))).toBe('recorded');
      expect((await repo.getOnlineMatch(mixed))!.category).toBe('with_bots');
      await repo.recordOnlineMatchFinish(mixed, new Map([[0, 'win' as const], [1, 'loss' as const], [2, 'loss' as const]]), new Date());
      const mixedRows = await repo.listOnlineMatchParticipants(mixed);
      expect(mixedRows[2]).toEqual({ seatIndex: 2, userId: null, memberType: 'ai', outcome: 'loss', forfeited: false });
    }
  });

  it('reports per-account ONLINE counters split by the frozen category (Stage 38.0.6 read)', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const users = await import('../../server/db/users');
    const repo = await import('../../server/db/onlineMatches');
    const A = await users.createAccountUser({ email: null, name: 'OM-T1', emailVerified: false });
    const B = await users.createAccountUser({ email: null, name: 'OM-T2', emailVerified: false });

    const won = nextMatchId('t-won');
    await repo.recordOnlineMatchStart(metaFor(won, 'king', [humanSeat(0, A), humanSeat(1, B)]));
    await repo.recordOnlineMatchFinish(won, new Map([[0, 'win' as const], [1, 'loss' as const]]), new Date());

    const quit = nextMatchId('t-quit');
    await repo.recordOnlineMatchStart(metaFor(quit, 'king', [humanSeat(0, A), humanSeat(1, B)]));
    await repo.applyPermanentForfeitTx({ matchId: quit, seatIndex: 0, userId: A, at: new Date() });

    const withBots = nextMatchId('t-bots');
    await repo.recordOnlineMatchStart(metaFor(withBots, 'durak', [humanSeat(0, A), humanSeat(1, B), aiSeat(2)]));
    await repo.recordOnlineMatchFinish(withBots, new Map([[0, 'loss' as const], [1, 'win' as const], [2, 'loss' as const]]), new Date());

    const counters = await repo.getOnlineParticipationCounters(A);
    const king = counters.find((c) => c.gameType === 'king' && c.category === 'human_only')!;
    expect(king.matches).toBe(2);
    expect(king.wins).toBe(1);
    expect(king.losses).toBe(1);
    expect(king.forfeits).toBe(1);
    const durak = counters.find((c) => c.gameType === 'durak' && c.category === 'with_bots')!;
    expect(durak).toMatchObject({ matches: 1, wins: 0, losses: 1, forfeits: 0 });
    // No human_only durak row exists for A.
    expect(counters.find((c) => c.gameType === 'durak' && c.category === 'human_only')).toBeUndefined();
  });
});
