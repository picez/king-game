// ---------------------------------------------------------------------------
// Stage 38.0.5.1 — the permanent-leave FINISH-DURING-DB-AWAIT race.
//
// RED (reproduced against the 38.0.5 code before the fix):
//   1. an ACTIVE human-only match is running;
//   2. `applyForfeit` COMMITS the durable technical loss;
//   3. inside that same await window a timer/auto-advance drives the match to FINISHED
//      (nothing is removed from `room.members` — a finish never touches membership);
//   4. the orchestration re-validated the room with the FULL pre-commit contract, so the
//      recheck answered `already_finished`;
//   5. it therefore returned `{ ok: true, kind: 'already_left' }` → `handlePermanentLeave`
//      sent `PERMANENT_LEAVE_ACCEPTED` → the client cleared its session…
//   6. …while the human member, its reconnect token and its reclaimable account were ALL
//      still in the room, and NO replacement AI was ever created.
//   The ACK contract says the opposite: an ACK means the departure is COMPLETE.
//
// These tests pin the corrected lifecycle: after a committed forfeit the identity
// teardown is MANDATORY, and only a genuine seat/account mismatch may stop it.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, freezeOnlineMatch,
  applyBotTurn, applyTimeoutAction, autoAdvance, publicScreenOf, isRoomFinished,
  botMemberToAct, reconnectMember, reclaimMemberByUserId, findUserRoomCodes,
  planPermanentLeave, planPermanentLeaveTakeover, takeoverSeatAfterForfeit,
  type ServerRoom,
} from './serverCore';
import { runPermanentLeave, type PermanentLeaveDeps } from '../../server/permanentLeave';

let seq = 0;
/** A 3-seat human-only Durak room with a frozen, already-durable match. */
function room3(bots = 0): ServerRoom {
  const humans = 3 - bots;
  const room = createRoom({
    code: `F${(seq++).toString(36).toUpperCase()}`.padEnd(4, 'X').slice(0, 4),
    gameType: 'durak', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0', userId: 'u0' }, now: 1,
  });
  for (let i = 1; i < humans; i++) {
    addMember(room, { clientId: `c${i}`, reconnectToken: `t${i}`, name: `P${i}`, userId: `u${i}` });
  }
  for (let b = 0; b < bots; b++) addBot(room, 'c0', { clientId: `b${b}`, reconnectToken: `bt${b}` });
  expect(startGame(room, { seed: 9, now: 1 }).ok).toBe(true);
  freezeOnlineMatch(room, `race-${room.code}`, 1000)!.durable = true;
  return room;
}

/** Drive the match to its terminal state with the server's own legal paths only. */
function driveToFinish(r: ServerRoom): void {
  for (let i = 0; i < 4000 && !isRoomFinished(r); i++) {
    if (botMemberToAct(r)) { applyBotTurn(r); continue; }
    if (publicScreenOf(r) != null) { autoAdvance(r, { now: i }); continue; }
    if (!applyTimeoutAction(r).acted) break;
  }
  expect(isRoomFinished(r)).toBe(true);
}

/** What `FIND_MY_ROOMS` would list for this account. */
const codesFor = (rooms: Map<string, ServerRoom>, userId: string): string[] =>
  findUserRoomCodes(rooms.values(), userId).map((x) => x.code);

function deps(rooms: Map<string, ServerRoom>, over: Partial<PermanentLeaveDeps> = {}): PermanentLeaveDeps {
  let n = 0;
  return {
    rooms,
    dbEnabled: () => true,
    ensureDurableMatch: async () => 'already_exists',
    applyForfeit: async () => 'applied',
    detachClient: () => {},
    closeRoom: (r) => { rooms.delete(r.code); },
    persist: () => {},
    broadcastRoom: () => {},
    advance: () => {},
    newIds: () => ({ clientId: `ai-${n}`, reconnectToken: `ah-${n++}` }),
    now: () => 5_000,
    ...over,
  };
}

describe('a match FINISHING inside the DB-await window', () => {
  it('still completes the identity teardown — the ACK never outruns it', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    // The RED seam: the durable loss commits, and the match becomes FINISHED before the
    // orchestration regains control. `driveToFinish` removes nothing from `room.members`.
    const forfeit = vi.fn(async () => { driveToFinish(r); return 'applied' as const; });

    const res = await runPermanentLeave(r.code, 'c1', 'u1', deps(rooms, { applyForfeit: forfeit }));

    expect(forfeit).toHaveBeenCalledTimes(1);
    // Baseline returned { ok: true, kind: 'already_left' } and changed NOTHING here.
    expect(res).toEqual({ ok: true, kind: 'takeover' });
    expect(r.members.get('c1')).toBeUndefined();                       // the member is gone
    expect([...r.members.values()].filter((m) => m.type === 'ai')).toHaveLength(1);
    expect(r.onlineMatch!.forfeits).toEqual([{ seat: 1, at: 5_000 }]);
  });

  it('the old reconnect identity is annulled (RECONNECT / RECLAIM / FIND_MY_ROOMS)', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    // Prove the identity WORKS first, so the assertions below are about the teardown.
    expect(reconnectMember(r, 't1')?.clientId).toBe('c1');
    expect(reclaimMemberByUserId(r, 'u1')?.clientId).toBe('c1');
    expect(codesFor(rooms, 'u1')).toContain(r.code);

    await runPermanentLeave(r.code, 'c1', 'u1',
      deps(rooms, { applyForfeit: async () => { driveToFinish(r); return 'applied'; } }));

    expect(reconnectMember(r, 't1')).toBeNull();
    expect(reclaimMemberByUserId(r, 'u1')).toBeNull();
    expect(codesFor(rooms, 'u1')).not.toContain(r.code);
  });

  it('the AI takes the SAME seat, and no move is driven after the terminal state', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    const seatBefore = r.members.get('c1')!.seatIndex;
    const advance = vi.fn();

    await runPermanentLeave(r.code, 'c1', 'u1', deps(rooms, {
      applyForfeit: async () => { driveToFinish(r); return 'applied'; }, advance,
    }));

    const bot = [...r.members.values()].find((m) => m.type === 'ai')!;
    expect(bot.seatIndex).toBe(seatBefore);
    expect(bot.userId).toBeNull();
    // A finished match is settled: never re-driven, never re-armed, never a bot move.
    expect(advance).not.toHaveBeenCalled();
    expect(botMemberToAct(r)).toBeNull();
  });

  it('the finish does not rewrite the forfeit, and a retry adds no second loss', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    let applied = 0;
    // A faithful stand-in for the durable gate: only the FIRST transition applies.
    const d = deps(rooms, {
      applyForfeit: async () => {
        if (applied === 0) driveToFinish(r);
        return applied++ === 0 ? 'applied' : 'already_applied';
      },
    });
    expect(await runPermanentLeave(r.code, 'c1', 'u1', d)).toEqual({ ok: true, kind: 'takeover' });
    // A retry after a lost ACK: the member is already gone → refused, nothing repeated.
    expect(await runPermanentLeave(r.code, 'c1', 'u1', d)).toEqual({ ok: false, reason: 'refused' });
    expect(r.onlineMatch!.forfeits).toHaveLength(1);
    expect([...r.members.values()].filter((m) => m.type === 'ai')).toHaveLength(1);
  });

  it('closes the room when the leaver was the LAST human, even on a finished match', async () => {
    const r = room3(2);                       // 1 human + 2 bots
    const rooms = new Map([[r.code, r]]);
    const closed = vi.fn((room: ServerRoom) => { rooms.delete(room.code); });

    const res = await runPermanentLeave(r.code, 'c0', 'u0', deps(rooms, {
      applyForfeit: async () => { driveToFinish(r); return 'applied'; }, closeRoom: closed,
    }));

    expect(res).toEqual({ ok: true, kind: 'room_closed' });
    expect(closed).toHaveBeenCalledTimes(1);
    expect(rooms.get(r.code)).toBeUndefined();
  });

  it('an ALREADY-finished table is still refused BEFORE any DB write', async () => {
    const r = room3();
    driveToFinish(r);
    expect(planPermanentLeave(r, 'c1').refusal).toBe('already_finished');
    const rooms = new Map([[r.code, r]]);
    const forfeit = vi.fn(async () => 'applied' as const);
    expect(await runPermanentLeave(r.code, 'c1', 'u1', deps(rooms, { applyForfeit: forfeit })))
      .toEqual({ ok: false, reason: 'refused' });
    expect(forfeit).not.toHaveBeenCalled();
    expect(r.members.get('c1')).toBeDefined();      // nothing changed
  });
});

describe('other things that can happen during the DB await', () => {
  it('a TRANSIENT DB failure changes nothing at all (retryable)', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    const res = await runPermanentLeave(r.code, 'c1', 'u1', deps(rooms, {
      applyForfeit: async () => { throw new Error('timeout'); },
    }));
    expect(res).toEqual({ ok: false, reason: 'retryable' });
    expect(r.members.get('c1')).toBeDefined();
    expect(reconnectMember(r, 't1')?.clientId).toBe('c1');
    expect(r.onlineMatch!.forfeits).toHaveLength(0);
  });

  it('the room being DELETED mid-await is an honest success (nothing to resume)', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    const res = await runPermanentLeave(r.code, 'c1', 'u1', deps(rooms, {
      applyForfeit: async () => { rooms.delete(r.code); return 'applied'; },
    }));
    expect(res).toEqual({ ok: true, kind: 'already_left' });
    expect(codesFor(rooms, 'u1')).toEqual([]);
  });

  it('the member being GENUINELY replaced by another identity fails CLOSED', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    // Someone else now holds this clientId (only reachable through a corrupted restore).
    const res = await runPermanentLeave(r.code, 'c1', 'u1', deps(rooms, {
      applyForfeit: async () => { r.members.get('c1')!.userId = 'someone-else'; return 'applied'; },
    }));
    expect(res).toEqual({ ok: false, reason: 'refused' });          // NO ACK
    expect(r.members.get('c1')!.type).toBe('human');                // innocent seat untouched
    expect([...r.members.values()].some((m) => m.type === 'ai')).toBe(false);
  });

  it('the SEAT moving under us fails CLOSED too', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    const res = await runPermanentLeave(r.code, 'c1', 'u1', deps(rooms, {
      applyForfeit: async () => { r.members.get('c1')!.seatIndex = 2; return 'applied'; },
    }));
    expect(res).toEqual({ ok: false, reason: 'refused' });
    expect([...r.members.values()].some((m) => m.type === 'ai')).toBe(false);
  });

  it('the member vanishing mid-await is an honest success (identity already annulled)', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    const res = await runPermanentLeave(r.code, 'c1', 'u1', deps(rooms, {
      applyForfeit: async () => { r.members.delete('c1'); return 'applied'; },
    }));
    expect(res).toEqual({ ok: true, kind: 'already_left' });
    expect(reconnectMember(r, 't1')).toBeNull();
  });
});

describe('the post-commit plan checks IDENTITY, never gameplay', () => {
  it('accepts a FINISHED match (the pre-commit plan does not)', () => {
    const r = room3();
    driveToFinish(r);
    expect(planPermanentLeave(r, 'c1').ok).toBe(false);
    expect(planPermanentLeaveTakeover(r, 'c1', { seatIndex: 1, userId: 'u1' }).ok).toBe(true);
  });

  it('reports each mismatch distinctly, and `not_a_member` alone means "already gone"', () => {
    const r = room3();
    expect(planPermanentLeaveTakeover(r, 'nope', { seatIndex: 1, userId: 'u1' }).refusal).toBe('not_a_member');
    expect(planPermanentLeaveTakeover(r, 'c1', { seatIndex: 2, userId: 'u1' }).refusal).toBe('seat_changed');
    expect(planPermanentLeaveTakeover(r, 'c1', { seatIndex: 1, userId: 'other' }).refusal).toBe('account_changed');
    const withBot = room3(1);                       // seat 2 is an AI
    const botId = [...withBot.members.values()].find((m) => m.type === 'ai')!.clientId;
    expect(planPermanentLeaveTakeover(withBot, botId, { seatIndex: 2, userId: null }).refusal).toBe('not_human');
  });

  it('the post-commit takeover never re-numbers seats and never touches gameState', () => {
    const r = room3();
    driveToFinish(r);
    const seats = [...r.members.values()].map((m) => m.seatIndex);
    const stateBefore = JSON.stringify(r.gameState);

    const out = takeoverSeatAfterForfeit(r, 'c1', { clientId: 'ai-1', reconnectToken: 'ah-1' },
      { seatIndex: 1, userId: 'u1' });

    expect(out.ok).toBe(true);
    expect([...r.members.values()].map((m) => m.seatIndex)).toEqual(seats);
    expect(JSON.stringify(r.gameState)).toBe(stateBefore);
  });
});
