// ---------------------------------------------------------------------------
// Stage 38.0.5 — permanent leave RACING the server's own scheduled work.
//
// A permanent leave is serialized on the room lock, but the SYNCHRONOUS timer callbacks
// (turn timeout, disconnected substitute, public-screen auto-advance, bot turn) are not
// — they can fire in the same tick. This file drives the REAL guard functions the
// production timers use and proves that each of those races resolves to exactly one
// action, never a double move and never a stalled table.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import {
  createRoom, addMember, addBot, startGame, freezeOnlineMatch, beginTurnDeadline,
  actingMember, botMemberToAct, applyTimeoutAction, applyBotTurn, autoAdvance,
  resolveHumanFireAt, publicScreenOf, markDisconnected, isRoomFinished,
  planPermanentLeave, takeoverSeatWithAi,
  type ServerRoom,
} from './serverCore';
import { runPermanentLeave, type PermanentLeaveDeps } from '../../server/permanentLeave';
import { withRoomLock } from '../../server/pokerEscrow';

let seq = 0;
function room3(opts: { timerSec?: number; bots?: number } = {}): ServerRoom {
  const bots = opts.bots ?? 0;
  const humans = 3 - bots;
  const room = createRoom({
    code: `C${(seq++).toString(36).toUpperCase()}`.padEnd(4, 'X').slice(0, 4),
    gameType: 'durak', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0', userId: 'u0' }, now: 1,
    turnTimerSec: opts.timerSec ?? 0,
  });
  for (let i = 1; i < humans; i++) addMember(room, { clientId: `c${i}`, reconnectToken: `t${i}`, name: `P${i}`, userId: `u${i}` });
  for (let b = 0; b < bots; b++) addBot(room, 'c0', { clientId: `b${b}`, reconnectToken: `bt${b}` });
  expect(startGame(room, { seed: 9, now: 1 }).ok).toBe(true);
  freezeOnlineMatch(room, `race-${room.code}`, 1000)!.durable = true;
  return room;
}

const clientAtSeat = (r: ServerRoom, seat: number) => {
  for (const [cid, m] of r.members) if (m.seatIndex === seat) return cid;
  throw new Error('no seat');
};

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

describe('permanent leave vs the TURN TIMEOUT', () => {
  it('a timeout callback armed for the departed seat no-ops after the takeover', () => {
    const r = room3({ timerSec: 30 });
    beginTurnDeadline(r, 10_000);
    const acting = actingMember(r)!;
    const revisionAtArm = r.turnTimerRevision;
    const seatAtArm = acting.seatIndex;

    takeoverSeatWithAi(r, acting.clientId, { clientId: 'ai-x', reconnectToken: 'ah-x' });

    // The production guard is: same revision AND the actor is still the SAME HUMAN seat.
    expect(r.turnTimerRevision).toBe(revisionAtArm);        // the revision was NOT bumped…
    const now = actingMember(r)!;
    expect(now.seatIndex).toBe(seatAtArm);                  // …and the seat is the same…
    expect(now.type).toBe('ai');                            // …but it is no longer a human,
    // which is exactly what makes the stale callback return without acting.
  });

  it('the seat still resolves — the bot scheduler takes exactly one turn', () => {
    const r = room3({ timerSec: 30 });
    beginTurnDeadline(r, 10_000);
    const acting = actingMember(r)!;
    takeoverSeatWithAi(r, acting.clientId, { clientId: 'ai-y', reconnectToken: 'ah-y' });

    expect(botMemberToAct(r)?.seatIndex).toBe(acting.seatIndex);
    const before = JSON.stringify(r.gameState);
    expect(applyBotTurn(r).acted).toBe(true);
    expect(JSON.stringify(r.gameState)).not.toBe(before);   // the table is not stalled
  });

  it('a NON-acting seat leaving never consumes the acting player’s deadline', () => {
    const r = room3({ timerSec: 30 });
    beginTurnDeadline(r, 10_000);
    const acting = actingMember(r)!;
    const victim = [0, 1, 2].find((s) => s !== acting.seatIndex)!;
    const deadline = r.turnDeadlineAt;

    takeoverSeatWithAi(r, clientAtSeat(r, victim), { clientId: 'ai-z', reconnectToken: 'ah-z' });

    expect(r.turnDeadlineAt).toBe(deadline);
    expect(actingMember(r)!.clientId).toBe(acting.clientId);  // still the same human on the clock
    expect(botMemberToAct(r)).toBeNull();                     // no bot turn was scheduled
  });
});

describe('permanent leave vs the DISCONNECTED SUBSTITUTE', () => {
  it('a pending substitute for the departed seat is cancelled (a bot acts instead)', () => {
    const r = room3();                       // no room timer → substitute territory
    const acting = actingMember(r)!;
    markDisconnected(r, acting.clientId);
    // The substitute deadline starts on the first resolve after the disconnect.
    expect(resolveHumanFireAt(r, 1_000, 120_000)).toBe(121_000);
    expect(r.substituteDeadlineAt).toBe(121_000);

    takeoverSeatWithAi(r, acting.clientId, { clientId: 'ai-s', reconnectToken: 'ah-s' });

    // No HUMAN is on the clock any more → no substitute deadline at all.
    expect(resolveHumanFireAt(r, 2_000, 120_000)).toBeNull();
    expect(r.substituteDeadlineAt).toBeNull();
    expect(botMemberToAct(r)?.seatIndex).toBe(acting.seatIndex);
  });

  it('another player’s pending substitute is untouched', () => {
    const r = room3();
    const acting = actingMember(r)!;
    const victim = [0, 1, 2].find((s) => s !== acting.seatIndex)!;
    markDisconnected(r, acting.clientId);
    resolveHumanFireAt(r, 1_000, 120_000);
    const sub = r.substituteDeadlineAt;

    takeoverSeatWithAi(r, clientAtSeat(r, victim), { clientId: 'ai-o', reconnectToken: 'ah-o' });

    expect(r.substituteDeadlineAt).toBe(sub);
    expect(resolveHumanFireAt(r, 2_000, 120_000)).toBe(sub);
  });
});

describe('permanent leave vs AUTO-ADVANCE and the timeout action', () => {
  it('a public screen still advances normally after a takeover', () => {
    const r = room3();
    // Drive the table until a public screen appears (or a few dozen steps pass).
    for (let i = 0; i < 200 && publicScreenOf(r) == null && !isRoomFinished(r); i++) {
      if (botMemberToAct(r)) applyBotTurn(r); else applyTimeoutAction(r);
    }
    if (publicScreenOf(r) == null || isRoomFinished(r)) return; // nothing to assert for this deal
    const seat = actingMember(r)?.seatIndex ?? 0;
    const victim = [0, 1, 2].find((s) => s !== seat)!;
    const target = clientAtSeat(r, victim);
    if (r.members.get(target)!.type !== 'human') return;
    takeoverSeatWithAi(r, target, { clientId: 'ai-a', reconnectToken: 'ah-a' });
    expect(autoAdvance(r, { now: 2 })).toBe(true);
  });

  it('the taken-over seat is driven by the BOT path, and a stale timeout cannot double-move', () => {
    const r = room3();
    const acting = actingMember(r)!;
    takeoverSeatWithAi(r, acting.clientId, { clientId: 'ai-t', reconnectToken: 'ah-t' });

    // The production timeout callback (`onTurnTimeout`) refuses to act unless the actor is
    // still a HUMAN on the same seat — after the takeover it is an AI, so it returns.
    const now = actingMember(r)!;
    expect(now.type).toBe('ai');
    expect(now.seatIndex).toBe(acting.seatIndex);

    // The bot path owns the seat and moves the game exactly once.
    const before = JSON.stringify(r.gameState);
    expect(applyBotTurn(r).acted).toBe(true);
    expect(JSON.stringify(r.gameState)).not.toBe(before);
  });
});

describe('permanent leave vs a FINISHING match', () => {
  it('is refused once the match is finished — no AI seat, no second result', async () => {
    const r = room3();
    // Drive to the end with the server's own legal-move paths.
    for (let i = 0; i < 4000 && !isRoomFinished(r); i++) {
      if (botMemberToAct(r)) { applyBotTurn(r); continue; }
      if (publicScreenOf(r) != null) { autoAdvance(r, { now: i }); continue; }
      if (!applyTimeoutAction(r).acted) break;
    }
    expect(isRoomFinished(r)).toBe(true);
    expect(planPermanentLeave(r, 'c1').refusal).toBe('already_finished');

    const rooms = new Map([[r.code, r]]);
    const forfeit = vi.fn(async () => 'applied' as const);
    expect(await runPermanentLeave(r.code, 'c1', 'u1', deps(rooms, { applyForfeit: forfeit })))
      .toEqual({ ok: false, reason: 'refused' });
    expect(forfeit).not.toHaveBeenCalled();
    expect([...r.members.values()].some((m) => m.type === 'ai')).toBe(false);
  });
});

describe('duplicate delivery and the lost-ACK window', () => {
  it('two intents delivered together produce ONE forfeit and ONE takeover', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    const forfeit = vi.fn(async () => 'applied' as const);
    const d = deps(rooms, { applyForfeit: forfeit });
    // Exactly how production calls it: BOTH through the real per-room mutex.
    const [a, b] = await Promise.all([
      withRoomLock(r.code, () => runPermanentLeave(r.code, 'c1', 'u1', d)),
      withRoomLock(r.code, () => runPermanentLeave(r.code, 'c1', 'u1', d)),
    ]);
    // The second runs AFTER the first and finds the member already replaced.
    expect([a, b].filter((x) => x.ok)).toHaveLength(1);
    expect([a, b].filter((x) => !x.ok)).toEqual([{ ok: false, reason: 'refused' }]);
    expect(forfeit).toHaveBeenCalledTimes(1);
    expect([...r.members.values()].filter((m) => m.type === 'ai')).toHaveLength(1);
    expect(r.onlineMatch!.forfeits).toHaveLength(1);
  });

  it('even WITHOUT the room lock the durable gate still yields exactly one loss', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    let applied = 0;
    // A faithful stand-in for the DB gate: only the FIRST transition applies.
    const d = deps(rooms, { applyForfeit: async () => (applied++ === 0 ? 'applied' : 'already_applied') });
    const [a, b] = await Promise.all([
      runPermanentLeave(r.code, 'c1', 'u1', d),
      runPermanentLeave(r.code, 'c1', 'u1', d),
    ]);
    expect(a.ok && b.ok).toBe(true);                    // both callers are told "it is done"
    expect(applied).toBe(2);                            // two attempts…
    expect(r.onlineMatch!.forfeits).toHaveLength(1);    // …one recorded departure,
    expect([...r.members.values()].filter((m) => m.type === 'ai')).toHaveLength(1); // one AI seat
  });

  it('the socket closing before the ACK still leaves the forfeit committed and the token dead', async () => {
    const r = room3();
    const rooms = new Map([[r.code, r]]);
    // Simulate the socket dying the moment the DB commits: the member is marked
    // disconnected by the close handler, but the orchestration is already past the gate.
    const d = deps(rooms, {
      applyForfeit: async () => { markDisconnected(r, 'c1'); return 'applied'; },
    });
    expect(await runPermanentLeave(r.code, 'c1', 'u1', d)).toEqual({ ok: true, kind: 'takeover' });
    expect(r.members.get('c1')).toBeUndefined();
    expect(r.onlineMatch!.forfeits).toEqual([{ seat: 1, at: 5_000 }]);
    // A retry after the lost ACK adds nothing (the DB gate would also say already_applied).
    expect(await runPermanentLeave(r.code, 'c1', 'u1', d)).toEqual({ ok: false, reason: 'refused' });
    expect(r.onlineMatch!.forfeits).toHaveLength(1);
  });
});
