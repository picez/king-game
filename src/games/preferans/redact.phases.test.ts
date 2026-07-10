// ---------------------------------------------------------------------------
// Preferans redaction — full phase × seat coverage (Stage 19.4 readiness).
// Proves preferansRedactStateFor upholds PREFERANS_RULES.md §14 at EVERY phase and
// for EVERY viewer (each seat + a spectator): a viewer sees only their own hand;
// the talon is hidden before it is taken, and after TAKE_TALON its cards are only
// visible to the declarer (folded into their private hand); discards are hidden
// from EVERYONE (including the declarer); the trick, bids, contract, scores,
// tricks and the score-only handHistory are public; counts the UI needs survive.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { preferansReducer } from './engine';
import { preferansBotAction } from './ai';
import { getActingPreferansSeat } from './rules';
import { preferansRedactStateFor } from './redact';
import type { PreferansAction, PreferansState } from './types';

const ctxOf = (seed: number) => ({ rng: makeRng(seed) });
const SEATS = [0, 1, 2] as const;
const key = (c: { suit: string; rank: string }) => `${c.suit}:${c.rank}`;
const allHidden = (cards: { rank: string }[]) => cards.every((c) => c.rank === '?');

function start(seed: number, dealerSeat = 0): PreferansState {
  return preferansReducer(null, {
    type: 'START_GAME', playerNames: ['A', 'B', 'C'], playerTypes: ['ai', 'ai', 'ai'], dealerSeat,
  }, ctxOf(seed)) as PreferansState;
}
function apply(s: PreferansState, ctx: { rng: () => number }, actions: PreferansAction[]): PreferansState {
  for (const a of actions) s = preferansReducer(s, a, ctx) as PreferansState;
  return s;
}

/** Every seat sees ONLY its own hand; a spectator sees none; counts are preserved. */
function assertOwnHandOnly(s: PreferansState) {
  for (const viewer of SEATS) {
    const view = preferansRedactStateFor(s, viewer);
    for (const seat of SEATS) {
      expect(view.handsBySeat[seat]).toHaveLength(s.handsBySeat[seat].length); // count kept for the UI
      if (seat === viewer) expect(view.handsBySeat[seat].map(key)).toEqual(s.handsBySeat[seat].map(key));
      else expect(allHidden(view.handsBySeat[seat])).toBe(true);
    }
    // Public fields survive untouched.
    expect(view.bids).toEqual(s.bids);
    expect(view.highBid).toEqual(s.highBid);
    expect(view.contract).toEqual(s.contract);
    expect(view.scores).toEqual(s.scores);
    expect(view.tricksBySeat).toEqual(s.tricksBySeat);
    expect(view.currentTrick).toEqual(s.currentTrick);
    expect(view.handHistory).toEqual(s.handHistory);
  }
  const spectator = preferansRedactStateFor(s, null);
  expect(spectator.handsBySeat.every(allHidden)).toBe(true);
  // Redaction never mutates the authoritative state.
  const before = JSON.stringify(s);
  preferansRedactStateFor(s, 0);
  expect(JSON.stringify(s)).toBe(before);
}

/** Talon + discards are hidden from EVERY viewer (including the declarer + spectator). */
function assertTalonAndDiscardsHidden(s: PreferansState) {
  for (const viewer of [...SEATS, null] as (number | null)[]) {
    const view = preferansRedactStateFor(s, viewer);
    expect(view.talon).toHaveLength(s.talon.length);
    expect(view.discards).toHaveLength(s.discards.length);
    expect(allHidden(view.talon)).toBe(true);
    expect(allHidden(view.discards)).toBe(true);
  }
}

describe('redaction — bidding phase', () => {
  it('own hand only for each seat; the un-taken talon is hidden from everyone', () => {
    const s = start(3, 0);
    expect(s.phase).toBe('bidding');
    assertOwnHandOnly(s);
    assertTalonAndDiscardsHidden(s);
  });
});

describe('redaction — talon phase (before + after take, after discard)', () => {
  function toTalon(seed: number) {
    const ctx = ctxOf(seed);
    const s = apply(start(seed, 0), ctx, [{ type: 'BID', level: 6, suit: 'spades' }, { type: 'PASS_BID' }, { type: 'PASS_BID' }]);
    return { s, ctx }; // declarer = seat 1
  }

  it('before TAKE_TALON: talon hidden from everyone (incl. the declarer)', () => {
    const { s } = toTalon(13);
    expect(s.phase).toBe('talon');
    expect(s.talon).toHaveLength(2);
    assertOwnHandOnly(s);
    assertTalonAndDiscardsHidden(s);
  });

  it('after TAKE_TALON: the talon cards are visible ONLY to the declarer (in-hand); defenders see 12 hidden', () => {
    const { s: t0, ctx } = toTalon(13);
    const talonKeys = new Set(t0.talon.map(key));
    const s = preferansReducer(t0, { type: 'TAKE_TALON' }, ctx) as PreferansState;
    expect(s.talon).toHaveLength(0);
    expect(s.handsBySeat[1]).toHaveLength(12);

    // Declarer (seat 1) sees the full 12 — including the 2 former talon cards.
    const declView = preferansRedactStateFor(s, 1);
    const declKeys = new Set(declView.handsBySeat[1].map(key));
    for (const k of talonKeys) expect(declKeys.has(k)).toBe(true);
    expect(allHidden(declView.handsBySeat[1])).toBe(false);

    // Defenders (seats 0, 2) + a spectator see the declarer's 12 as face-down only.
    for (const viewer of [0, 2, null] as (number | null)[]) {
      const view = preferansRedactStateFor(s, viewer);
      expect(view.handsBySeat[1]).toHaveLength(12);
      expect(allHidden(view.handsBySeat[1])).toBe(true);
      // None of the talon cards leak to a non-declarer.
      const visible = view.handsBySeat.flat().filter((c) => c.rank !== '?').map(key);
      for (const k of visible) expect(talonKeys.has(k)).toBe(false);
    }
    assertOwnHandOnly(s);
  });

  it('after DISCARD: the 2 discards are hidden from everyone (incl. the declarer)', () => {
    const { s: t0, ctx } = toTalon(21);
    const taken = preferansReducer(t0, { type: 'TAKE_TALON' }, ctx) as PreferansState;
    const [a, b] = taken.handsBySeat[1];
    const s = preferansReducer(taken, { type: 'DISCARD', cards: [a, b] }, ctx) as PreferansState;
    expect(s.discards).toHaveLength(2);
    const buriedKeys = new Set(s.discards.map(key));

    for (const viewer of [...SEATS, null] as (number | null)[]) {
      const view = preferansRedactStateFor(s, viewer);
      expect(allHidden(view.discards)).toBe(true);
      // The buried cards appear nowhere visible for ANY viewer (not even the declarer's hand).
      const visible = [...view.handsBySeat.flat(), ...view.talon, ...view.discards].filter((c) => c.rank !== '?').map(key);
      for (const k of visible) expect(buriedKeys.has(k)).toBe(false);
    }
    assertOwnHandOnly(s);
    assertTalonAndDiscardsHidden(s);
  });
});

describe('redaction — playing / hand_complete / finished', () => {
  it('mid-play: own hand only, the current trick is public, discards stay hidden', () => {
    const ctx = ctxOf(101);
    let s = start(101, 0);
    let guard = 0;
    while (s.phase !== 'playing' && guard++ < 300) {
      s = preferansReducer(s, preferansBotAction(s, getActingPreferansSeat(s)!), ctx) as PreferansState;
    }
    // Advance a couple of plays so a trick is in progress.
    for (let i = 0; i < 2 && s.phase === 'playing'; i++) {
      s = preferansReducer(s, preferansBotAction(s, getActingPreferansSeat(s)!), ctx) as PreferansState;
    }
    expect(s.phase).toBe('playing');
    assertOwnHandOnly(s);
    assertTalonAndDiscardsHidden(s);
    // The trick in progress is identical for a viewer and a spectator (public).
    expect(preferansRedactStateFor(s, 0).currentTrick).toEqual(s.currentTrick);
    expect(preferansRedactStateFor(s, null).currentTrick).toEqual(s.currentTrick);
  });

  it('at hand_complete / finished the score-only handHistory is public and carries no cards', () => {
    const ctx = ctxOf(2024);
    let s = start(2024, 0);
    let guard = 0;
    // Drive to the first scored hand (hand_complete) — or the whole match if short.
    while (s.phase !== 'hand_complete' && s.phase !== 'game_finished' && guard++ < 40000) {
      s = preferansReducer(s, preferansBotAction(s, s.currentSeat), ctx) as PreferansState;
    }
    expect(['hand_complete', 'game_finished']).toContain(s.phase);
    expect(s.handHistory.length).toBeGreaterThan(0);
    for (const viewer of [0, 1, 2, null] as (number | null)[]) {
      const view = preferansRedactStateFor(s, viewer);
      expect(view.handHistory).toEqual(s.handHistory);           // public + unchanged
      for (const h of view.handHistory) expect(h).not.toHaveProperty('cards'); // score-only
      expect(view.scores).toEqual(s.scores);
      expect(view.lastHand).toEqual(s.lastHand);
    }
  });
});
