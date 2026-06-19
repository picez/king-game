import { describe, it, expect } from 'vitest';
import { gameReducer } from '../core/gameEngine';
import type { Card, GameState } from '../models/types';
import { redactStateFor } from './messages';

const c = (rank: string): Card => ({ suit: 'spades', rank: rank as Card['rank'], value: 1 });

/** Minimal state with populated collected cards + a dealer discard. */
function stateWithCollected(status: GameState['status'] = 'playing'): GameState {
  return {
    status,
    dealerIndex: 0,
    players: [
      { id: 'player-0', name: 'A', hand: [c('A')], seatIndex: 0, isDealer: true, type: 'human' },
      { id: 'player-1', name: 'B', hand: [c('K')], seatIndex: 1, isDealer: false, type: 'human' },
      { id: 'player-2', name: 'C', hand: [c('Q')], seatIndex: 2, isDealer: false, type: 'human' },
    ],
    currentRound: {
      collectedCards: { 'player-0': [c('2')], 'player-1': [c('3')], 'player-2': [c('4')] },
      discard: [c('9'), c('10')],
    },
    kittyForExchange: [],
  } as unknown as GameState;
}

function start4p(): GameState {
  const s = gameReducer(null, {
    type: 'START_GAME',
    playerNames: ['A', 'B', 'C', 'D'],
    playerTypes: ['human', 'human', 'human', 'human'],
    modeSelectionType: 'fixed',
  });
  if (!s) throw new Error('no state');
  return s;
}

describe('redactStateFor', () => {
  it('keeps the viewer hand and hides every opponent hand (count preserved)', () => {
    const state = start4p();
    const redacted = redactStateFor(state, 'player-0')!;

    const me = redacted.players.find((p) => p.id === 'player-0')!;
    const real = state.players.find((p) => p.id === 'player-0')!;
    // Own hand is intact.
    expect(me.hand).toEqual(real.hand);

    for (const p of redacted.players) {
      if (p.id === 'player-0') continue;
      const original = state.players.find((q) => q.id === p.id)!;
      // Same number of cards, but no real rank/suit leaks through.
      expect(p.hand).toHaveLength(original.hand.length);
      expect(p.hand.every((c) => c.rank === '?')).toBe(true);
      // The redacted payload must not contain any opponent's real card.
      const leaked = original.hand.some((real) =>
        p.hand.some((c) => c.suit === real.suit && c.rank === real.rank),
      );
      expect(leaked).toBe(false);
    }
  });

  it('returns null for a null state (no game yet)', () => {
    expect(redactStateFor(null, 'player-0')).toBeNull();
  });

  it('hides all hands from a spectator (no viewer id)', () => {
    const state = start4p();
    const redacted = redactStateFor(state, null)!;
    for (const p of redacted.players) {
      expect(p.hand.every((c) => c.rank === '?')).toBe(true);
    }
  });
});

describe('redactStateFor — collected cards & dealer discard privacy', () => {
  it('a player sees only their OWN collected cards during the round', () => {
    const view = redactStateFor(stateWithCollected('playing'), 'player-1')!;
    expect(view.currentRound.collectedCards['player-1']).toEqual([c('3')]); // own — real
    expect(view.currentRound.collectedCards['player-0']).toEqual([]);       // others — hidden
    expect(view.currentRound.collectedCards['player-2']).toEqual([]);
  });

  it('reveals all collected cards once the round is over (scoring)', () => {
    const view = redactStateFor(stateWithCollected('round_scoring'), 'player-1')!;
    expect(view.currentRound.collectedCards['player-0']).toEqual([c('2')]);
    expect(view.currentRound.collectedCards['player-2']).toEqual([c('4')]);
  });

  it('the dealer sees their own discard; non-dealers do not', () => {
    const dealerView = redactStateFor(stateWithCollected('playing'), 'player-0')!; // player-0 is dealer
    expect(dealerView.currentRound.discard).toEqual([c('9'), c('10')]);

    const otherView = redactStateFor(stateWithCollected('playing'), 'player-1')!;
    expect(otherView.currentRound.discard).toEqual([]);

    const spectatorView = redactStateFor(stateWithCollected('playing'), null)!;
    expect(spectatorView.currentRound.discard).toEqual([]);
  });
});
