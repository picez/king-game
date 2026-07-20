// ---------------------------------------------------------------------------
// Deberc бела at PLAY time (Stage 30.16, §4). Бела is no longer declared in the
// declaring phase; the holder of trump K+Q declares it as they PLAY a trump K/Q
// (PLAY_CARD.declareBela), and scores 20 only if they WIN that trick. This file
// verifies the timing, win/lose, no-flag, invalid-declaration and scoring paths.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { debercReducer } from './engine';
import { debercBotAction } from './ai';
import { seqValue } from './deck';
import type { Card, Rank, Suit } from '../../models/types';
import type { DebercState } from './types';

const card = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: seqValue(rank) });

/** Drive a fresh 3p match to the first 'playing' phase (bots bid/declare). */
function toPlaying(seed = 1): DebercState {
  const rng = makeRng(seed);
  let s = debercReducer(null, { type: 'START_DEBERC', playerNames: ['A', 'B', 'C'], playerTypes: ['ai', 'ai', 'ai'], matchSize: 'small' }, { rng })!;
  let steps = 0;
  while (s.phase !== 'playing' && steps++ < 200) {
    s = debercReducer(s, debercBotAction(s)!, { rng })!;
  }
  expect(s.phase).toBe('playing');
  return s;
}

/**
 * A controlled last-trick scenario: 3p, trump hearts, tricksPlayed=8, seat 0 leads
 * and holds `seat0Hand`; seats 1/2 hold `s1`/`s2`. dealtHands[0] carries K♥+Q♥ so
 * a won бела can be valued. Seat 0 is bella-eligible unless overridden.
 */
function lastTrick(seat0Hand: Card[], s1: Card, s2: Card, eligible = true): DebercState {
  const base = toPlaying();
  const trump: Suit = 'hearts';
  return {
    ...base,
    trumpSuit: trump,
    phase: 'playing',
    currentTrick: null,
    turnSeat: 0,
    tricksPlayed: 8,
    players: base.players.map((p, i) => ({ ...p, hand: i === 0 ? seat0Hand : i === 1 ? [s1] : [s2] })),
    dealtHands: [[card('hearts', 'K'), card('hearts', 'Q')], [{ ...s1 }], [{ ...s2 }]],
    bellaEligible: eligible ? [0] : [],
    bellaEarned: [],
    bellaDeclaredBy: null,
    bellaDeclaredCard: null,
    wonCards: [[], [], []],
    seatsWithTricks: [],
  };
}

/** Play out the (up to 3) single-card plays that finish the current trick. */
function finishTrick(s: DebercState): DebercState {
  let st = s;
  let guard = 0;
  while (st.phase === 'playing' && guard++ < 5) {
    const seat = st.turnSeat;
    st = debercReducer(st, { type: 'PLAY_CARD', card: st.players[seat].hand[0] }, { rng: makeRng(1) })!;
  }
  return st;
}

describe('бела cannot be declared in the declaring phase (v1.6)', () => {
  it('a DECLARE_MELD carrying a bella is rejected (same ref)', () => {
    const rng = makeRng(3);
    let s = debercReducer(null, { type: 'START_DEBERC', playerNames: ['A', 'B', 'C'], playerTypes: ['ai', 'ai', 'ai'], matchSize: 'small' }, { rng })!;
    let steps = 0;
    while (s.phase !== 'declaring' && steps++ < 200) s = debercReducer(s, debercBotAction(s)!, { rng })!;
    expect(s.phase).toBe('declaring');
    const rejected = debercReducer(s, { type: 'DECLARE_MELD', melds: [{ kind: 'bella' }] });
    expect(rejected).toBe(s); // illegal → same reference
  });
});

describe('бела at play time — earn only on a won declared trick', () => {
  it('declaring on a trump K that WINS the trick earns бела (+20 to the team score)', () => {
    // Seat 0 leads K♥ (declare); seats 1/2 are void in hearts and hold no trump → K♥ wins.
    const s = lastTrick([card('hearts', 'K')], card('clubs', '7'), card('clubs', '8'));
    const played = debercReducer(s, { type: 'PLAY_CARD', card: card('hearts', 'K'), declareBela: true })!;
    expect(played.bellaDeclaredBy).toBe(0);
    const done = finishTrick(played);
    expect(done.bellaEarned).toContain(0);
    // Fold the hand into the score: trick_complete → hand_scoring → NEXT_HAND applies points.
    const scored = debercReducer(done, { type: 'NEXT_TRICK' })!;
    expect(scored.phase).toBe('hand_scoring');
    expect(scored.melds.some((m) => m.kind === 'bella' && m.seatIndex === 0)).toBe(true);
    const beforeTeam0 = scored.matchScore[0];
    const next = debercReducer(scored, { type: 'NEXT_HAND' }, { rng: makeRng(1) })!;
    // Seat 0's team gained its card points + the +20 бела; assert the бела meld points.
    expect(scored.lastHand ?? next.handHistory[next.handHistory.length - 1]).toBeTruthy();
    const hand = next.handHistory[next.handHistory.length - 1]!;
    expect(hand.meldPoints[0]).toBeGreaterThanOrEqual(20);
    expect(beforeTeam0).toBe(0);
  });

  it('declaring on a trump K but LOSING the trick earns nothing (0)', () => {
    // Seat 1 holds A♥ and must follow hearts → A♥ beats K♥, so seat 0 loses its declared trick.
    const s = lastTrick([card('hearts', 'K')], card('hearts', 'A'), card('clubs', '8'));
    const played = debercReducer(s, { type: 'PLAY_CARD', card: card('hearts', 'K'), declareBela: true })!;
    expect(played.bellaDeclaredBy).toBe(0);
    const done = finishTrick(played);
    expect(done.bellaEarned).toEqual([]); // declared but lost → no бела
  });

  it('playing a trump K WITHOUT the declare flag earns nothing', () => {
    const s = lastTrick([card('hearts', 'K')], card('clubs', '7'), card('clubs', '8'));
    const played = debercReducer(s, { type: 'PLAY_CARD', card: card('hearts', 'K') })!;
    expect(played.bellaDeclaredBy).toBeNull();
    const done = finishTrick(played);
    expect(done.bellaEarned).toEqual([]);
  });
});

describe('бела invalid declarations are rejected (same ref)', () => {
  it('declaring on a NON-honor card is rejected', () => {
    const s = lastTrick([card('clubs', '7'), card('hearts', 'K')], card('clubs', '9'), card('clubs', '8'));
    // Leading a 7♣ with declareBela: not a trump honor → whole play rejected.
    expect(debercReducer(s, { type: 'PLAY_CARD', card: card('clubs', '7'), declareBela: true })).toBe(s);
  });

  it('declaring while NOT bella-eligible is rejected', () => {
    const s = lastTrick([card('hearts', 'K')], card('clubs', '7'), card('clubs', '8'), false);
    expect(debercReducer(s, { type: 'PLAY_CARD', card: card('hearts', 'K'), declareBela: true })).toBe(s);
  });

  it('a SECOND бела declaration in the same hand is refused', () => {
    const s = lastTrick([card('hearts', 'K')], card('clubs', '7'), card('clubs', '8'));
    const withDecl = { ...s, bellaDeclaredBy: 2, bellaDeclaredCard: card('hearts', 'Q') };
    expect(debercReducer(withDecl, { type: 'PLAY_CARD', card: card('hearts', 'K'), declareBela: true })).toBe(withDecl);
  });
});

describe('бела in 4p pairs — team earns the 20', () => {
  it('a declared+won бела scores for the declarer’s team', () => {
    const rng = makeRng(2);
    let base = debercReducer(null, { type: 'START_DEBERC', playerNames: ['A', 'B', 'C', 'D'], playerTypes: ['ai', 'ai', 'ai', 'ai'], matchSize: 'small' }, { rng })!;
    let steps = 0;
    while (base.phase !== 'playing' && steps++ < 200) base = debercReducer(base, debercBotAction(base)!, { rng })!;
    const trump: Suit = 'hearts';
    // 4p last trick: seat 0 leads K♥, the other three are void in hearts + trumpless → K♥ wins.
    const s: DebercState = {
      ...base, trumpSuit: trump, phase: 'playing', currentTrick: null, turnSeat: 0, tricksPlayed: 8,
      players: base.players.map((p, i) => ({ ...p, hand: [card('clubs', ['7', '8', '9', '10'][i] as Rank)] })),
    };
    s.players[0].hand = [card('hearts', 'K')];
    s.dealtHands = [[card('hearts', 'K'), card('hearts', 'Q')], [card('clubs', '8')], [card('clubs', '9')], [card('clubs', '10')]];
    s.bellaEligible = [0]; s.bellaEarned = []; s.bellaDeclaredBy = null; s.bellaDeclaredCard = null;
    s.wonCards = [[], [], [], []]; s.seatsWithTricks = [];
    const played = debercReducer(s, { type: 'PLAY_CARD', card: card('hearts', 'K'), declareBela: true })!;
    const done = finishTrick(played);
    expect(done.bellaEarned).toContain(0);
    const scored = debercReducer(done, { type: 'NEXT_TRICK' })!;
    const next = debercReducer(scored, { type: 'NEXT_HAND' }, { rng: makeRng(1) })!;
    const hand = next.handHistory[next.handHistory.length - 1]!;
    expect(hand.meldPoints[base.teamOf[0]]).toBeGreaterThanOrEqual(20);
  });
});
