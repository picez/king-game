import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { tarneebReducer } from './engine';
import { tarneebBotAction } from './ai';
import {
  canChooseTrump,
  canPlayCard,
  getValidBids,
  isTarneebFinished,
} from './rules';
import type { TarneebAction, TarneebContext, TarneebState } from './types';

function startBots(seed: number): { state: TarneebState; ctx: TarneebContext } {
  const ctx: TarneebContext = { rng: makeRng(seed) };
  const state = tarneebReducer(
    null,
    {
      type: 'START_GAME',
      playerNames: ['B0', 'B1', 'B2', 'B3'],
      playerTypes: ['ai', 'ai', 'ai', 'ai'],
    },
    ctx,
  ) as TarneebState;
  return { state, ctx };
}

/** Cards accounted for right now — must always be 52 within a hand. */
function cardsInPlay(s: TarneebState): number {
  let n = s.handsBySeat.reduce((sum, h) => sum + h.length, 0);
  if (s.currentTrick) n += s.currentTrick.plays.length;
  for (const t of s.completedTricks) n += t.plays.length;
  return n;
}

/**
 * Run a full bot-only match to completion. Returns the final state and the step
 * count, or throws if it fails to terminate within the cap (which would also
 * catch a bot emitting an illegal/no-op action, since that leaves state === prev).
 */
function runBotMatch(seed: number, cap = 50_000): { state: TarneebState; steps: number } {
  let { state, ctx } = startBots(seed);
  let steps = 0;
  while (!isTarneebFinished(state)) {
    if (steps++ > cap) throw new Error(`bot match ${seed} did not terminate in ${cap} steps`);
    // 52-card invariant holds continuously within a hand.
    expect(cardsInPlay(state)).toBe(52);
    const action: TarneebAction =
      state.phase === 'hand_complete'
        ? { type: 'START_NEXT_HAND' }
        : tarneebBotAction(state, state.currentSeat);
    const next = tarneebReducer(state, action, ctx) as TarneebState;
    // Every step must make progress (a legal action always yields a new state).
    expect(next).not.toBe(state);
    state = next;
  }
  return { state, steps };
}

describe('Tarneeb bot', () => {
  it('always produces a legal action in every phase', () => {
    let { state, ctx } = startBots(3);
    let steps = 0;
    while (!isTarneebFinished(state) && steps++ < 2000) {
      if (state.phase === 'hand_complete') {
        state = tarneebReducer(state, { type: 'START_NEXT_HAND' }, ctx) as TarneebState;
        continue;
      }
      const seat = state.currentSeat;
      const action = tarneebBotAction(state, seat);
      if (action.type === 'BID') {
        expect(getValidBids(state, seat)).toContain(action.amount);
      } else if (action.type === 'CHOOSE_TRUMP') {
        expect(canChooseTrump(state, seat, action.suit)).toBe(true);
      } else if (action.type === 'PLAY_CARD') {
        expect(canPlayCard(state, seat, action.card)).toBe(true);
      }
      state = tarneebReducer(state, action, ctx) as TarneebState;
    }
  });

  it('terminates a bot-only match for many seeds', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { state } = runBotMatch(seed);
      expect(isTarneebFinished(state)).toBe(true);
      expect(state.winnerTeam === 'A' || state.winnerTeam === 'B').toBe(true);
      const { A, B } = state.scoresByTeam;
      // The declared winner really has the higher, at-or-over-target score.
      expect(Math.max(A, B)).toBeGreaterThanOrEqual(state.targetScore);
      expect(A).not.toBe(B);
      expect(state.winnerTeam).toBe(A > B ? 'A' : 'B');
    }
  });

  it('is deterministic — the same seed yields the same result', () => {
    const a = runBotMatch(7);
    const b = runBotMatch(7);
    expect(a.state.scoresByTeam).toEqual(b.state.scoresByTeam);
    expect(a.state.winnerTeam).toBe(b.state.winnerTeam);
    expect(a.steps).toBe(b.steps);
  });
});
