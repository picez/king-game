// ---------------------------------------------------------------------------
// Tarneeb — structural invariants over full bot-only matches (soak-style). These
// guard the properties the online server and UI both rely on: a stable 52-card
// deck with no duplicates, an always-valid acting seat, terminating auctions, and
// a clean hand→hand hand-over. Complements engine.test.ts (rule-by-rule) and
// ai.test.ts (bot legality). See TARNEEB_RULES.md §11–§13, §15.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { tarneebReducer } from './engine';
import { tarneebBotAction } from './ai';
import { getActingTarneebSeat, isTarneebFinished, NUM_SEATS } from './rules';
import type { Card } from '../../models/types';
import type { TarneebAction, TarneebContext, TarneebState } from './types';

function startBots(seed: number): { state: TarneebState; ctx: TarneebContext } {
  const ctx: TarneebContext = { rng: makeRng(seed) };
  const state = tarneebReducer(
    null,
    { type: 'START_GAME', playerNames: ['B0', 'B1', 'B2', 'B3'], playerTypes: ['ai', 'ai', 'ai', 'ai'] },
    ctx,
  ) as TarneebState;
  return { state, ctx };
}

/** Every card currently somewhere on the table (hands + open trick + won tricks). */
function allCards(s: TarneebState): Card[] {
  const cards: Card[] = [];
  for (const h of s.handsBySeat) cards.push(...h);
  if (s.currentTrick) for (const p of s.currentTrick.plays) cards.push(p.card);
  for (const t of s.completedTricks) for (const p of t.plays) cards.push(p.card);
  return cards;
}

const key = (c: Card) => `${c.rank}${c.suit}`;

function step(s: TarneebState, ctx: TarneebContext): TarneebState {
  const action: TarneebAction =
    s.phase === 'hand_complete' ? { type: 'START_NEXT_HAND' } : tarneebBotAction(s, s.currentSeat);
  return tarneebReducer(s, action, ctx) as TarneebState;
}

describe('Tarneeb invariants (bot soak)', () => {
  it('keeps exactly 52 unique cards at every step of a full match', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let { state, ctx } = startBots(seed);
      let steps = 0;
      while (!isTarneebFinished(state) && steps++ < 30_000) {
        const cards = allCards(state);
        expect(cards, `seed ${seed} step ${steps}`).toHaveLength(52);
        expect(new Set(cards.map(key)).size, `seed ${seed} step ${steps} duplicate`).toBe(52);
        state = step(state, ctx);
      }
      expect(isTarneebFinished(state)).toBe(true);
    }
  }, 20_000); // CPU-bound soak — headroom under parallel CI load

  it('never strands the acting seat: an in-progress phase always names a valid, non-passed seat', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let { state, ctx } = startBots(seed);
      let steps = 0;
      while (!isTarneebFinished(state) && steps++ < 30_000) {
        const seat = getActingTarneebSeat(state);
        if (state.phase === 'bidding' || state.phase === 'choosing_trump' || state.phase === 'playing') {
          expect(seat, `seed ${seed} step ${steps}`).not.toBeNull();
          expect(seat! >= 0 && seat! < NUM_SEATS).toBe(true);
          // A seat that must act in the auction cannot already be out of it.
          if (state.phase === 'bidding') expect(state.passed[seat!]).toBe(false);
          // The declarer alone acts during trump choice.
          if (state.phase === 'choosing_trump') expect(seat).toBe(state.declarerSeat);
        }
        state = step(state, ctx);
      }
    }
  }, 20_000); // CPU-bound soak — headroom under parallel CI load

  it('always terminates the auction (bidding is bounded per hand)', () => {
    // From a fresh deal, no auction can exceed a small number of legal actions:
    // bids strictly increase (≤ 11 rungs, min 3) and each pass is final (≤ 4), so the
    // auction resolves — or a dead auction redeals — well within a tight bound.
    for (let seed = 1; seed <= 40; seed++) {
      let { state, ctx } = startBots(seed);
      let auctionSteps = 0;
      // Run until we leave the very first bidding phase (a bid resolves to
      // choosing_trump, or an all-pass redeal starts a brand-new auction).
      const firstDealer = state.dealerSeat;
      while (state.phase === 'bidding' && auctionSteps++ < 100) {
        state = step(state, ctx);
        // A redeal (still bidding, same dealer, empty auction) is a fresh auction.
        if (state.phase === 'bidding' && state.bids.length === 0 && state.dealerSeat === firstDealer) break;
      }
      expect(auctionSteps).toBeLessThan(100);
    }
  });

  it('hands over cleanly: START_NEXT_HAND deals a fresh 13-card hand and preserves scores', () => {
    // Drive to the first hand_complete, then verify the next hand is a clean deal
    // with unchanged cumulative scores and a rotated dealer.
    let { state, ctx } = startBots(3);
    let steps = 0;
    while (state.phase !== 'hand_complete' && steps++ < 30_000) {
      if (isTarneebFinished(state)) break;
      state = step(state, ctx);
    }
    expect(state.phase).toBe('hand_complete');
    const scoresBefore = { ...state.scoresByTeam };
    const dealerBefore = state.dealerSeat;
    const handBefore = state.handNumber;
    const next = tarneebReducer(state, { type: 'START_NEXT_HAND' }, ctx) as TarneebState;
    expect(next.phase).toBe('bidding');
    expect(next.handsBySeat.every((h) => h.length === 13)).toBe(true);
    expect(allCards(next)).toHaveLength(52);
    expect(new Set(allCards(next).map(key)).size).toBe(52);
    expect(next.scoresByTeam).toEqual(scoresBefore); // scores carry over untouched
    expect(next.handNumber).toBe(handBefore + 1);
    expect(next.dealerSeat).not.toBe(dealerBefore); // dealer rotated
    expect(next.completedTricks).toHaveLength(0);
    expect(next.trumpSuit).toBeNull();
  });
});
