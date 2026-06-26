import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createRoom, addMember, addBot, startGame, applyTimeoutAction,
  sanitizedStateFor, actingMember, serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import type { DurakState } from '../games/durak/types';

const id = () => randomUUID();

/** A seated 3-player Durak room (host + 1 human + 1 bot). Internal only — Durak
 *  is NOT joinable online from the UI; this exercises serverCore directly. */
function durakRoom(): ServerRoom {
  const r = createRoom({
    code: 'DRK', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'ht', name: 'Host' }, gameType: 'durak', now: 1,
  });
  addMember(r, { clientId: id(), reconnectToken: id(), name: 'B' });
  addBot(r, 'host', { clientId: id(), reconnectToken: id() });
  return r;
}

describe('serverCore runs Durak internally (Stage 9.5)', () => {
  it('createRoom(gameType:durak) + startGame builds a DurakState (no King deal log)', () => {
    const r = durakRoom();
    expect(r.gameType).toBe('durak');
    const res = startGame(r, { seed: 5, now: 1 });
    expect(res.ok).toBe(true);
    const s = r.gameState as DurakState;
    expect(s.gameType).toBe('durak');
    expect(s.players).toHaveLength(3);
    expect(s.drawPile).toHaveLength(36 - 18);
    expect(r.dealLog).toHaveLength(0); // Durak skips King's deal audit
  });

  it('actingMember + applyTimeoutAction progress a Durak game via the definition', () => {
    const r = durakRoom();
    startGame(r, { seed: 5, now: 1 });
    expect(actingMember(r)).not.toBeNull();
    const before = JSON.stringify(r.gameState);
    expect(applyTimeoutAction(r).acted).toBe(true); // def.botAction through the reducer path
    expect(JSON.stringify(r.gameState)).not.toBe(before);
  });

  it('sanitizedStateFor redacts opponents for the Durak viewer (no hand leak)', () => {
    const r = durakRoom();
    startGame(r, { seed: 5, now: 1 });
    const view = sanitizedStateFor(r, 'host') as DurakState; // host = seat 0
    const me = view.players.find((p) => p.seatIndex === 0)!;
    const opp = view.players.find((p) => p.seatIndex !== 0)!;
    expect(me.hand.every((c) => c.rank !== '?')).toBe(true);  // own hand visible
    expect(opp.hand.every((c) => c.rank === '?')).toBe(true); // opponents hidden
    expect(opp.hand).toHaveLength(6);                          // count preserved
    expect(view.drawPile.every((c) => c.rank === '?')).toBe(true);
  });

  it('serialize → restore keeps the room as Durak with its state', () => {
    const r = durakRoom();
    startGame(r, { seed: 5, now: 1 });
    const restored = deserializeRoom(serializeRoom(r))!;
    expect(restored.gameType).toBe('durak');
    expect((restored.gameState as DurakState).gameType).toBe('durak');
  });
});
