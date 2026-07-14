import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { fiftyOneReducer } from './engine';
import { fiftyOneBotAction } from './ai';
import { checkFiftyOneInvariants } from './invariants';
import { fiftyOneRedactStateFor } from './redact';
import type { FiftyOneAction, FiftyOneContext, FiftyOneState } from './types';

function startBots(playerCount: number, seed: number): { state: FiftyOneState; ctx: FiftyOneContext } {
  const ctx: FiftyOneContext = { rng: makeRng(seed) };
  const names = Array.from({ length: playerCount }, (_, i) => `B${i}`);
  const types = Array.from({ length: playerCount }, () => 'ai' as const);
  const state = fiftyOneReducer(null, { type: 'START_GAME', playerNames: names, playerTypes: types, dealerSeat: 0 }, ctx) as FiftyOneState;
  return { state, ctx };
}

function step(s: FiftyOneState, ctx: FiftyOneContext): FiftyOneState {
  const action: FiftyOneAction = s.phase === 'round_complete'
    ? { type: 'START_NEXT_ROUND' }
    : fiftyOneBotAction(s, s.currentSeat);
  return fiftyOneReducer(s, action, ctx) as FiftyOneState;
}

describe('51 invariants (bot soak)', () => {
  it('holds every structural invariant at every step across many bot games', () => {
    for (const playerCount of [2, 3, 4]) {
      for (let seed = 1; seed <= 3; seed++) {
        let { state, ctx } = startBots(playerCount, seed);
        let steps = 0;
        while (state.phase !== 'game_finished' && steps++ < 2500) {
          const errors = checkFiftyOneInvariants(state);
          expect(errors, `pc ${playerCount} seed ${seed} step ${steps}: ${errors.join('; ')}`).toEqual([]);
          const next = step(state, ctx);
          // The bot (and START_NEXT_ROUND) must always make legal progress.
          expect(next, `pc ${playerCount} seed ${seed} step ${steps} stalled`).not.toBe(state);
          state = next;
        }
      }
    }
  }, 30_000);

  it('completes several full rounds in a bot-only game without breaking invariants', () => {
    let { state, ctx } = startBots(3, 4);
    let roundsCompleted = 0;
    let steps = 0;
    while (state.phase !== 'game_finished' && steps++ < 20_000) {
      if (state.phase === 'round_complete') roundsCompleted++;
      state = step(state, ctx);
    }
    expect(roundsCompleted).toBeGreaterThanOrEqual(3);
    expect(checkFiftyOneInvariants(state)).toEqual([]);
  }, 30_000);

  it('a redacted state passes the (redaction-aware) invariants', () => {
    let { state, ctx } = startBots(4, 2);
    for (let i = 0; i < 60; i++) state = step(state, ctx);
    const redacted = fiftyOneRedactStateFor(state, 0);
    expect(checkFiftyOneInvariants(redacted)).toEqual([]);
  });

  it('flags an injected duplicate card id', () => {
    const { state } = startBots(2, 1);
    const dup = { ...state, handsBySeat: state.handsBySeat.map((h) => h.slice()) };
    // Copy seat 1's first card id onto seat 0's first card → a duplicate id.
    dup.handsBySeat[0] = [{ ...dup.handsBySeat[1][0] }, ...dup.handsBySeat[0].slice(1)];
    expect(checkFiftyOneInvariants(dup)).toContain('duplicate card id detected');
  });

  it('flags a corrupted turn step', () => {
    const { state } = startBots(2, 1);
    const bad = { ...state, turnStep: 'bogus' as unknown as FiftyOneState['turnStep'] };
    expect(checkFiftyOneInvariants(bad).some((e) => e.includes('invalid turnStep'))).toBe(true);
  });

  it('flags an eliminated seat that still holds cards', () => {
    const { state } = startBots(3, 1);
    const bad = { ...state, eliminatedSeats: [false, true, false] };
    expect(checkFiftyOneInvariants(bad).some((e) => e.includes('eliminated seat'))).toBe(true);
  });
});
