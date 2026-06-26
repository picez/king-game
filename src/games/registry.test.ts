import { describe, it, expect } from 'vitest';
import { GAME_DEFINITIONS, getGameDefinition, DEFAULT_GAME_DEFINITION } from './registry';
import { kingGameDefinition } from './king/definition';
import { durakGameDefinition } from './durak/definition';
import { GAME_CATALOG } from './catalog';
import { gameReducer, getActingPlayerId } from '../core/gameEngine';
import { buildStartAction } from '../net/online';
import { botAction } from '../net/serverCore';
import { makeRng } from '../core/rng';
import type { RoomSnapshot } from '../net/messages';
import type { DurakState } from './durak/types';

describe('game registry', () => {
  it('returns the right definition by gameType and null for unknown input', () => {
    expect(getGameDefinition('king')).toBe(kingGameDefinition);
    expect(getGameDefinition('durak')).toBe(durakGameDefinition);
    expect(getGameDefinition('poker')).toBeNull();
    expect(getGameDefinition(undefined)).toBeNull();
    expect(getGameDefinition(42)).toBeNull();
    expect(GAME_DEFINITIONS.king.id).toBe('king');
    expect(GAME_DEFINITIONS.durak.id).toBe('durak');
    expect(DEFAULT_GAME_DEFINITION).toBe(kingGameDefinition); // King remains default
  });
});

describe('Durak game definition (registered, not yet playable)', () => {
  it('references the Durak core + catalog and records no stats yet', () => {
    expect(durakGameDefinition.id).toBe('durak');
    expect(durakGameDefinition.catalog).toBe(GAME_CATALOG.durak);
    expect(durakGameDefinition.rulesDoc).toBe('DURAK_RULES.md');
    expect(durakGameDefinition.supportedPlayerCounts).toEqual([2, 3, 4]);
    expect(durakGameDefinition.recordsStats).toBe(false);
    expect(durakGameDefinition.catalog.status).toBe('experimental'); // local prototype (9.3)
  });

  it('smoke: reducer starts a game and botAction can progress it', () => {
    const start = durakGameDefinition.buildStartAction({
      members: [
        { clientId: '1', name: 'A', role: 'player', seatIndex: 0, isHost: true, connected: true, type: 'human' },
        { clientId: '2', name: 'B', role: 'player', seatIndex: 1, isHost: false, connected: true, type: 'ai' },
      ],
      code: 'ABCD', playerCount: 4, modeSelectionType: 'fixed', turnTimerSec: 0, started: false, hasPassword: false,
    } as RoomSnapshot);
    expect(start.type).toBe('START_DURAK');

    const state = durakGameDefinition.reducer(null, start, { rng: makeRng(3) }) as DurakState;
    expect(state).not.toBeNull();
    expect(state.gameType).toBe('durak');
    expect(state.players).toHaveLength(2);
    // The acting player and a legal bot action both resolve.
    expect(durakGameDefinition.getActingPlayerId(state)).toMatch(/^player-/);
    const botMove = durakGameDefinition.botAction(state);
    expect(botMove).not.toBeNull();
    const next = durakGameDefinition.reducer(state, botMove!, { rng: makeRng(3) });
    expect(next).not.toBe(state); // a legal action advanced the state
  });
});

describe('King game definition', () => {
  it('references the correct id, catalog, rulesDoc and player counts', () => {
    expect(kingGameDefinition.id).toBe('king');
    expect(kingGameDefinition.catalog).toBe(GAME_CATALOG.king);
    expect(kingGameDefinition.rulesDoc).toBe('KING_RULES.md');
    expect(kingGameDefinition.supportedPlayerCounts).toEqual([3, 4]);
    expect(kingGameDefinition.recordsStats).toBe(true);
  });

  it('wraps the existing King modules WITHOUT moving logic (same fn refs)', () => {
    expect(kingGameDefinition.reducer).toBe(gameReducer);
    expect(kingGameDefinition.getActingPlayerId).toBe(getActingPlayerId);
    expect(kingGameDefinition.buildStartAction).toBe(buildStartAction);
    expect(kingGameDefinition.botAction).toBe(botAction);
  });

  it('drives a game through the definition: buildStartAction → reducer → acting/bot', () => {
    const snap = {
      code: 'ABCD',
      members: [
        { clientId: '1', name: 'A', role: 'player', seatIndex: 0, isHost: true, connected: true, type: 'human' },
        { clientId: '2', name: 'B', role: 'player', seatIndex: 1, isHost: false, connected: true, type: 'human' },
        { clientId: '3', name: 'Bot', role: 'player', seatIndex: 2, isHost: false, connected: true, type: 'ai' },
      ],
      playerCount: 3,
      modeSelectionType: 'fixed',
      turnTimerSec: 0,
      started: false,
      hasPassword: false,
    } as RoomSnapshot;

    const action = kingGameDefinition.buildStartAction(snap);
    expect(action.type).toBe('START_GAME');

    const state = kingGameDefinition.reducer(null, action, { rng: makeRng(7) });
    expect(state).not.toBeNull();
    expect(state!.players.map((p) => p.name)).toEqual(['A', 'B', 'Bot']);

    // getActingPlayerId returns a seat id (string) or null on a public screen.
    const acting = kingGameDefinition.getActingPlayerId(state!);
    expect(acting === null || typeof acting === 'string').toBe(true);

    // botAction returns a legal action or null — never throws on a fresh game.
    expect(() => kingGameDefinition.botAction(state!)).not.toThrow();
  });
});
