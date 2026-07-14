// ---------------------------------------------------------------------------
// 51 local prototype wiring (Stage 30.3). Source guards that the local UI plugs
// into the pure core WITHOUT re-implementing any rules, dispatches the full 51
// action vocabulary, and reads the deck rule from the core. Plus a headless
// drive of the local loop's exact dispatch contract (bot for the acting seat,
// human START_NEXT_ROUND between rounds) to a finished match with no invariant
// break. No jsdom — behaviour comes from the pure reducer.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../../core/rng';
import { fiftyOneReducer } from '../../games/fiftyOne/engine';
import { fiftyOneBotAction } from '../../games/fiftyOne/ai';
import { getActingFiftyOneSeat } from '../../games/fiftyOne/rules';
import { checkFiftyOneInvariants } from '../../games/fiftyOne/invariants';
import type { FiftyOneState } from '../../games/fiftyOne/types';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('51 local UI wiring (no rule duplication)', () => {
  it('FiftyOneLocalGame drives the pure reducer + bot (human at seat 0)', () => {
    const src = read('src/ui/fiftyOne/FiftyOneLocalGame.tsx');
    expect(src).toContain('fiftyOneReducer');
    expect(src).toContain('fiftyOneBotAction');
    expect(src).toContain('getActingFiftyOneSeat');
    expect(src).toContain("apply({ type: 'START_GAME'");
  });

  it('FiftyOneGameScreen reuses the core validator + dispatches every 51 action', () => {
    const src = read('src/ui/fiftyOne/FiftyOneGameScreen.tsx');
    // Uses the pure meld validator + opening threshold (no rules copied into the UI).
    expect(src).toContain('resolveMeld');
    expect(src).toContain('OPENING_MINIMUM');
    for (const action of ['DRAW_FROM_DECK', 'TAKE_DISCARD', 'OPEN_MELDS', 'ADD_TO_MELD', 'DISCARD', 'START_NEXT_ROUND']) {
      expect(src, `dispatches ${action}`).toContain(action);
    }
  });

  it('FiftyOneSetup reads the deck rule from the core (2p vs 3–4p) and offers 2/3/4', () => {
    const src = read('src/ui/fiftyOne/FiftyOneSetup.tsx');
    expect(src).toContain('deckCountFor');
    expect(src).toContain('totalDeckSize');
    expect(src).toContain('fiftyOne.deckNote2');
    expect(src).toContain('fiftyOne.deckNote34');
    expect(src).toContain('[2, 3, 4]');
  });
});

describe('51 local loop completes a match (headless drive of the UI contract)', () => {
  function drive(playerCount: number, seed: number): { finished: boolean; rounds: number; state: FiftyOneState } {
    const ctx = { rng: makeRng(seed) };
    const names = Array.from({ length: playerCount }, (_, i) => `P${i}`);
    const types = Array.from({ length: playerCount }, () => 'ai' as const);
    let state = fiftyOneReducer(null, { type: 'START_GAME', playerNames: names, playerTypes: types, playerCount, dealerSeat: 0 }, ctx) as FiftyOneState;
    let rounds = 0;
    let steps = 0;
    while (state.phase !== 'game_finished' && steps++ < 12000) {
      expect(checkFiftyOneInvariants(state)).toEqual([]);
      if (state.phase === 'round_complete') {
        rounds++;
        state = fiftyOneReducer(state, { type: 'START_NEXT_ROUND' }, ctx) as FiftyOneState;
        continue;
      }
      const seat = getActingFiftyOneSeat(state);
      if (seat == null) break;
      const next = fiftyOneReducer(state, fiftyOneBotAction(state, seat), ctx) as FiftyOneState;
      expect(next, `stalled at step ${steps}`).not.toBe(state);
      state = next;
    }
    return { finished: state.phase === 'game_finished', rounds, state };
  }

  it('completes several rounds with no invariant break; a finished match names a valid winner', () => {
    for (const [pc, seed] of [[2, 5], [3, 4]] as const) {
      const { finished, rounds, state } = drive(pc, seed);
      expect(rounds, `pc ${pc} rounds`).toBeGreaterThanOrEqual(3);
      if (finished) {
        expect(state.winnerSeat, `pc ${pc} winner`).not.toBeNull();
        expect(state.eliminatedSeats[state.winnerSeat as number]).toBe(false);
      }
    }
  }, 20_000);
});
