import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createRoom, addMember, addBot, startGame, serializeRoom, deserializeRoom,
  roomSummary, snapshot, applyTimeoutAction, botAction, type ServerRoom,
} from './serverCore';
import { gameReducer } from '../core/gameEngine';
import { buildStartAction } from './online';
import { makeRng } from '../core/rng';

const id = () => randomUUID();

function room3(): ServerRoom {
  const r = createRoom({
    code: 'ABCD', playerCount: 3, modeSelectionType: 'fixed',
    host: { clientId: 'h', reconnectToken: 't', name: 'H' }, now: 1,
  });
  addMember(r, { clientId: id(), reconnectToken: id(), name: 'B' });
  addBot(r, 'h', { clientId: id(), reconnectToken: id() });
  return r;
}

describe('gameType wiring (Stage 8.5)', () => {
  it('createRoom defaults gameType to king', () => {
    expect(room3().gameType).toBe('king');
  });

  it('roomSummary reports the room gameType (king)', () => {
    expect(roomSummary(room3()).gameType).toBe('king');
  });

  it('serialize → deserialize preserves gameType', () => {
    const persisted = serializeRoom(room3());
    expect(persisted.gameType).toBe('king');
    const restored = deserializeRoom(persisted)!;
    expect(restored.gameType).toBe('king');
  });

  it('a legacy persisted room WITHOUT gameType restores as king', () => {
    const persisted = serializeRoom(room3()) as Record<string, unknown>;
    delete persisted.gameType;            // simulate a save from before Stage 8.5
    const restored = deserializeRoom(persisted)!;
    expect(restored.gameType).toBe('king');
  });

  it('an unknown persisted gameType falls back to king', () => {
    const persisted = serializeRoom(room3()) as Record<string, unknown>;
    persisted.gameType = 'chess';
    expect(deserializeRoom(persisted)!.gameType).toBe('king');
  });

  it('startGame via the definition creates the SAME King state as the raw reducer', () => {
    const r = room3();
    // Reference state from the raw King path (def.reducer === gameReducer,
    // def.buildStartAction === buildStartAction), same seed + same snapshot.
    const expected = gameReducer(null, buildStartAction(snapshot(r)), { rng: makeRng(42) });
    const res = startGame(r, { seed: 42, now: 1 });
    expect(res.ok).toBe(true);
    expect(r.started).toBe(true);
    expect(r.gameState).toEqual(expected);
    // Stage 13.6: the two humans keep their names; the bot has a varied " AI" identity.
    const names = r.gameState!.players.map((p) => p.name);
    expect(names.slice(0, 2)).toEqual(['H', 'B']);
    expect(names[2].endsWith(' AI')).toBe(true);
    expect(names[2]).not.toMatch(/^Bot \d+$/);
  });

  it('botAction + applyTimeoutAction still drive the table via the definition', () => {
    const r = room3();
    startGame(r, { seed: 7, now: 1 });
    // botAction (re-exported from serverCore) returns a legal action for the actor.
    expect(botAction(r.gameState!)).not.toBeNull();
    // applyTimeoutAction routes through def.botAction → advances the state.
    const before = JSON.stringify(r.gameState);
    expect(applyTimeoutAction(r).acted).toBe(true);
    expect(JSON.stringify(r.gameState)).not.toBe(before);
  });
});
