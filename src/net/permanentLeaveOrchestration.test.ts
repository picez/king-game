// ---------------------------------------------------------------------------
// Stage 38.0.5 — the permanent-leave ORCHESTRATION contract (`runPermanentLeave`).
//
// The whole safety argument of the feature is an ORDER, so it is tested as an order:
// the durable forfeit must COMMIT before anything irreversible happens, and every
// failure mode must leave the room, the seat, the token and the client's session
// byte-identical. Real side effects are replaced by spies; the room itself is a real
// `ServerRoom` driven through the real serverCore functions.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, freezeOnlineMatch, beginTurnDeadline,
  reconnectMember, reclaimMemberByUserId, findUserRoomCodes, activePlayers,
  type ServerRoom,
} from './serverCore';
import { isSeatForfeited } from './onlineMatch';
import { runPermanentLeave, seatAlreadyForfeited, type PermanentLeaveDeps } from '../../server/permanentLeave';
import type { ForfeitResult, StartRecordResult } from '../../server/db/onlineMatches';

let seq = 0;
function startedRoom(opts: { humans?: number; bots?: number; timerSec?: number; durable?: boolean } = {}): ServerRoom {
  const humans = opts.humans ?? 3;
  const bots = opts.bots ?? 0;
  const room = createRoom({
    code: `O${(seq++).toString(36).toUpperCase()}`.padEnd(4, 'X').slice(0, 4),
    gameType: 'durak', playerCount: (humans + bots) as 2 | 3 | 4, modeSelectionType: 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0', userId: 'u0' }, now: 1,
    turnTimerSec: opts.timerSec ?? 0,
  });
  for (let i = 1; i < humans; i++) {
    addMember(room, { clientId: `c${i}`, reconnectToken: `t${i}`, name: `P${i}`, userId: `u${i}` });
  }
  for (let b = 0; b < bots; b++) addBot(room, 'c0', { clientId: `b${b}`, reconnectToken: `bt${b}` });
  expect(startGame(room, { seed: 7, now: 1 }).ok).toBe(true);
  const meta = freezeOnlineMatch(room, `match-${room.code}`, 1000)!;
  meta.durable = opts.durable ?? true;
  return room;
}

interface Harness {
  deps: PermanentLeaveDeps;
  rooms: Map<string, ServerRoom>;
  calls: string[];
  forfeits: Array<{ matchId: string; seatIndex: number; userId: string | null }>;
  spies: {
    ensureDurableMatch: ReturnType<typeof vi.fn>;
    applyForfeit: ReturnType<typeof vi.fn>;
    detachClient: ReturnType<typeof vi.fn>;
    closeRoom: ReturnType<typeof vi.fn>;
    persist: ReturnType<typeof vi.fn>;
    broadcastRoom: ReturnType<typeof vi.fn>;
    advance: ReturnType<typeof vi.fn>;
  };
}

function harness(room: ServerRoom, over: {
  dbEnabled?: boolean;
  start?: StartRecordResult | Error;
  forfeit?: ForfeitResult | Error;
  onAfterForfeit?: () => void;
} = {}): Harness {
  const rooms = new Map<string, ServerRoom>([[room.code, room]]);
  const calls: string[] = [];
  const forfeits: Harness['forfeits'] = [];
  let botSeq = 0;

  const ensureDurableMatch = vi.fn(async () => {
    calls.push('ensureDurableMatch');
    if (over.start instanceof Error) throw over.start;
    return over.start ?? 'already_exists';
  });
  const applyForfeit = vi.fn(async (input: { matchId: string; seatIndex: number; userId: string | null }) => {
    calls.push('applyForfeit');
    if (over.forfeit instanceof Error) throw over.forfeit;
    forfeits.push({ matchId: input.matchId, seatIndex: input.seatIndex, userId: input.userId });
    over.onAfterForfeit?.();
    return (over.forfeit ?? 'applied') as ForfeitResult;
  });
  const detachClient = vi.fn(() => { calls.push('detachClient'); });
  const closeRoom = vi.fn((r: ServerRoom) => { calls.push('closeRoom'); rooms.delete(r.code); });
  const persist = vi.fn(() => { calls.push('persist'); });
  const broadcastRoom = vi.fn(() => { calls.push('broadcastRoom'); });
  const advance = vi.fn(() => { calls.push('advance'); });

  const deps: PermanentLeaveDeps = {
    rooms,
    dbEnabled: () => over.dbEnabled ?? true,
    ensureDurableMatch,
    applyForfeit,
    detachClient,
    closeRoom,
    persist,
    broadcastRoom,
    advance,
    newIds: () => ({ clientId: `ai-${botSeq}`, reconnectToken: `ai-hash-${botSeq++}` }),
    now: () => 5_000,
  };
  return { deps, rooms, calls, forfeits, spies: { ensureDurableMatch, applyForfeit, detachClient, closeRoom, persist, broadcastRoom, advance } };
}

describe('the happy path commits the forfeit BEFORE anything irreversible', () => {
  it('forfeit → takeover → persist → broadcast → advance', async () => {
    const room = startedRoom();
    const h = harness(room);
    const res = await runPermanentLeave(room.code, 'c1', 'u1', h.deps);

    expect(res).toEqual({ ok: true, kind: 'takeover' });
    expect(h.calls).toEqual(['applyForfeit', 'detachClient', 'persist', 'broadcastRoom', 'advance']);
    expect(h.forfeits).toEqual([{ matchId: `match-${room.code}`, seatIndex: 1, userId: 'u1' }]);
    // The seat is an AI on the SAME index; the departed member is gone.
    expect(room.members.get('c1')).toBeUndefined();
    const bot = [...room.members.values()].find((m) => m.type === 'ai')!;
    expect(bot.seatIndex).toBe(1);
    expect(bot.userId).toBeNull();
    expect(activePlayers(room)).toHaveLength(3);
    // And the room JSON now remembers the permanent departure.
    expect(isSeatForfeited(room.onlineMatch!, 1)).toBe(true);
    expect(seatAlreadyForfeited(room, 1)).toBe(true);
  });

  it('records the match durably first when the START-time write had not been confirmed', async () => {
    const room = startedRoom({ durable: false });
    const h = harness(room, { start: 'recorded' });
    const res = await runPermanentLeave(room.code, 'c1', 'u1', h.deps);
    expect(res.ok).toBe(true);
    expect(h.calls.slice(0, 2)).toEqual(['ensureDurableMatch', 'applyForfeit']);
    expect(room.onlineMatch!.durable).toBe(true);
  });

  it('does not reset or extend the current turn deadline', async () => {
    const room = startedRoom({ timerSec: 30 });
    beginTurnDeadline(room, 10_000);
    const deadline = room.turnDeadlineAt;
    const revision = room.turnTimerRevision;
    const h = harness(room);
    await runPermanentLeave(room.code, 'c2', 'u2', h.deps);
    expect(room.turnDeadlineAt).toBe(deadline);
    expect(room.turnTimerRevision).toBe(revision);
    // The re-evaluation is the CONNECTION-EVENT variant: one call, no turn advance.
    expect(h.spies.advance).toHaveBeenCalledTimes(1);
  });

  it('annuls the reconnect identity for the leaver only', async () => {
    const room = startedRoom();
    const h = harness(room);
    await runPermanentLeave(room.code, 'c1', 'u1', h.deps);
    expect(reconnectMember(room, 't1')).toBeNull();
    expect(reclaimMemberByUserId(room, 'u1')).toBeNull();
    expect(findUserRoomCodes([room], 'u1')).toEqual([]);
    expect(reconnectMember(room, 't2')).not.toBeNull();
    expect(findUserRoomCodes([room], 'u2')).toHaveLength(1);
  });
});

describe('a durable forfeit that cannot commit NEVER takes the seat over', () => {
  const untouched = (room: ServerRoom) => {
    expect(room.members.get('c1')).toBeDefined();
    expect(room.members.get('c1')!.type).toBe('human');
    expect(room.members.get('c1')!.seatIndex).toBe(1);
    expect(reconnectMember(room, 't1')).not.toBeNull();
    expect([...room.members.values()].some((m) => m.type === 'ai')).toBe(false);
    expect(isSeatForfeited(room.onlineMatch!, 1)).toBe(false);
  };

  it('transient DB failure on the forfeit → RETRYABLE, nothing changed', async () => {
    const room = startedRoom();
    const h = harness(room, { forfeit: new Error('connection reset') });
    expect(await runPermanentLeave(room.code, 'c1', 'u1', h.deps)).toEqual({ ok: false, reason: 'retryable' });
    untouched(room);
    expect(h.spies.detachClient).not.toHaveBeenCalled();
    expect(h.spies.closeRoom).not.toHaveBeenCalled();
    expect(h.spies.broadcastRoom).not.toHaveBeenCalled();
  });

  it('transient DB failure while recording the match → RETRYABLE, no forfeit attempted', async () => {
    const room = startedRoom({ durable: false });
    const h = harness(room, { start: new Error('timeout') });
    expect(await runPermanentLeave(room.code, 'c1', 'u1', h.deps)).toEqual({ ok: false, reason: 'retryable' });
    untouched(room);
    expect(h.spies.applyForfeit).not.toHaveBeenCalled();
  });

  it('a durable record describing a DIFFERENT match → REFUSED (never overwritten)', async () => {
    const room = startedRoom({ durable: false });
    const h = harness(room, { start: 'conflict' });
    expect(await runPermanentLeave(room.code, 'c1', 'u1', h.deps)).toEqual({ ok: false, reason: 'refused' });
    untouched(room);
    expect(h.spies.applyForfeit).not.toHaveBeenCalled();
  });

  it('a participant row that already carries a NON-forfeit result → REFUSED', async () => {
    const room = startedRoom();
    const h = harness(room, { forfeit: 'conflict' });
    expect(await runPermanentLeave(room.code, 'c1', 'u1', h.deps)).toEqual({ ok: false, reason: 'refused' });
    untouched(room);
  });

  it('an AUTHENTICATED leave with no chip/account database → RETRYABLE, nothing changed', async () => {
    const room = startedRoom();
    const h = harness(room, { dbEnabled: false });
    expect(await runPermanentLeave(room.code, 'c1', 'u1', h.deps)).toEqual({ ok: false, reason: 'retryable' });
    untouched(room);
    expect(h.spies.applyForfeit).not.toHaveBeenCalled();
  });

  it('a room with no frozen match metadata → REFUSED (fail closed)', async () => {
    const room = startedRoom();
    room.onlineMatch = undefined;
    const h = harness(room);
    expect(await runPermanentLeave(room.code, 'c1', 'u1', h.deps)).toEqual({ ok: false, reason: 'refused' });
    expect(room.members.get('c1')).toBeDefined();
    expect(h.spies.applyForfeit).not.toHaveBeenCalled();
  });

  it('metadata that belongs to a DIFFERENT room/game → REFUSED', async () => {
    const room = startedRoom();
    room.onlineMatch!.roomCode = 'ZZZZ';
    expect((await runPermanentLeave(room.code, 'c1', 'u1', harness(room).deps))).toEqual({ ok: false, reason: 'refused' });
    room.onlineMatch!.roomCode = room.code;
    room.onlineMatch!.gameType = 'king';
    expect((await runPermanentLeave(room.code, 'c1', 'u1', harness(room).deps))).toEqual({ ok: false, reason: 'refused' });
  });

  it('a session account that disagrees with the seat is REFUSED (never mis-attributed)', async () => {
    const room = startedRoom();
    const h = harness(room);
    expect(await runPermanentLeave(room.code, 'c1', 'someone-else', h.deps)).toEqual({ ok: false, reason: 'refused' });
    expect(h.spies.applyForfeit).not.toHaveBeenCalled();
  });
});

describe('guests, duplicates and races', () => {
  it('a GUEST (no resolved account) can leave even with no database', async () => {
    const room = startedRoom();
    room.members.get('c1')!.userId = null;
    room.onlineMatch!.roster[1].userId = null;
    const h = harness(room, { dbEnabled: false });
    expect(await runPermanentLeave(room.code, 'c1', null, h.deps)).toEqual({ ok: true, kind: 'takeover' });
    expect(h.spies.applyForfeit).not.toHaveBeenCalled();     // no account row to write
    expect(room.members.get('c1')).toBeUndefined();
    expect(isSeatForfeited(room.onlineMatch!, 1)).toBe(true); // still tracked in the room JSON
  });

  it("a GUEST's best-effort durable write failing does not block the takeover", async () => {
    const room = startedRoom();
    room.members.get('c1')!.userId = null;
    const h = harness(room, { forfeit: new Error('db down') });
    expect(await runPermanentLeave(room.code, 'c1', null, h.deps)).toEqual({ ok: true, kind: 'takeover' });
    expect(h.spies.applyForfeit).toHaveBeenCalledTimes(1);
    expect(room.members.get('c1')).toBeUndefined();
  });

  it('a duplicate intent produces exactly ONE forfeit and ONE takeover', async () => {
    const room = startedRoom();
    const h = harness(room);
    const first = await runPermanentLeave(room.code, 'c1', 'u1', h.deps);
    const second = await runPermanentLeave(room.code, 'c1', 'u1', h.deps);
    expect(first).toEqual({ ok: true, kind: 'takeover' });
    expect(second).toEqual({ ok: false, reason: 'refused' });  // the member is gone
    expect(h.spies.applyForfeit).toHaveBeenCalledTimes(1);
    expect([...room.members.values()].filter((m) => m.type === 'ai')).toHaveLength(1);
    expect(room.onlineMatch!.forfeits).toHaveLength(1);
  });

  it("a replayed forfeit the DB reports as 'already_applied' still completes cleanly", async () => {
    const room = startedRoom();
    const h = harness(room, { forfeit: 'already_applied' });
    expect(await runPermanentLeave(room.code, 'c1', 'u1', h.deps)).toEqual({ ok: true, kind: 'takeover' });
    expect(room.onlineMatch!.forfeits).toHaveLength(1);
  });

  it('a room torn down while the DB write was in flight → accepted, no takeover attempted', async () => {
    const room = startedRoom();
    const h = harness(room, { onAfterForfeit: () => { h.rooms.delete(room.code); } });
    expect(await runPermanentLeave(room.code, 'c1', 'u1', h.deps)).toEqual({ ok: true, kind: 'already_left' });
    expect(h.spies.detachClient).not.toHaveBeenCalled();
    expect([...room.members.values()].some((m) => m.type === 'ai')).toBe(false);
  });

  it('a member that vanished while the DB write was in flight → accepted, nothing forced', async () => {
    const room = startedRoom();
    const h = harness(room, { onAfterForfeit: () => { room.members.delete('c1'); } });
    expect(await runPermanentLeave(room.code, 'c1', 'u1', h.deps)).toEqual({ ok: true, kind: 'already_left' });
    expect([...room.members.values()].some((m) => m.type === 'ai')).toBe(false);
    expect(h.spies.persist).toHaveBeenCalled();
  });
});

describe('the LAST human closes the room instead of leaving bots behind', () => {
  it('closes the room and never spawns a replacement AI', async () => {
    const room = startedRoom({ humans: 1, bots: 2 });
    const h = harness(room);
    expect(await runPermanentLeave(room.code, 'c0', 'u0', h.deps)).toEqual({ ok: true, kind: 'room_closed' });
    expect(h.calls).toEqual(['applyForfeit', 'detachClient', 'closeRoom']);
    expect(h.spies.broadcastRoom).not.toHaveBeenCalled();
    expect(h.spies.advance).not.toHaveBeenCalled();
    expect(h.rooms.has(room.code)).toBe(false);
  });

  it('a spectator still counts as a human present → the seat is taken over, not closed', async () => {
    const room = createRoom({
      code: 'SPEC', gameType: 'durak', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'P0', userId: 'u0' }, now: 1,
    });
    addMember(room, { clientId: 'sp', reconnectToken: 'tsp', name: 'Spec', role: 'spectator', userId: 'usp' });
    addBot(room, 'c0', { clientId: 'b0', reconnectToken: 'bt0' });
    expect(startGame(room, { seed: 4, now: 1 }).ok).toBe(true);
    freezeOnlineMatch(room, 'm-spec', 1)!.durable = true;
    const h = harness(room);
    h.rooms.set(room.code, room);
    expect(await runPermanentLeave(room.code, 'c0', 'u0', h.deps)).toEqual({ ok: true, kind: 'takeover' });
    expect(h.spies.closeRoom).not.toHaveBeenCalled();
  });

  it('refuses a spectator outright — no AI, no room close, no forfeit', async () => {
    const room = createRoom({
      code: 'SPC2', gameType: 'durak', playerCount: 2, modeSelectionType: 'fixed',
      host: { clientId: 'c0', reconnectToken: 't0', name: 'P0', userId: 'u0' }, now: 1,
    });
    addMember(room, { clientId: 'c1', reconnectToken: 't1', name: 'P1', userId: 'u1' });
    addMember(room, { clientId: 'sp', reconnectToken: 'tsp', name: 'Spec', role: 'spectator', userId: 'usp' });
    expect(startGame(room, { seed: 4, now: 1 }).ok).toBe(true);
    freezeOnlineMatch(room, 'm-spc2', 1)!.durable = true;
    const h = harness(room);
    h.rooms.set(room.code, room);
    expect(await runPermanentLeave(room.code, 'sp', 'usp', h.deps)).toEqual({ ok: false, reason: 'refused' });
    expect(h.spies.applyForfeit).not.toHaveBeenCalled();
    expect(h.spies.closeRoom).not.toHaveBeenCalled();
    expect([...room.members.values()].some((m) => m.type === 'ai')).toBe(false);
  });

  it('an unknown room code is refused without any side effect', async () => {
    const room = startedRoom();
    const h = harness(room);
    expect(await runPermanentLeave('NOPE', 'c1', 'u1', h.deps)).toEqual({ ok: false, reason: 'refused' });
    expect(h.calls).toEqual([]);
  });
});
