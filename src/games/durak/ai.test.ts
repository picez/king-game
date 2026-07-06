import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { durakReducer } from './engine';
import { durakBotAction } from './ai';
import type { DurakState, DurakVariant } from './types';

/** Play a full bot-vs-bot game; returns the finished state (or throws if stuck). */
function playOut(numPlayers: number, variant: DurakVariant, seed: number): DurakState {
  const names = Array.from({ length: numPlayers }, (_, i) => `Bot${i}`);
  let state = durakReducer(null, { type: 'START_DURAK', playerNames: names, variant }, { rng: makeRng(seed) })!;
  for (let step = 0; step < 5000; step++) {
    if (state.status === 'finished') return state;
    const action = durakBotAction(state);
    if (!action) throw new Error('no bot action while not finished');
    const next = durakReducer(state, action);
    if (next === state || next === null) throw new Error('bot produced a no-op (illegal) action');
    state = next;
  }
  throw new Error('game did not finish within the step cap');
}

describe('Durak AI drives a full legal game', () => {
  it.each([
    [2, 'simple'], [3, 'simple'], [4, 'simple'], [5, 'simple'],
    [2, 'transfer'], [3, 'transfer'], [4, 'transfer'], [5, 'transfer'],
  ] as [number, DurakVariant][])('finishes a %i-player %s game', (n, variant) => {
    const final = playOut(n, variant, 2026);
    expect(final.status).toBe('finished');
    // Deck fully drawn and the bout chain resolved.
    expect(final.drawPile).toHaveLength(0);
    expect(final.table).toEqual([]);
    // Exactly one fool, or a draw with none.
    if (final.isDraw) {
      expect(final.foolId).toBeNull();
    } else {
      expect(final.foolId).not.toBeNull();
      expect(final.winnerIds).not.toContain(final.foolId);
    }
    // Every card is accounted for (hands + discard), 36 total.
    const cardCount = final.players.reduce((s, p) => s + p.hand.length, 0) + final.discardPile.length;
    expect(cardCount).toBe(36);
  });

  it('is deterministic for a fixed seed', () => {
    const a = playOut(3, 'simple', 555);
    const b = playOut(3, 'simple', 555);
    expect(a.foolId).toBe(b.foolId);
    expect(a.discardPile.length).toBe(b.discardPile.length);
  });
});
