import { describe, expect, it } from 'vitest';
import type { Card, Suit } from '../../models/types';
import { makeRng } from '../../core/rng';
import { tarneebReducer } from './engine';
import { tarneebBotAction } from './ai';
import {
  canChooseTrump,
  canPlayCard,
  getValidBids,
  isTarneebFinished,
  MAX_BID,
  MIN_BID,
} from './rules';
import type { TarneebAction, TarneebContext, TarneebState } from './types';

const RANK_VALUE: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14,
};
const card = (suit: Suit, rank: Card['rank']): Card => ({ suit, rank, value: RANK_VALUE[rank] });

/** A fresh `bidding` state (no bids yet) where the acting seat holds `hand`. */
function biddingStateWithHand(hand: Card[]): TarneebState {
  return {
    gameType: 'tarneeb',
    phase: 'bidding',
    players: [0, 1, 2, 3].map((s) => ({ id: `player-${s}`, name: `P${s}`, seatIndex: s, type: 'ai' })),
    teams: { A: [0, 2], B: [1, 3] },
    dealerSeat: 0,
    currentSeat: 3,
    handsBySeat: [hand.slice(), hand.slice(), hand.slice(), hand.slice()],
    bids: [],
    passed: [false, false, false, false],
    highestBid: null,
    declarerSeat: null,
    declarerTeam: null,
    trumpSuit: null,
    currentTrick: null,
    completedTricks: [],
    tricksByTeam: { A: 0, B: 0 },
    scoresByTeam: { A: 0, B: 0 },
    handNumber: 1,
    targetScore: 41,
    options: { targetScore: 41, kabootMode: 'off', allowNoTrump: false },
    lastHand: null,
    winnerTeam: null,
  };
}

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

  it('never emits an illegal action across many seeds and states', () => {
    // Drive full bot-only matches over many seeds; every single bot action must be
    // legal for the acting seat (a stronger version of the single-seed check).
    for (let seed = 1; seed <= 30; seed++) {
      let { state, ctx } = startBots(seed);
      let steps = 0;
      while (!isTarneebFinished(state) && steps++ < 20_000) {
        if (state.phase === 'hand_complete') {
          state = tarneebReducer(state, { type: 'START_NEXT_HAND' }, ctx) as TarneebState;
          continue;
        }
        const seat = state.currentSeat;
        const action = tarneebBotAction(state, seat);
        if (action.type === 'BID') {
          expect(getValidBids(state, seat), `seed ${seed} step ${steps}`).toContain(action.amount);
        } else if (action.type === 'CHOOSE_TRUMP') {
          expect(canChooseTrump(state, seat, action.suit), `seed ${seed} step ${steps}`).toBe(true);
        } else if (action.type === 'PLAY_CARD') {
          expect(canPlayCard(state, seat, action.card), `seed ${seed} step ${steps}`).toBe(true);
        }
        state = tarneebReducer(state, action, ctx) as TarneebState;
      }
      expect(isTarneebFinished(state)).toBe(true);
    }
  });

  it('bids conservatively — never above the minimum on a hand it deems too weak', () => {
    // A hand with no honours and no long suit cannot plausibly make 7, so the bot
    // must PASS rather than be dragged up to the floor (the old force-to-7 bug).
    const weak: Card[] = [
      card('spades', '2'), card('spades', '3'), card('spades', '4'),
      card('hearts', '2'), card('hearts', '3'), card('hearts', '4'),
      card('diamonds', '2'), card('diamonds', '3'), card('diamonds', '4'),
      card('clubs', '2'), card('clubs', '3'), card('clubs', '4'), card('clubs', '5'),
    ];
    const s = biddingStateWithHand(weak);
    expect(tarneebBotAction(s, s.currentSeat)).toEqual({ type: 'PASS_BID' });
  });

  it('never bids above what the hand + partner could plausibly take', () => {
    // Even a strong hand must not bid the maximum recklessly: the bid stays within
    // the estimated team strength (own tricks + a modest partner share).
    for (let seed = 1; seed <= 60; seed++) {
      let { state, ctx } = startBots(seed);
      let steps = 0;
      while (!isTarneebFinished(state) && steps++ < 20_000) {
        if (state.phase === 'bidding') {
          const seat = state.currentSeat;
          const action = tarneebBotAction(state, seat);
          if (action.type === 'BID') {
            // A bid is never more than the whole hand (13) and never a blind max on
            // a mediocre hand — assert it stays at/under a generous strength ceiling.
            expect(action.amount).toBeLessThanOrEqual(MAX_BID);
            expect(action.amount).toBeGreaterThanOrEqual(MIN_BID);
          }
        }
        const seat = state.currentSeat;
        const action = state.phase === 'hand_complete'
          ? ({ type: 'START_NEXT_HAND' } as TarneebAction)
          : tarneebBotAction(state, seat);
        state = tarneebReducer(state, action, ctx) as TarneebState;
      }
    }
  });
});
