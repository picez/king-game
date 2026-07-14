import { describe, it, expect } from 'vitest';
import {
  createRoom, addBot, startGame, restartGame, snapshot, roomSummary,
  serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import { getGameDefinition } from '../games/registry';
import {
  normalizeTargetScore, DEFAULT_TARGET_SCORE, MIN_TARGET_SCORE, MAX_TARGET_SCORE,
} from '../games/tarneeb/rules';
import type { TarneebState } from '../games/tarneeb/types';

// ---------------------------------------------------------------------------
// Stage 29.8 — configurable Tarneeb match target. Verifies the target flows
// host → room → snapshot/summary → start action → state, is normalised/clamped,
// backward-compatible (missing → 41), and survives persistence + rematch. The
// per-hand SCORING is unchanged — only the finish threshold moves.
// ---------------------------------------------------------------------------

const def = getGameDefinition('tarneeb')!;

function room(tarneebTargetScore?: number, tarneebVariant?: 'pairs' | 'solo'): ServerRoom {
  const r = createRoom({
    code: 'TRN1', gameType: 'tarneeb', tarneebVariant, tarneebTargetScore, playerCount: 4,
    modeSelectionType: 'fixed', host: { clientId: 'h', reconnectToken: 't', name: 'Host' },
  });
  for (let i = 1; i < 4; i++) addBot(r, 'h', { clientId: `b${i}`, reconnectToken: `t${i}` });
  return r;
}

describe('normalizeTargetScore', () => {
  it('keeps a valid in-range integer', () => {
    expect(normalizeTargetScore(61)).toBe(61);
    expect(normalizeTargetScore(41)).toBe(41);
  });
  it('falls back to the default 41 for missing / non-finite / non-numeric input', () => {
    expect(normalizeTargetScore(undefined)).toBe(DEFAULT_TARGET_SCORE);
    expect(normalizeTargetScore(null)).toBe(DEFAULT_TARGET_SCORE);
    expect(normalizeTargetScore(NaN)).toBe(DEFAULT_TARGET_SCORE);
    expect(normalizeTargetScore(Infinity)).toBe(DEFAULT_TARGET_SCORE);
    expect(normalizeTargetScore('nope')).toBe(DEFAULT_TARGET_SCORE);
  });
  it('clamps out-of-range values to the nearest bound and rounds', () => {
    expect(normalizeTargetScore(5)).toBe(MIN_TARGET_SCORE);
    expect(normalizeTargetScore(99999)).toBe(MAX_TARGET_SCORE);
    expect(normalizeTargetScore(-10)).toBe(MIN_TARGET_SCORE);
    expect(normalizeTargetScore(40.6)).toBe(41);
  });
});

describe('buildStartAction threads the room target (default 41)', () => {
  it('a custom target flows into the START_GAME options; missing/legacy → 41', () => {
    const custom = def.buildStartAction(snapshot(room(61))) as { options?: { targetScore?: number } };
    expect(custom.options?.targetScore).toBe(61);
    const legacy = def.buildStartAction(snapshot(room(undefined))) as { options?: { targetScore?: number } };
    expect(legacy.options?.targetScore).toBe(41);
  });
});

describe('room metadata + snapshot/summary carry the target', () => {
  it('createRoom stores it; snapshot + summary expose it for Tarneeb rooms', () => {
    expect(room(61).tarneebTargetScore).toBe(61);
    expect(snapshot(room(61)).tarneebTargetScore).toBe(61);
    expect(roomSummary(room(61)).tarneebTargetScore).toBe(61);
    // A non-Tarneeb room never carries it.
    const king = createRoom({ code: 'KING', gameType: 'king', playerCount: 4, modeSelectionType: 'fixed', host: { clientId: 'h', reconnectToken: 't', name: 'H' } });
    expect(snapshot(king).tarneebTargetScore).toBeUndefined();
    expect(roomSummary(king).tarneebTargetScore).toBeUndefined();
  });

  it('persistence round-trips the target; a legacy row (no field) restores as undefined (→ 41 at start)', () => {
    const restored = deserializeRoom(serializeRoom(room(61)));
    expect(restored?.tarneebTargetScore).toBe(61);
    const legacyRow = { ...serializeRoom(room(61)) } as Record<string, unknown>;
    delete legacyRow.tarneebTargetScore;
    const legacy = deserializeRoom(legacyRow);
    expect(legacy?.tarneebTargetScore).toBeUndefined();
    // A garbage stored value is re-normalised on restore.
    const badRow = { ...serializeRoom(room(61)), tarneebTargetScore: 99999 } as Record<string, unknown>;
    expect(deserializeRoom(badRow)?.tarneebTargetScore).toBe(MAX_TARGET_SCORE);
  });
});

describe('server start applies the target to the state (Pairs AND Solo)', () => {
  it('a custom-target room produces a TarneebState with that targetScore', () => {
    const pairs = room(61, 'pairs');
    expect(startGame(pairs, { seed: 1 }).ok).toBe(true);
    expect((pairs.gameState as TarneebState).targetScore).toBe(61);

    const solo = room(31, 'solo');
    expect(startGame(solo, { seed: 1 }).ok).toBe(true);
    const st = solo.gameState as TarneebState;
    expect(st.targetScore).toBe(31);
    expect(st.variant).toBe('solo');
  });

  it('a legacy room (no target) starts at the default 41', () => {
    const legacy = room(undefined);
    expect(startGame(legacy, { seed: 1 }).ok).toBe(true);
    expect((legacy.gameState as TarneebState).targetScore).toBe(41);
  });
});

describe('rematch preserves the target', () => {
  it('restarting a custom-target room deals another game at the same target', () => {
    const r = room(61);
    startGame(r, { seed: 1 });
    (r.gameState as TarneebState).phase = 'game_finished';
    expect(restartGame(r, { seed: 2 }).ok).toBe(true);
    expect((r.gameState as TarneebState).targetScore).toBe(61);
  });
});
