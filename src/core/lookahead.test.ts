import { describe, it, expect } from 'vitest';
import { analyzeLookahead, aiChooseCardLookahead } from './lookahead';
import { aiChooseCard, aiChooseMode, aiChooseTrump, aiChooseKittyDiscards } from './ai';
import { gameReducer, getCurrentPlayer } from './gameEngine';
import { getValidCards, cardEquals } from './rules';
import { makeRng } from './rng';
import type { Card, GameState } from '../models/types';

// ── Deterministic per-state legal-move policy ────────────────────────────────
// A tiny hash over the state gives reproducible-but-varied "random" legal plays,
// so we explore many distinct endgame positions without Math.random flakiness.
function pick<T>(arr: T[], salt: number): T {
  let h = 2166136261 ^ salt;
  h = Math.imul(h, 16777619) >>> 0;
  return arr[h % arr.length];
}

function start(names: string[], seed: number): GameState {
  const s = gameReducer(
    null,
    { type: 'START_GAME', playerNames: names, playerTypes: names.map(() => 'ai'), modeSelectionType: 'fixed' },
    { rng: makeRng(seed) },
  );
  if (!s) throw new Error('START_GAME returned null');
  return s;
}

/** Drive setup steps with the AI; play cards with a seeded legal-move policy. */
function drive(
  state: GameState,
  onPlaying: (s: GameState) => void,
  seed: number,
): GameState {
  let s = state;
  let step = 0;
  for (let guard = 0; guard < 2000; guard++) {
    switch (s.status) {
      case 'mode_selection':
        s = gameReducer(s, { type: 'CHOOSE_MODE', modeId: aiChooseMode(s.dealerModes[getCurrentPlayer(s).id]) })!;
        break;
      case 'select_trump': {
        const dealer = getCurrentPlayer(s);
        s = gameReducer(s, { type: 'SELECT_TRUMP', suit: aiChooseTrump(dealer.hand) ?? dealer.hand[0].suit })!;
        break;
      }
      case 'kitty_exchange': {
        const dealer = s.players[s.dealerIndex];
        s = gameReducer(s, { type: 'EXCHANGE_KITTY', discards: aiChooseKittyDiscards(dealer.hand, s.config.kittySize, s.currentRound.mode.id) })!;
        break;
      }
      case 'trick_complete':
        s = gameReducer(s, { type: 'NEXT_TRICK' })!;
        break;
      case 'playing': {
        onPlaying(s);
        const p = getCurrentPlayer(s);
        const valid = getValidCards(p.hand, s.currentTrick?.ledSuit ?? null, s.currentRound.mode.id, s.trumpSuit);
        s = gameReducer(s, { type: 'PLAY_CARD', playerId: p.id, card: pick(valid, seed * 7919 + step++) })!;
        break;
      }
      default:
        return s; // round_scoring / game_finished
    }
  }
  throw new Error(`did not finish (stuck at ${s.status})`);
}

const value = (a: ReturnType<typeof analyzeLookahead>, card: Card): number | undefined =>
  a?.candidates.find((c) => cardEquals(c.card, card))?.value;

describe('lookahead — legality & round completion', () => {
  for (const names of [['A', 'B', 'C'], ['A', 'B', 'C', 'D']]) {
    it(`${names.length}-player round: lookahead only ever returns legal cards`, () => {
      // Every 'playing' state has its lookahead card checked against the legal set.
      drive(start(names, 42), (s) => {
        const chosen = aiChooseCardLookahead(s);
        const valid = getValidCards(
          getCurrentPlayer(s).hand, s.currentTrick?.ledSuit ?? null, s.currentRound.mode.id, s.trumpSuit,
        );
        expect(valid.some((v) => cardEquals(v, chosen)), `illegal lookahead card in ${s.currentRound.mode.id}`).toBe(true);
      }, 1);
    });
  }

  it('a full game driven entirely by lookahead reaches game_finished', () => {
    let s = start(['A', 'B', 'C', 'D'], 7);
    for (let guard = 0; guard < 20000 && s.status !== 'game_finished'; guard++) {
      switch (s.status) {
        case 'mode_selection': s = gameReducer(s, { type: 'CHOOSE_MODE', modeId: aiChooseMode(s.dealerModes[getCurrentPlayer(s).id]) })!; break;
        case 'select_trump': { const d = getCurrentPlayer(s); s = gameReducer(s, { type: 'SELECT_TRUMP', suit: aiChooseTrump(d.hand) ?? d.hand[0].suit })!; break; }
        case 'kitty_exchange': { const d = s.players[s.dealerIndex]; s = gameReducer(s, { type: 'EXCHANGE_KITTY', discards: aiChooseKittyDiscards(d.hand, s.config.kittySize, s.currentRound.mode.id) })!; break; }
        case 'trick_complete': s = gameReducer(s, { type: 'NEXT_TRICK' })!; break;
        case 'round_scoring': s = gameReducer(s, { type: 'NEXT_ROUND' }, { rng: makeRng(7 + s.currentRoundIdx) })!; break;
        case 'playing': { const p = getCurrentPlayer(s); s = gameReducer(s, { type: 'PLAY_CARD', playerId: p.id, card: aiChooseCardLookahead(s) })!; break; }
        default: throw new Error(`unexpected ${s.status}`);
      }
    }
    expect(s.status).toBe('game_finished');
  }, 60000);
});

describe('lookahead — dominates greedy on its own objective', () => {
  it('never scores its pick below the greedy pick, and strictly beats it somewhere', () => {
    let analyzed = 0;
    let strictImprovements = 0;

    // Sweep many seeded rounds; every time a small-enough endgame position turns
    // up, verify the invariants. Perfect-info max-n is only claimed to dominate
    // when the whole subtree is searched, i.e. when analyzeLookahead is non-null.
    for (let seed = 1; seed <= 30; seed++) {
      for (const names of [['A', 'B', 'C'], ['A', 'B', 'C', 'D']]) {
        drive(start(names, seed), (s) => {
          const a = analyzeLookahead(s);
          if (!a) return; // outside the gate → greedy fallback, nothing to prove
          analyzed++;

          // The chosen card must be the argmax of our seat's value.
          const bestVal = Math.max(...a.candidates.map((c) => c.value));
          expect(value(a, a.best)).toBe(bestVal);

          // Dominance: the search never rates its pick below the greedy pick.
          const gVal = value(a, a.greedy);
          expect(gVal).toBeDefined();
          expect(bestVal).toBeGreaterThanOrEqual(gVal!);
          if (bestVal > gVal!) strictImprovements++;
        }, seed);
      }
    }

    // Sanity: we actually reached solvable endgames…
    expect(analyzed).toBeGreaterThan(50);
    // …and in at least some of them the search found a play the greedy heuristic
    // would have missed. This is the whole point of the lookahead.
    expect(strictImprovements).toBeGreaterThan(0);
  }, 120000);
});

describe('lookahead — exact vs an independent reference solver', () => {
  // A reference max-n solver that reuses the PRODUCTION reducer (no Sim, no TT,
  // no pruning) — the fully independent oracle. It returns each seat's final
  // round total under optimal self-maximising play; every seat maximises its own
  // component. Kept for TINY residual positions so the brute force stays cheap.
  function refSolve(state: GameState, memo = new Map<string, number[]>()): number[] {
    let s = state;
    // Fast-forward system screens to the next decision / round end.
    while (s.status === 'trick_complete') s = gameReducer(s, { type: 'NEXT_TRICK' })!;
    if (s.status !== 'playing') return s.players.map((p) => s.scores[p.id].total);

    const p = getCurrentPlayer(s);
    const seat = p.seatIndex;
    const valid = getValidCards(p.hand, s.currentTrick?.ledSuit ?? null, s.currentRound.mode.id, s.trumpSuit);
    let best: number[] | null = null;
    for (const card of valid) {
      const next = gameReducer(s, { type: 'PLAY_CARD', playerId: p.id, card })!;
      const vec = refSolve(next, memo);
      if (best === null || vec[seat] > best[seat]) best = vec;
    }
    return best!;
  }

  it('candidate value differences match the reference solver on small positions', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 12; seed++) {
      for (const names of [['A', 'B', 'C'], ['A', 'B', 'C', 'D']]) {
        drive(start(names, seed), (s) => {
          if (checked >= 12) return;
          const remaining = s.players.reduce((n, p) => n + p.hand.length, 0);
          if (remaining > 9) return; // keep the brute force cheap
          const a = analyzeLookahead(s);
          if (!a) return;
          const seat = getCurrentPlayer(s).seatIndex;

          // Reference: play each root card, then solve optimally to round end.
          const ref = a.candidates.map(({ card }) => {
            const next = gameReducer(s, { type: 'PLAY_CARD', playerId: getCurrentPlayer(s).id, card })!;
            return refSolve(next)[seat];
          });
          // lookahead values are FUTURE deltas; the reference totals differ from
          // them only by a per-position constant (points from already-played
          // tricks), which cancels in differences. So (ref − value) is constant.
          const offsets = a.candidates.map((c, i) => ref[i] - c.value);
          for (const o of offsets) expect(o).toBeCloseTo(offsets[0], 6);
          // And the argmax must agree: the reference's best is a lookahead best.
          const refBest = Math.max(...ref);
          const laBest = Math.max(...a.candidates.map((c) => c.value));
          a.candidates.forEach((c, i) => {
            if (Math.abs(ref[i] - refBest) < 1e-9) expect(c.value).toBeCloseTo(laBest, 6);
          });
          checked++;
        }, seed);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  }, 120000);
});

describe('lookahead — determinism & fallback', () => {
  it('returns the same card for the same state', () => {
    drive(start(['A', 'B', 'C', 'D'], 99), (s) => {
      expect(cardEquals(aiChooseCardLookahead(s), aiChooseCardLookahead(s))).toBe(true);
    }, 3);
  });

  it('falls back to the greedy heuristic when a hand is above the gate', () => {
    // First lead of a 4-player round: 13 cards each → far above the gate, so
    // lookahead must defer to the exact greedy pick.
    let s = start(['A', 'B', 'C', 'D'], 5);
    while (s.status !== 'playing') {
      switch (s.status) {
        case 'mode_selection': s = gameReducer(s, { type: 'CHOOSE_MODE', modeId: aiChooseMode(s.dealerModes[getCurrentPlayer(s).id]) })!; break;
        case 'select_trump': { const d = getCurrentPlayer(s); s = gameReducer(s, { type: 'SELECT_TRUMP', suit: aiChooseTrump(d.hand) ?? d.hand[0].suit })!; break; }
        case 'kitty_exchange': { const d = s.players[s.dealerIndex]; s = gameReducer(s, { type: 'EXCHANGE_KITTY', discards: aiChooseKittyDiscards(d.hand, s.config.kittySize, s.currentRound.mode.id) })!; break; }
        default: throw new Error(`unexpected ${s.status}`);
      }
    }
    expect(getCurrentPlayer(s).hand.length).toBeGreaterThan(6);
    expect(analyzeLookahead(s)).toBeNull();
    expect(cardEquals(aiChooseCardLookahead(s), aiChooseCard(s))).toBe(true);
  });
});
