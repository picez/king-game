import { describe, expect, it } from 'vitest';
import type { Card, Suit } from '../../models/types';
import { makeRng, type Rng } from '../../core/rng';
import { tarneebReducer } from './engine';
import {
  canBid,
  canChooseTrump,
  getActingTarneebPlayerId,
  getActingTarneebSeat,
  getValidBids,
  getValidPlayableCards,
  isTarneebFinished,
  nextSeatCounterClockwise,
  teamOfSeat,
} from './rules';
import type { TarneebAction, TarneebContext, TarneebState, Team } from './types';

// --- helpers ---------------------------------------------------------------

function start(opts?: {
  dealerSeat?: number;
  seed?: number;
  options?: Partial<TarneebState['options']>;
  types?: TarneebState['players'][number]['type'][];
}): { state: TarneebState; ctx: TarneebContext } {
  const ctx: TarneebContext = { rng: makeRng(opts?.seed ?? 1) };
  const action: TarneebAction = {
    type: 'START_GAME',
    playerNames: ['P0', 'P1', 'P2', 'P3'],
    playerTypes: opts?.types ?? ['ai', 'ai', 'ai', 'ai'],
    dealerSeat: opts?.dealerSeat ?? 0,
    options: opts?.options,
  };
  const state = tarneebReducer(null, action, ctx) as TarneebState;
  return { state, ctx };
}

const R = (s: TarneebState, a: TarneebAction, ctx: TarneebContext): TarneebState =>
  tarneebReducer(s, a, ctx) as TarneebState;

/** Cards accounted for right now (hands + current trick + completed tricks). */
function cardsInPlay(s: TarneebState): number {
  let n = s.handsBySeat.reduce((sum, h) => sum + h.length, 0);
  if (s.currentTrick) n += s.currentTrick.plays.length;
  for (const t of s.completedTricks) n += t.plays.length;
  return n;
}

/** Drive a single generic step: first bidder bids 7, others pass; trump = spades. */
function drive(s: TarneebState, ctx: TarneebContext): TarneebState {
  switch (s.phase) {
    case 'bidding':
      return s.highestBid === null
        ? R(s, { type: 'BID', amount: 7 }, ctx)
        : R(s, { type: 'PASS_BID' }, ctx);
    case 'choosing_trump':
      return R(s, { type: 'CHOOSE_TRUMP', suit: 'spades' }, ctx);
    case 'playing': {
      const seat = s.currentSeat;
      const card = getValidPlayableCards(s, seat)[0];
      return R(s, { type: 'PLAY_CARD', card }, ctx);
    }
    default:
      return s;
  }
}

/** Play from a `playing` state to the end of the hand, taking the first legal card each turn. */
function playOutHand(s: TarneebState, ctx: TarneebContext, checkInvariant = false): TarneebState {
  let cur = s;
  while (cur.phase === 'playing') {
    if (checkInvariant) expect(cardsInPlay(cur)).toBe(52);
    const seat = cur.currentSeat;
    cur = R(cur, { type: 'PLAY_CARD', card: getValidPlayableCards(cur, seat)[0] }, ctx);
  }
  return cur;
}

/** Reach the `playing` phase from a fresh start (seat 3 declares spades on dealer 0). */
function toPlaying(seed = 1, dealerSeat = 0): { state: TarneebState; ctx: TarneebContext } {
  let { state, ctx } = start({ seed, dealerSeat });
  while (state.phase !== 'playing') state = drive(state, ctx);
  return { state, ctx };
}

const card = (suit: Suit, rank: Card['rank']): Card => {
  const v: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    J: 11, Q: 12, K: 13, A: 14,
  };
  return { suit, rank, value: v[rank] };
};

/**
 * Craft a `playing` state sitting on the 13th (final) trick, so playing it out
 * triggers §8 scoring with fully controlled inputs. The first 12 tricks are
 * recorded as `teamA12` for team A and the rest for team B; each seat holds
 * exactly its `lastCards` card for the final trick.
 */
function craftFinalTrick(opts: {
  declarerSeat: number;
  trumpSuit: Suit;
  bid: number;
  teamA12: number;
  lastCards: [Card, Card, Card, Card];
  targetScore?: number;
  preScores?: Record<Team, number>;
}): TarneebState {
  const { declarerSeat, trumpSuit, bid, teamA12, lastCards } = opts;
  const targetScore = opts.targetScore ?? 41;
  const preScores = opts.preScores ?? { A: 0, B: 0 };
  const completedTricks = Array.from({ length: 12 }, (_, i) => {
    const winner = i < teamA12 ? 0 : 1;
    return { leadSeat: winner, ledSuit: 'spades' as Suit, plays: [], winnerSeat: winner };
  });
  return {
    gameType: 'tarneeb',
    phase: 'playing',
    players: [0, 1, 2, 3].map((s) => ({ id: `player-${s}`, name: `P${s}`, seatIndex: s, type: 'ai' })),
    teams: { A: [0, 2], B: [1, 3] },
    dealerSeat: 0,
    currentSeat: declarerSeat,
    handsBySeat: [[lastCards[0]], [lastCards[1]], [lastCards[2]], [lastCards[3]]],
    bids: [],
    passed: [true, true, true, true],
    highestBid: { seat: declarerSeat, amount: bid },
    declarerSeat,
    declarerTeam: teamOfSeat(declarerSeat),
    trumpSuit,
    currentTrick: { leadSeat: declarerSeat, ledSuit: null, plays: [], winnerSeat: null },
    completedTricks,
    tricksByTeam: { A: teamA12, B: 12 - teamA12 },
    scoresByTeam: { ...preScores },
    handNumber: 1,
    targetScore,
    options: { targetScore, kabootMode: 'off', allowNoTrump: false },
    lastHand: null,
    handHistory: [],
    winnerTeam: null,
  };
}

// --- START_GAME ------------------------------------------------------------

describe('Tarneeb START_GAME', () => {
  it('deals 13 to each seat and opens bidding to the dealer’s right', () => {
    const { state } = start({ dealerSeat: 0 });
    expect(state.phase).toBe('bidding');
    expect(state.handsBySeat.every((h) => h.length === 13)).toBe(true);
    expect(state.currentSeat).toBe(nextSeatCounterClockwise(0)); // seat 3
    expect(state.dealerSeat).toBe(0);
    expect(state.handNumber).toBe(1);
    expect(state.scoresByTeam).toEqual({ A: 0, B: 0 });
    expect(state.teams).toEqual({ A: [0, 2], B: [1, 3] });
  });

  it('bidding starts to the right of a non-zero dealer', () => {
    expect(start({ dealerSeat: 1 }).state.currentSeat).toBe(0);
    expect(start({ dealerSeat: 2 }).state.currentSeat).toBe(1);
  });

  it('rejects a second START_GAME (already started)', () => {
    const { state, ctx } = start();
    const again = tarneebReducer(state, { type: 'START_GAME', playerNames: ['a', 'b', 'c', 'd'] }, ctx);
    expect(again).toBe(state);
  });

  it('rejects START_GAME without exactly 4 players', () => {
    const ctx = { rng: makeRng(1) };
    expect(tarneebReducer(null, { type: 'START_GAME', playerNames: ['a', 'b', 'c'] }, ctx)).toBeNull();
  });

  it('forces MVP options (kaboot off, no No-Trump) even if asked otherwise', () => {
    const { state } = start({ options: { targetScore: 31 } as never });
    expect(state.options.kabootMode).toBe('off');
    expect(state.options.allowNoTrump).toBe(false);
    expect(state.targetScore).toBe(31);
  });
});

// --- Bidding ---------------------------------------------------------------

describe('Tarneeb bidding', () => {
  it('offers only legal bids 7–13 initially', () => {
    const { state } = start({ dealerSeat: 0 });
    expect(getValidBids(state, state.currentSeat)).toEqual([7, 8, 9, 10, 11, 12, 13]);
    expect(canBid(state, state.currentSeat, 6)).toBe(false);
    expect(canBid(state, state.currentSeat, 14)).toBe(false);
    expect(canBid(state, state.currentSeat, 7)).toBe(true);
  });

  it('requires each bid to strictly exceed the current highest', () => {
    const { state, ctx } = start({ dealerSeat: 0 }); // currentSeat 3
    const s1 = R(state, { type: 'BID', amount: 9 }, ctx);
    expect(s1.highestBid).toEqual({ seat: 3, amount: 9 });
    expect(s1.currentSeat).toBe(2);
    expect(canBid(s1, 2, 9)).toBe(false);
    expect(canBid(s1, 2, 10)).toBe(true);
    // a too-low bid is rejected and does not change state
    expect(R(s1, { type: 'BID', amount: 8 }, ctx)).toBe(s1);
  });

  it('makes a pass final — the seat cannot bid again', () => {
    const { state, ctx } = start({ dealerSeat: 0 }); // currentSeat 3
    const s1 = R(state, { type: 'PASS_BID' }, ctx);
    expect(s1.passed[3]).toBe(true);
    expect(s1.currentSeat).toBe(2);
    // seat 3 is out; canBid is false and an out-of-turn bid is ignored
    expect(canBid(s1, 3, 10)).toBe(false);
  });

  it('ends with a single declarer once three seats pass', () => {
    const { state, ctx } = start({ dealerSeat: 0 }); // seat 3 first
    let s = R(state, { type: 'BID', amount: 7 }, ctx); // seat 3 bids
    s = R(s, { type: 'PASS_BID' }, ctx); // seat 2
    s = R(s, { type: 'PASS_BID' }, ctx); // seat 1
    s = R(s, { type: 'PASS_BID' }, ctx); // seat 0
    expect(s.phase).toBe('choosing_trump');
    expect(s.declarerSeat).toBe(3);
    expect(s.declarerTeam).toBe('B');
    expect(s.currentSeat).toBe(3);
  });

  it('redeals with the SAME dealer and unchanged scores when all four pass', () => {
    const { state, ctx } = start({ dealerSeat: 0 });
    let s = state;
    for (let i = 0; i < 4; i++) s = R(s, { type: 'PASS_BID' }, ctx);
    expect(s.phase).toBe('bidding');
    expect(s.dealerSeat).toBe(0); // dealer does NOT rotate
    expect(s.handNumber).toBe(1); // no real hand was played
    expect(s.scoresByTeam).toEqual({ A: 0, B: 0 });
    expect(s.currentSeat).toBe(nextSeatCounterClockwise(0));
    expect(s.passed).toEqual([false, false, false, false]);
    expect(s.handsBySeat.every((h) => h.length === 13)).toBe(true);
  });
});

// --- Trump choice ----------------------------------------------------------

describe('Tarneeb trump choice', () => {
  it('lets only the declarer choose trump and then leads them into play', () => {
    const { state, ctx } = start({ dealerSeat: 0 });
    let s = R(state, { type: 'BID', amount: 7 }, ctx); // seat 3 declarer-to-be
    s = R(s, { type: 'PASS_BID' }, ctx);
    s = R(s, { type: 'PASS_BID' }, ctx);
    s = R(s, { type: 'PASS_BID' }, ctx);
    expect(s.phase).toBe('choosing_trump');
    // a non-declarer cannot choose trump
    expect(canChooseTrump(s, 0, 'hearts')).toBe(false);
    expect(canChooseTrump(s, s.declarerSeat as number, 'hearts')).toBe(true);
    const p = R(s, { type: 'CHOOSE_TRUMP', suit: 'hearts' }, ctx);
    expect(p.phase).toBe('playing');
    expect(p.trumpSuit).toBe('hearts');
    // declarer leads the first trick
    expect(p.currentSeat).toBe(s.declarerSeat);
    expect(p.currentTrick?.leadSeat).toBe(s.declarerSeat);
  });
});

// --- Trick play ------------------------------------------------------------

describe('Tarneeb trick play', () => {
  it('rejects playing a card that is not in the acting seat’s hand', () => {
    const { state, ctx } = toPlaying();
    const seat = state.currentSeat;
    const missing = state.handsBySeat.flat().find((c) => !state.handsBySeat[seat].some((h) => h.suit === c.suit && h.rank === c.rank));
    expect(R(state, { type: 'PLAY_CARD', card: missing as Card }, ctx)).toBe(state);
  });

  it('requires following the led suit when able', () => {
    const { state, ctx } = toPlaying();
    const leader = state.currentSeat;
    const lead = getValidPlayableCards(state, leader)[0];
    const s1 = R(state, { type: 'PLAY_CARD', card: lead }, ctx);
    const follower = s1.currentSeat;
    const hand = s1.handsBySeat[follower];
    const hasLed = hand.some((c) => c.suit === lead.suit);
    if (hasLed) {
      const offSuit = hand.find((c) => c.suit !== lead.suit);
      if (offSuit) {
        // playing off-suit while holding the led suit is illegal → unchanged state
        expect(R(s1, { type: 'PLAY_CARD', card: offSuit }, ctx)).toBe(s1);
      }
      // the legal set is exactly the led-suit cards
      expect(getValidPlayableCards(s1, follower).every((c) => c.suit === lead.suit)).toBe(true);
    }
  });

  it('awards the trick and passes the lead to the winner', () => {
    const { state, ctx } = toPlaying();
    let s = state;
    for (let i = 0; i < 4; i++) {
      s = R(s, { type: 'PLAY_CARD', card: getValidPlayableCards(s, s.currentSeat)[0] }, ctx);
    }
    expect(s.completedTricks).toHaveLength(1);
    const winner = s.completedTricks[0].winnerSeat;
    expect(winner).not.toBeNull();
    expect(s.currentSeat).toBe(winner);
    expect(s.tricksByTeam.A + s.tricksByTeam.B).toBe(1);
  });

  it('plays exactly 13 tricks, keeps 52 cards accounted for, then scores', () => {
    const { state, ctx } = toPlaying();
    const end = playOutHand(state, ctx, true);
    expect(end.completedTricks).toHaveLength(13);
    expect(end.tricksByTeam.A + end.tricksByTeam.B).toBe(13);
    expect(['hand_complete', 'game_finished']).toContain(end.phase);
    expect(cardsInPlay(end)).toBe(52); // all cards now sit in completed tricks
    expect(end.handsBySeat.every((h) => h.length === 0)).toBe(true);
  });
});

// --- Scoring (§8) ----------------------------------------------------------

describe('Tarneeb scoring', () => {
  const ctx: TarneebContext = {};

  it('scores a made contract as +tricks for declarer, +0 for defenders', () => {
    const s = craftFinalTrick({
      declarerSeat: 0, // team A
      trumpSuit: 'spades',
      bid: 9,
      teamA12: 9,
      lastCards: [card('spades', 'A'), card('hearts', '2'), card('hearts', '3'), card('hearts', '4')],
    });
    const end = playOutHand(s, ctx);
    expect(end.tricksByTeam).toEqual({ A: 10, B: 3 });
    expect(end.lastHand?.made).toBe(true);
    expect(end.scoresByTeam).toEqual({ A: 10, B: 0 });
    expect(end.phase).toBe('hand_complete');
  });

  it('scores a failed contract as −bid for declarer, +tricks for defenders (negatives allowed)', () => {
    const s = craftFinalTrick({
      declarerSeat: 0, // team A
      trumpSuit: 'spades',
      bid: 9,
      teamA12: 8,
      // declarer leads a low trump; team B (seat 1) overtrumps to take the 13th
      lastCards: [card('spades', '2'), card('spades', 'A'), card('hearts', '3'), card('hearts', '4')],
    });
    const end = playOutHand(s, ctx);
    expect(end.tricksByTeam).toEqual({ A: 8, B: 5 });
    expect(end.lastHand?.made).toBe(false);
    expect(end.scoresByTeam).toEqual({ A: -9, B: 5 });
  });

  it('scores an all-13 made contract as a plain +13 with kaboot off (no bonus)', () => {
    const s = craftFinalTrick({
      declarerSeat: 0,
      trumpSuit: 'spades',
      bid: 13,
      teamA12: 12,
      lastCards: [card('spades', 'A'), card('hearts', '2'), card('hearts', '3'), card('hearts', '4')],
    });
    const end = playOutHand(s, ctx);
    expect(end.tricksByTeam).toEqual({ A: 13, B: 0 });
    expect(end.scoresByTeam).toEqual({ A: 13, B: 0 });
    expect(end.phase).toBe('hand_complete');
  });
});

// --- Game end (§10) --------------------------------------------------------

describe('Tarneeb game end', () => {
  const ctx: TarneebContext = {};
  const winByA = (preScores: Record<Team, number>, targetScore = 41) =>
    craftFinalTrick({
      declarerSeat: 0,
      trumpSuit: 'spades',
      bid: 9,
      teamA12: 9,
      lastCards: [card('spades', 'A'), card('hearts', '2'), card('hearts', '3'), card('hearts', '4')],
      preScores,
      targetScore,
    });

  it('finishes the game when a team reaches the target', () => {
    const end = playOutHand(winByA({ A: 35, B: 0 }), ctx);
    expect(end.scoresByTeam).toEqual({ A: 45, B: 0 });
    expect(end.phase).toBe('game_finished');
    expect(end.winnerTeam).toBe('A');
    expect(isTarneebFinished(end)).toBe(true);
  });

  it('gives the win to the higher score when both teams cross the target', () => {
    const end = playOutHand(winByA({ A: 35, B: 42 }), ctx);
    expect(end.scoresByTeam).toEqual({ A: 45, B: 42 });
    expect(end.phase).toBe('game_finished');
    expect(end.winnerTeam).toBe('A');
  });

  it('continues for another hand when both teams tie at/over the target', () => {
    const end = playOutHand(winByA({ A: 35, B: 45 }), ctx);
    expect(end.scoresByTeam).toEqual({ A: 45, B: 45 });
    expect(end.phase).toBe('hand_complete');
    expect(end.winnerTeam).toBeNull();
  });
});

// --- START_NEXT_HAND -------------------------------------------------------

describe('Tarneeb START_NEXT_HAND', () => {
  it('preserves scores and rotates the dealer to the right', () => {
    const s = craftFinalTrick({
      declarerSeat: 0,
      trumpSuit: 'spades',
      bid: 7,
      teamA12: 7,
      lastCards: [card('spades', 'A'), card('hearts', '2'), card('hearts', '3'), card('hearts', '4')],
    });
    const scored = playOutHand(s, {});
    expect(scored.phase).toBe('hand_complete');
    const ctx: TarneebContext = { rng: makeRng(9) };
    const next = R(scored, { type: 'START_NEXT_HAND' }, ctx);
    expect(next.dealerSeat).toBe(nextSeatCounterClockwise(0)); // rotated to seat 3
    expect(next.handNumber).toBe(2);
    expect(next.scoresByTeam).toEqual(scored.scoresByTeam);
    expect(next.phase).toBe('bidding');
    expect(next.currentSeat).toBe(nextSeatCounterClockwise(next.dealerSeat));
    expect(next.handsBySeat.every((h) => h.length === 13)).toBe(true);
  });
});

// --- Illegal actions / acting seat -----------------------------------------

describe('Tarneeb illegal actions', () => {
  it('returns the SAME state reference for an illegal action', () => {
    const { state, ctx } = start({ dealerSeat: 0 });
    // wrong phase: cannot play a card while bidding
    expect(R(state, { type: 'PLAY_CARD', card: card('spades', 'A') }, ctx)).toBe(state);
    // wrong phase: cannot choose trump while bidding
    expect(R(state, { type: 'CHOOSE_TRUMP', suit: 'spades' }, ctx)).toBe(state);
    // cannot advance to next hand mid-auction
    expect(R(state, { type: 'START_NEXT_HAND' }, ctx)).toBe(state);
  });

  it('exposes the acting seat/player and null between hands', () => {
    const { state } = start({ dealerSeat: 0 });
    expect(getActingTarneebSeat(state)).toBe(state.currentSeat);
    expect(getActingTarneebPlayerId(state)).toBe(`player-${state.currentSeat}`);
    const finished = { ...state, phase: 'hand_complete' as const };
    expect(getActingTarneebSeat(finished)).toBeNull();
    expect(getActingTarneebPlayerId(finished)).toBeNull();
  });
});
