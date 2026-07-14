import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { fiftyOneReducer } from './engine';
import { handPenalty, JOKER_HAND_PENALTY, NEVER_OPENED_PENALTY } from './rules';
import type { Rank, Suit } from '../../models/types';
import type { FiftyOneCard, FiftyOneState } from './types';

const c = (rank: Rank, suit: Suit, d = 0): FiftyOneCard => ({ id: `${d}-${suit}-${rank}`, joker: false, suit, rank });
let jokerN = 0;
const J = (): FiftyOneCard => ({ id: `joker-s${jokerN++}`, joker: true, suit: null, rank: null });

function baseState(hands: FiftyOneCard[][], over: Partial<FiftyOneState> = {}): FiftyOneState {
  const playerCount = hands.length;
  return {
    gameType: 'fifty-one', phase: 'playing', playerCount,
    players: hands.map((_, i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type: 'ai' })),
    dealerSeat: 0, starterSeat: 1, currentSeat: 0, turnStep: 'meld_discard',
    handsBySeat: hands, drawPile: [], discardPile: [],
    openedBySeat: hands.map(() => true), publicMelds: [],
    scoresBySeat: hands.map(() => 0), eliminatedSeats: hands.map(() => false),
    roundNumber: 1, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 }, ...over,
  };
}

/** Drive the winning discard: seat 0 discards its last card and goes out. */
function goOut(state: FiftyOneState, card: FiftyOneCard): FiftyOneState {
  return fiftyOneReducer(state, { type: 'DISCARD', card }) as FiftyOneState;
}

describe('51 handPenalty (§10, §11)', () => {
  it('counts §10 card values for an opened loser, joker = 25', () => {
    expect(handPenalty([c('A', 'hearts'), c('9', 'clubs'), J()], true)).toBe(10 + 9 + JOKER_HAND_PENALTY);
  });
  it('an Ace left in hand is 10 (not 1)', () => {
    expect(handPenalty([c('A', 'spades')], true)).toBe(10);
  });
  it('a never-opened loser takes the flat 100', () => {
    expect(handPenalty([c('2', 'clubs')], false)).toBe(NEVER_OPENED_PENALTY);
  });
});

describe('51 round scoring (§11)', () => {
  it('winner scores 0; opened loser counts hand values', () => {
    const s = baseState([[c('2', 'clubs')], [c('A', 'hearts'), c('9', 'clubs'), J()]]);
    const done = goOut(s, c('2', 'clubs'));
    expect(done.phase).toBe('round_complete');
    expect(done.roundWinnerSeat).toBe(0);
    expect(done.scoresBySeat[0]).toBe(0);
    expect(done.scoresBySeat[1]).toBe(10 + 9 + 25); // 44
    expect(done.lastRound?.penaltyBySeat[1]).toBe(44);
    expect(done.lastRound?.neverOpenedBySeat[1]).toBe(false);
  });

  it('a never-opened loser takes the flat 100', () => {
    const s = baseState([[c('2', 'clubs')], [c('K', 'hearts'), c('K', 'spades')]], { openedBySeat: [true, false] });
    const done = goOut(s, c('2', 'clubs'));
    expect(done.scoresBySeat[1]).toBe(100);
    expect(done.lastRound?.neverOpenedBySeat[1]).toBe(true);
  });

  it('eliminates a seat crossing 510 and finishes the match when one remains (2p)', () => {
    const s = baseState([[c('2', 'clubs')], [c('K', 'hearts'), c('Q', 'spades')]], {
      scoresBySeat: [0, 495], // +20 (K+Q) → 515 ≥ 510
    });
    const done = goOut(s, c('2', 'clubs'));
    expect(done.scoresBySeat[1]).toBe(515);
    expect(done.eliminatedSeats[1]).toBe(true);
    expect(done.phase).toBe('game_finished');
    expect(done.winnerSeat).toBe(0);
    expect(done.lastRound?.newlyEliminated).toEqual([1]);
  });

  it('continues (round_complete) when more than one seat remains (3p)', () => {
    const s = baseState([
      [c('2', 'clubs')],
      [c('K', 'hearts'), c('Q', 'spades')],
      [c('3', 'diamonds')],
    ]);
    const done = goOut(s, c('2', 'clubs'));
    expect(done.phase).toBe('round_complete');
    expect(done.scoresBySeat).toEqual([0, 20, 3]);
    expect(done.eliminatedSeats).toEqual([false, false, false]);
  });

  it('START_NEXT_ROUND deals a fresh round, rotates the dealer, bumps the round number, keeps scores', () => {
    const s = baseState([[c('2', 'clubs')], [c('K', 'hearts')], [c('3', 'diamonds')]], { dealerSeat: 0 });
    const done = goOut(s, c('2', 'clubs'));
    expect(done.phase).toBe('round_complete');
    const scoresBefore = [...done.scoresBySeat];
    const next = fiftyOneReducer(done, { type: 'START_NEXT_ROUND' }, { rng: makeRng(7) }) as FiftyOneState;
    expect(next.phase).toBe('playing');
    expect(next.roundNumber).toBe(2);
    expect(next.dealerSeat).toBe(1);          // rotated clockwise
    expect(next.starterSeat).toBe(2);
    expect(next.scoresBySeat).toEqual(scoresBefore); // scores carry over
    expect(next.openedBySeat).toEqual([false, false, false]);
    expect(next.publicMelds).toHaveLength(0);
    expect(next.handsBySeat[2]).toHaveLength(14); // starter
  });

  it('START_NEXT_ROUND skips an eliminated seat when dealing and rotating', () => {
    const s = baseState([[c('2', 'clubs')], [c('K', 'hearts')], [c('3', 'diamonds')]], {
      dealerSeat: 0,
      eliminatedSeats: [false, true, false],
    });
    const done = goOut(s, c('2', 'clubs'));
    const next = fiftyOneReducer(done, { type: 'START_NEXT_ROUND' }, { rng: makeRng(8) }) as FiftyOneState;
    // Dealer rotates 0 → (skip 1) → 2; starter = next active after 2 = 0.
    expect(next.dealerSeat).toBe(2);
    expect(next.starterSeat).toBe(0);
    expect(next.handsBySeat[1]).toHaveLength(0); // eliminated seat is not dealt
  });
});
