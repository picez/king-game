import { describe, it, expect } from 'vitest';
import {
  createRoom, addBot, startGame, restartGame, snapshot, roomSummary,
  serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import { getGameDefinition } from '../games/registry';
import type { TarneebState } from '../games/tarneeb/types';

// ---------------------------------------------------------------------------
// Stage 28.4 — Tarneeb Solo full online release. Verifies the variant flows
// host → room → snapshot → start action → state, is backward-compatible
// (missing → pairs), survives persistence + rematch, and never touches Pairs.
// ---------------------------------------------------------------------------

const def = getGameDefinition('tarneeb')!;

function room(tarneebVariant?: 'pairs' | 'solo'): ServerRoom {
  const r = createRoom({
    code: 'TRN1', gameType: 'tarneeb', tarneebVariant, playerCount: 4,
    modeSelectionType: 'fixed', host: { clientId: 'h', reconnectToken: 't', name: 'Host' },
  });
  for (let i = 1; i < 4; i++) addBot(r, 'h', { clientId: `b${i}`, reconnectToken: `t${i}` });
  return r;
}

describe('buildStartAction threads the room variant', () => {
  it('a Solo room starts variant:solo; a Pairs/legacy room omits it (→ pairs)', () => {
    const solo = def.buildStartAction(snapshot(room('solo'))) as { variant?: string };
    expect(solo.variant).toBe('solo');
    const pairs = def.buildStartAction(snapshot(room('pairs'))) as { variant?: string };
    expect(pairs.variant).toBeUndefined();
    const legacy = def.buildStartAction(snapshot(room(undefined))) as { variant?: string };
    expect(legacy.variant).toBeUndefined();
  });
});

describe('room metadata + snapshot/summary carry the variant', () => {
  it('snapshot + summary expose tarneebVariant for Tarneeb rooms only', () => {
    expect(snapshot(room('solo')).tarneebVariant).toBe('solo');
    expect(snapshot(room('pairs')).tarneebVariant).toBe('pairs');
    expect(roomSummary(room('solo')).tarneebVariant).toBe('solo');
    // A non-Tarneeb room never carries it.
    const king = createRoom({ code: 'KING', gameType: 'king', playerCount: 4, modeSelectionType: 'fixed', host: { clientId: 'h', reconnectToken: 't', name: 'H' } });
    expect(snapshot(king).tarneebVariant).toBeUndefined();
    expect(roomSummary(king).tarneebVariant).toBeUndefined();
  });

  it('persistence round-trips the variant; a legacy row (no field) restores as undefined (→ pairs)', () => {
    const restored = deserializeRoom(serializeRoom(room('solo')));
    expect(restored?.tarneebVariant).toBe('solo');
    const legacyRow = { ...serializeRoom(room('pairs')) } as Record<string, unknown>;
    delete legacyRow.tarneebVariant;
    expect(deserializeRoom(legacyRow)?.tarneebVariant).toBeUndefined();
  });
});

describe('server start produces the right variant state', () => {
  it('a Solo room starts a TarneebState with variant solo; Pairs stays pairs', () => {
    const solo = room('solo');
    expect(startGame(solo, { seed: 1 }).ok).toBe(true);
    expect((solo.gameState as TarneebState).variant).toBe('solo');

    const pairs = room('pairs');
    expect(startGame(pairs, { seed: 1 }).ok).toBe(true);
    expect((pairs.gameState as TarneebState).variant).toBe('pairs');
  });
});

describe('rematch preserves the variant', () => {
  it('restarting a Solo room deals another Solo game', () => {
    const solo = room('solo');
    startGame(solo, { seed: 1 });
    // Force finish so restart is legal, then restart.
    (solo.gameState as TarneebState).phase = 'game_finished';
    expect(restartGame(solo, { seed: 2 }).ok).toBe(true);
    expect((solo.gameState as TarneebState).variant).toBe('solo');
  });
});

describe('online redaction hides solo hands but keeps public per-seat data', () => {
  it('a viewer sees only their own hand; scoresBySeat/tricksBySeat survive', () => {
    const solo = room('solo');
    startGame(solo, { seed: 3 });
    const state = solo.gameState as TarneebState;
    const view = def.redactStateFor(state, 0) as TarneebState;
    expect(view.handsBySeat[0]).toEqual(state.handsBySeat[0]);
    for (let s = 1; s < 4; s++) expect(view.handsBySeat[s].every((c) => c.rank === '?')).toBe(true);
    expect(view.scoresBySeat).toEqual(state.scoresBySeat);
    expect(view.variant).toBe('solo');
  });
});
