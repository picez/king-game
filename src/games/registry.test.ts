import { describe, it, expect } from 'vitest';
import { GAME_DEFINITIONS, getGameDefinition, DEFAULT_GAME_DEFINITION } from './registry';
import { kingGameDefinition } from './king/definition';
import { durakGameDefinition } from './durak/definition';
import { tarneebGameDefinition } from './tarneeb/definition';
import { GAME_CATALOG } from './catalog';
import { gameReducer, getActingPlayerId } from '../core/gameEngine';
import { buildStartAction } from '../net/online';
import { botAction } from '../net/serverCore';
import { makeRng } from '../core/rng';
import type { RoomSnapshot } from '../net/messages';
import type { DurakState } from './durak/types';
import { tarneebReducer } from './tarneeb/engine';
import { tarneebBotAction } from './tarneeb/ai';
import { getActingTarneebPlayerId, isTarneebFinished } from './tarneeb/rules';
import { tarneebRedactStateFor } from './tarneeb/redact';
import type { TarneebState } from './tarneeb/types';
import { preferansGameDefinition } from './preferans/definition';
import type { PreferansState } from './preferans/types';

describe('game registry', () => {
  it('returns the right definition by gameType and null for unknown input', () => {
    expect(getGameDefinition('king')).toBe(kingGameDefinition);
    expect(getGameDefinition('durak')).toBe(durakGameDefinition);
    expect(getGameDefinition('tarneeb')).toBe(tarneebGameDefinition);
    expect(getGameDefinition('preferans')).toBe(preferansGameDefinition);
    expect(getGameDefinition('poker')).toBeNull();
    expect(getGameDefinition(undefined)).toBeNull();
    expect(getGameDefinition(42)).toBeNull();
    expect(GAME_DEFINITIONS.king.id).toBe('king');
    expect(GAME_DEFINITIONS.durak.id).toBe('durak');
    expect(GAME_DEFINITIONS.tarneeb.id).toBe('tarneeb');
    expect(GAME_DEFINITIONS.preferans.id).toBe('preferans');
    expect(DEFAULT_GAME_DEFINITION).toBe(kingGameDefinition); // King remains default
  });
});

describe('Preferans game definition (registered, coming_soon — not playable yet)', () => {
  const snap = {
    code: 'ABCD',
    members: [
      { clientId: '1', name: 'A', role: 'player', seatIndex: 0, isHost: true, connected: true, type: 'human' },
      { clientId: '2', name: 'B', role: 'player', seatIndex: 1, isHost: false, connected: true, type: 'ai' },
      { clientId: '3', name: 'C', role: 'player', seatIndex: 2, isHost: false, connected: true, type: 'ai' },
    ],
    playerCount: 3, modeSelectionType: 'fixed', turnTimerSec: 0, started: false, hasPassword: false,
  } as RoomSnapshot;

  it('references the Preferans core + catalog; coming_soon, no stats, no local/online', () => {
    expect(preferansGameDefinition.id).toBe('preferans');
    expect(preferansGameDefinition.catalog).toBe(GAME_CATALOG.preferans);
    expect(preferansGameDefinition.rulesDoc).toBe('PREFERANS_RULES.md');
    expect(preferansGameDefinition.supportedPlayerCounts).toEqual([3]);
    expect(preferansGameDefinition.recordsStats).toBe(false); // no stats yet (coming_soon)
    expect(preferansGameDefinition.catalog.status).toBe('coming_soon');
    expect(preferansGameDefinition.catalog.supportsLocal).toBe(false);
    expect(preferansGameDefinition.catalog.supportsOnline).toBe(false);
  });

  it('smoke: buildStartAction → reducer creates a bidding PreferansState; botAction is legal', () => {
    const start = preferansGameDefinition.buildStartAction(snap);
    expect(start.type).toBe('START_GAME');

    const state = preferansGameDefinition.reducer(null, start, { rng: makeRng(3) }) as PreferansState;
    expect(state).not.toBeNull();
    expect(state.gameType).toBe('preferans');
    expect(state.phase).toBe('bidding');
    expect(state.players.map((p) => p.name)).toEqual(['A', 'B', 'C']);
    expect(state.handsBySeat.every((h) => h.length === 10)).toBe(true);
    expect(state.talon).toHaveLength(2);

    // An actor is acting; its bot move is a legal action that advances the state.
    expect(preferansGameDefinition.getActingPlayerId(state)).toMatch(/^player-/);
    const move = preferansGameDefinition.botAction(state);
    expect(move).not.toBeNull();
    const next = preferansGameDefinition.reducer(state, move!, { rng: makeRng(3) });
    expect(next).not.toBe(state);

    // botAction returns null on a public screen with no actor (finished game).
    const finished = { ...state, phase: 'game_finished' as const };
    expect(preferansGameDefinition.botAction(finished)).toBeNull();
  });

  it('redaction hides other hands + the talon while keeping the viewer own hand', () => {
    const state = preferansGameDefinition.reducer(null, preferansGameDefinition.buildStartAction(snap), { rng: makeRng(5) }) as PreferansState;
    const view = preferansGameDefinition.redactStateFor(state, 0);
    expect(view.handsBySeat[0]).toEqual(state.handsBySeat[0]);
    for (const seat of [1, 2]) expect(view.handsBySeat[seat].every((c) => c.rank === '?')).toBe(true);
    expect(view.talon.every((c) => c.rank === '?')).toBe(true);
  });
});

describe('Tarneeb game definition (registered, available with stats)', () => {
  const snap = {
    code: 'ABCD',
    members: [
      { clientId: '1', name: 'A', role: 'player', seatIndex: 0, isHost: true, connected: true, type: 'human' },
      { clientId: '2', name: 'B', role: 'player', seatIndex: 1, isHost: false, connected: true, type: 'ai' },
      { clientId: '3', name: 'C', role: 'player', seatIndex: 2, isHost: false, connected: true, type: 'ai' },
      { clientId: '4', name: 'D', role: 'player', seatIndex: 3, isHost: false, connected: true, type: 'ai' },
    ],
    playerCount: 4, modeSelectionType: 'fixed', turnTimerSec: 0, started: false, hasPassword: false,
  } as RoomSnapshot;

  it('references the Tarneeb pure core + catalog and is available with stats', () => {
    expect(tarneebGameDefinition.id).toBe('tarneeb');
    expect(tarneebGameDefinition.catalog).toBe(GAME_CATALOG.tarneeb);
    expect(tarneebGameDefinition.rulesDoc).toBe('TARNEEB_RULES.md');
    expect(tarneebGameDefinition.supportedPlayerCounts).toEqual([4]);
    expect(tarneebGameDefinition.recordsStats).toBe(true); // Stage 10.8: stats enabled
    expect(tarneebGameDefinition.catalog.status).toBe('available'); // Stage 10.8: released
    expect(tarneebGameDefinition.catalog.supportsLocal).toBe(true); // Stage 10.3: local UI
    expect(tarneebGameDefinition.catalog.supportsOnline).toBe(true); // Stage 10.5: online
    // Wraps the pure-core functions without moving logic.
    expect(tarneebGameDefinition.reducer).toBe(tarneebReducer);
    expect(tarneebGameDefinition.getActingPlayerId).toBe(getActingTarneebPlayerId);
    expect(tarneebGameDefinition.isFinished).toBe(isTarneebFinished);
    expect(tarneebGameDefinition.redactStateFor).toBe(tarneebRedactStateFor);
  });

  it('smoke: buildStartAction → reducer creates a bidding TarneebState; botAction is legal', () => {
    const start = tarneebGameDefinition.buildStartAction(snap);
    expect(start.type).toBe('START_GAME');

    const state = tarneebGameDefinition.reducer(null, start, { rng: makeRng(3) }) as TarneebState;
    expect(state).not.toBeNull();
    expect(state.gameType).toBe('tarneeb');
    expect(state.phase).toBe('bidding');
    expect(state.players.map((p) => p.name)).toEqual(['A', 'B', 'C', 'D']);
    expect(state.handsBySeat.every((h) => h.length === 13)).toBe(true);

    // An actor is acting, and its bot move is a legal action that advances the state.
    expect(tarneebGameDefinition.getActingPlayerId(state)).toMatch(/^player-/);
    const move = tarneebGameDefinition.botAction(state);
    expect(move).not.toBeNull();
    const next = tarneebGameDefinition.reducer(state, move!, { rng: makeRng(3) });
    expect(next).not.toBe(state);

    // botAction returns null on a public screen with no actor (finished game).
    const finished = { ...state, phase: 'game_finished' as const };
    expect(tarneebGameDefinition.botAction(finished)).toBeNull();
  });

  it('redaction hides opponent hands while keeping the viewer’s own hand', () => {
    const start = tarneebGameDefinition.buildStartAction(snap);
    const state = tarneebGameDefinition.reducer(null, start, { rng: makeRng(5) }) as TarneebState;
    const view = tarneebGameDefinition.redactStateFor(state, 0);
    // Seat 0 sees its real 13 cards…
    expect(view.handsBySeat[0]).toEqual(state.handsBySeat[0]);
    // …every other hand keeps its count but the cards are face-down placeholders.
    for (const seat of [1, 2, 3]) {
      expect(view.handsBySeat[seat]).toHaveLength(13);
      expect(view.handsBySeat[seat].every((c) => c.rank === '?')).toBe(true);
    }
    // A spectator (null) sees no real hand at all.
    const spectator = tarneebGameDefinition.redactStateFor(state, null);
    expect(spectator.handsBySeat.every((h) => h.every((c) => c.rank === '?'))).toBe(true);
  });
});

describe('Durak game definition (registered, not yet playable)', () => {
  it('references the Durak core + catalog and records no stats yet', () => {
    expect(durakGameDefinition.id).toBe('durak');
    expect(durakGameDefinition.catalog).toBe(GAME_CATALOG.durak);
    expect(durakGameDefinition.rulesDoc).toBe('DURAK_RULES.md');
    expect(durakGameDefinition.supportedPlayerCounts).toEqual([2, 3, 4, 5]);
    expect(durakGameDefinition.recordsStats).toBe(true); // DURAK-1: outcome stats enabled
    expect(durakGameDefinition.catalog.status).toBe('available'); // released (Stage 9.13)
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
