// ---------------------------------------------------------------------------
// Preferans invariant + soak tests (Stage 19.4 hardening). Proves the reducer
// never corrupts the 32-card deck or the trick/score bookkeeping across every
// phase, that the invariant checker actually CATCHES corruption, and that a
// bot-only match always terminates (no endless all-pass redeal) with invariants
// holding throughout — over many seeds. See PREFERANS_RULES.md §16.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { makeRng } from '../../core/rng';
import { rankValueOf } from './deck';
import { preferansReducer } from './engine';
import { preferansBotAction } from './ai';
import { getActingPreferansSeat, bidRank } from './rules';
import { checkPreferansInvariants } from './invariants';
import type { PreferansAction, PreferansState } from './types';

const C = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: rankValueOf(rank) });
const ctxOf = (seed: number) => ({ rng: makeRng(seed) });

function start(seed: number, dealerSeat = 0): PreferansState {
  return preferansReducer(null, {
    type: 'START_GAME', playerNames: ['A', 'B', 'C'], playerTypes: ['ai', 'ai', 'ai'], dealerSeat,
  }, ctxOf(seed)) as PreferansState;
}
function apply(s: PreferansState, ctx: { rng: () => number }, actions: PreferansAction[]): PreferansState {
  for (const a of actions) s = preferansReducer(s, a, ctx) as PreferansState;
  return s;
}
/** Total real cards across every zone (hands + talon + discards + played). */
function totalCards(s: PreferansState): number {
  return s.handsBySeat.reduce((n, h) => n + h.length, 0) + s.talon.length + s.discards.length
    + s.completedTricks.reduce((n, t) => n + t.plays.length, 0) + (s.currentTrick?.plays.length ?? 0);
}

describe('hand sizes by phase', () => {
  it('deal = 10/10/10 + a 2-card talon; take → declarer 12; discard → 10', () => {
    const ctx = ctxOf(31);
    let s = start(31, 0);
    expect(s.handsBySeat.map((h) => h.length)).toEqual([10, 10, 10]);
    expect(s.talon).toHaveLength(2);
    expect(totalCards(s)).toBe(32);

    // Auction: seat 1 wins (bid + two passes) → declarer = seat 1.
    s = apply(s, ctx, [{ type: 'BID', level: 6, suit: 'spades' }, { type: 'PASS_BID' }, { type: 'PASS_BID' }]);
    expect(s.phase).toBe('talon');
    expect(s.declarerSeat).toBe(1);

    s = preferansReducer(s, { type: 'TAKE_TALON' }, ctx) as PreferansState;
    expect(s.handsBySeat[1]).toHaveLength(12);   // declarer holds the talon briefly
    expect(s.talon).toHaveLength(0);
    expect(totalCards(s)).toBe(32);              // conserved through the take

    const [d1, d2] = s.handsBySeat[1];
    s = preferansReducer(s, { type: 'DISCARD', cards: [d1, d2] }, ctx) as PreferansState;
    expect(s.handsBySeat[1]).toHaveLength(10);   // back to 10 after burying 2
    expect(s.discards).toHaveLength(2);
    expect(totalCards(s)).toBe(32);
    expect(checkPreferansInvariants(s)).toEqual([]);
  });

  it('during trick play the in-hand total decreases 3 per completed trick (32 conserved)', () => {
    const ctx = ctxOf(77);
    let s = start(77, 0);
    // Drive with bots until playing begins.
    let guard = 0;
    while (s.phase !== 'playing' && guard++ < 200) {
      const seat = getActingPreferansSeat(s)!;
      s = preferansReducer(s, preferansBotAction(s, seat), ctx) as PreferansState;
    }
    expect(s.phase).toBe('playing');
    let lastInHand = s.handsBySeat.reduce((n, h) => n + h.length, 0);
    let lastCompleted = s.completedTricks.length;
    guard = 0;
    while (s.phase === 'playing' && guard++ < 200) {
      const seat = getActingPreferansSeat(s)!;
      s = preferansReducer(s, preferansBotAction(s, seat), ctx) as PreferansState;
      expect(totalCards(s)).toBe(32);            // never leaks a card mid-trick
      expect(s.completedTricks.length).toBeLessThanOrEqual(10);
      if (s.completedTricks.length > lastCompleted) {
        const inHand = s.handsBySeat.reduce((n, h) => n + h.length, 0);
        expect(inHand).toBe(lastInHand - 3);     // one card left each hand per trick
        lastInHand = inHand; lastCompleted = s.completedTricks.length;
      }
    }
  });
});

describe('checkPreferansInvariants catches corruption', () => {
  const base = () => start(5, 0);

  it('flags a duplicated card', () => {
    const s = base();
    const dup = { ...s, handsBySeat: [[...s.handsBySeat[0], { ...s.handsBySeat[1][0] }], s.handsBySeat[1], s.handsBySeat[2]] };
    expect(checkPreferansInvariants(dup)).toContain('duplicate card in play');
  });

  it('flags a wrong card count (a lost card)', () => {
    const s = base();
    const short = { ...s, talon: [s.talon[0]] };     // dropped one talon card → 31
    const errs = checkPreferansInvariants(short);
    expect(errs.some((e) => e.startsWith('card count'))).toBe(true);
    expect(errs).toContain('talon size 1');
  });

  it('flags a non-ascending auction and a contract below the winning bid', () => {
    const s = base();
    const badBids = {
      ...s,
      bids: [{ seat: 0, bid: { level: 8, suit: 'hearts' as const } }, { seat: 1, bid: { level: 6, suit: 'spades' as const } }],
    };
    expect(checkPreferansInvariants(badBids)).toContain('bids not strictly ascending');

    const belowContract = {
      ...s,
      highBid: { level: 8, suit: 'hearts' as const, seat: 0 },
      contract: { level: 6, suit: 'spades' as const },
    };
    expect(checkPreferansInvariants(belowContract)).toContain('contract below winning bid');
  });
});

describe('auction ordering + acting seat validity across a full game', () => {
  it('bids ascend strictly and the acting seat is always valid (or null between hands)', () => {
    const ctx = ctxOf(2024);
    let s = start(2024, 0);
    let guard = 0;
    while (s.phase !== 'game_finished' && guard++ < 40000) {
      // The acting seat is null (public screen) or a real 0..2 seat == currentSeat.
      const acting = getActingPreferansSeat(s);
      if (acting !== null) {
        expect(acting).toBe(s.currentSeat);
        expect(acting).toBeGreaterThanOrEqual(0);
        expect(acting).toBeLessThan(3);
      }
      // Whenever bids exist, they form a strictly ascending ladder.
      const ranks = s.bids.filter((b) => b.bid).map((b) => bidRank(b.bid!));
      for (let i = 1; i < ranks.length; i++) expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
      // A declared contract is never below the winning bid.
      if (s.contract && s.highBid) expect(bidRank(s.contract)).toBeGreaterThanOrEqual(bidRank(s.highBid));

      if (s.phase === 'hand_complete') { s = preferansReducer(s, { type: 'START_NEXT_HAND' }, ctx) as PreferansState; continue; }
      s = preferansReducer(s, preferansBotAction(s, s.currentSeat), ctx) as PreferansState;
    }
    expect(s.phase).toBe('game_finished');
  });
});

describe('bot-only soak: always terminates with invariants intact', () => {
  it('over many seeds a 3-bot match finishes well under cap, with hands actually played', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i * 7 + 1);
    for (const seed of seeds) {
      const ctx = ctxOf(seed);
      let s = start(seed, seed % 3);
      let steps = 0;
      const problems: string[] = [];
      while (s.phase !== 'game_finished' && steps < 40000) {
        problems.push(...checkPreferansInvariants(s));
        const action = s.phase === 'hand_complete'
          ? ({ type: 'START_NEXT_HAND' } as PreferansAction)
          : preferansBotAction(s, s.currentSeat);
        const next = preferansReducer(s, action, ctx) as PreferansState;
        if (next === s) throw new Error(`illegal bot action in phase ${s.phase} (seed ${seed})`);
        s = next; steps++;
      }
      problems.push(...checkPreferansInvariants(s));
      expect(problems, `seed ${seed} invariants`).toEqual([]);
      expect(s.phase, `seed ${seed}`).toBe('game_finished');
      expect(steps, `seed ${seed} terminates well under cap`).toBeLessThan(4000);
      // The AI never lets an auction all-pass into an endless redeal → hands were played.
      expect(s.handHistory.length, `seed ${seed} played hands`).toBeGreaterThan(0);
      // handHistory is score-only (no cards leak into the public record).
      for (const h of s.handHistory) expect(h).not.toHaveProperty('cards');
    }
  });
});
