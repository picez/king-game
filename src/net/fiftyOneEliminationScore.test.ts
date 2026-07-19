import { describe, it, expect } from 'vitest';
import {
  createRoom, addBot, startGame, restartGame, snapshot, roomSummary,
  serializeRoom, deserializeRoom, type ServerRoom,
} from './serverCore';
import { getGameDefinition } from '../games/registry';
import {
  normalizeEliminationScore, ELIMINATION_SCORE_PRESETS, DEFAULT_TARGET_PENALTY,
} from '../games/fiftyOne/rules';
import { fiftyOneReducer } from '../games/fiftyOne/engine';
import type { FiftyOneState } from '../games/fiftyOne/types';

// ---------------------------------------------------------------------------
// Stage 30.15 — configurable 51 elimination score. Verifies the score flows
// host → room → snapshot/summary → start action → state, is normalised to an
// allowed preset (210/310/410/510), is backward-compatible (missing → 510), and
// survives persistence + rematch. The per-round SCORING is unchanged — only the
// elimination threshold moves.
// ---------------------------------------------------------------------------

const def = getGameDefinition('fifty-one')!;

function room(fiftyOneEliminationScore?: number, seats = 2): ServerRoom {
  const r = createRoom({
    code: 'F51A', gameType: 'fifty-one', fiftyOneEliminationScore, playerCount: seats as 2 | 3 | 4,
    modeSelectionType: 'fixed', host: { clientId: 'h', reconnectToken: 't', name: 'Host' },
  });
  for (let i = 1; i < seats; i++) addBot(r, 'h', { clientId: `b${i}`, reconnectToken: `t${i}` });
  return r;
}

describe('normalizeEliminationScore', () => {
  it('keeps each allowed preset unchanged', () => {
    for (const v of ELIMINATION_SCORE_PRESETS) expect(normalizeEliminationScore(v)).toBe(v);
  });
  it('falls back to 510 for missing / non-finite / off-preset / non-numeric input', () => {
    expect(normalizeEliminationScore(undefined)).toBe(DEFAULT_TARGET_PENALTY);
    expect(normalizeEliminationScore(NaN)).toBe(DEFAULT_TARGET_PENALTY);
    expect(normalizeEliminationScore(Infinity)).toBe(DEFAULT_TARGET_PENALTY);
    // Off-preset values (legacy 5000, a clamped-old value, an arbitrary number) → 510.
    expect(normalizeEliminationScore(250)).toBe(DEFAULT_TARGET_PENALTY);
    expect(normalizeEliminationScore(5000)).toBe(DEFAULT_TARGET_PENALTY);
    expect(normalizeEliminationScore(410.5)).toBe(DEFAULT_TARGET_PENALTY);
    expect(normalizeEliminationScore(-10)).toBe(DEFAULT_TARGET_PENALTY);
    expect(normalizeEliminationScore('nope' as unknown as number)).toBe(DEFAULT_TARGET_PENALTY);
  });
  it('exposes exactly the four presets low→high', () => {
    expect([...ELIMINATION_SCORE_PRESETS]).toEqual([210, 310, 410, 510]);
  });
});

describe('core eliminates at the selected threshold (not always 510)', () => {
  function seat0Score(target: number, start: number): FiftyOneState {
    // A round where seat 1 wins (empties hand); seat 0 crosses `target` and is out.
    const base = fiftyOneReducer(null, {
      type: 'START_GAME', playerNames: ['A', 'B'], playerTypes: ['ai', 'ai'],
      playerCount: 2, dealerSeat: 0, options: { targetPenalty: target },
    }, { rng: () => 0 }) as FiftyOneState;
    // Drive it directly to a scored round: seat 0 already near the target, opened, holding a K (10).
    const s: FiftyOneState = {
      ...base,
      phase: 'playing',
      handsBySeat: [
        [{ id: 'x-spades-K', joker: false, suit: 'spades', rank: 'K' }],
        [{ id: 'y-hearts-9', joker: false, suit: 'hearts', rank: '9' }],
      ],
      openedBySeat: [true, true],
      scoresBySeat: [start, 0],
      currentSeat: 1,
      turnStep: 'meld_discard',
    };
    // Seat 1 discards its last card → empties hand → round win → scoring.
    return fiftyOneReducer(s, { type: 'DISCARD', card: s.handsBySeat[1][0] }, { rng: () => 0 }) as FiftyOneState;
  }

  it('at target 210 a seat crossing 210 is eliminated (would survive at 510)', () => {
    const out = seat0Score(210, 205); // 205 + 10 (K) = 215 ≥ 210
    expect(out.eliminatedSeats[0]).toBe(true);
    expect(out.phase).toBe('game_finished');
  });
  it('the SAME score does NOT eliminate at the default 510', () => {
    const alive = seat0Score(510, 205); // 215 < 510 → still in
    expect(alive.eliminatedSeats[0]).toBe(false);
    expect(alive.phase).toBe('round_complete');
  });
});

describe('buildStartAction threads the room score (default 510)', () => {
  it('a custom score flows into the START_GAME options; missing/legacy → 510', () => {
    const custom = def.buildStartAction(snapshot(room(310))) as { options?: { targetPenalty?: number } };
    expect(custom.options?.targetPenalty).toBe(310);
    const legacy = def.buildStartAction(snapshot(room(undefined))) as { options?: { targetPenalty?: number } };
    expect(legacy.options?.targetPenalty).toBe(510);
  });
});

describe('room metadata + snapshot/summary carry the score', () => {
  it('createRoom stores it; snapshot + summary expose it for 51 rooms', () => {
    expect(room(310).fiftyOneEliminationScore).toBe(310);
    expect(snapshot(room(310)).fiftyOneEliminationScore).toBe(310);
    expect(roomSummary(room(310)).fiftyOneEliminationScore).toBe(310);
    // A non-51 room never carries it.
    const king = createRoom({ code: 'KING', gameType: 'king', playerCount: 4, modeSelectionType: 'fixed', host: { clientId: 'h', reconnectToken: 't', name: 'H' } });
    expect(snapshot(king).fiftyOneEliminationScore).toBeUndefined();
    expect(roomSummary(king).fiftyOneEliminationScore).toBeUndefined();
  });

  it('persistence round-trips the score; a legacy row (no field) restores as undefined (→ 510 at start)', () => {
    const restored = deserializeRoom(serializeRoom(room(310)));
    expect(restored?.fiftyOneEliminationScore).toBe(310);
    const legacyRow = { ...serializeRoom(room(310)) } as Record<string, unknown>;
    delete legacyRow.fiftyOneEliminationScore;
    expect(deserializeRoom(legacyRow)?.fiftyOneEliminationScore).toBeUndefined();
    // A garbage stored value re-normalises to the default preset on restore.
    const badRow = { ...serializeRoom(room(310)), fiftyOneEliminationScore: 99999 } as Record<string, unknown>;
    expect(deserializeRoom(badRow)?.fiftyOneEliminationScore).toBe(510);
  });
});

describe('server start applies the score to the state', () => {
  it('a custom-score room produces a FiftyOneState with that targetPenalty', () => {
    const r = room(210, 3);
    expect(startGame(r, { seed: 1 }).ok).toBe(true);
    expect((r.gameState as FiftyOneState).options.targetPenalty).toBe(210);
  });
  it('a legacy room (no score) starts at the default 510', () => {
    const legacy = room(undefined);
    expect(startGame(legacy, { seed: 1 }).ok).toBe(true);
    expect((legacy.gameState as FiftyOneState).options.targetPenalty).toBe(510);
  });
});

describe('rematch preserves the score', () => {
  it('restarting a custom-score room deals another game at the same score', () => {
    const r = room(410);
    startGame(r, { seed: 1 });
    (r.gameState as FiftyOneState).phase = 'game_finished';
    expect(restartGame(r, { seed: 2 }).ok).toBe(true);
    expect((r.gameState as FiftyOneState).options.targetPenalty).toBe(410);
  });
});
