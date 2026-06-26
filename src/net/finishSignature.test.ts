import { describe, it, expect } from 'vitest';
import type { GameState } from '../models/types';
import type { ServerRoom } from './serverCore';
import { finishSignature } from '../../server/finishSignature';

// Minimal ServerRoom stub — finishSignature only reads room.gameState.
function room(state: GameState | null): ServerRoom {
  return { gameState: state } as unknown as ServerRoom;
}
function state(totals: Record<string, number>, rounds: number): GameState {
  return {
    players: Object.keys(totals).map((id) => ({ id })),
    scores: Object.fromEntries(Object.entries(totals).map(([id, total]) => [id, { total }])),
    roundHistory: Array.from({ length: rounds }, (_, i) => ({ roundNumber: i + 1 })),
  } as unknown as GameState;
}

describe('finishSignature', () => {
  it('is empty for no game state', () => {
    expect(finishSignature(room(null))).toBe('');
  });
  it('encodes round count + per-seat totals', () => {
    expect(finishSignature(room(state({ 'player-0': -9, 'player-1': -25 }, 27))))
      .toBe('27|player-0=-9,player-1=-25');
  });
  it('differs for a different game (different scores)', () => {
    const a = finishSignature(room(state({ 'player-0': -9 }, 27)));
    const b = finishSignature(room(state({ 'player-0': -10 }, 27)));
    expect(a).not.toBe(b);
  });
  it('is identical for the SAME finished game (idempotent recording)', () => {
    const s = state({ 'player-0': -9, 'player-1': -25, 'player-2': -16 }, 27);
    expect(finishSignature(room(s))).toBe(finishSignature(room(s)));
  });
});
