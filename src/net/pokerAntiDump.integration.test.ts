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
    // Two refunded starts + one ACTIVE (unsettled) match…
    for (let i = 0; i < 2; i++) {
      const r = room([A, B]);
      expect(await escrow.debitFreshStart(r, { now: () => clock })).toMatchObject({ ok: true });
      expect(await escrow.refundBuyInsResult(r)).toBe('confirmed_refund');
      clock += 1000;
    }
    const active = room([A, B]);
    expect(await escrow.debitFreshStart(active, { now: () => clock })).toMatchObject({ ok: true });
    clock += BANKROLL_PAIR_COOLDOWN_MS + 1000;
    // …then three REAL settled matches are still all ranked.
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
