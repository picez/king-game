import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { debercReducer } from './engine';
import { debercBotAction } from './ai';
import type { DebercMatchSize, DebercState } from './types';

/** Play a full bot-vs-bot match; returns the finished state (or throws if stuck). */
function playOut(numPlayers: number, matchSize: DebercMatchSize, seed: number): DebercState {
  const names = Array.from({ length: numPlayers }, (_, i) => `Bot${i}`);
  const playerTypes = Array.from({ length: numPlayers }, () => 'ai' as const);
  // One rng instance threaded through EVERY call so each hand's re-deal (NEXT_HAND)
  // draws from the same seeded stream — the whole match replays from the seed.
  const ctx = { rng: makeRng(seed) };
  let state = debercReducer(
    null,
    { type: 'START_DEBERC', playerNames: names, playerTypes, matchSize },
    ctx,
  )!;
  for (let step = 0; step < 20000; step++) {
    if (state.phase === 'finished') return state;
    const action = debercBotAction(state);
    if (!action) throw new Error('no bot action while not finished');
    const next = debercReducer(state, action, ctx);
    if (next === state || next === null) throw new Error('bot produced a no-op (illegal) action');
    state = next;
  }
  throw new Error('match did not finish within the step cap');
}

/** Every physical card the state accounts for (see the soak script for the rules). */
function countCards(s: DebercState): number {
  let n = s.stock.length;
  for (const p of s.players) n += p.hand.length;
  for (const won of s.wonCards) n += won.length;
  if (s.phase === 'playing' && s.currentTrick) n += s.currentTrick.plays.length;
  return n;
}

describe('Deberc AI drives a full legal match', () => {
  it.each([
    [3, 'small'], [4, 'small'], [3, 'big'], [4, 'big'],
  ] as [number, DebercMatchSize][])('finishes a %i-player %s match', (n, matchSize) => {
    const final = playOut(n, matchSize, 2026);
    expect(final.phase).toBe('finished');
    expect(final.winnerTeam).not.toBeNull();
    // The match ends by reaching the target or on a деберц jackpot.
    const target = matchSize === 'small' ? 510 : 1020;
    expect(final.jackpot || final.matchScore.some((v) => v >= target)).toBe(true);
    // Every card is still accounted for (32-card deck for 3p, 36 for 4p — v1.2).
    expect(countCards(final)).toBe(n === 4 ? 36 : 32);
    // The per-hand score sheet accumulates one row per scored hand (item #5). A
    // non-jackpot match scores at least one hand; each row records its об'яз/dealer.
    if (!final.jackpot) expect(final.handHistory.length).toBeGreaterThan(0);
    for (const h of final.handHistory) {
      expect(h.teamPoints).toHaveLength(n === 4 ? 2 : 3);
      expect(typeof h.objazSeat).toBe('number');
      expect(typeof h.dealerSeat).toBe('number');
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = playOut(4, 'small', 777);
    const b = playOut(4, 'small', 777);
    expect(a.winnerTeam).toBe(b.winnerTeam);
    expect(a.matchScore).toEqual(b.matchScore);
  });
});
