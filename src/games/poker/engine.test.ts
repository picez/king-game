import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { pokerReducer } from './engine';
import { checkPokerInvariants, totalChips } from './invariants';
import { DEFAULT_OPTIONS } from './rules';
import type { Rank, Suit } from '../../models/types';
import type { PokerCard, PokerPlayer, PokerState } from './types';

const pc = (rank: Rank, suit: Suit): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });

function start(playerCount: number, seed = 1, buttonSeat = 0): PokerState {
  const names = Array.from({ length: playerCount }, (_, i) => `P${i}`);
  const types = names.map(() => 'ai' as const);
  return pokerReducer(null, { type: 'START_GAME', playerNames: names, playerTypes: types, playerCount, buttonSeat }, { rng: makeRng(seed) }) as PokerState;
}

/** A directly-built betting state for deterministic showdown/side-pot tests. */
function mkState(over: Partial<PokerState> & { playerCount: number }): PokerState {
  const n = over.playerCount;
  const players: PokerPlayer[] = Array.from({ length: n }, (_, i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type: 'ai' }));
  const zeros = () => Array.from({ length: n }, () => 0);
  const falses = () => Array.from({ length: n }, () => false);
  return {
    gameType: 'poker', phase: 'betting', playerCount: n, players, options: DEFAULT_OPTIONS,
    buttonSeat: 0, handNumber: 1, street: 'river',
    stacksBySeat: Array.from({ length: n }, () => DEFAULT_OPTIONS.startingStack),
    holeCardsBySeat: Array.from({ length: n }, () => []), board: [], deck: [], burned: [],
    committedBySeat: zeros(), contributedBySeat: zeros(), foldedBySeat: falses(),
    allInBySeat: falses(), wasAllInBySeat: falses(), actedBySeat: falses(), eliminatedBySeat: falses(),
    currentBet: 0, minRaise: DEFAULT_OPTIONS.bigBlind, toActSeat: 0, revealedBySeat: falses(),
    lastHand: null, winnerSeat: null,
    telemetry: {
      handsPlayedBySeat: zeros(), handsWonBySeat: zeros(), showdownsWonBySeat: zeros(),
      potsWonBySeat: zeros(), biggestPotBySeat: zeros(), allInsWonBySeat: zeros(), royalFlushBySeat: zeros(),
    },
    ...over,
  };
}

describe('poker START_GAME + blinds (§1/§2)', () => {
  it('deals 2 hole cards each, posts SB/BB, opens pre-flop', () => {
    const s = start(3, 7, 0);
    expect(s.phase).toBe('betting');
    expect(s.street).toBe('preflop');
    for (let seat = 0; seat < 3; seat++) expect(s.holeCardsBySeat[seat]).toHaveLength(2);
    // 3-handed: SB = seat 1, BB = seat 2, first to act = seat 0 (button/UTG).
    expect(s.committedBySeat[1]).toBe(DEFAULT_OPTIONS.smallBlind);
    expect(s.committedBySeat[2]).toBe(DEFAULT_OPTIONS.bigBlind);
    expect(s.currentBet).toBe(DEFAULT_OPTIONS.bigBlind);
    expect(s.toActSeat).toBe(0);
    expect(s.stacksBySeat[1]).toBe(1000 - 10);
    expect(s.stacksBySeat[2]).toBe(1000 - 20);
    expect(checkPokerInvariants(s)).toEqual([]);
  });

  it('heads-up: the button posts the small blind and acts first pre-flop (§2)', () => {
    const s = start(2, 3, 0);
    // button = 0 posts SB and acts first pre-flop; seat 1 posts BB.
    expect(s.committedBySeat[0]).toBe(DEFAULT_OPTIONS.smallBlind);
    expect(s.committedBySeat[1]).toBe(DEFAULT_OPTIONS.bigBlind);
    expect(s.toActSeat).toBe(0);
  });

  it('heads-up: the big blind acts first post-flop', () => {
    let s = start(2, 5, 0);
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;   // button/SB calls to 20
    expect(s.toActSeat).toBe(1);                            // BB option
    s = pokerReducer(s, { type: 'CHECK' }) as PokerState;   // BB checks → flop
    expect(s.street).toBe('flop');
    expect(s.toActSeat).toBe(1);                            // BB first to act post-flop
    expect(s.board).toHaveLength(3);
  });
});

describe('poker betting actions & validation (§5/§6)', () => {
  it('rejects an out-of-turn / illegal action with the same state reference', () => {
    const s = start(3, 9, 0);
    // A BET is illegal pre-flop (there is an outstanding bet → must raise).
    expect(pokerReducer(s, { type: 'BET', amount: 40 })).toBe(s);
    // A below-min raise is illegal (min raise to 40).
    expect(pokerReducer(s, { type: 'RAISE', amount: 30 })).toBe(s);
    // A CHECK is illegal when facing the big blind.
    expect(pokerReducer(s, { type: 'CHECK' })).toBe(s);
  });

  it('supports check/call around to close a street and deal the flop', () => {
    let s = start(3, 11, 0);
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;   // seat 0 calls 20
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;   // seat 1 (SB) calls 10 more
    expect(s.toActSeat).toBe(2);                            // BB option
    s = pokerReducer(s, { type: 'CHECK' }) as PokerState;   // BB checks → flop
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.currentBet).toBe(0);
    expect(checkPokerInvariants(s)).toEqual([]);
  });

  it('a full raise reopens the action; min-raise increment is enforced', () => {
    let s = start(3, 13, 0);
    s = pokerReducer(s, { type: 'RAISE', amount: 60 }) as PokerState; // seat 0 raises to 60 (increment 40)
    expect(s.currentBet).toBe(60);
    expect(s.minRaise).toBe(40);
    // Next min raise must be to >= 100.
    const before = s;
    expect(pokerReducer(s, { type: 'RAISE', amount: 90 })).toBe(before); // below min
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;   // seat 1 calls 60
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;   // seat 2 calls 60
    expect(s.street).toBe('flop');
    expect(checkPokerInvariants(s)).toEqual([]);
  });
});

describe('poker showdown resolution (§9/§10)', () => {
  const board = [pc('9', 'spades'), pc('6', 'diamonds'), pc('4', 'clubs'), pc('3', 'hearts'), pc('2', 'spades')];

  it('awards the whole pot to the best hand at showdown', () => {
    const s = mkState({
      playerCount: 2, board,
      holeCardsBySeat: [[pc('A', 'spades'), pc('A', 'hearts')], [pc('K', 'spades'), pc('K', 'hearts')]],
      contributedBySeat: [100, 100], stacksBySeat: [900, 900],
      actedBySeat: [true, false], toActSeat: 1,
    });
    const r = pokerReducer(s, { type: 'CHECK' }) as PokerState;
    expect(r.phase).toBe('hand_complete');
    expect(r.lastHand?.showdown).toBe(true);
    expect(r.stacksBySeat[0]).toBe(1100); // aces win the 200 pot
    expect(r.stacksBySeat[1]).toBe(900);
    expect(r.revealedBySeat).toEqual([true, true]);
    expect(r.telemetry.handsWonBySeat[0]).toBe(1);
    expect(r.telemetry.showdownsWonBySeat[0]).toBe(1);
  });

  it('splits a tied (board-play) pot evenly', () => {
    const s = mkState({
      playerCount: 2, board: [pc('A', 'spades'), pc('A', 'hearts'), pc('K', 'diamonds'), pc('Q', 'clubs'), pc('J', 'spades')],
      holeCardsBySeat: [[pc('2', 'hearts'), pc('3', 'clubs')], [pc('2', 'diamonds'), pc('4', 'spades')]],
      contributedBySeat: [100, 100], stacksBySeat: [900, 900],
      actedBySeat: [true, false], toActSeat: 1,
    });
    const r = pokerReducer(s, { type: 'CHECK' }) as PokerState;
    expect(r.stacksBySeat[0]).toBe(1000);
    expect(r.stacksBySeat[1]).toBe(1000);
  });

  it('builds a main + side pot for a short all-in and awards each correctly', () => {
    const s = mkState({
      playerCount: 3, board,
      holeCardsBySeat: [
        [pc('A', 'spades'), pc('A', 'hearts')], // seat 0: pair of aces (best)
        [pc('K', 'spades'), pc('K', 'hearts')], // seat 1: pair of kings
        [pc('Q', 'clubs'), pc('J', 'diamonds')], // seat 2: queen high (worst)
      ],
      contributedBySeat: [50, 200, 200], stacksBySeat: [0, 800, 800],
      allInBySeat: [true, false, false], wasAllInBySeat: [true, false, false],
      actedBySeat: [true, true, false], toActSeat: 2,
    });
    const r = pokerReducer(s, { type: 'CHECK' }) as PokerState;
    // main pot 150 → seat 0 (aces); side pot 300 → seat 1 (kings, seat 0 not eligible).
    expect(r.stacksBySeat[0]).toBe(150);
    expect(r.stacksBySeat[1]).toBe(1100);
    expect(r.stacksBySeat[2]).toBe(800);
    expect(r.telemetry.allInsWonBySeat[0]).toBe(1); // seat 0 won after being all-in
  });

  it('wins without showdown when everyone else folds — no cards revealed (§7)', () => {
    const s = mkState({
      playerCount: 3, street: 'preflop',
      contributedBySeat: [20, 10, 20], stacksBySeat: [980, 990, 980],
      foldedBySeat: [false, true, false], actedBySeat: [true, true, false], toActSeat: 2,
    });
    const r = pokerReducer(s, { type: 'FOLD' }) as PokerState;
    expect(r.phase).toBe('hand_complete');
    expect(r.lastHand?.showdown).toBe(false);
    expect(r.revealedBySeat).toEqual([false, false, false]); // no reveal on a fold-win
    expect(r.stacksBySeat[0]).toBe(980 + 50); // seat 0 takes the 50 pot
  });

  it('counts a royal flush at showdown in telemetry', () => {
    const royalBoard = [pc('K', 'spades'), pc('Q', 'spades'), pc('J', 'spades'), pc('4', 'clubs'), pc('3', 'hearts')];
    const s = mkState({
      playerCount: 2, board: royalBoard,
      holeCardsBySeat: [[pc('A', 'spades'), pc('10', 'spades')], [pc('2', 'diamonds'), pc('2', 'hearts')]],
      contributedBySeat: [100, 100], stacksBySeat: [900, 900],
      actedBySeat: [true, false], toActSeat: 1,
    });
    const r = pokerReducer(s, { type: 'CHECK' }) as PokerState;
    expect(r.telemetry.royalFlushBySeat[0]).toBe(1);
  });
});

describe('poker hand loop & match finish (§2/§11)', () => {
  it('moves the button one seat clockwise on the next hand', () => {
    const s = mkState({
      playerCount: 3, street: 'preflop', buttonSeat: 0,
      contributedBySeat: [20, 10, 20], stacksBySeat: [980, 990, 980],
      foldedBySeat: [false, true, false], actedBySeat: [true, true, false], toActSeat: 2,
    });
    const done = pokerReducer(s, { type: 'FOLD' }) as PokerState;
    expect(done.phase).toBe('hand_complete');
    const next = pokerReducer(done, { type: 'START_NEXT_HAND' }, { rng: makeRng(4) }) as PokerState;
    expect(next.buttonSeat).toBe(1);
    expect(next.handNumber).toBe(2);
    expect(next.street).toBe('preflop');
  });

  it('finishes the match when one player holds all the chips', () => {
    // Lopsided late-match state (stacks already 1000 vs 0-behind): seat 1 is all-in
    // for its last 500 and loses; it busts, leaving seat 0 with all 2000 chips.
    const s = mkState({
      playerCount: 2, board: [pc('9', 'spades'), pc('6', 'diamonds'), pc('4', 'clubs'), pc('3', 'hearts'), pc('2', 'spades')],
      holeCardsBySeat: [[pc('A', 'spades'), pc('A', 'hearts')], [pc('K', 'spades'), pc('K', 'hearts')]],
      contributedBySeat: [500, 500], stacksBySeat: [1000, 0],
      allInBySeat: [false, true], wasAllInBySeat: [false, true],
      actedBySeat: [false, true], toActSeat: 0,
    });
    const r = pokerReducer(s, { type: 'CHECK' }) as PokerState;
    expect(r.stacksBySeat[0]).toBe(2000); // 1000 stack + 1000 pot
    expect(r.stacksBySeat[1]).toBe(0);
    expect(r.phase).toBe('game_finished');
    expect(r.winnerSeat).toBe(0);
    expect(r.eliminatedBySeat[1]).toBe(true);
  });
});

describe('poker chip conservation over a full seeded hand (§15)', () => {
  it('never creates or destroys chips through a scripted bot-free hand', () => {
    let s = start(4, 21, 0);
    const total = totalChips(s);
    const guard = () => {
      const chips = s.stacksBySeat.reduce((a, b) => a + b, 0) + (s.phase === 'betting' ? s.contributedBySeat.reduce((a, b) => a + b, 0) : 0);
      expect(chips).toBe(total);
      expect(checkPokerInvariants(s)).toEqual([]);
    };
    guard();
    // Everyone folds to the big blind (seats 3, 0, 1 fold; seat 2 = BB wins).
    s = pokerReducer(s, { type: 'FOLD' }) as PokerState; guard(); // seat 3 (UTG in 4-handed)
    s = pokerReducer(s, { type: 'FOLD' }) as PokerState; guard(); // seat 0 (button)
    s = pokerReducer(s, { type: 'FOLD' }) as PokerState; guard(); // seat 1 (SB)
    expect(s.phase).toBe('hand_complete');
    expect(s.stacksBySeat.reduce((a, b) => a + b, 0)).toBe(total); // all chips back in stacks
  });
});
