import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createRoom, addMember, addBot, markDisconnected, reconnectMember,
  recomputeOrphan, hasConnectedHuman, roomsToExpire, substituteDelayMs,
  type ServerRoom, type ServerMember,
} from './serverCore';

const id = () => randomUUID();

function roomWithHost(opts: { turnTimerSec?: number } = {}): ServerRoom {
  return createRoom({
    code: 'ABCD', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'host-tok', name: 'Host' },
    turnTimerSec: opts.turnTimerSec, now: 1000,
  });
}

describe('recomputeOrphan', () => {
  it('is null while a human is connected', () => {
    const r = roomWithHost();
    recomputeOrphan(r, 5000);
    expect(r.orphanSince).toBeNull();
    expect(hasConnectedHuman(r)).toBe(true);
  });

  it('sets orphanSince when the last connected human leaves (bots do not count)', () => {
    const r = roomWithHost();
    addBot(r, 'host', { clientId: id(), reconnectToken: id() }); // a bot stays "present"
    markDisconnected(r, 'host');
    recomputeOrphan(r, 7000);
    expect(hasConnectedHuman(r)).toBe(false);
    expect(r.orphanSince).toBe(7000);
  });

  it('keeps the original orphan timestamp while it stays orphaned', () => {
    const r = roomWithHost();
    markDisconnected(r, 'host');
    recomputeOrphan(r, 7000);
    recomputeOrphan(r, 9999); // still no human → must NOT reset the countdown
    expect(r.orphanSince).toBe(7000);
  });

  it('clears orphanSince the moment a human reconnects', () => {
    const r = roomWithHost();
    markDisconnected(r, 'host');
    recomputeOrphan(r, 7000);
    expect(r.orphanSince).toBe(7000);
    reconnectMember(r, 'host-tok');
    recomputeOrphan(r, 8000);
    expect(r.orphanSince).toBeNull();
  });

  it('a new human joining clears the orphan timer', () => {
    const r = roomWithHost();
    markDisconnected(r, 'host');
    recomputeOrphan(r, 7000);
    addMember(r, { clientId: id(), reconnectToken: id(), name: 'Late' });
    recomputeOrphan(r, 8000);
    expect(r.orphanSince).toBeNull();
  });
});

describe('roomsToExpire — orphan TTL', () => {
  const NOW = 1_000_000;
  const TTL = 24 * 3600_000, HARD = 48 * 3600_000, ORPHAN = 15 * 60_000;

  function orphanRoom(code: string, orphanSince: number): ServerRoom {
    const r = createRoom({ code, playerCount: 3, modeSelectionType: 'fixed',
      host: { clientId: 'h', reconnectToken: 't', name: 'H' }, now: NOW });
    markDisconnected(r, 'h');
    r.orphanSince = orphanSince;
    r.updatedAt = NOW; // freshly persisted → not idle-expired
    return r;
  }

  it('deletes an orphan room after the 15-minute orphan TTL', () => {
    const old = orphanRoom('OLD', NOW - ORPHAN - 1);
    const young = orphanRoom('YNG', NOW - 5 * 60_000); // orphaned 5 min ago
    expect(roomsToExpire([old, young], NOW, TTL, HARD, ORPHAN)).toEqual(['OLD']);
  });

  it('keeps a room that still has a connected human (not an orphan)', () => {
    const active = createRoom({ code: 'ACT', playerCount: 3, modeSelectionType: 'fixed',
      host: { clientId: 'h', reconnectToken: 't', name: 'H' }, now: NOW });
    active.updatedAt = NOW;
    expect(roomsToExpire([active], NOW, TTL, HARD, ORPHAN)).toEqual([]);
  });

  it('reconnect before the TTL preserves the room (orphan cleared)', () => {
    const r = orphanRoom('RJN', NOW - ORPHAN - 1);
    reconnectMember(r, 't');
    recomputeOrphan(r, NOW);
    expect(roomsToExpire([r], NOW, TTL, HARD, ORPHAN)).toEqual([]);
  });
});

describe('substituteDelayMs — precedence rule', () => {
  const SUB = 120_000;
  const human = (over: Partial<ServerMember> = {}): ServerMember => ({
    clientId: 'x', reconnectToken: 'x', name: 'X', role: 'player', seatIndex: 0,
    isHost: false, connected: true, type: 'human', avatar: '😀', ...over,
  });

  it('connected human, no room timer → wait (null)', () => {
    expect(substituteDelayMs(human({ connected: true }), roomWithHost({ turnTimerSec: 0 }), SUB)).toBeNull();
  });
  it('connected human + room timer → the room timer', () => {
    expect(substituteDelayMs(human({ connected: true }), roomWithHost({ turnTimerSec: 60 }), SUB)).toBe(60_000);
  });
  it('disconnected human, no timer → substitute delay', () => {
    expect(substituteDelayMs(human({ connected: false }), roomWithHost({ turnTimerSec: 0 }), SUB)).toBe(SUB);
  });
  it('disconnected human + shorter room timer → the shorter timer', () => {
    expect(substituteDelayMs(human({ connected: false }), roomWithHost({ turnTimerSec: 30 }), SUB)).toBe(30_000);
  });
  it('disconnected human + timer longer than substitute → the substitute delay', () => {
    expect(substituteDelayMs(human({ connected: false }), roomWithHost({ turnTimerSec: 90 }), 5_000)).toBe(5_000);
  });
  it('bots / null are never substituted here', () => {
    expect(substituteDelayMs(human({ type: 'ai' }), roomWithHost({ turnTimerSec: 60 }), SUB)).toBeNull();
    expect(substituteDelayMs(null, roomWithHost(), SUB)).toBeNull();
  });
});
