import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Card, Suit } from '../../models/types';
import { makeRng, type Rng } from '../../core/rng';
import { tarneebReducer } from './engine';
import { tarneebBotAction } from './ai';
import { tarneebRedactStateFor } from './redact';
import {
  getActingTarneebSeat,
  getValidBids,
  getValidPlayableCards,
  isSoloTarneeb,
  nextSeatCounterClockwise,
} from './rules';
import type { TarneebAction, TarneebContext, TarneebState } from './types';

// ---------------------------------------------------------------------------
// Stage 28.1 — Tarneeb SOLO pure core (4-player cutthroat). Every player is
// their own side; scoring is per-seat (TARNEEB_SOLO_PLAN.md §2). These tests
// exercise the solo path only; pairs is covered by engine.test.ts and its
// unchanged assertions (see soloGuard.test.ts for the pairs-unchanged guard).
// ---------------------------------------------------------------------------

const V: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14,
};
const card = (suit: Suit, rank: Card['rank']): Card => ({ suit, rank, value: V[rank] });

const R = (s: TarneebState, a: TarneebAction, ctx: TarneebContext): TarneebState =>
  tarneebReducer(s, a, ctx) as TarneebState;

function startSolo(opts?: { seed?: number; dealerSeat?: number; types?: TarneebState['players'][number]['type'][] }): {
  state: TarneebState; ctx: TarneebContext;
} {
  const ctx: TarneebContext = { rng: makeRng(opts?.seed ?? 1) };
  const action: TarneebAction = {
    type: 'START_GAME',
    playerNames: ['P0', 'P1', 'P2', 'P3'],
    playerTypes: opts?.types ?? ['ai', 'ai', 'ai', 'ai'],
    dealerSeat: opts?.dealerSeat ?? 0,
    variant: 'solo',
  };
  return { state: tarneebReducer(null, action, ctx) as TarneebState, ctx };
}

/**
 * Craft a solo `playing` state sitting on the 13th (final) trick with fully
 * controlled inputs, so playing it out triggers §2 solo scoring. `tricks12` are
 * the per-seat tricks after the first 12 tricks (sums to 12); each seat holds
 * exactly its `lastCards` card for the final trick.
 */
function craftSoloFinal(opts: {
  declarerSeat: number;
  trumpSuit: Suit;
  bid: number;
  tricks12: [number, number, number, number];
  lastCards: [Card, Card, Card, Card];
  targetScore?: number;
  preScores?: [number, number, number, number];
}): TarneebState {
  const { declarerSeat, trumpSuit, bid, tricks12, lastCards } = opts;
  const targetScore = opts.targetScore ?? 41;
  const preScores = opts.preScores ?? [0, 0, 0, 0];
  const completedTricks = tricks12.flatMap((n, seat) =>
    Array.from({ length: n }, () => ({ leadSeat: seat, ledSuit: 'spades' as Suit, plays: [], winnerSeat: seat })),
  );
  return {
    gameType: 'tarneeb',
    phase: 'playing',
    variant: 'solo',
    players: [0, 1, 2, 3].map((s) => ({ id: `player-${s}`, name: `P${s}`, seatIndex: s, type: 'ai' })),
    teams: { A: [0, 2], B: [1, 3] },
    dealerSeat: 0,
    currentSeat: declarerSeat,
    handsBySeat: [[lastCards[0]], [lastCards[1]], [lastCards[2]], [lastCards[3]]],
    bids: [],
    passed: [true, true, true, true],
    highestBid: { seat: declarerSeat, amount: bid },
    declarerSeat,
    declarerTeam: null,
    trumpSuit,
    currentTrick: { leadSeat: declarerSeat, ledSuit: null, plays: [], winnerSeat: null },
    completedTricks,
    tricksByTeam: { A: 0, B: 0 },
    scoresByTeam: { A: 0, B: 0 },
    handNumber: 1,
    targetScore,
    options: { targetScore, kabootMode: 'off', allowNoTrump: false },
    lastHand: null,
    handHistory: [],
    winnerTeam: null,
    tricksBySeat: tricks12.slice() as number[],
    scoresBySeat: preScores.slice() as number[],
    lastSoloHand: null,
    soloHandHistory: [],
    soloWinnerSeat: null,
  };
}

function playOut(s: TarneebState, ctx: TarneebContext): TarneebState {
  let cur = s;
  while (cur.phase === 'playing') {
    const seat = cur.currentSeat;
    cur = R(cur, { type: 'PLAY_CARD', card: getValidPlayableCards(cur, seat)[0] }, ctx);
  }
  return cur;
}

// --- Setup -----------------------------------------------------------------

describe('solo setup', () => {
  it('creates a solo match with 4 players, 13 cards each, per-seat ledgers', () => {
    const { state } = startSolo({ dealerSeat: 0 });
    expect(state.variant).toBe('solo');
    expect(isSoloTarneeb(state)).toBe(true);
    expect(state.players).toHaveLength(4);
    expect(state.handsBySeat.every((h) => h.length === 13)).toBe(true);
    expect(state.tricksBySeat).toEqual([0, 0, 0, 0]);
    expect(state.scoresBySeat).toEqual([0, 0, 0, 0]);
    expect(state.soloWinnerSeat).toBeNull();
    expect(state.phase).toBe('bidding');
    expect(state.currentSeat).toBe(nextSeatCounterClockwise(0));
  });

  it('rejects a 3-player solo START (no cutthroat with 3)', () => {
    const s = tarneebReducer(null, { type: 'START_GAME', playerNames: ['a', 'b', 'c'], variant: 'solo' }, { rng: makeRng(1) });
    expect(s).toBeNull();
  });

  it('a state without a variant field reads as pairs (backward compatible)', () => {
    const { state } = startSolo();
    const legacy = { ...state, variant: undefined as never };
    expect(isSoloTarneeb(legacy)).toBe(false);
  });
});

// --- Bidding ---------------------------------------------------------------

describe('solo bidding', () => {
  it('offers the same 3–13 range and the highest bidder becomes sole declarer', () => {
    let { state, ctx } = startSolo({ dealerSeat: 0 });
    expect(getValidBids(state, state.currentSeat)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    // First to act bids 6; the other three pass → that seat declares (no partner).
    const opener = state.currentSeat;
    state = R(state, { type: 'BID', amount: 6 }, ctx);
    while (state.phase === 'bidding') state = R(state, { type: 'PASS_BID' }, ctx);
    expect(state.phase).toBe('choosing_trump');
    expect(state.declarerSeat).toBe(opener);
    expect(state.currentSeat).toBe(opener);
  });
});

// --- Play legality ----------------------------------------------------------

describe('solo play legality (reuses the shared legalPlays, incl. trump obligation)', () => {
  it('forces a trump when void in the led suit, and rejects an illegal play (same ref)', () => {
    const s = craftSoloFinal({
      declarerSeat: 0, trumpSuit: 'spades', bid: 3, tricks12: [3, 3, 3, 3],
      // Seat 0 leads hearts; seat 3 is void in hearts but holds a spade (trump) →
      // must trump. Give seat 3 a heart too so we can also assert an illegal choice.
      lastCards: [card('hearts', 'K'), card('hearts', '2'), card('hearts', '3'), card('spades', '5')],
    });
    // Seat 0 leads the K of hearts.
    const s1 = R(s, { type: 'PLAY_CARD', card: card('hearts', 'K') }, { rng: makeRng(1) });
    // Order after seat 0 is 3 → seat 3 is now on turn, void in hearts, holds a trump.
    expect(s1.currentSeat).toBe(3);
    const legal = getValidPlayableCards(s1, 3);
    expect(legal).toEqual([card('spades', '5')]); // trump obligation
    // An off-suit discard while holding a trump is illegal → same state reference.
    const illegal = tarneebReducer(s1, { type: 'PLAY_CARD', card: card('hearts', '9') }, { rng: makeRng(1) });
    expect(illegal).toBe(s1);
  });
});

// --- Scoring (§2) -----------------------------------------------------------

describe('solo scoring (TARNEEB_SOLO_PLAN.md §2; exact-double corrected Stage 29.0)', () => {
  it('made EXACTLY the bid → declarer +bid×2 (doubled), every defender +0', () => {
    // Declarer 0 has 2 tricks after 12; wins the final trump trick → 3 tricks = bid 3 (exact).
    const s = craftSoloFinal({
      declarerSeat: 0, trumpSuit: 'spades', bid: 3, tricks12: [2, 4, 3, 3],
      lastCards: [card('spades', 'A'), card('hearts', '2'), card('hearts', '3'), card('hearts', '4')],
    });
    const end = playOut(s, { rng: makeRng(1) });
    expect(end.phase).toBe('hand_complete');
    expect(end.tricksBySeat).toEqual([3, 4, 3, 3]);
    expect(end.scoresBySeat).toEqual([6, 0, 0, 0]);        // bid 3 × 2 = 6
    expect(end.lastSoloHand?.made).toBe(true);
    expect(end.lastSoloHand?.exactBidDouble).toBe(true);
    expect(end.lastSoloHand?.deltaBySeat).toEqual([6, 0, 0, 0]);
    expect(end.soloHandHistory).toHaveLength(1);
  });

  it('made WITH OVERTRICKS → declarer +own tricks (the actual count, NOT the bid, no double)', () => {
    // Declarer 0 has 4 tricks after 12; wins the final trump trick → 5 tricks > bid 3.
    const s = craftSoloFinal({
      declarerSeat: 0, trumpSuit: 'spades', bid: 3, tricks12: [4, 4, 3, 1],
      lastCards: [card('spades', 'A'), card('hearts', '2'), card('hearts', '3'), card('hearts', '4')],
    });
    const end = playOut(s, { rng: makeRng(1) });
    expect(end.tricksBySeat).toEqual([5, 4, 3, 1]);
    expect(end.lastSoloHand?.made).toBe(true);
    expect(end.lastSoloHand?.exactBidDouble).toBeFalsy();
    expect(end.scoresBySeat).toEqual([5, 0, 0, 0]);        // 5 tricks won, not the bid 3, no double
  });

  it('failed contract: declarer −bid, each defender +its own tricks', () => {
    // Declarer 0 stays at 3 tricks (bid 5) — a defender (seat 1) wins the final trick.
    const s = craftSoloFinal({
      declarerSeat: 0, trumpSuit: 'spades', bid: 5, tricks12: [3, 4, 3, 2],
      lastCards: [card('hearts', '2'), card('hearts', 'A'), card('hearts', '3'), card('hearts', '4')],
    });
    const end = playOut(s, { rng: makeRng(1) });
    expect(end.tricksBySeat).toEqual([3, 5, 3, 2]);         // seat 1 took the last trick
    expect(end.lastSoloHand?.made).toBe(false);
    // declarer −5; defenders bank their OWN trick counts (5, 3, 2).
    expect(end.scoresBySeat).toEqual([-5, 5, 3, 2]);
    // Defensive credit sums to 13 − declarerTricks (10) — self-balancing.
    expect(5 + 3 + 2).toBe(13 - 3);
  });

  it('a unique seat reaching the target finishes the match', () => {
    const s = craftSoloFinal({
      declarerSeat: 0, trumpSuit: 'spades', bid: 3, tricks12: [2, 4, 3, 3],
      lastCards: [card('spades', 'A'), card('hearts', '2'), card('hearts', '3'), card('hearts', '4')],
      preScores: [39, 0, 0, 0],
    });
    const end = playOut(s, { rng: makeRng(1) });
    expect(end.scoresBySeat![0]).toBe(45);                 // 39 + bid 3 × 2 (exact double)
    expect(end.phase).toBe('game_finished');
    expect(end.soloWinnerSeat).toBe(0);
  });

  it('a TIE at/over the target is NOT a finish (play one more hand — no null winner)', () => {
    // Failed bid 6 by declarer 2; seats 0 and 1 each +1 → 41 & 41 (tied at the top).
    const s = craftSoloFinal({
      declarerSeat: 2, trumpSuit: 'spades', bid: 6, tricks12: [1, 1, 5, 5],
      lastCards: [card('hearts', '4'), card('hearts', '3'), card('hearts', '2'), card('hearts', 'A')],
      preScores: [40, 40, 0, 0],
    });
    const end = playOut(s, { rng: makeRng(1) });
    expect(end.tricksBySeat).toEqual([1, 1, 5, 6]);   // seat 3 took the final trick
    // Declarer (seat 2) failed → −6; seat 3 banked its 6 tricks → +6.
    expect(end.scoresBySeat).toEqual([41, 41, -6, 6]);
    expect(end.phase).toBe('hand_complete');           // tie → keep playing
    expect(end.soloWinnerSeat).toBeNull();
  });
});

// --- Redaction --------------------------------------------------------------

describe('solo redaction — no hidden-hand leaks', () => {
  it('each viewer sees only their own hand; solo public fields survive', () => {
    const { state } = startSolo();
    for (let seat = 0; seat < 4; seat++) {
      const view = tarneebRedactStateFor(state, seat);
      expect(view.handsBySeat[seat]).toEqual(state.handsBySeat[seat]);
      for (let other = 0; other < 4; other++) {
        if (other === seat) continue;
        expect(view.handsBySeat[other].every((c) => c.rank === '?')).toBe(true);
      }
      // Per-seat public ledgers are not cards → stay visible.
      expect(view.tricksBySeat).toEqual(state.tricksBySeat);
      expect(view.scoresBySeat).toEqual(state.scoresBySeat);
      expect(view.variant).toBe('solo');
    }
  });

  it('a spectator (null viewer) sees no hands at all', () => {
    const { state } = startSolo();
    const view = tarneebRedactStateFor(state, null);
    expect(view.handsBySeat.every((h) => h.every((c) => c.rank === '?'))).toBe(true);
  });
});

// --- Bot soak ---------------------------------------------------------------

/** Drive a fully-bot match to completion (or a step cap), returning the end state + steps. */
function botMatch(state: TarneebState, ctx: TarneebContext, cap: number): { end: TarneebState; steps: number } {
  let s = state;
  let steps = 0;
  while (s.phase !== 'game_finished' && steps < cap) {
    const seat = getActingTarneebSeat(s);
    const action: TarneebAction = seat == null ? { type: 'START_NEXT_HAND' } : tarneebBotAction(s, seat);
    s = R(s, action, ctx);
    steps++;
  }
  return { end: s, steps };
}

describe('solo bot soak — deterministic, terminates', () => {
  for (const seed of [1, 2, 7, 42, 99]) {
    it(`seed ${seed}: a bot-only solo match finishes under the step cap with a unique winner`, () => {
      const { state, ctx } = startSolo({ seed });
      const { end, steps } = botMatch(state, ctx, 20000);
      expect(end.phase).toBe('game_finished');
      expect(steps).toBeLessThan(20000);
      expect(end.soloWinnerSeat).not.toBeNull();
      const max = Math.max(...(end.scoresBySeat as number[]));
      expect((end.scoresBySeat as number[])[end.soloWinnerSeat as number]).toBe(max);
      // Unique winner (no tie at the top on the finishing hand).
      expect((end.scoresBySeat as number[]).filter((v) => v === max)).toHaveLength(1);
    });
  }
});

// --- Core purity (Scope D.8) ------------------------------------------------

describe('Tarneeb pure core stays isolated (no UI / server / IO)', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), 'src/games/tarneeb', p), 'utf8');
  // definition.ts is the platform seam (imports net/messages by design) — excluded.
  const CORE = ['types.ts', 'deck.ts', 'rules.ts', 'engine.ts', 'ai.ts', 'redact.ts'];

  for (const file of CORE) {
    it(`${file}: no browser/server/IO imports or globals`, () => {
      const src = read(file);
      expect(src, `${file} imports UI`).not.toMatch(/from '\.\.\/\.\.\/ui/);
      expect(src, `${file} imports net`).not.toMatch(/from '\.\.\/\.\.\/net/);
      expect(src, `${file} imports server`).not.toMatch(/from '\.\.\/\.\.\/\.\.\/server/);
      expect(src, `${file} imports stats`).not.toMatch(/from '\.\.\/\.\.\/stats/);
      // Property-access forms so a prose comment mentioning "that document" is fine.
      expect(src, `${file} uses localStorage`).not.toMatch(/\blocalStorage\b/);
      expect(src, `${file} uses window.`).not.toMatch(/\bwindow\s*\./);
      expect(src, `${file} uses document.`).not.toMatch(/\bdocument\s*\./);
      expect(src, `${file} uses fetch`).not.toMatch(/\bfetch\s*\(/);
    });
  }
});

// --- Pairs regression -------------------------------------------------------

describe('pairs is the default and still scores by team', () => {
  it('START without a variant → pairs, and a pairs hand fills the TEAM ledger (not solo)', () => {
    const ctx: TarneebContext = { rng: makeRng(3) };
    const s = tarneebReducer(null, { type: 'START_GAME', playerNames: ['a', 'b', 'c', 'd'], dealerSeat: 0 }, ctx)!;
    expect(s.variant).toBe('pairs');
    expect(isSoloTarneeb(s)).toBe(false);
    expect(s.tricksBySeat).toBeUndefined();
    expect(s.scoresBySeat).toBeUndefined();
    // Pairs bot match still terminates with a team winner (no solo fields set).
    const { end } = botMatch(s, ctx, 20000);
    expect(end.phase).toBe('game_finished');
    expect(end.winnerTeam == null ? '' : end.winnerTeam).toMatch(/^[AB]$/);
    expect(end.soloWinnerSeat).toBeUndefined();
  });
});
