// ---------------------------------------------------------------------------
// Authoritative room turn-timer (Stage 37.5). Proves the shared-deadline model:
// a deadline is minted ONLY on a real gameplay transition; reload / reconnect /
// rebroadcast keep it stable; disconnect never extends it; the substitute deadline
// starts on disconnect and cancels on reconnect; and it round-trips through storage.
// Drives the PURE serverCore helpers directly (deterministic `now` / substitute ms).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createRoom, addMember, startGame, actingMember, markDisconnected, applyTimeoutAction,
  beginTurnDeadline, resolveHumanFireAt, roomTimerInfo,
  serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';

const SUBST = 120_000; // 2 min substitute delay

/** A started 2-human Durak room (both seats human, so the actor is always a human). */
function humanRoom(timerSec: number, seed: number): ServerRoom {
  const room = createRoom({
    code: 'TMR1', gameType: 'durak', playerCount: 2, modeSelectionType: 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, turnTimerSec: timerSec, now: 0,
  });
  addMember(room, { clientId: 'c1', reconnectToken: 't1', name: 'P1' });
  expect(startGame(room, { seed, now: 0 }).ok).toBe(true);
  return room;
}

/** Client-side remaining seconds from the authoritative timer info. */
const remaining = (deadlineAt: number | null, serverNow: number) =>
  deadlineAt == null ? 0 : Math.ceil(Math.max(0, deadlineAt - serverNow) / 1000);

describe('authoritative deadline is minted only on a real transition (Stage 37.5)', () => {
  it('a 30s turn reads ~18s left after 12s — the deadline does not move', () => {
    const room = humanRoom(30, 7);
    beginTurnDeadline(room, 0); // turn begins at T=0
    expect(room.turnDeadlineAt).toBe(30_000);
    expect(room.turnTimerRevision).toBe(1);
    const info = roomTimerInfo(room, 12_000); // 12 s later
    expect(info.deadlineAt).toBe(30_000);      // UNCHANGED
    expect(info.revision).toBe(1);
    expect(remaining(info.deadlineAt, info.serverNow)).toBe(18);
  });

  it('reload / reconnect / rebroadcast (no transition) keeps the deadline + revision', () => {
    const room = humanRoom(30, 7);
    beginTurnDeadline(room, 0);
    // A rebroadcast re-arms the timer via resolveHumanFireAt WITHOUT minting a new turn.
    for (const t of [5_000, 12_000, 20_000]) {
      const fire = resolveHumanFireAt(room, t, SUBST);
      expect(fire).toBe(30_000);              // same absolute deadline every time
      expect(room.turnDeadlineAt).toBe(30_000);
      expect(room.turnTimerRevision).toBe(1); // never bumped by a rebroadcast
    }
  });

  it('a real transition mints a new revision + a full fresh deadline', () => {
    const room = humanRoom(30, 7);
    beginTurnDeadline(room, 0);
    beginTurnDeadline(room, 40_000); // the next turn begins at T=40s
    expect(room.turnTimerRevision).toBe(2);
    expect(room.turnDeadlineAt).toBe(70_000);
  });

  it('disconnecting the acting player does NOT extend the room deadline', () => {
    const room = humanRoom(30, 7);
    beginTurnDeadline(room, 0);
    const acting = actingMember(room)!;
    markDisconnected(room, acting.clientId);
    // Room timer on → the deadline governs regardless of connection (no substitute delay).
    expect(resolveHumanFireAt(room, 5_000, SUBST)).toBe(30_000);
    expect(room.turnDeadlineAt).toBe(30_000);
    expect(room.substituteDeadlineAt).toBeNull();
  });
});

describe('timer OFF + disconnect → a stable substitute deadline (Stage 37.5)', () => {
  it('starts once on disconnect, stays stable across rebroadcasts, cancels on reconnect', () => {
    const room = humanRoom(0, 9); // timer OFF
    beginTurnDeadline(room, 0);
    expect(room.turnDeadlineAt).toBeNull();               // no room deadline when off
    const acting = actingMember(room)!;
    // Connected + off → no auto-action.
    expect(resolveHumanFireAt(room, 1_000, SUBST)).toBeNull();
    // Disconnect → a substitute deadline starts.
    markDisconnected(room, acting.clientId);
    const fire = resolveHumanFireAt(room, 10_000, SUBST);
    expect(fire).toBe(10_000 + SUBST);
    // A later rebroadcast keeps the SAME substitute deadline (does not restart it).
    expect(resolveHumanFireAt(room, 50_000, SUBST)).toBe(10_000 + SUBST);
    // Reconnect → the substitute is cancelled.
    room.members.get(acting.clientId)!.connected = true;
    expect(resolveHumanFireAt(room, 60_000, SUBST)).toBeNull();
    expect(room.substituteDeadlineAt).toBeNull();
  });

  it('the client-visible timer never exposes the server-only substitute deadline', () => {
    const room = humanRoom(0, 9);
    beginTurnDeadline(room, 0);
    markDisconnected(room, actingMember(room)!.clientId);
    resolveHumanFireAt(room, 0, SUBST); // sets substituteDeadlineAt
    const info = roomTimerInfo(room, 0);
    expect(info.deadlineAt).toBeNull(); // substitute is NOT surfaced (timer off → no countdown)
  });
});

describe('storage round-trip + restore (Stage 37.5)', () => {
  it('persists and restores the deadline + revision + substitute', () => {
    const room = humanRoom(60, 11);
    beginTurnDeadline(room, 1_000);
    const restored = deserializeRoom(serializeRoom(room))!;
    expect(restored.turnDeadlineAt).toBe(61_000);
    expect(restored.turnTimerRevision).toBe(1);
    expect(restored.substituteDeadlineAt).toBeNull();
  });

  it('a FUTURE persisted deadline schedules only the remaining time', () => {
    const room = humanRoom(60, 11);
    beginTurnDeadline(room, 1_000); // deadline 61_000
    const restored = deserializeRoom(serializeRoom(room))!;
    // On restore the acting human is disconnected, but the room timer still governs.
    const fire = resolveHumanFireAt(restored, 55_000, SUBST);
    expect(fire).toBe(61_000);                       // the same absolute deadline
    expect(Math.max(0, fire! - 55_000)).toBe(6_000); // only 6 s remain
  });

  it('an EXPIRED persisted deadline resolves immediately (0 remaining)', () => {
    const room = humanRoom(30, 11);
    beginTurnDeadline(room, 0); // deadline 30_000
    const restored = deserializeRoom(serializeRoom(room))!;
    const fire = resolveHumanFireAt(restored, 90_000, SUBST); // 90 s later → past
    expect(fire).toBe(30_000);
    expect(Math.max(0, fire! - 90_000)).toBe(0); // fires on the next tick
  });

  it('a legacy persisted room without timer metadata restores without crashing', () => {
    const room = humanRoom(30, 11);
    const persisted = serializeRoom(room) as Record<string, unknown>;
    delete persisted.turnTimerRevision;
    delete persisted.turnDeadlineAt;
    delete persisted.substituteDeadlineAt;
    const restored = deserializeRoom(persisted)!;
    expect(restored).not.toBeNull();
    expect(restored.turnTimerRevision).toBe(0);
    expect(restored.turnDeadlineAt).toBeNull();
    expect(restored.substituteDeadlineAt).toBeNull();
  });
});

describe('stale-callback guard + one-shot timeout (Stage 37.5)', () => {
  it('a captured revision from a prior turn no longer matches after a real transition', () => {
    const room = humanRoom(30, 7);
    beginTurnDeadline(room, 0);
    const revisionAtArm = room.turnTimerRevision; // what a scheduled callback captured
    // The turn's timeout fires: it applies ONE legal auto-action and begins the next turn.
    expect(applyTimeoutAction(room).acted).toBe(true);
    beginTurnDeadline(room, 30_000);
    // The new turn has a NEW revision, so the old callback's guard (captured !== current)
    // would make it a no-op — it can never act in the new turn.
    expect(room.turnTimerRevision).not.toBe(revisionAtArm);
    expect(room.turnTimerRevision).toBe(revisionAtArm + 1);
  });

  it('the timeout applies exactly one action (state advances a single step)', () => {
    const room = humanRoom(30, 7);
    beginTurnDeadline(room, 0);
    const before = JSON.stringify(room.gameState);
    const actorBefore = actingMember(room)!.seatIndex;
    expect(applyTimeoutAction(room).acted).toBe(true);
    expect(JSON.stringify(room.gameState)).not.toBe(before); // moved
    // The actor changed (a single turn was consumed, not a loop of moves).
    expect(actingMember(room)?.seatIndex).not.toBe(actorBefore);
  });
});
