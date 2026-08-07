// ---------------------------------------------------------------------------
// Stage 38.0.8 — the anti-dumping policy against a REAL PostgreSQL.
//
// SKIPPED unless TEST_DATABASE_URL points at a database migrated through 0014 (no new
// migration was added for this stage):
//
//   docker run -d --name kg-pg-3808 -e POSTGRES_PASSWORD=test -e POSTGRES_DB=kingtest \
//     -p 55437:5432 postgres:16-alpine
//   DATABASE_URL=postgres://postgres:test@localhost:55437/kingtest npm run db:migrate
//   TEST_DATABASE_URL=postgres://postgres:test@localhost:55437/kingtest \
//     npx vitest run src/net/pokerAntiDump.integration.test.ts
//
// RED this locks down (measured on 7532e7e): one seat took 5+ rebuys in one match; the
// same pair could rematch AND open a brand-new paid room immediately; six repeat matches
// all wrote `recorded` and pushed B to gamesWon 6.
//
// Every account is created fresh, so the counters observed belong to this test alone.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { withPokerDbSuiteLock } from './pokerDbSuite.testutil';
import { bindGameToEscrow } from '../../server/pokerBinding';
import { BANKROLL_PAIR_COOLDOWN_MS } from '../../server/pokerAntiDump';
import type { ServerRoom, ServerMember } from './serverCore';
import type { PokerState } from '../games/poker/types';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DAY = new Date(Date.UTC(2026, 6, 21, 12));
const BUY_IN = 5_000;
let seq = 0;

afterEach(async () => {
  const escrow = await import('../../server/pokerEscrow');
  escrow.__setRefundFailure(false); escrow.__setPayoutFailure(false);
});

function member(over: Partial<ServerMember>): ServerMember {
  return {
    clientId: over.clientId ?? 'c', reconnectToken: 't', name: over.name ?? 'P',
    role: 'player', seatIndex: over.seatIndex ?? 0, isHost: over.seatIndex === 0, connected: true,
    type: 'human', avatar: '🙂', userId: over.userId ?? null,
  } as ServerMember;
}
let roomSeq = 0;
// The test database persists between runs, so the codes are salted per RUN — otherwise a
// later run could observe a previous run's rows for a re-used 4-character code.
const RUN_SALT = Math.floor(Date.now() / 1000).toString(36).toUpperCase().slice(-2);
const SALT = RUN_SALT;
function room(ids: string[], buyIn = BUY_IN): ServerRoom {
  const code = `${RUN_SALT}${(roomSeq++).toString(36).toUpperCase()}`.padEnd(4, 'Z').slice(0, 4);
  return {
    code, gameType: 'poker', pokerBuyIn: buyIn, pokerSmallBlind: 25, pokerBigBlind: 50,
    members: new Map(ids.map((u, i) => [`c${i}`, member({ clientId: `c${i}`, seatIndex: i, userId: u })])),
  } as unknown as ServerRoom;
}
function finished(winnerSeat: number, total: number, n: number, rebuys: Array<{ handNumber: number; seat: number }> = []): PokerState {
  const stacks = Array.from({ length: n }, (_, i) => (i === winnerSeat ? total : 0));
  return {
    phase: 'game_finished', stacksBySeat: stacks, playerCount: n, winnerSeat, handNumber: 4,
    players: stacks.map((_, seat) => ({ id: `p${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human' })),
    appliedRebuys: rebuys, options: { startingStack: BUY_IN },
    telemetry: {
      handsPlayedBySeat: Array.from({ length: n }, () => 4),
      handsWonBySeat: Array.from({ length: n }, (_, i) => (i === winnerSeat ? 4 : 0)),
      showdownsWonBySeat: Array.from({ length: n }, () => 0),
      potsWonBySeat: Array.from({ length: n }, () => 0),
      biggestPotBySeat: Array.from({ length: n }, () => 0),
      allInsWonBySeat: Array.from({ length: n }, () => 0),
      royalFlushBySeat: Array.from({ length: n }, () => 0),
    },
  } as unknown as PokerState;
}

async function mods() {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  return {
    users: await import('../../server/db/users'),
    wallet: await import('../../server/db/pokerWallet'),
    escrow: await import('../../server/pokerEscrow'),
    finish: await import('../../server/pokerFinish'),
    stats: await import('../../server/db/pokerStats'),
    client: await import('../../server/db/client'),
  };
}
async function newUser(tag: string): Promise<string> {
  const { users } = await mods();
  return users.createAccountUser({ email: null, name: `AD-${tag}-${seq++}`, emailVerified: false });
}
async function fund(...ids: string[]): Promise<void> {
  const { wallet } = await mods();
  for (const id of ids) await wallet.dailyClaim(id, DAY);
}

/** Run one whole paid match to a confirmed payout. Returns the room. */
async function playPaidMatch(ids: string[], opts: { unrankedConfirmed?: boolean; now?: () => number } = {}): Promise<ServerRoom> {
  const { escrow } = await mods();
  const r = room(ids);
  const d = await escrow.debitFreshStart(r, opts);
  expect(d, 'debit').toMatchObject({ ok: true });
  r.gameState = finished(0, BUY_IN * ids.length, ids.length) as never;
  bindGameToEscrow(r);
  expect(await escrow.payoutStacks(r, r.gameState as never)).toBe('paid');
  return r;
}

/** Deps that record real Poker stats, so "unranked writes nothing" is measurable. */
async function statsDeps() {
  const { stats } = await mods();
  const recorded = new Set<string>();
  return {
    alreadyRecorded: (code: string, id: string) => recorded.has(`${code}:${id}`),
    markRecorded: (code: string, id: string) => { recorded.add(`${code}:${id}`); },
    unmarkRecorded: () => {},
    record: async (code: string, st: PokerState, seatUsers: Map<number, string | null>, matchId?: string | null) =>
      stats.recordFinishedPokerGame(code, st as never, seatUsers as never, matchId ?? undefined),
  };
}

withPokerDbSuiteLock(beforeAll, afterAll);

describe.skipIf(!TEST_DATABASE_URL)('anti-dumping: REBUY CAP (real PostgreSQL)', () => {
  it('1/2 — two rebuys pass, the THIRD is refused with no ledger row and no balance change', async () => {
    const { escrow, wallet, client } = await mods();
    const A = await newUser('cap-a'); const B = await newUser('cap-b');
    await fund(A, B);
    const r = room([A, B]);
    expect(await escrow.debitFreshStart(r)).toMatchObject({ ok: true });
    const matchId = r.pokerEscrow!.matchId;
    expect(r.pokerEscrow!.antiDumpPolicy?.version).toBe(1);      // the marker is stamped

    const { performRebuy } = await import('../../server/pokerRebuy');
    const deps = { persist: () => {}, broadcast: () => {}, freeze: () => {}, now: () => Date.now() };
    const grant = async (hand: number) => {
      r.gameState = {
        phase: 'rebuy_window', playerCount: 2, stacksBySeat: [0, BUY_IN * 2],
        players: [{ id: 'p0', name: 'A', seatIndex: 0, type: 'human' }, { id: 'p1', name: 'B', seatIndex: 1, type: 'human' }],
        rebuyWindow: { handNumber: hand, eligibleSeats: [0], decisionBySeat: ['pending', 'pending'] },
        appliedRebuys: (r.gameState as PokerState | null)?.appliedRebuys ?? [],
        eliminatedBySeat: [false, false], options: { startingStack: BUY_IN },
      } as unknown as never;
      bindGameToEscrow(r);
      return performRebuy(r, A, 0, deps);
    };

    expect(await grant(1)).toMatchObject({ ok: true });
    expect(await grant(2)).toMatchObject({ ok: true });
    const before = (await wallet.getWalletView(A, DAY)).balance;
    const third = await grant(3);
    expect(third).toEqual({ ok: false, reason: 'not_allowed' });   // refused BEFORE any debit
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(before);

    const conn = await client.getDb();
    const rows = await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${matchId} AND reason = 'table_rebuy'`;
    expect((rows as Array<{ n: number }>)[0].n).toBe(2);
    expect(((r.gameState as PokerState).appliedRebuys ?? []).length).toBe(2);
  });

  it('3 — the allowance is PER SEAT, not per table', async () => {
    const { escrow } = await mods();
    const A = await newUser('seat-a'); const B = await newUser('seat-b');
    await fund(A, B);
    const r = room([A, B]);
    expect(await escrow.debitFreshStart(r)).toMatchObject({ ok: true });
    const { performRebuy } = await import('../../server/pokerRebuy');
    const deps = { persist: () => {}, broadcast: () => {}, freeze: () => {}, now: () => Date.now() };
    const open = (hand: number, seats: number[], applied: Array<{ handNumber: number; seat: number }>) => {
      r.gameState = {
        phase: 'rebuy_window', playerCount: 2, stacksBySeat: [0, 0],
        players: [{ id: 'p0', name: 'A', seatIndex: 0, type: 'human' }, { id: 'p1', name: 'B', seatIndex: 1, type: 'human' }],
        rebuyWindow: { handNumber: hand, eligibleSeats: seats, decisionBySeat: ['pending', 'pending'] },
        appliedRebuys: applied, eliminatedBySeat: [false, false], options: { startingStack: BUY_IN },
      } as unknown as never;
      bindGameToEscrow(r);
    };
    open(1, [0, 1], []);
    expect(await performRebuy(r, A, 0, deps)).toMatchObject({ ok: true });
    expect(await performRebuy(r, B, 1, deps)).toMatchObject({ ok: true });
    const applied = (r.gameState as PokerState).appliedRebuys ?? [];
    open(2, [0, 1], applied);
    expect(await performRebuy(r, A, 0, deps)).toMatchObject({ ok: true });   // A's 2nd
    expect(await performRebuy(r, B, 1, deps)).toMatchObject({ ok: true });   // B's 2nd
    open(3, [0, 1], (r.gameState as PokerState).appliedRebuys ?? []);
    expect(await performRebuy(r, A, 0, deps)).toEqual({ ok: false, reason: 'not_allowed' });
    expect(await performRebuy(r, B, 1, deps)).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('4/5 — a CONCURRENT race for the last allowance yields exactly ONE debit; failures cost nothing', async () => {
    const { escrow, wallet, client } = await mods();
    const A = await newUser('race-a'); const B = await newUser('race-b');
    await fund(A, B);
    const r = room([A, B]);
    expect(await escrow.debitFreshStart(r)).toMatchObject({ ok: true });
    const matchId = r.pokerEscrow!.matchId;
    const { performRebuy } = await import('../../server/pokerRebuy');
    const deps = { persist: () => {}, broadcast: () => {}, freeze: () => {}, now: () => Date.now() };

    r.gameState = {
      phase: 'rebuy_window', playerCount: 2, stacksBySeat: [0, BUY_IN * 2],
      players: [{ id: 'p0', name: 'A', seatIndex: 0, type: 'human' }, { id: 'p1', name: 'B', seatIndex: 1, type: 'human' }],
      rebuyWindow: { handNumber: 1, eligibleSeats: [0], decisionBySeat: ['pending', 'pending'] },
      appliedRebuys: [{ handNumber: 0, seat: 0 }], eliminatedBySeat: [false, false], options: { startingStack: BUY_IN },
    } as unknown as never;
    bindGameToEscrow(r);
    // The state claims one rebuy the ledger does not have → the in-transaction check
    // refuses rather than guessing (the reconciliation model owns that disagreement).
    expect(await performRebuy(r, A, 0, deps)).toEqual({ ok: false, reason: 'cap_reached' });
    let rows = await (await client.getDb())!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${matchId} AND reason = 'table_rebuy'`;
    expect((rows as Array<{ n: number }>)[0].n).toBe(0);

    // Now a consistent state: two concurrent requests for the SAME last allowance.
    (r.gameState as PokerState).appliedRebuys = [];
    const [x, y] = await Promise.all([performRebuy(r, A, 0, deps), performRebuy(r, A, 0, deps)]);
    expect([x.ok, y.ok]).toContain(true);
    rows = await (await client.getDb())!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${matchId} AND reason = 'table_rebuy'`;
    expect((rows as Array<{ n: number }>)[0].n).toBe(1);          // exactly one debit
  });

  it('6/8 — the count survives serialize/restore, and a LEGACY match stays uncapped', async () => {
    const { escrow } = await mods();
    const core = await import('./serverCore');
    const A = await newUser('restore-a'); const B = await newUser('restore-b');
    await fund(A, B);
    // A REAL room (createRoom/addMember), so serialize→deserialize is the production path.
    const r = core.createRoom({
      code: 'ADR9', gameType: 'poker', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'A', userId: A }, now: 1,
      pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: BUY_IN,
    } as never);
    expect(core.addMember(r, { clientId: 'c1', reconnectToken: 't1', name: 'B', userId: B }).ok).toBe(true);
    expect(await escrow.debitFreshStart(r)).toMatchObject({ ok: true });
    r.gameState = finished(0, BUY_IN * 2, 2, [{ handNumber: 1, seat: 0 }, { handNumber: 2, seat: 0 }]) as never;
    r.started = true;
    bindGameToEscrow(r);

    const serialized = core.serializeRoom(r);
    const restored = core.deserializeRoom(JSON.parse(JSON.stringify(serialized)))!;
    const { rebuysLeftForSeat } = await import('../../server/pokerAntiDump');
    expect(restored).not.toBeNull();
    expect(restored.pokerEscrow!.antiDumpPolicy?.version).toBe(1);   // marker round-trips
    expect(rebuysLeftForSeat(restored, 0)).toBe(0);                  // count is not reset
    expect(rebuysLeftForSeat(restored, 1)).toBe(2);

    // A LEGACY escrow — exactly what an in-flight match looked like before this stage.
    const legacyJson = JSON.parse(JSON.stringify(serialized));
    delete legacyJson.pokerEscrow.antiDumpPolicy;
    const legacy = core.deserializeRoom(legacyJson)!;
    expect(legacy.pokerEscrow).toBeDefined();                       // NOT corrupt
    expect(legacy.pokerEscrowCorrupt).toBeFalsy();
    expect(legacy.pokerEscrow!.antiDumpPolicy).toBeUndefined();
    expect(rebuysLeftForSeat(legacy, 0)).toBeNull();                 // uncapped, not zero
  });
});

describe.skipIf(!TEST_DATABASE_URL)('anti-dumping: PAIR COOLDOWN (real PostgreSQL)', () => {
  it('10/11 — an immediate REMATCH and an immediate NEW ROOM are both blocked', async () => {
    const { escrow, wallet } = await mods();
    const A = await newUser('cd-a'); const B = await newUser('cd-b');
    await fund(A, B);
    const r1 = await playPaidMatch([A, B]);
    const balA = (await wallet.getWalletView(A, DAY)).balance;

    // Rematch in the SAME room.
    const rem = await escrow.debitRematch(r1);
    expect(rem.ok).toBe(false);
    expect((rem as { cooldownRetryAfterSeconds?: number }).cooldownRetryAfterSeconds).toBeGreaterThan(0);
    // Inert: the settled escrow/state are untouched and nothing was charged.
    expect(r1.pokerEscrow!.status).toBe('settled');
    expect(r1.pokerFrozen).toBeFalsy();
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(balA);

    // A brand-new room for the same pair — the room code is NOT identity.
    const r2 = room([A, B]);
    const fresh = await escrow.debitFreshStart(r2);
    expect(fresh.ok).toBe(false);
    expect((fresh as { cooldownRetryAfterSeconds?: number }).cooldownRetryAfterSeconds).toBeGreaterThan(0);
    expect(r2.pokerEscrow).toBeUndefined();                    // no matchId was minted
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(balA);
  });

  it('12/13/17 — reversed order blocks; one recent pair blocks a MULTIWAY roster; a different pair does not', async () => {
    const { escrow } = await mods();
    const A = await newUser('rev-a'); const B = await newUser('rev-b');
    const C = await newUser('rev-c'); const D = await newUser('rev-d');
    await fund(A, B, C, D);
    await playPaidMatch([A, B]);

    // Reversed seat/user order — same unordered pair.
    expect((await escrow.debitFreshStart(room([B, A]))).ok).toBe(false);
    // A multiway roster that merely CONTAINS the recent pair.
    expect((await escrow.debitFreshStart(room([C, A, B]))).ok).toBe(false);
    // A roster with no recent pair is unaffected.
    expect((await escrow.debitFreshStart(room([C, D]))).ok).toBe(true);
  });

  it('14 — a CANCELLED (refunded) match creates no cooldown', async () => {
    const { escrow } = await mods();
    const A = await newUser('ref-a'); const B = await newUser('ref-b');
    await fund(A, B);
    const r = room([A, B]);
    expect(await escrow.debitFreshStart(r)).toMatchObject({ ok: true });
    expect(await escrow.refundBuyInsResult(r)).toBe('confirmed_refund');
    // A match that was never played must not block the pair.
    expect((await escrow.debitFreshStart(room([A, B]))).ok).toBe(true);
  });

  it('15 — past the 15-minute boundary the pair may start again', async () => {
    const { escrow } = await mods();
    const A = await newUser('bnd-a'); const B = await newUser('bnd-b');
    await fund(A, B);
    await playPaidMatch([A, B]);
    // The clock is injected, so the boundary is exercised without waiting 15 minutes.
    const later = Date.now() + BANKROLL_PAIR_COOLDOWN_MS + 1000;
    expect((await escrow.debitFreshStart(room([A, B]), { now: () => later })).ok).toBe(true);
  });

  it('16 — two CONCURRENT fresh rooms of the same pair cannot both slip past the policy', async () => {
    const { escrow, wallet } = await mods();
    const A = await newUser('conc-a'); const B = await newUser('conc-b');
    await fund(A, B);
    await playPaidMatch([A, B]);
    const before = (await wallet.getWalletView(A, DAY)).balance;

    // Different rooms → different room locks. Only the shared economy barrier + the
    // in-transaction decision stop them, which is exactly what this proves.
    const [x, y] = await Promise.all([
      escrow.debitFreshStart(room([A, B])),
      escrow.debitFreshStart(room([A, B])),
    ]);
    expect([x.ok, y.ok]).toEqual([false, false]);
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(before);
  });

  it('18 — a refusal reveals nothing about the opponent', async () => {
    const { escrow } = await mods();
    const A = await newUser('priv-a'); const B = await newUser('priv-b');
    await fund(A, B);
    await playPaidMatch([A, B]);
    const refusal = await escrow.debitFreshStart(room([A, B]));
    const raw = JSON.stringify(refusal);
    for (const secret of [A, B, 'pair', 'opponent', 'rosterDigest', 'matchId']) {
      expect(raw, secret).not.toContain(secret);
    }
    expect(Object.keys(refusal).sort()).toEqual(['cooldownRetryAfterSeconds', 'error', 'ok']);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('anti-dumping: RANKED / UNRANKED (real PostgreSQL)', () => {
  /** Play `n` settled matches for a pair, stepping the clock past each cooldown. */
  async function playSeries(ids: string[], n: number, base = Date.now()): Promise<number> {
    let clock = base;
    for (let i = 0; i < n; i++) {
      await playPaidMatch(ids, { now: () => clock });
      clock += BANKROLL_PAIR_COOLDOWN_MS + 1000;
    }
    return clock;
  }

  it('19/20/21 — matches 1–3 are ranked; the 4th needs confirmation and debits NOTHING without it', async () => {
    const { escrow, wallet } = await mods();
    const A = await newUser('rk-a'); const B = await newUser('rk-b');
    await fund(A, B);
    const clock = await playSeries([A, B], 3);
    const before = (await wallet.getWalletView(A, DAY)).balance;

    const r4 = room([A, B]);
    const refused = await escrow.debitFreshStart(r4, { now: () => clock });
    expect(refused).toMatchObject({ ok: false, unrankedConfirmRequired: true });
    expect(r4.pokerEscrow).toBeUndefined();                       // no matchId minted
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(before);   // no debit
  });

  it('23/27 — a CONFIRMED unranked match debits exactly once and pays out normally', async () => {
    const { escrow, wallet, client } = await mods();
    const A = await newUser('uc-a'); const B = await newUser('uc-b');
    await fund(A, B);
    const clock = await playSeries([A, B], 3);
    const before = { a: (await wallet.getWalletView(A, DAY)).balance, b: (await wallet.getWalletView(B, DAY)).balance };

    const r = room([A, B]);
    expect(await escrow.debitFreshStart(r, { now: () => clock, unrankedConfirmed: true })).toMatchObject({ ok: true });
    expect(r.pokerEscrow!.antiDumpPolicy).toMatchObject({ version: 1, statsEligible: false });
    const matchId = r.pokerEscrow!.matchId;
    r.gameState = finished(0, BUY_IN * 2, 2) as never;
    bindGameToEscrow(r);
    expect(await escrow.payoutStacks(r, r.gameState as never)).toBe('paid');

    // Payout conservation is untouched by the policy: A wins the whole pot.
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(before.a + BUY_IN);
    expect((await wallet.getWalletView(B, DAY)).balance).toBe(before.b - BUY_IN);
    const conn = await client.getDb();
    const debits = await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE match_id = ${matchId} AND reason = 'table_buy_in'`;
    expect((debits as Array<{ n: number }>)[0].n).toBe(2);
  });

  it('28/29/30 — unranked writes NO stats row; ranked still does; the outcome is terminal + idempotent', async () => {
    const { escrow, finish, stats, client } = await mods();
    const A = await newUser('st-a'); const B = await newUser('st-b');
    await fund(A, B);
    const deps = await statsDeps();

    // Three RANKED matches → three recorded results.
    let clock = Date.now();
    for (let i = 0; i < 3; i++) {
      const r = room([A, B]);
      expect(await escrow.debitFreshStart(r, { now: () => clock })).toMatchObject({ ok: true });
      r.gameState = finished(0, BUY_IN * 2, 2) as never;
      bindGameToEscrow(r);
      expect(await escrow.payoutStacks(r, r.gameState as never)).toBe('paid');
      expect(await finish.recordConfirmedPokerStats(r, r.gameState as never, deps as never)).toBe('recorded');
      clock += BANKROLL_PAIR_COOLDOWN_MS + 1000;
    }
    const ranked = await stats.getPokerStats(A);
    expect(ranked.gamesPlayed).toBe(3);
    expect(ranked.gamesWon).toBe(3);

    // The FOURTH, confirmed unranked.
    const r4 = room([A, B]);
    expect(await escrow.debitFreshStart(r4, { now: () => clock, unrankedConfirmed: true })).toMatchObject({ ok: true });
    r4.gameState = finished(0, BUY_IN * 2, 2) as never;
    bindGameToEscrow(r4);
    expect(await escrow.payoutStacks(r4, r4.gameState as never)).toBe('paid');
    r4.pokerStatsPending = true;                                  // pretend a write was owed
    expect(await finish.recordConfirmedPokerStats(r4, r4.gameState as never, deps as never)).toBe('unranked_skipped');
    // Repeat (a restart / sweep) → the SAME terminal answer, still nothing written.
    expect(await finish.recordConfirmedPokerStats(r4, r4.gameState as never, deps as never)).toBe('unranked_skipped');

    const after = await stats.getPokerStats(A);
    expect(after.gamesPlayed).toBe(3);                            // unchanged by the unranked match
    expect(after.gamesWon).toBe(3);
    // Durable proof: this account has exactly THREE attributed Poker games — the ranked
    // ones. The unranked match wrote no `games` / `game_players` / `rounds` row at all.
    const conn = await client.getDb();
    const attributed = await conn!.sql`
      SELECT count(*)::int AS n FROM game_players gp
      JOIN games g ON g.id = gp.game_id
      WHERE gp.user_id = ${A} AND g.game_type = 'poker'`;
    expect((attributed as Array<{ n: number }>)[0].n).toBe(3);
  });

  it('25 — refunded and still-active matches never spend a ranked slot', async () => {
    const { escrow } = await mods();
    const A = await newUser('slot-a'); const B = await newUser('slot-b');
    await fund(A, B);
    let clock = Date.now();
    // Two refunded starts…
    for (let i = 0; i < 2; i++) {
      const r = room([A, B]);
      expect(await escrow.debitFreshStart(r, { now: () => clock })).toMatchObject({ ok: true });
      expect(await escrow.refundBuyInsResult(r)).toBe('confirmed_refund');
      clock += 1000;
    }
    // …and one ACTIVE match. (38.0.8.1) While it is unresolved it RESERVES the pair, so a
    // second paid table is refused; releasing it must not have spent a ranked slot either.
    const active = room([A, B]);
    expect(await escrow.debitFreshStart(active, { now: () => clock })).toMatchObject({ ok: true });
    expect((await escrow.debitFreshStart(room([A, B]), { now: () => clock })).ok).toBe(false);
    expect(await escrow.refundBuyInsResult(active)).toBe('confirmed_refund');
    clock += BANKROLL_PAIR_COOLDOWN_MS + 1000;

    // Three REAL settled matches are still all ranked — nothing above consumed a slot.
    for (let i = 0; i < 3; i++) {
      const r = room([A, B]);
      const d = await escrow.debitFreshStart(r, { now: () => clock });
      expect(d, `settled ${i}`).toMatchObject({ ok: true });
      expect(r.pokerEscrow!.antiDumpPolicy!.statsEligible, `settled ${i}`).toBe(true);
      r.gameState = finished(0, BUY_IN * 2, 2) as never;
      bindGameToEscrow(r);
      expect(await escrow.payoutStacks(r, r.gameState as never)).toBe('paid');
      clock += BANKROLL_PAIR_COOLDOWN_MS + 1000;
    }
    // Only now is the pair out of ranked slots.
    expect(await escrow.debitFreshStart(room([A, B]), { now: () => clock }))
      .toMatchObject({ ok: false, unrankedConfirmRequired: true });
  });

  it('26 — a MULTIWAY table is unranked when ONE of its pairs is over the threshold', async () => {
    const { escrow } = await mods();
    const A = await newUser('mw-a'); const B = await newUser('mw-b'); const C = await newUser('mw-c');
    await fund(A, B, C);
    const clock = await playSeries([A, B], 3);
    // C is fresh, but the A+B pair inside the roster is not.
    expect(await escrow.debitFreshStart(room([A, B, C]), { now: () => clock }))
      .toMatchObject({ ok: false, unrankedConfirmRequired: true });
  });

  it('24 — the UTC-day rollover restores ranked eligibility', async () => {
    const { escrow } = await mods();
    const A = await newUser('roll-a'); const B = await newUser('roll-b');
    await fund(A, B);
    await playSeries([A, B], 3);
    // A clock in the NEXT UTC day: the settled matches are outside the day window.
    const tomorrow = Date.now() + 26 * 60 * 60 * 1000;
    const r = room([A, B]);
    expect(await escrow.debitFreshStart(r, { now: () => tomorrow })).toMatchObject({ ok: true });
    expect(r.pokerEscrow!.antiDumpPolicy!.statsEligible).toBe(true);
  });

  it('31/32 — a legacy escrow stays RANKED, and the snapshot carries only a boolean', async () => {
    const { escrow, finish } = await mods();
    const { snapshot } = await import('./serverCore');
    const A = await newUser('leg-a'); const B = await newUser('leg-b');
    await fund(A, B);
    const r = room([A, B]);
    expect(await escrow.debitFreshStart(r)).toMatchObject({ ok: true });
    // Simulate a match started BEFORE the policy shipped.
    delete r.pokerEscrow!.antiDumpPolicy;
    r.gameState = finished(0, BUY_IN * 2, 2) as never;
    bindGameToEscrow(r);
    expect(await escrow.payoutStacks(r, r.gameState as never)).toBe('paid');
    expect(await finish.recordConfirmedPokerStats(r, r.gameState as never, (await statsDeps()) as never)).toBe('recorded');

    const snap = snapshot(r) as unknown as Record<string, unknown>;
    expect(snap.pokerStatsEligible).toBe(true);                   // legacy → ranked
    const raw = JSON.stringify(snap);
    for (const secret of [A, B, 'antiDumpPolicy', 'rosterDigest', 'decidedAt', r.pokerEscrow!.matchId]) {
      expect(raw, secret).not.toContain(secret);
    }
  });

  it('22 — a confirmation cannot be replayed against a DIFFERENT roster', async () => {
    const { escrow } = await mods();
    const A = await newUser('stale-a'); const B = await newUser('stale-b'); const C = await newUser('stale-c');
    await fund(A, B, C);
    const clock = await playSeries([A, B], 3);
    // The host confirms for A+B…
    const rAB = room([A, B]);
    expect(await escrow.debitFreshStart(rAB, { now: () => clock, unrankedConfirmed: true })).toMatchObject({ ok: true });
    const digestAB = rAB.pokerEscrow!.antiDumpPolicy!.rosterDigest;

    // …and a table with a DIFFERENT roster gets its own decision + its own digest. The
    // acknowledgement is never a token: the server re-decides for the actual roster.
    const rAC = room([A, C]);
    expect(await escrow.debitFreshStart(rAC, { now: () => clock, unrankedConfirmed: true })).toMatchObject({ ok: true });
    expect(rAC.pokerEscrow!.antiDumpPolicy!.statsEligible).toBe(true);   // A+C is a fresh pair → RANKED
    expect(rAC.pokerEscrow!.antiDumpPolicy!.rosterDigest).not.toBe(digestAB);
  });
});

// ---------------------------------------------------------------------------
// Stage 38.0.8.1 — the two corrective FAILs, against a REAL PostgreSQL.
//
// RED measured on 0ba01a6:
//   FAIL 1 — two FRESH rooms of one pair with NO history: `[{ok:true},{ok:true}]`,
//            2 unresolved poker_matches, 2 `table_buy_in` rows per account.
//   FAIL 2 — every malformed marker restored as legacy: `rebuysLeft=null`,
//            `statsEligible=true`, no corrupt marker.
// ---------------------------------------------------------------------------

describe.skipIf(!TEST_DATABASE_URL)('38.0.8.1 FAIL 1 — concurrent FRESH starts (real PostgreSQL)', () => {
  it('with NO history at all, exactly ONE of two concurrent rooms funds', async () => {
    const { escrow, wallet, client } = await mods();
    const A = await newUser('fresh-a'); const B = await newUser('fresh-b');
    await fund(A, B);                                    // enough for TWO buy-ins each
    const before = { a: (await wallet.getWalletView(A, DAY)).balance, b: (await wallet.getWalletView(B, DAY)).balance };
    expect(before.a).toBeGreaterThanOrEqual(BUY_IN * 2);

    const r1 = room([A, B]);
    const r2 = room([A, B]);
    const [x, y] = await Promise.all([escrow.debitFreshStart(r1), escrow.debitFreshStart(r2)]);

    const ok = [x, y].filter((r) => r.ok);
    const refused = [x, y].filter((r) => !r.ok) as Array<{ cooldownRetryAfterSeconds?: number }>;
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].cooldownRetryAfterSeconds).toBeGreaterThan(0);

    const winner = x.ok ? r1 : r2;
    const loser = x.ok ? r2 : r1;
    expect(loser.pokerEscrow).toBeUndefined();           // no escrow, no matchId for the refusal

    const conn = await client.getDb();
    const unresolved = await conn!.sql`
      SELECT count(*)::int AS n FROM poker_matches m
      LEFT JOIN poker_match_settlements s ON s.match_id = m.match_id
      WHERE s.match_id IS NULL AND m.seats::text LIKE ${'%' + A + '%'}`;
    expect((unresolved as Array<{ n: number }>)[0].n).toBe(1);

    for (const [u, start] of [[A, before.a], [B, before.b]] as Array<[string, number]>) {
      const debits = await conn!.sql`
        SELECT count(*)::int AS n FROM poker_ledger WHERE user_id = ${u} AND reason = 'table_buy_in'`;
      expect((debits as Array<{ n: number }>)[0].n).toBe(1);
      expect((await wallet.getWalletView(u, DAY)).balance).toBe(start - BUY_IN);
    }
    // The winner is untouched by the refusal: no settlement, no refund.
    const settlement = await conn!.sql`SELECT count(*)::int AS n FROM poker_match_settlements WHERE match_id = ${winner.pokerEscrow!.matchId}`;
    expect((settlement as Array<{ n: number }>)[0].n).toBe(0);
  });

  it('the ACTIVE reservation releases on cancel_refund and becomes a cooldown on payout', async () => {
    const { escrow, wallet } = await mods();
    const A = await newUser('rel-a'); const B = await newUser('rel-b');
    await fund(A, B);

    // 1. An unresolved match reserves the pair.
    const r1 = room([A, B]);
    expect(await escrow.debitFreshStart(r1)).toMatchObject({ ok: true });
    expect((await escrow.debitFreshStart(room([A, B]))).ok).toBe(false);

    // 2. A refund RELEASES it immediately (the match was never played).
    expect(await escrow.refundBuyInsResult(r1)).toBe('confirmed_refund');
    const r2 = room([A, B]);
    expect(await escrow.debitFreshStart(r2)).toMatchObject({ ok: true });

    // 3. A PAYOUT converts it into the ordinary 15-minute cooldown.
    r2.gameState = finished(0, BUY_IN * 2, 2) as never;
    bindGameToEscrow(r2);
    expect(await escrow.payoutStacks(r2, r2.gameState as never)).toBe('paid');
    const blocked = await escrow.debitFreshStart(room([A, B]));
    expect(blocked.ok).toBe(false);
    expect((blocked as { cooldownRetryAfterSeconds?: number }).cooldownRetryAfterSeconds).toBeGreaterThan(60);
    // …and it lifts once the window passes.
    const later = Date.now() + BANKROLL_PAIR_COOLDOWN_MS + 1000;
    expect((await escrow.debitFreshStart(room([A, B]), { now: () => later })).ok).toBe(true);
    void wallet;
  });

  it('a ROLLED-BACK debit leaves NO reservation — the next start succeeds', async () => {
    const { escrow, client } = await mods();
    const A = await newUser('rb-a'); const B = await newUser('rb-b');
    // Deliberately NOT funded: the debit takes the pair locks, then rolls back on
    // InsufficientChipsError. The advisory locks and the durable row must vanish with it.
    const poor = await escrow.debitFreshStart(room([A, B]));
    expect(poor.ok).toBe(false);
    expect((poor as { error: string }).error).toMatch(/chips/i);

    const conn = await client.getDb();
    const phantom = await conn!.sql`SELECT count(*)::int AS n FROM poker_matches WHERE seats::text LIKE ${'%' + A + '%'}`;
    const ledger = await conn!.sql`SELECT count(*)::int AS n FROM poker_ledger WHERE user_id = ${A}`;
    expect((phantom as Array<{ n: number }>)[0].n).toBe(0);      // no phantom reservation
    expect((ledger as Array<{ n: number }>)[0].n).toBe(0);       // no phantom debit

    // With chips, the very same pair now starts normally.
    await fund(A, B);
    expect((await escrow.debitFreshStart(room([A, B]))).ok).toBe(true);
  });

  it('the advisory lock serializes TWO INDEPENDENT DB transactions (not just the JS mutex)', async () => {
    const { client } = await mods();
    const anti = await import('../../server/pokerAntiDump');
    const A = await newUser('adv-a'); const B = await newUser('adv-b');
    const conn = await client.getDb();
    const db = conn!.db as never;

    const order: string[] = [];
    let releaseFirst: (() => void) | null = null;
    const firstHolds = new Promise<void>((r) => { releaseFirst = r; });

    // TX1 takes the pair lock and holds it open. TX2 is a SEPARATE transaction on a separate
    // connection from the pool — the in-process economy barrier is deliberately not involved.
    const tx1 = (db as { transaction: (f: (tx: never) => Promise<void>) => Promise<void> }).transaction(async (tx) => {
      await anti.lockPairsTx(tx, [A, B]);
      order.push('tx1:locked');
      await firstHolds;                                  // hold the lock open
      order.push('tx1:commit');
    });
    await new Promise((r) => setTimeout(r, 120));        // let TX1 reach the lock

    let tx2Locked = false;
    const tx2 = (db as { transaction: (f: (tx: never) => Promise<void>) => Promise<void> }).transaction(async (tx) => {
      await anti.lockPairsTx(tx, [B, A]);                // REVERSED order → the SAME lock
      tx2Locked = true;
      order.push('tx2:locked');
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(tx2Locked).toBe(false);                       // genuinely blocked by Postgres

    releaseFirst!();
    await tx1;
    await tx2;
    expect(order).toEqual(['tx1:locked', 'tx1:commit', 'tx2:locked']);

    // A DIFFERENT pair is not serialized against it.
    const C = await newUser('adv-c'); const D = await newUser('adv-d');
    let other: (() => void) | null = null;
    const holds = new Promise<void>((r) => { other = r; });
    let otherLocked = false;
    const t3 = (db as { transaction: (f: (tx: never) => Promise<void>) => Promise<void> }).transaction(async (tx) => {
      await anti.lockPairsTx(tx, [A, B]);
      await holds;
    });
    await new Promise((r) => setTimeout(r, 120));
    const t4 = (db as { transaction: (f: (tx: never) => Promise<void>) => Promise<void> }).transaction(async (tx) => {
      await anti.lockPairsTx(tx, [C, D]);
      otherLocked = true;
    });
    await new Promise((r) => setTimeout(r, 200));
    expect(otherLocked).toBe(true);                      // unrelated pair proceeds freely
    other!();
    await t3; await t4;
  });
});

describe.skipIf(!TEST_DATABASE_URL)('38.0.8.1 FAIL 2 — the restore matrix (real PostgreSQL)', () => {
  /** A funded, policy-v1 bankroll room. `rebuys` fakes spent allowance for the cap cases;
   *  a PAYOUT case must pass 0, because the durable ledger has no rebuy rows to match. */
  async function policyRoom(rebuys = 2) {
    const { escrow } = await mods();
    const core = await import('./serverCore');
    const A = await newUser('rm-a'); const B = await newUser('rm-b');
    await fund(A, B);
    const r = core.createRoom({
      code: `${SALT}RM`.padEnd(4, 'Z').slice(0, 4), gameType: 'poker', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'A', userId: A }, now: 1,
      pokerSmallBlind: 25, pokerBigBlind: 50, pokerBuyIn: BUY_IN,
    } as never);
    expect(core.addMember(r, { clientId: 'c1', reconnectToken: 't1', name: 'B', userId: B }).ok).toBe(true);
    expect(await escrow.debitFreshStart(r)).toMatchObject({ ok: true });
    const applied = Array.from({ length: rebuys }, (_, i) => ({ handNumber: i + 1, seat: 0 }));
    r.gameState = finished(0, BUY_IN * (2 + rebuys), 2, applied) as never;
    r.started = true;
    bindGameToEscrow(r);
    return { r, core, A, B };
  }

  const MALFORMED: Array<[string, unknown]> = [
    ['explicit null', null],
    ['unknown version', { version: 999, statsEligible: true, decidedAt: 1, rosterDigest: 'a'.repeat(32) }],
    ['wrong statsEligible', { version: 1, statsEligible: 'yes', decidedAt: 1, rosterDigest: 'a'.repeat(32) }],
    ['invalid decidedAt', { version: 1, statsEligible: true, decidedAt: -1, rosterDigest: 'a'.repeat(32) }],
    ['invalid rosterDigest', { version: 1, statsEligible: true, decidedAt: 1, rosterDigest: 'nope' }],
    ['extra unexpected key', { version: 1, statsEligible: true, decidedAt: 1, rosterDigest: 'a'.repeat(32), extra: 1 }],
  ];

  it('1/2 — an ABSENT field is legacy (ranked, uncapped); a VALID one round-trips exactly', async () => {
    const { r, core } = await policyRoom();
    const anti = await import('../../server/pokerAntiDump');
    const base = core.serializeRoom(r);

    const exact = core.deserializeRoom(JSON.parse(JSON.stringify(base)))!;
    expect(exact.pokerEscrow!.antiDumpPolicy).toEqual(r.pokerEscrow!.antiDumpPolicy);
    expect(exact.pokerAntiDumpCorrupt).toBeUndefined();
    expect(anti.rebuysLeftForSeat(exact, 0)).toBe(0);            // the cap still applies

    const legacyJson = JSON.parse(JSON.stringify(base));
    delete legacyJson.pokerEscrow.antiDumpPolicy;
    const legacy = core.deserializeRoom(legacyJson)!;
    expect(legacy.pokerEscrow).toBeDefined();
    expect(legacy.pokerAntiDumpCorrupt).toBeUndefined();
    expect(anti.rebuysLeftForSeat(legacy, 0)).toBeNull();        // uncapped, grandfathered
    expect(anti.statsEligibleForRoom(legacy)).toBe(true);        // ranked
  });

  it('3–8/10 — every MALFORMED shape becomes policy-corrupt, and refuses new rebuys', async () => {
    const { r, core } = await policyRoom();
    const anti = await import('../../server/pokerAntiDump');
    const base = core.serializeRoom(r);

    for (const [label, bad] of MALFORMED) {
      const json = JSON.parse(JSON.stringify(base));
      json.pokerEscrow.antiDumpPolicy = bad;
      const restored = core.deserializeRoom(json)!;
      // The ESCROW (money) survives intact — only the POLICY is unknown.
      expect(restored.pokerEscrow, label).toBeDefined();
      expect(restored.pokerEscrow!.matchId, label).toBe(r.pokerEscrow!.matchId);
      expect(restored.pokerEscrow!.seats, label).toHaveLength(2);
      expect(restored.pokerEscrowCorrupt, label).toBeFalsy();
      // …and the policy fails CLOSED.
      expect(restored.pokerAntiDumpCorrupt, label).toBe(true);
      expect(restored.pokerEscrow!.antiDumpPolicy, label).toBeUndefined();
      expect(anti.rebuysLeftForSeat(restored, 0), label).toBe(0);
      expect(anti.rebuyCapReached(restored, 1), label).toBe(true);
      expect(anti.statsEligibleForRoom(restored), label).toBe(false);
    }
  });

  it('9/15 — the corruption never leaks, and a re-serialize never launders it into legacy', async () => {
    const { r, core } = await policyRoom();
    const anti = await import('../../server/pokerAntiDump');
    const json = JSON.parse(JSON.stringify(core.serializeRoom(r)));
    json.pokerEscrow.antiDumpPolicy = { version: 999, evil: 'payload' };
    const once = core.deserializeRoom(json)!;
    expect(once.pokerAntiDumpCorrupt).toBe(true);

    // Round-trip AGAIN: the fact survives, the attacker's object does not.
    const reserialized = core.serializeRoom(once);
    expect(JSON.stringify(reserialized)).not.toContain('evil');
    expect(reserialized.pokerAntiDumpCorrupt).toBe(true);
    const twice = core.deserializeRoom(JSON.parse(JSON.stringify(reserialized)))!;
    expect(twice.pokerAntiDumpCorrupt).toBe(true);               // still corrupt, not legacy
    expect(anti.rebuysLeftForSeat(twice, 0)).toBe(0);
    expect(anti.statsEligibleForRoom(twice)).toBe(false);

    // Public snapshot: one boolean, and no marker anywhere.
    const snap = JSON.stringify(core.snapshot(twice));
    expect(snap).toContain('"pokerStatsEligible":false');
    expect(snap).not.toContain('antiDumpPolicy');
    expect(snap).not.toContain('pokerAntiDumpCorrupt');
    expect(snap).not.toContain('evil');
    expect(JSON.stringify(core.roomSummary(twice))).not.toContain('AntiDump');
  });

  it('11/13/14 — a corrupt-policy PAYOUT still pays, and its stats are terminal unranked', async () => {
    const { escrow, finish, client } = await mods();
    const { r, core, A } = await policyRoom(0);   // a real payout: no fabricated rebuys
    const { wallet } = await mods();
    const before = (await wallet.getWalletView(A, DAY)).balance;

    // Corrupt the persisted marker, restore, and finish the match normally.
    const json = JSON.parse(JSON.stringify(core.serializeRoom(r)));
    json.pokerEscrow.antiDumpPolicy = { version: 1, statsEligible: 'yes', decidedAt: 1, rosterDigest: 'a'.repeat(32) };
    const live = core.deserializeRoom(json)!;
    expect(live.pokerAntiDumpCorrupt).toBe(true);

    // The live game may still finish and the payout is NEVER blocked by the policy.
    expect(await escrow.payoutStacks(live, live.gameState as never)).toBe('paid');
    expect((await wallet.getWalletView(A, DAY)).balance).toBeGreaterThan(before);

    // Stats: terminal `unranked_skipped`, decided AFTER the structural validation, idempotent.
    live.pokerStatsPending = true;
    const deps = await statsDeps();
    expect(await finish.recordConfirmedPokerStats(live, live.gameState as never, deps as never)).toBe('unranked_skipped');
    expect(await finish.recordConfirmedPokerStats(live, live.gameState as never, deps as never)).toBe('unranked_skipped');

    const conn = await client.getDb();
    const rows = await conn!.sql`
      SELECT count(*)::int AS n FROM game_players gp JOIN games g ON g.id = gp.game_id
      WHERE gp.user_id = ${A} AND g.game_type = 'poker'`;
    expect((rows as Array<{ n: number }>)[0].n).toBe(0);         // no stats row at all
  });

  it('12 — a corrupt-policy CANCELLATION still refunds, and then a fresh match is valid again', async () => {
    const { escrow, wallet } = await mods();
    const { r, core, A } = await policyRoom(0);
    const json = JSON.parse(JSON.stringify(core.serializeRoom(r)));
    json.pokerEscrow.antiDumpPolicy = null;
    json.gameState = null;                                       // a funded orphan, no game
    const live = core.deserializeRoom(json)!;
    live.pokerGameMatchId = undefined;
    expect(live.pokerAntiDumpCorrupt).toBe(true);

    const before = (await wallet.getWalletView(A, DAY)).balance;
    // A NEW paid match is refused while the corrupt escrow is unresolved…
    const blocked = await escrow.debitFreshStart(live);
    expect(blocked.ok).toBe(false);
    expect((blocked as { settlementPending?: boolean }).settlementPending).toBe(true);
    expect(live.pokerFrozen).toBeFalsy();                        // never a freeze

    // …but the REFUND is never blocked.
    expect(await escrow.refundBuyInsResult(live)).toBe('confirmed_refund');
    expect((await wallet.getWalletView(A, DAY)).balance).toBe(before + BUY_IN);

    // Once terminal, a brand-new generation gets a FRESH valid policy and clears the marker.
    const later = Date.now() + BANKROLL_PAIR_COOLDOWN_MS + 1000;
    live.gameState = null;
    expect(await escrow.debitFreshStart(live, { now: () => later })).toMatchObject({ ok: true });
    expect(live.pokerAntiDumpCorrupt).toBeUndefined();
    expect(live.pokerEscrow!.antiDumpPolicy!.version).toBe(1);
  });
});
