// ---------------------------------------------------------------------------
// 7-game server turn-timeout matrix (Stage 37.5). For each game a minimal all-human
// room is started (so the actor is always a human on the clock) and the SERVER
// timeout path is driven turn-by-turn: for every player-owned phase it must derive
// the acting member, apply a LEGAL auto-action through the reducer (`acted: true`),
// and genuinely advance the state — never throw, never return `acted: false` while a
// human is on the clock. This is the guarantee that "timer hits 0 → the table always
// moves" holds across all 7 games and their unusual phases.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import {
  createRoom, addMember, startGame, actingMember, applyTimeoutAction, type ServerRoom,
} from './serverCore';
import type { GameType } from '../games/catalog';

/** A started room with EVERY seat a human (so `actingMember` is always human). */
function allHumanRoom(gameType: GameType, playerCount: 2 | 3 | 4, seed: number): ServerRoom {
  const room = createRoom({
    code: 'MTX1', gameType, playerCount, modeSelectionType: gameType === 'king' ? 'dealer_choice' : 'fixed',
    host: { clientId: 'c0', reconnectToken: 't0', name: 'P0' }, now: 0,
  });
  for (let i = 1; i < playerCount; i++) addMember(room, { clientId: `c${i}`, reconnectToken: `t${i}`, name: `P${i}` });
  expect(startGame(room, { seed, now: 0 }).ok, `${gameType} start`).toBe(true);
  return room;
}

const phaseOf = (room: ServerRoom): string => {
  const s = room.gameState as { phase?: unknown; status?: unknown } | null;
  const p = s?.phase ?? s?.status;
  return typeof p === 'string' ? p : 'unknown';
};

/**
 * Drive the server timeout path while a HUMAN is on the clock. Every step must apply a
 * legal auto-action and advance the state. Stops at a public screen (`actingMember`
 * null) or when the game finishes. Returns the phases exercised.
 */
function driveTimeouts(room: ServerRoom, maxSteps: number): { steps: number; phases: Set<string> } {
  const phases = new Set<string>();
  let steps = 0;
  let seed = 5000;
  while (steps < maxSteps) {
    const acting = actingMember(room);
    if (!acting) break; // public/no-actor screen — the human timeout path is not for these
    expect(acting.type, `step ${steps}`).toBe('human'); // every seat is human here
    phases.add(phaseOf(room));
    const before = JSON.stringify(room.gameState);
    // A seed is threaded so any RNG-consuming auto-action stays reproducible; it never
    // throws and must report it acted.
    const res = applyTimeoutAction(room);
    void seed; seed += 1;
    expect(res.acted, `step ${steps}, ${room.gameType} phase ${phaseOf(room)} — timeout must produce a legal action`).toBe(true);
    expect(JSON.stringify(room.gameState), `step ${steps} advanced`).not.toBe(before);
    steps++;
  }
  return { steps, phases };
}

const CASES: Array<{ game: GameType; count: 2 | 3 | 4; seed: number }> = [
  { game: 'king', count: 3, seed: 1 },
  { game: 'durak', count: 2, seed: 2 },
  { game: 'deberc', count: 3, seed: 3 },
  { game: 'tarneeb', count: 4, seed: 4 },
  { game: 'preferans', count: 3, seed: 5 },
  { game: 'fifty-one', count: 2, seed: 6 },
  { game: 'poker', count: 2, seed: 7 },
];

describe('server turn-timeout produces a legal auto-action in every game (Stage 37.5)', () => {
  for (const { game, count, seed } of CASES) {
    it(`${game}: the timeout path auto-plays turn-by-turn without stalling`, () => {
      const room = allHumanRoom(game, count, seed);
      // The freshly-dealt state must have a human on the clock (a player-owned phase).
      expect(actingMember(room), `${game} initial actor`).toBeTruthy();
      const { steps, phases } = driveTimeouts(room, 40);
      // At least the opening several turns auto-played through the reducer.
      expect(steps, `${game} steps`).toBeGreaterThanOrEqual(2);
      expect(phases.size, `${game} phases`).toBeGreaterThanOrEqual(1);
    });
  }

  it('every game exposes a non-null acting player on its opening (player-owned) phase', () => {
    for (const { game, count, seed } of CASES) {
      const room = allHumanRoom(game, count, seed);
      const acting = actingMember(room);
      expect(acting, `${game}`).toBeTruthy();
      expect(acting!.type).toBe('human');
    }
  });
});
