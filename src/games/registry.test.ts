import { describe, it, expect } from 'vitest';
import { GAME_DEFINITIONS, getGameDefinition, DEFAULT_GAME_DEFINITION } from './registry';
import { kingGameDefinition } from './king/definition';
import { GAME_CATALOG } from './catalog';
import { gameReducer, getActingPlayerId } from '../core/gameEngine';
import { buildStartAction } from '../net/online';
import { botAction } from '../net/serverCore';
import { makeRng } from '../core/rng';
import type { RoomSnapshot } from '../net/messages';

describe('game registry', () => {
  it('returns the King definition for "king" and null for unknown input', () => {
    expect(getGameDefinition('king')).toBe(kingGameDefinition);
    expect(getGameDefinition('poker')).toBeNull();
    expect(getGameDefinition(undefined)).toBeNull();
    expect(getGameDefinition(42)).toBeNull();
    expect(GAME_DEFINITIONS.king.id).toBe('king');
    expect(DEFAULT_GAME_DEFINITION).toBe(kingGameDefinition);
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
