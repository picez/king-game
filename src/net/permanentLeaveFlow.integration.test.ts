// ---------------------------------------------------------------------------
// Stage 38.0.5 — the FULL permanent-leave flow against a REAL PostgreSQL.
//
// The orchestration unit tests use fakes for the durable half; this file wires
// `runPermanentLeave` to the REAL repository and a REAL `ServerRoom`, so the whole
// chain is exercised end to end for every one of the six online games:
//
//   START (durable match + participants) → permanent leave (gated forfeit transition)
//   → same-seat AI takeover → serialize/restore ("restart") → finish attribution.
//
// SKIPPED unless TEST_DATABASE_URL points at a database migrated through 0014 (see
// onlineMatches.integration.test.ts for the exact commands).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, freezeOnlineMatch,
  serializeRoom, deserializeRoom, reconnectMember, reclaimMemberByUserId, findUserRoomCodes,
  type ServerRoom,
} from './serverCore';
import { finishSeatUsers, ratedByFrozenCategory, isSeatForfeited } from './onlineMatch';
import { runPermanentLeave, type PermanentLeaveDeps } from '../../server/permanentLeave';
import type { GameType } from '../games/catalog';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const GAMES: Array<{ gt: GameType; seats: 2 | 3 | 4 }> = [
  { gt: 'king', seats: 3 },
  { gt: 'durak', seats: 3 },
  { gt: 'deberc', seats: 3 },
  { gt: 'tarneeb', seats: 4 },
  { gt: 'preferans', seats: 3 },
  { gt: 'fifty-one', seats: 3 },
];

let seq = 0;
const code = () => `F${(seq++).toString(36).toUpperCase()}`.padEnd(4, 'Z').slice(0, 4);

/** Real deps backed by the real repository; side effects are counted, not faked away. */
async function realDeps(rooms: Map<string, ServerRoom>, over: { failForfeit?: boolean } = {}) {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const repo = await import('../../server/db/onlineMatches');
  let botSeq = 0;
  const spies = {
    detachClient: vi.fn(),
    closeRoom: vi.fn((r: ServerRoom) => { rooms.delete(r.code); }),
    persist: vi.fn(),
    broadcastRoom: vi.fn(),
    advance: vi.fn(),
  };
  const deps: PermanentLeaveDeps = {
    rooms,
    dbEnabled: () => true,
    ensureDurableMatch: (meta) => repo.recordOnlineMatchStart(meta),
    applyForfeit: async (input) => {
      if (over.failForfeit) throw new Error('simulated transient DB failure');
      return repo.applyPermanentForfeitTx(input);
    },
    ...spies,
    newIds: () => ({ clientId: `ai-${code()}-${botSeq}`, reconnectToken: `ai-hash-${botSeq++}` }),
    now: () => Date.now(),
  };
  return { deps, repo, spies };
}

async function startedRoom(gt: GameType, seats: number, users: string[], opts: { bots?: number } = {}) {
  const c = code();
  const room = createRoom({
    code: c, gameType: gt, playerCount: seats as 2 | 3 | 4, modeSelectionType: 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0', userId: users[0] }, now: 1,
  });
  const humans = seats - (opts.bots ?? 0);
  for (let i = 1; i < humans; i++) {
    expect(addMember(room, { clientId: `c${i}`, reconnectToken: `t${i}`, name: `P${i}`, userId: users[i] }).ok).toBe(true);
  }
  for (let b = 0; b < (opts.bots ?? 0); b++) addBot(room, 'c0', { clientId: `b${b}`, reconnectToken: `bt${b}` });
  expect(startGame(room, { seed: 11, now: 1 }).ok).toBe(true);
  const meta = freezeOnlineMatch(room, `flow-${c}-${Date.now().toString(36)}`, Date.now())!;
  return { room, meta };
}

describe.skipIf(!TEST_DATABASE_URL)('permanent leave end-to-end (real PostgreSQL)', () => {
  it.each(GAMES)('$gt — committed forfeit, same-seat AI, restart-safe, correct finish attribution', async ({ gt, seats }) => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const usersRepo = await import('../../server/db/users');
    const accounts: string[] = [];
    for (let i = 0; i < seats; i++) {
      accounts.push(await usersRepo.createAccountUser({ email: null, name: `PL-${gt}-${i}-${seq}`, emailVerified: false }));
    }
    const { room, meta } = await startedRoom(gt, seats, accounts);
    const rooms = new Map([[room.code, room]]);
    const { deps, repo } = await realDeps(rooms);

    // START: the durable match must exist before the leave can be accepted.
    expect(await repo.recordOnlineMatchStart(meta)).toBe('recorded');
    meta.durable = true;

    // The seat-1 player quits for good.
    expect(await runPermanentLeave(room.code, 'c1', accounts[1], deps)).toEqual({ ok: true, kind: 'takeover' });

    // Exactly ONE durable technical loss, on the right seat and the right account.
    const rows = await repo.listOnlineMatchParticipants(meta.matchId);
    expect(rows.filter((r) => r.forfeited)).toEqual([
      { seatIndex: 1, userId: accounts[1], memberType: 'human', outcome: 'loss', forfeited: true },
    ]);

    // The seat is an account-less AI on the SAME index and the old identity is dead.
    const bot = [...room.members.values()].find((m) => m.type === 'ai')!;
    expect(bot.seatIndex).toBe(1);
    expect(bot.userId).toBeNull();
    expect(reconnectMember(room, 't1')).toBeNull();
    expect(reclaimMemberByUserId(room, accounts[1])).toBeNull();
    expect(findUserRoomCodes([room], accounts[1])).toEqual([]);

    // RESTART: serialize → restore keeps the frozen roster/category/forfeit + the AI seat.
    const restored = deserializeRoom(JSON.parse(JSON.stringify(serializeRoom(room))))!;
    expect(restored.onlineMatch!.category).toBe('human_only');
    expect(isSeatForfeited(restored.onlineMatch!, 1)).toBe(true);
    expect([...restored.members.values()].find((m) => m.seatIndex === 1)!.type).toBe('ai');
    // A replay of the forfeit after the restart adds nothing.
    expect(await repo.applyPermanentForfeitTx({ matchId: meta.matchId, seatIndex: 1, userId: accounts[1], at: new Date() })).toBe('already_applied');

    // FINISH after the replacement: the match is still rated (it STARTED human_only) and
    // the leaver is not attributed a second time, while everyone who stayed is.
    expect(ratedByFrozenCategory(restored.onlineMatch!)).toBe(true);
    const attributed = finishSeatUsers(restored.onlineMatch!);
    expect(attributed.has(1)).toBe(false);
    expect([...attributed.keys()].sort()).toEqual([...Array(seats).keys()].filter((s) => s !== 1));

    // The replacement bot WINS — the leaver still owns only its single loss.
    const outcomes = new Map<number, 'win' | 'loss'>([[1, 'win']]);
    for (let s = 0; s < seats; s++) if (s !== 1) outcomes.set(s, 'loss');
    await repo.recordOnlineMatchFinish(meta.matchId, outcomes, new Date());
    const finalRows = await repo.listOnlineMatchParticipants(meta.matchId);
    expect(finalRows[1]).toMatchObject({ outcome: 'loss', forfeited: true });
    expect(finalRows.filter((r) => r.userId === accounts[1])).toHaveLength(1);
  });

  it('a DB failure leaves the seat, the token and the room completely untouched', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const usersRepo = await import('../../server/db/users');
    const A = await usersRepo.createAccountUser({ email: null, name: `PL-fail-A-${seq}`, emailVerified: false });
    const B = await usersRepo.createAccountUser({ email: null, name: `PL-fail-B-${seq}`, emailVerified: false });
    const { room, meta } = await startedRoom('durak', 2, [A, B]);
    const rooms = new Map([[room.code, room]]);
    const { deps, repo } = await realDeps(rooms, { failForfeit: true });
    expect(await repo.recordOnlineMatchStart(meta)).toBe('recorded');
    meta.durable = true;

    expect(await runPermanentLeave(room.code, 'c1', B, deps)).toEqual({ ok: false, reason: 'retryable' });

    expect(room.members.get('c1')?.type).toBe('human');
    expect(reconnectMember(room, 't1')).not.toBeNull();
    expect([...room.members.values()].some((m) => m.type === 'ai')).toBe(false);
    expect(isSeatForfeited(room.onlineMatch!, 1)).toBe(false);
    // And nothing was written durably.
    expect((await repo.listOnlineMatchParticipants(meta.matchId)).every((r) => !r.forfeited)).toBe(true);

    // Retrying with a WORKING database then succeeds, exactly once (seat 0's human
    // stays, so the seat is taken over rather than the room being closed).
    const { deps: healthy } = await realDeps(rooms);
    expect(await runPermanentLeave(room.code, 'c1', B, healthy)).toEqual({ ok: true, kind: 'takeover' });
    expect((await repo.listOnlineMatchParticipants(meta.matchId)).filter((r) => r.forfeited)).toHaveLength(1);
  });

  it('a match that STARTED with a bot stays with_bots and is never rated after a takeover', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const usersRepo = await import('../../server/db/users');
    const A = await usersRepo.createAccountUser({ email: null, name: `PL-bots-A-${seq}`, emailVerified: false });
    const B = await usersRepo.createAccountUser({ email: null, name: `PL-bots-B-${seq}`, emailVerified: false });
    const { room, meta } = await startedRoom('durak', 3, [A, B], { bots: 1 });
    const rooms = new Map([[room.code, room]]);
    const { deps, repo } = await realDeps(rooms);
    expect(await repo.recordOnlineMatchStart(meta)).toBe('recorded');
    meta.durable = true;
    expect(meta.category).toBe('with_bots');

    expect(await runPermanentLeave(room.code, 'c1', B, deps)).toEqual({ ok: true, kind: 'takeover' });

    // The category is FROZEN — the durable header still says with_bots.
    expect((await repo.getOnlineMatch(meta.matchId))!.category).toBe('with_bots');
    expect(room.onlineMatch!.category).toBe('with_bots');
    // …so the legacy rating path stays OFF, exactly as it was before the leave.
    expect(ratedByFrozenCategory(room.onlineMatch!)).toBe(false);
    // …but the canonical participant loss IS recorded (the 38.0.6 tracker counts it).
    expect((await repo.listOnlineMatchParticipants(meta.matchId)).filter((r) => r.forfeited)).toHaveLength(1);
  });

  it('the LAST human leaving closes the room and still records the loss', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const usersRepo = await import('../../server/db/users');
    const A = await usersRepo.createAccountUser({ email: null, name: `PL-last-${seq}`, emailVerified: false });
    const { room, meta } = await startedRoom('durak', 3, [A], { bots: 2 });
    const rooms = new Map([[room.code, room]]);
    const { deps, repo, spies } = await realDeps(rooms);
    expect(await repo.recordOnlineMatchStart(meta)).toBe('recorded');
    meta.durable = true;

    expect(await runPermanentLeave(room.code, 'c0', A, deps)).toEqual({ ok: true, kind: 'room_closed' });
    expect(spies.closeRoom).toHaveBeenCalledTimes(1);
    expect(rooms.has(room.code)).toBe(false);
    expect((await repo.listOnlineMatchParticipants(meta.matchId)).filter((r) => r.forfeited)).toHaveLength(1);
  });

  it('two players leaving the same match record two DISTINCT losses, one per seat', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const usersRepo = await import('../../server/db/users');
    const accounts: string[] = [];
    for (let i = 0; i < 3; i++) accounts.push(await usersRepo.createAccountUser({ email: null, name: `PL-two-${i}-${seq}`, emailVerified: false }));
    const { room, meta } = await startedRoom('king', 3, accounts);
    const rooms = new Map([[room.code, room]]);
    const { deps, repo } = await realDeps(rooms);
    expect(await repo.recordOnlineMatchStart(meta)).toBe('recorded');
    meta.durable = true;

    expect(await runPermanentLeave(room.code, 'c1', accounts[1], deps)).toEqual({ ok: true, kind: 'takeover' });
    expect(await runPermanentLeave(room.code, 'c2', accounts[2], deps)).toEqual({ ok: true, kind: 'takeover' });

    const rows = await repo.listOnlineMatchParticipants(meta.matchId);
    expect(rows.filter((r) => r.forfeited).map((r) => r.seatIndex)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ outcome: 'pending', forfeited: false });
    // Only ONE starting human is left → the match can no longer be rated for two players,
    // but the frozen category itself never moved.
    expect(room.onlineMatch!.category).toBe('human_only');
    expect([...finishSeatUsers(room.onlineMatch!).keys()]).toEqual([0]);
  });
});
