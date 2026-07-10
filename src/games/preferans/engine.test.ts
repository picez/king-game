import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { makeRng } from '../../core/rng';
import { rankValueOf } from './deck';
import { preferansReducer, gameValue } from './engine';
import { preferansBotAction } from './ai';
import { checkPreferansInvariants } from './invariants';
import type { PreferansAction, PreferansState } from './types';

const C = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: rankValueOf(rank) });
const ctxOf = (seed: number) => ({ rng: makeRng(seed) });

function start(seed = 1, dealerSeat = 0): PreferansState {
  return preferansReducer(null, {
    type: 'START_GAME', playerNames: ['A', 'B', 'C'], playerTypes: ['ai', 'ai', 'ai'], dealerSeat,
  }, ctxOf(seed)) as PreferansState;
}
/** Apply a sequence of actions with a shared ctx; returns the final state. */
function apply(s: PreferansState, ctx: { rng: () => number }, actions: PreferansAction[]): PreferansState {
  for (const a of actions) s = preferansReducer(s, a, ctx) as PreferansState;
  return s;
}

describe('START_GAME', () => {
  it('deals 10 to each of 3 seats + a 2-card talon and opens bidding left of dealer', () => {
    const s = start(3, 0);
    expect(s.phase).toBe('bidding');
    expect(s.players).toHaveLength(3);
    expect(s.handsBySeat.map((h) => h.length)).toEqual([10, 10, 10]);
    expect(s.talon).toHaveLength(2);
    expect(s.dealerSeat).toBe(0);
    expect(s.currentSeat).toBe(1); // left of dealer
    expect(checkPreferansInvariants(s)).toEqual([]);
  });

  it('is illegal to re-start or start with the wrong player count', () => {
    const s = start();
    expect(preferansReducer(s, { type: 'START_GAME', playerNames: ['A', 'B', 'C'] }, ctxOf(1))).toBe(s);
    expect(preferansReducer(null, { type: 'START_GAME', playerNames: ['A', 'B'] }, ctxOf(1))).toBeNull();
  });
});

describe('bidding', () => {
  it('a bid sets the high bid; a lower/equal bid is rejected (same reference)', () => {
    const ctx = ctxOf(5);
    let s = start(5, 0); // currentSeat 1
    s = preferansReducer(s, { type: 'BID', level: 6, suit: 'clubs' }, ctx) as PreferansState;
    expect(s.highBid).toMatchObject({ level: 6, suit: 'clubs', seat: 1 });
    expect(s.currentSeat).toBe(2);
    // seat 2 tries 6♠ (below 6♣) → illegal, same ref.
    const same = preferansReducer(s, { type: 'BID', level: 6, suit: 'spades' }, ctx);
    expect(same).toBe(s);
  });

  it('two passes after a bid make the sole bidder the declarer (→ talon)', () => {
    const ctx = ctxOf(9);
    let s = start(9, 0); // currentSeat 1
    s = apply(s, ctx, [
      { type: 'BID', level: 6, suit: 'spades' }, // seat 1
      { type: 'PASS_BID' },                       // seat 2
      { type: 'PASS_BID' },                       // seat 0
    ]);
    expect(s.phase).toBe('talon');
    expect(s.declarerSeat).toBe(1);
    expect(s.currentSeat).toBe(1);
    expect(s.talon).toHaveLength(2);
  });

  it('all-pass redeals to the NEXT dealer with the hand number unchanged', () => {
    const ctx = ctxOf(11);
    let s = start(11, 0);
    const hand0 = s.handsBySeat.map((h) => h.map((c) => `${c.suit}${c.rank}`).join(','));
    s = apply(s, ctx, [{ type: 'PASS_BID' }, { type: 'PASS_BID' }, { type: 'PASS_BID' }]);
    expect(s.phase).toBe('bidding');
    expect(s.dealerSeat).toBe(1);         // rotated left
    expect(s.currentSeat).toBe(2);        // left of the new dealer
    expect(s.handNumber).toBe(1);         // a redeal is not a played hand
    const hand1 = s.handsBySeat.map((h) => h.map((c) => `${c.suit}${c.rank}`).join(','));
    expect(hand1).not.toEqual(hand0);     // a fresh deal
    expect(checkPreferansInvariants(s)).toEqual([]);
  });
});

describe('talon → discard → declare', () => {
  function toTalon(seed: number) {
    const ctx = ctxOf(seed);
    let s = start(seed, 0);
    s = apply(s, ctx, [{ type: 'BID', level: 6, suit: 'spades' }, { type: 'PASS_BID' }, { type: 'PASS_BID' }]);
    return { s, ctx }; // declarer = seat 1, phase 'talon'
  }

  it('TAKE_TALON → 12 cards; DISCARD 2 → 10; DECLARE ≥ bid → playing', () => {
    const { s: t0, ctx } = toTalon(13);
    const s1 = preferansReducer(t0, { type: 'TAKE_TALON' }, ctx) as PreferansState;
    expect(s1.handsBySeat[1]).toHaveLength(12);
    expect(s1.talon).toHaveLength(0);

    const [d1, d2] = s1.handsBySeat[1];
    const s2 = preferansReducer(s1, { type: 'DISCARD', cards: [d1, d2] }, ctx) as PreferansState;
    expect(s2.handsBySeat[1]).toHaveLength(10);
    expect(s2.discards).toHaveLength(2);

    const s3 = preferansReducer(s2, { type: 'DECLARE_CONTRACT', level: 6, suit: 'spades' }, ctx) as PreferansState;
    expect(s3.phase).toBe('playing');
    expect(s3.contract).toEqual({ level: 6, suit: 'spades' });
    expect(s3.currentSeat).toBe(2);       // left-hand defender of declarer(1) leads
    expect(s3.currentTrick?.leadSeat).toBe(2);
    expect(checkPreferansInvariants(s3)).toEqual([]);
  });

  it('rejects a wrong-count discard and a contract below the winning bid (same reference)', () => {
    const ctx = ctxOf(21);
    let s = start(21, 0);
    // Auction where the declarer's winning bid is 6♦.
    s = apply(s, ctx, [{ type: 'BID', level: 6, suit: 'diamonds' }, { type: 'PASS_BID' }, { type: 'PASS_BID' }]);
    s = preferansReducer(s, { type: 'TAKE_TALON' }, ctx) as PreferansState;
    // A single-card discard is illegal.
    const bad = preferansReducer(s, { type: 'DISCARD', cards: [s.handsBySeat[1][0]] as unknown as [Card, Card] }, ctx);
    expect(bad).toBe(s);
    const [a, b] = s.handsBySeat[1];
    s = preferansReducer(s, { type: 'DISCARD', cards: [a, b] }, ctx) as PreferansState;
    // 6♠ is below the winning bid 6♦ → illegal.
    const below = preferansReducer(s, { type: 'DECLARE_CONTRACT', level: 6, suit: 'spades' }, ctx);
    expect(below).toBe(s);
    // 6♥ is above 6♦ → legal.
    const ok = preferansReducer(s, { type: 'DECLARE_CONTRACT', level: 6, suit: 'hearts' }, ctx) as PreferansState;
    expect(ok.phase).toBe('playing');
  });
});

describe('trick play (crafted state)', () => {
  function playing(partial: Partial<PreferansState>): PreferansState {
    return {
      gameType: 'preferans', phase: 'playing',
      players: [0, 1, 2].map((i) => ({ id: `player-${i}`, name: 'x', seatIndex: i, type: 'ai' as const })),
      dealerSeat: 0, currentSeat: 0, handsBySeat: [[], [], []], talon: [], discards: [],
      bids: [], passed: [false, false, false], highBid: { level: 6, suit: 'spades', seat: 0 },
      declarerSeat: 0, contract: { level: 6, suit: 'spades' },
      currentTrick: { leadSeat: 0, ledSuit: null, plays: [], winnerSeat: null },
      completedTricks: [], tricksBySeat: [0, 0, 0], scores: [0, 0, 0], handNumber: 1,
      targetScore: 10, options: { targetScore: 10 }, lastHand: null, handHistory: [], winnerSeat: null,
      ...partial,
    };
  }

  it('must follow the led suit if able (illegal off-suit play = same reference)', () => {
    const s = playing({
      currentSeat: 0,
      handsBySeat: [[C('hearts', 'K'), C('hearts', '7'), C('spades', 'A')], [], []],
      currentTrick: {
        leadSeat: 2, ledSuit: 'hearts', winnerSeat: null,
        plays: [{ seat: 2, card: C('hearts', '9'), playOrder: 1 }, { seat: 1, card: C('hearts', '10'), playOrder: 2 }],
      },
    });
    // Off-suit spade is illegal while holding hearts.
    expect(preferansReducer(s, { type: 'PLAY_CARD', card: C('spades', 'A') }, ctxOf(1))).toBe(s);
    // Following with a heart resolves the (3-player) trick.
    const r = preferansReducer(s, { type: 'PLAY_CARD', card: C('hearts', 'K') }, ctxOf(1)) as PreferansState;
    expect(r.completedTricks).toHaveLength(1);
    expect(r.completedTricks[0].winnerSeat).toBe(0);  // K♥ beats 10♥/9♥
    expect(r.tricksBySeat[0]).toBe(1);
    expect(r.currentSeat).toBe(0);                    // winner leads next
    expect(r.currentTrick?.leadSeat).toBe(0);
  });
});

describe('scoring + end (bot-driven real hands)', () => {
  function playGame(seed: number, cap = 40000) {
    const ctx = ctxOf(seed);
    let s = preferansReducer(null, {
      type: 'START_GAME', playerNames: ['A', 'B', 'C'], playerTypes: ['ai', 'ai', 'ai'],
    }, ctx) as PreferansState;
    let steps = 0;
    const problems: string[] = [];
    while (s.phase !== 'game_finished' && steps < cap) {
      problems.push(...checkPreferansInvariants(s));
      const action = preferansBotAction(s, s.currentSeat);
      const next = preferansReducer(s, action, ctx) as PreferansState;
      if (next === s) throw new Error(`illegal bot action in phase ${s.phase}`);
      s = next; steps++;
    }
    problems.push(...checkPreferansInvariants(s));
    return { s, steps, problems };
  }

  it('a bot-only match terminates with invariants intact (multiple seeds)', () => {
    for (const seed of [1, 2, 3, 7, 42, 100, 2024]) {
      const { s, steps, problems } = playGame(seed);
      expect(s.phase, `seed ${seed}`).toBe('game_finished');
      expect(steps, `seed ${seed} cap`).toBeLessThan(40000);
      expect(problems, `seed ${seed} invariants`).toEqual([]);
      // Each hand played 10 tricks; history is score-only (no cards).
      for (const h of s.handHistory) {
        expect(h).not.toHaveProperty('cards');
        expect(Object.keys(h).sort()).toEqual(['contract', 'declarerSeat', 'declarerTricks', 'deltaBySeat', 'handNumber', 'made'].sort());
      }
    }
  });

  it('the §10 scoring formula holds on every scored hand, and both made & set occur', () => {
    let sawMade = false, sawSet = false, sawNegativeDelta = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 8, 9, 42, 77, 100, 2024]) {
      const { s } = playGame(seed);
      for (const h of s.handHistory) {
        const g = gameValue(h.contract.level);
        expect(g).toBe(h.contract.level - 5);
        if (h.made) {
          sawMade = true;
          expect(h.deltaBySeat[h.declarerSeat]).toBe(g);
          for (let seat = 0; seat < 3; seat++) if (seat !== h.declarerSeat) expect(h.deltaBySeat[seat]).toBe(0);
        } else {
          sawSet = true;
          expect(h.deltaBySeat[h.declarerSeat]).toBe(-g);   // negative delta allowed
          sawNegativeDelta = true;
          for (let seat = 0; seat < 3; seat++) if (seat !== h.declarerSeat) expect(h.deltaBySeat[seat]).toBe(g);
        }
      }
      // Match ends once a score reaches the target; a unique leader wins, else a draw.
      const max = Math.max(...s.scores);
      expect(max).toBeGreaterThanOrEqual(s.targetScore);
      const leaders = s.scores.filter((v) => v === max).length;
      expect(s.winnerSeat === null ? leaders : 1).toBeGreaterThanOrEqual(1);
    }
    expect(sawMade).toBe(true);
    expect(sawSet).toBe(true);
    expect(sawNegativeDelta).toBe(true);
  });

  it('gameValue maps levels 6..10 → 1..5', () => {
    expect([6, 7, 8, 9, 10].map(gameValue)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('illegal actions return the same reference', () => {
  it('acting in the wrong phase is a no-op', () => {
    const s = start(1, 0); // bidding phase
    expect(preferansReducer(s, { type: 'PLAY_CARD', card: C('spades', 'A') }, ctxOf(1))).toBe(s);
    expect(preferansReducer(s, { type: 'TAKE_TALON' }, ctxOf(1))).toBe(s);
    expect(preferansReducer(s, { type: 'START_NEXT_HAND' }, ctxOf(1))).toBe(s);
  });
});
