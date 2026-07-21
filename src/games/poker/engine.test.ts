import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { pokerReducer } from './engine';
import { checkPokerInvariants, totalChips } from './invariants';
import { DEFAULT_OPTIONS, legalActions } from './rules';
import type { Rank, Suit } from '../../models/types';
import type { PokerAction, PokerCard, PokerPlayer, PokerState } from './types';

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
    allInBySeat: falses(), wasAllInBySeat: falses(), actedBySeat: falses(),
    raiseOpenBySeat: Array.from({ length: n }, () => true), eliminatedBySeat: falses(),
    currentBet: 0, minRaise: DEFAULT_OPTIONS.bigBlind, toActSeat: 0, revealedBySeat: falses(),
    lastHand: null, winnerSeat: null, actionLog: [],
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

// ── Stage 37.4 corrective hardening ─────────────────────────────────────────

describe('P0-1 — START_GAME can never replace a live match', () => {
  it('a forged START_GAME mid-match returns the SAME state reference (no reset)', () => {
    const s = start(3, 9, 0);
    const forged: PokerAction = {
      type: 'START_GAME', playerNames: ['X', 'Y'], playerTypes: ['human', 'human'], playerCount: 2,
    };
    const r = pokerReducer(s, forged);
    expect(r).toBe(s);                 // same reference — content untouched
    expect(r!.playerCount).toBe(3);    // not replaced by the forged 2-player game
  });

  it('START_GAME is only honoured from the null (uncreated) state', () => {
    const created = pokerReducer(null, { type: 'START_GAME', playerNames: ['A', 'B'], playerCount: 2 });
    expect(created).not.toBeNull();
    expect(created!.playerCount).toBe(2);
  });
});

describe('P0-2 — malformed wager amounts never enter chip math (§5)', () => {
  // Reach a post-flop state where seat 1 may bet (currentBet 0) and seats may raise.
  function flopBetState(): PokerState {
    let s = start(3, 11, 0);
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;  // seat 0
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;  // seat 1 (SB)
    s = pokerReducer(s, { type: 'CHECK' }) as PokerState; // seat 2 (BB) → flop
    return s; // flop, currentBet 0, seat 1 to act (can BET)
  }
  const BAD: unknown[] = ['not-a-number', {}, null, undefined, NaN, Infinity, -Infinity, 20.5, -20, 0];

  it('rejects a malformed BET amount with the same state reference; invariants stay green', () => {
    const s = flopBetState();
    for (const amount of BAD) {
      const r = pokerReducer(s, { type: 'BET', amount } as unknown as PokerAction);
      expect(r, `BET amount ${String(amount)}`).toBe(s);
    }
    expect(checkPokerInvariants(s)).toEqual([]);
  });

  it('rejects a malformed RAISE amount; chips / pot / turn unchanged', () => {
    let s = flopBetState();
    s = pokerReducer(s, { type: 'BET', amount: 40 }) as PokerState; // a real bet so RAISE is legal
    const snapshot = JSON.stringify(s);
    for (const amount of BAD) {
      const r = pokerReducer(s, { type: 'RAISE', amount } as unknown as PokerAction);
      expect(r, `RAISE amount ${String(amount)}`).toBe(s);
    }
    expect(JSON.stringify(s)).toBe(snapshot); // no mutation at all
    expect(checkPokerInvariants(s)).toEqual([]);
  });
});

describe('P1-1 — an incomplete all-in raise does NOT re-open raise rights (§5/§6)', () => {
  it('already-acted seat may only call; a not-yet-acted seat keeps its raise right', () => {
    // Flop, 3 players in the hand. Order of action = seat 1, 2, 0 (SB first post-flop).
    // seat 2 has only 150 chips so its all-in over a 100 bet is an INCOMPLETE raise.
    let s = mkState({
      playerCount: 3, street: 'flop', buttonSeat: 0,
      board: [pc('9', 'spades'), pc('6', 'diamonds'), pc('2', 'clubs')],
      stacksBySeat: [300, 300, 150], contributedBySeat: [20, 20, 20],
      currentBet: 0, minRaise: 20, toActSeat: 1,
    });
    s = pokerReducer(s, { type: 'BET', amount: 100 }) as PokerState;   // seat 1 bets 100 (full)
    expect(s.toActSeat).toBe(2);
    s = pokerReducer(s, { type: 'ALL_IN' }) as PokerState;             // seat 2 all-in to 150 (incomplete raise: +50 < 100)
    expect(s.currentBet).toBe(150);
    expect(s.minRaise).toBe(100);                                     // NOT lowered by the incomplete raise
    expect(s.toActSeat).toBe(0);
    // seat 0 had not acted since the last full bet → it KEEPS the right to raise.
    expect(legalActions(s, 0).canRaise).toBe(true);
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;              // seat 0 calls 150
    // Action returns to seat 1, who already acted on the full bet → may only call the
    // extra 50 or fold; the incomplete raise did NOT re-open its raise right.
    expect(s.toActSeat).toBe(1);
    const la1 = legalActions(s, 1);
    expect(la1.canRaise).toBe(false);
    expect(la1.canCall).toBe(true);
    // Chip conservation across the actions (synthetic stacks, so compare to the sum in play).
    const inPlay = s.stacksBySeat.reduce((a, b) => a + b, 0) + s.contributedBySeat.reduce((a, b) => a + b, 0);
    expect(inPlay).toBe(300 + 300 + 150 + 60); // starting synthetic stacks + prior contributions
  });
});

describe('P1-2 — a short all-in big blind does not lower the nominal opening bet', () => {
  it('heads-up: the pre-flop currentBet stays the full big blind (20)', () => {
    // hand_complete → next hand deals with a short BB (seat 1 has 15 chips).
    const done = mkState({ playerCount: 2, phase: 'hand_complete', buttonSeat: 1, stacksBySeat: [1985, 15] });
    const s = pokerReducer(done, { type: 'START_NEXT_HAND' }, { rng: makeRng(3) }) as PokerState;
    // button 0 posts SB 10; seat 1 posts a short all-in BB of 15 — but currentBet = 20.
    expect(s.committedBySeat[0]).toBe(10);
    expect(s.committedBySeat[1]).toBe(15);
    expect(s.allInBySeat[1]).toBe(true);
    expect(s.currentBet).toBe(20);                 // nominal big blind, NOT 15
    expect(legalActions(s, 0).callAmount).toBe(10); // seat 0 must complete to 20
    expect(checkPokerInvariants(s)).toEqual([]);
  });

  it('3-player: a short all-in BB still sets a nominal currentBet of 20', () => {
    const done = mkState({ playerCount: 3, phase: 'hand_complete', buttonSeat: 2, stacksBySeat: [1998, 990, 12] });
    // next button = 0 → SB = 1, BB = 2 (short, 12 chips).
    const s = pokerReducer(done, { type: 'START_NEXT_HAND' }, { rng: makeRng(9) }) as PokerState;
    expect(s.committedBySeat[1]).toBe(10);
    expect(s.committedBySeat[2]).toBe(12);
    expect(s.allInBySeat[2]).toBe(true);
    expect(s.currentBet).toBe(20);
    expect(checkPokerInvariants(s)).toEqual([]);
  });

  it('side pots cap the short BB to its actual contribution; the excess is returned', () => {
    // River showdown: seat 0 committed 20, seat 1 all-in short for 15. Seat 1 wins the
    // 30 main pot; the uncalled 5 excess returns to seat 0.
    const s = mkState({
      playerCount: 2, board: [pc('9', 'spades'), pc('6', 'diamonds'), pc('4', 'clubs'), pc('3', 'hearts'), pc('2', 'spades')],
      holeCardsBySeat: [[pc('K', 'clubs'), pc('Q', 'hearts')], [pc('9', 'hearts'), pc('9', 'diamonds')]],
      contributedBySeat: [20, 15], stacksBySeat: [1965, 0],
      allInBySeat: [false, true], wasAllInBySeat: [false, true],
      actedBySeat: [false, true], toActSeat: 0,
    });
    const r = pokerReducer(s, { type: 'CHECK' }) as PokerState; // closes river → showdown
    expect(r.stacksBySeat[1]).toBe(30);   // pair of nines wins the 30 main pot
    expect(r.stacksBySeat[0]).toBe(1970); // 1965 + 5 uncalled excess returned
    const returned = r.lastHand!.pots.find((p) => p.returned);
    expect(returned?.amount).toBe(5);
    expect(returned?.winners).toEqual([0]);
    expect(r.telemetry.biggestPotBySeat[1]).toBe(30);
    expect(r.stacksBySeat.reduce((a, b) => a + b, 0)).toBe(2000);
  });
});

describe('P1-3 — fold-win returns uncalled excess (never counts it as a won pot, §8)', () => {
  it('winner 100 vs folded 20 → contested 40 won + 80 returned; biggestPot 40, net +20', () => {
    const s = mkState({
      playerCount: 2, street: 'preflop',
      committedBySeat: [100, 20], contributedBySeat: [100, 20], stacksBySeat: [900, 980],
      currentBet: 100, actedBySeat: [true, false], toActSeat: 1,
    });
    const r = pokerReducer(s, { type: 'FOLD' }) as PokerState; // seat 1 folds → seat 0 wins
    expect(r.phase).toBe('hand_complete');
    expect(r.stacksBySeat[0]).toBe(1020);            // 900 + 40 won + 80 returned
    expect(r.stacksBySeat.reduce((a, b) => a + b, 0)).toBe(2000);
    const contested = r.lastHand!.pots.find((p) => !p.returned);
    const returned = r.lastHand!.pots.find((p) => p.returned);
    expect(contested?.amount).toBe(40);
    expect(returned?.amount).toBe(80);
    expect(r.telemetry.biggestPotBySeat[0]).toBe(40); // NOT 120
    expect(r.telemetry.potsWonBySeat[0]).toBe(1);     // the returned layer is not a won pot
  });
});

describe('P2 — public action history (§13)', () => {
  it('records blinds + each action in order, with the actual committed amounts, no cards', () => {
    let s = start(3, 11, 0);
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;  // seat 0 calls 20
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;  // seat 1 (SB) calls 10 more
    s = pokerReducer(s, { type: 'CHECK' }) as PokerState; // seat 2 (BB) checks → flop
    expect(s.actionLog.slice(0, 5)).toEqual([
      { seat: 1, street: 'preflop', kind: 'blind', amount: 10 },
      { seat: 2, street: 'preflop', kind: 'blind', amount: 20 },
      { seat: 0, street: 'preflop', kind: 'call', amount: 20 },
      { seat: 1, street: 'preflop', kind: 'call', amount: 10 },
      { seat: 2, street: 'preflop', kind: 'check', amount: 0 },
    ]);
    // No card / deck / hole vocabulary ever appears in the public log.
    expect(JSON.stringify(s.actionLog)).not.toMatch(/rank|suit|hearts|spades|clubs|diamonds|hole|deck|burn/);
  });

  it('resets the action history at the next hand', () => {
    const done = mkState({ playerCount: 2, phase: 'hand_complete', buttonSeat: 1, stacksBySeat: [1000, 1000] });
    const s = pokerReducer(done, { type: 'START_NEXT_HAND' }, { rng: makeRng(2) }) as PokerState;
    // Fresh hand: only the two blind posts so far.
    expect(s.actionLog.every((e) => e.kind === 'blind')).toBe(true);
    expect(s.actionLog).toHaveLength(2);
  });
});

// ── Stage 37.4 corrective hardening — round 2 ───────────────────────────────

describe('FAIL 2 — ALL_IN cannot bypass a closed raise right (§5/§6)', () => {
  it('an already-acted seat with a closed raise right cannot shove to re-raise', () => {
    let s = mkState({
      playerCount: 3, street: 'flop', buttonSeat: 0,
      board: [pc('9', 'spades'), pc('6', 'diamonds'), pc('2', 'clubs')],
      stacksBySeat: [300, 300, 150], contributedBySeat: [20, 20, 20],
      currentBet: 0, minRaise: 20, toActSeat: 1,
    });
    s = pokerReducer(s, { type: 'BET', amount: 100 }) as PokerState;      // seat 1 bets 100 (full)
    // seat 2's raise right was RE-OPENED by the full bet → it may shove-raise.
    expect(legalActions(s, 2).canAllIn).toBe(true);
    s = pokerReducer(s, { type: 'ALL_IN' }) as PokerState;                // seat 2 incomplete all-in to 150
    // seat 0 has not acted since the full bet → keeps BOTH raise and shove-raise rights.
    expect(legalActions(s, 0).canRaise).toBe(true);
    expect(legalActions(s, 0).canAllIn).toBe(true);
    s = pokerReducer(s, { type: 'CALL' }) as PokerState;                  // seat 0 calls 150
    // seat 1 already acted; the incomplete all-in did NOT re-open its raise right.
    expect(s.toActSeat).toBe(1);
    const la1 = legalActions(s, 1);
    expect(la1.canRaise).toBe(false);
    expect(la1.canAllIn).toBe(false);       // a shove (300 > 150) would raise → blocked
    expect(la1.canCall).toBe(true);         // may only call the extra 50 …
    expect(pokerReducer(s, { type: 'ALL_IN' })).toBe(s); // … a forged ALL_IN is a no-op
    expect(pokerReducer(s, { type: 'CALL' })).not.toBe(s); // … a CALL is accepted
  });

  it('a SHORT all-in call (≤ current bet) stays legal even with a closed raise right', () => {
    // seat 1 has a closed right but only 30 chips over a 50 shortfall → a call for less.
    // A full river board is present so the resulting showdown resolves cleanly.
    const s = mkState({
      playerCount: 3, street: 'river',
      board: [pc('9', 'spades'), pc('6', 'diamonds'), pc('4', 'clubs'), pc('3', 'hearts'), pc('2', 'spades')],
      holeCardsBySeat: [[pc('A', 'spades'), pc('A', 'hearts')], [pc('K', 'spades'), pc('Q', 'hearts')], [pc('J', 'clubs'), pc('10', 'diamonds')]],
      stacksBySeat: [0, 30, 0], committedBySeat: [150, 100, 150], contributedBySeat: [150, 100, 150],
      allInBySeat: [true, false, true], actedBySeat: [true, false, true],
      raiseOpenBySeat: [false, false, false], currentBet: 150, minRaise: 100, toActSeat: 1,
    });
    const la = legalActions(s, 1);
    expect(la.canRaise).toBe(false);
    expect(la.canAllIn).toBe(true);    // maxTo 130 ≤ currentBet 150 → an all-in CALL, allowed
    expect(pokerReducer(s, { type: 'ALL_IN' })).not.toBe(s); // accepted
  });

  it('a full raise re-opens both canRaise and a shove-raise for everyone else', () => {
    let s = start(3, 13, 0);
    s = pokerReducer(s, { type: 'RAISE', amount: 60 }) as PokerState; // seat 0 full raise to 60
    // seat 1 faces a full raise → both rights open.
    const la1 = legalActions(s, 1);
    expect(la1.canRaise).toBe(true);
    expect(la1.canAllIn).toBe(true);
  });
});

describe('FAIL 1 — the reducer never throws on runtime-invalid direct input', () => {
  it('returns the same live state for null / non-object / unknown-type / malformed actions', () => {
    const s = start(3, 9, 0);
    const bad: unknown[] = [
      null, undefined, 'FOLD', 42, [], {}, { type: 'NUKE' },
      { type: 'BET' }, { type: 'RAISE', amount: 'x' }, { type: 'BET', amount: NaN },
      { type: 'START_GAME' }, { type: 'START_GAME', playerNames: 'AB' }, { type: 'START_GAME', playerNames: ['A', 'B'], playerCount: 1.5 },
    ];
    for (const a of bad) {
      expect(pokerReducer(s, a as never), JSON.stringify(a)).toBe(s); // same reference, no throw
    }
  });

  it('returns null (not a throw) for a malformed action from the null state', () => {
    expect(pokerReducer(null, null as never)).toBeNull();
    expect(pokerReducer(null, { type: 'START_GAME', playerNames: 'nope' } as never)).toBeNull();
  });
});
