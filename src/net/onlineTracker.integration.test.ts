// ---------------------------------------------------------------------------
// Stage 38.0.6 — the ONLINE participation tracker against a REAL PostgreSQL.
//
// SKIPPED unless TEST_DATABASE_URL points at a database migrated through 0014:
//
//   docker run -d --name kg-pg-3806 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kingtest \
//     -p 55435:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55435/kingtest npm run db:migrate
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:55435/kingtest \
//     npx vitest run src/net/onlineTracker.integration.test.ts
//
// RED that this file locks down (measured on the Stage 38.0.5 helper):
//   ONE active match, nobody with a result yet → `{matches: 1, wins: 0, losses: 0}`.
//   A bare `count(*)` counted a `pending` seat as a played match, there was no `draws`
//   column at all, and `matches` could therefore never equal `wins + losses + draws`.
//
// Every account here is freshly created, so the counters observed are exactly the
// matches this test wrote — no cross-test contamination.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { buildOnlineMatchMeta, type OnlineMatchSeat } from './onlineMatch';
import {
  buildOnlineTracker, TRACKED_ONLINE_GAMES, ONLINE_CATEGORIES, emptyCounters,
} from './onlineTracker';
import type { GameType } from '../games/catalog';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

let seq = 0;
const nextMatchId = (tag: string) => `trk-${tag}-${Date.now().toString(36)}-${seq++}`;
const human = (seat: number, userId: string | null): OnlineMatchSeat => ({ seat, type: 'human', userId });
const bot = (seat: number): OnlineMatchSeat => ({ seat, type: 'ai', userId: null });

async function repo() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  return import('../../server/db/onlineMatches');
}
async function newUser(tag: string): Promise<string> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const users = await import('../../server/db/users');
  return users.createAccountUser({ email: null, name: `TRK-${tag}-${seq++}`, emailVerified: false });
}

/** START one match with the given roster; returns its id. */
async function start(gameType: GameType, seats: OnlineMatchSeat[], roomCode = 'TR01'): Promise<string> {
  const r = await repo();
  const matchId = nextMatchId(gameType);
  expect(await r.recordOnlineMatchStart(buildOnlineMatchMeta({
    matchId, gameType, roomCode, startedAt: Date.now(), seats,
  }))).toBe('recorded');
  return matchId;
}

/** The tracker matrix exactly as the API would build it for this account. */
async function trackerFor(userId: string) {
  const r = await repo();
  return buildOnlineTracker(await r.getOnlineParticipationCounters(userId));
}

describe.skipIf(!TEST_DATABASE_URL)('online participation tracker (real PostgreSQL)', () => {
  it('1 — an ACTIVE human participant with a PENDING outcome is NOT counted', async () => {
    const A = await newUser('pending-a');
    const B = await newUser('pending-b');
    await start('king', [human(0, A), human(1, B)]);

    const raw = await (await repo()).getOnlineParticipationCounters(A);
    // The row does not exist at all — pending seats are filtered out in SQL.
    expect(raw).toEqual([]);
    const t = await trackerFor(A);
    expect(t.overall.human_only).toEqual(emptyCounters());
    expect(t.byGame.king.human_only).toEqual(emptyCounters());
    expect(t.overall.human_only.winRate).toBeNull();
  });

  it('2 — a permanent leave counts IMMEDIATELY, while the match is still active', async () => {
    const A = await newUser('leave-a');
    const B = await newUser('leave-b');
    const r = await repo();
    const matchId = await start('durak', [human(0, A), human(1, B)]);

    expect(await r.applyPermanentForfeitTx({ matchId, seatIndex: 0, userId: A, at: new Date() })).toBe('applied');
    // The MATCH is still active — only this participant reached a terminal outcome.
    expect((await r.getOnlineMatch(matchId))!.status).toBe('active');

    const t = await trackerFor(A);
    expect(t.byGame.durak.human_only).toEqual({ matches: 1, wins: 0, losses: 1, draws: 0, forfeits: 1, winRate: 0 });
    // …and the opponent, still pending, has nothing.
    expect((await trackerFor(B)).overall.human_only).toEqual(emptyCounters());
  });

  it('3 — a FINISHED human-only match records a win and a loss', async () => {
    const A = await newUser('hw-a');
    const B = await newUser('hw-b');
    const r = await repo();
    const matchId = await start('deberc', [human(0, A), human(1, B)]);
    await r.recordOnlineMatchFinish(matchId, new Map([[0, 'win'], [1, 'loss']]), new Date());

    expect((await trackerFor(A)).byGame.deberc.human_only)
      .toEqual({ matches: 1, wins: 1, losses: 0, draws: 0, forfeits: 0, winRate: 100 });
    expect((await trackerFor(B)).byGame.deberc.human_only)
      .toEqual({ matches: 1, wins: 0, losses: 1, draws: 0, forfeits: 0, winRate: 0 });
  });

  it('4 — a FINISHED with-bots match lands in the with_bots column only', async () => {
    const A = await newUser('bw-a');
    const r = await repo();
    const matchId = await start('tarneeb', [human(0, A), bot(1), bot(2), bot(3)]);
    expect((await r.getOnlineMatch(matchId))!.category).toBe('with_bots');
    await r.recordOnlineMatchFinish(matchId, new Map([[0, 'win']]), new Date());

    const t = await trackerFor(A);
    expect(t.byGame.tarneeb.with_bots).toEqual({ matches: 1, wins: 1, losses: 0, draws: 0, forfeits: 0, winRate: 100 });
    expect(t.byGame.tarneeb.human_only).toEqual(emptyCounters());
    expect(t.overall.human_only).toEqual(emptyCounters());
  });

  it('5 — a DRAW is counted as a played match that is neither a win nor a loss', async () => {
    const A = await newUser('draw-a');
    const B = await newUser('draw-b');
    const r = await repo();
    const matchId = await start('preferans', [human(0, A), human(1, B)]);
    await r.recordOnlineMatchFinish(matchId, new Map([[0, 'draw'], [1, 'draw']]), new Date());

    const c = (await trackerFor(A)).byGame.preferans.human_only;
    expect(c).toEqual({ matches: 1, wins: 0, losses: 0, draws: 1, forfeits: 0, winRate: 0 });
    expect(c.matches).toBe(c.wins + c.losses + c.draws);
  });

  it('6 — ONE game played in BOTH categories never mixes the two', async () => {
    const A = await newUser('both');
    const r = await repo();
    const solo = await start('fifty-one', [human(0, A), bot(1), bot(2)]);
    await r.recordOnlineMatchFinish(solo, new Map([[0, 'loss']]), new Date());
    const withPeople = await start('fifty-one', [human(0, A), human(1, await newUser('both-b'))]);
    await r.recordOnlineMatchFinish(withPeople, new Map([[0, 'win'], [1, 'loss']]), new Date());

    const t = await trackerFor(A);
    expect(t.byGame['fifty-one'].human_only).toEqual({ matches: 1, wins: 1, losses: 0, draws: 0, forfeits: 0, winRate: 100 });
    expect(t.byGame['fifty-one'].with_bots).toEqual({ matches: 1, wins: 0, losses: 1, draws: 0, forfeits: 0, winRate: 0 });
    // The two are reported separately and are NEVER summed into one number.
    expect(t.overall.human_only.matches).toBe(1);
    expect(t.overall.with_bots.matches).toBe(1);
  });

  it('7 — several DIFFERENT games aggregate correctly into Overall', async () => {
    const A = await newUser('multi');
    const r = await repo();
    const plan: Array<[GameType, 'win' | 'loss' | 'draw']> = [
      ['king', 'win'], ['durak', 'win'], ['deberc', 'loss'], ['tarneeb', 'draw'], ['preferans', 'win'],
    ];
    for (const [game, outcome] of plan) {
      const id = await start(game, [human(0, A), human(1, await newUser(`m-${game}`))]);
      await r.recordOnlineMatchFinish(id, new Map([[0, outcome]]), new Date());
    }

    const t = await trackerFor(A);
    expect(t.overall.human_only).toEqual({ matches: 5, wins: 3, losses: 1, draws: 1, forfeits: 0, winRate: 60 });
    // Overall is EXACTLY the sum of the per-game cells.
    const summed = TRACKED_ONLINE_GAMES.reduce((n, g) => n + t.byGame[g].human_only.matches, 0);
    expect(summed).toBe(t.overall.human_only.matches);
    expect(t.byGame['fifty-one'].human_only).toEqual(emptyCounters());   // never played → zeros
  });

  it('8 — a retry / reconnect / restart replay never inflates a counter', async () => {
    const A = await newUser('retry-a');
    const B = await newUser('retry-b');
    const r = await repo();
    const meta = buildOnlineMatchMeta({
      matchId: nextMatchId('retry'), gameType: 'king', roomCode: 'TR08',
      startedAt: Date.now(), seats: [human(0, A), human(1, B)],
    });
    expect(await r.recordOnlineMatchStart(meta)).toBe('recorded');
    // A duplicate START (a reconnect replay) and a duplicate FINISH (a rebroadcast).
    expect(await r.recordOnlineMatchStart(meta)).toBe('already_exists');
    await r.recordOnlineMatchFinish(meta.matchId, new Map([[0, 'win'], [1, 'loss']]), new Date());
    await r.recordOnlineMatchFinish(meta.matchId, new Map([[0, 'win'], [1, 'loss']]), new Date());
    // A duplicate permanent-leave attempt on the already-settled seat.
    expect(await r.applyPermanentForfeitTx({ matchId: meta.matchId, seatIndex: 0, userId: A, at: new Date() }))
      .toBe('conflict');

    expect((await trackerFor(A)).byGame.king.human_only)
      .toEqual({ matches: 1, wins: 1, losses: 0, draws: 0, forfeits: 0, winRate: 100 });
  });

  it('9 — one account never sees another account’s matches', async () => {
    const A = await newUser('iso-a');
    const B = await newUser('iso-b');
    const C = await newUser('iso-c');            // never plays at all
    const r = await repo();
    const id = await start('king', [human(0, A), human(1, B)]);
    await r.recordOnlineMatchFinish(id, new Map([[0, 'win'], [1, 'loss']]), new Date());

    expect((await trackerFor(A)).overall.human_only).toMatchObject({ matches: 1, wins: 1, losses: 0 });
    expect((await trackerFor(B)).overall.human_only).toMatchObject({ matches: 1, wins: 0, losses: 1 });
    const empty = await trackerFor(C);
    for (const g of TRACKED_ONLINE_GAMES) {
      for (const c of ONLINE_CATEGORIES) expect(empty.byGame[g][c], `${g}/${c}`).toEqual(emptyCounters());
    }
  });

  it('10 — a guest/unattributed seat (user_id NULL) is charged to nobody', async () => {
    const A = await newUser('guest-a');
    const r = await repo();
    // Seat 1 is a HUMAN with no account (a guest): its outcome exists but belongs to no user.
    const id = await start('durak', [human(0, A), human(1, null)]);
    await r.recordOnlineMatchFinish(id, new Map([[0, 'loss'], [1, 'win']]), new Date());

    const rows = await r.listOnlineMatchParticipants(id);
    expect(rows.find((x) => x.seatIndex === 1)).toMatchObject({ userId: null, outcome: 'win' });
    // A's own counters are unaffected by the anonymous seat…
    expect((await trackerFor(A)).byGame.durak.human_only)
      .toEqual({ matches: 1, wins: 0, losses: 1, draws: 0, forfeits: 0, winRate: 0 });
    // …and the guest's win is attributed to no account at all.
    const B = await newUser('guest-b');
    expect((await trackerFor(B)).overall.human_only).toEqual(emptyCounters());
  });

  it('11 — a bot seat is never counted, and Poker never appears', async () => {
    const A = await newUser('poker-a');
    const r = await repo();
    const id = await start('king', [human(0, A), bot(1), bot(2)]);
    await r.recordOnlineMatchFinish(id, new Map([[0, 'win'], [1, 'loss'], [2, 'loss']]), new Date());

    const raw = await r.getOnlineParticipationCounters(A);
    // Only the human seat of this account — the two bot rows are not attributable.
    expect(raw).toEqual([{ gameType: 'king', category: 'with_bots', matches: 1, wins: 1, losses: 0, draws: 0, forfeits: 0 }]);
    expect(raw.some((x) => x.gameType === 'poker')).toBe(false);
    const t = await trackerFor(A);
    expect(Object.keys(t.byGame)).toEqual([...TRACKED_ONLINE_GAMES]);
    expect(Object.keys(t.byGame)).not.toContain('poker');
  });

  it('12 — the invariants hold on a mixed, realistic history', async () => {
    const A = await newUser('inv');
    const r = await repo();
    // A win, a loss, a draw, a permanent leave, and one match still being played.
    const w = await start('king', [human(0, A), human(1, await newUser('inv-1'))]);
    await r.recordOnlineMatchFinish(w, new Map([[0, 'win']]), new Date());
    const l = await start('king', [human(0, A), human(1, await newUser('inv-2'))]);
    await r.recordOnlineMatchFinish(l, new Map([[0, 'loss']]), new Date());
    const d = await start('king', [human(0, A), human(1, await newUser('inv-3'))]);
    await r.recordOnlineMatchFinish(d, new Map([[0, 'draw']]), new Date());
    const q = await start('king', [human(0, A), human(1, await newUser('inv-4'))]);
    expect(await r.applyPermanentForfeitTx({ matchId: q, seatIndex: 0, userId: A, at: new Date() })).toBe('applied');
    await start('king', [human(0, A), human(1, await newUser('inv-5'))]);   // still pending

    const t = await trackerFor(A);
    const c = t.byGame.king.human_only;
    // 4 terminal results; the 5th (pending) match is NOT counted.
    expect(c).toEqual({ matches: 4, wins: 1, losses: 2, draws: 1, forfeits: 1, winRate: 25 });
    for (const g of TRACKED_ONLINE_GAMES) {
      for (const cat of ONLINE_CATEGORIES) {
        const cell = t.byGame[g][cat];
        expect(cell.matches, `${g}/${cat}`).toBe(cell.wins + cell.losses + cell.draws);
        expect(cell.forfeits, `${g}/${cat}`).toBeLessThanOrEqual(cell.losses);
      }
    }
    expect(t.overall.human_only).toEqual(c);
  });
});
