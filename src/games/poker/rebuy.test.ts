import { describe, expect, it } from 'vitest';
import { pokerReducer } from './engine';
import { checkPokerInvariants, totalChips } from './invariants';
import {
  rebuyWindowOf, rebuyAmount, canSeatRebuy, pendingRebuySeats, reboughtSeats, rebuyChipsAdded,
  isPokerAction, isPokerLifecycleAction,
} from './rules';
import { createPokerDeck } from './deck';
import type { PokerCard, PokerState, Rank, Suit } from './types';

// Stage 38.0.3B §17 — the between-hands rebuy window in the PURE core.
// Owner rule: once a stack hits 0 the seat may buy back in between hands, for exactly one
// starting stack (local) / one table buy-in (online). Nothing here knows about wallets,
// users, matches or ledgers — the economy is the server's job.

const pc = (rank: Rank, suit: Suit): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });

/** Every card not already dealt, so a hand-built fixture still holds all 52 (card
 *  conservation is one of the invariants these tests assert). */
function restOfDeck(used: PokerCard[]): PokerCard[] {
  const ids = new Set(used.map((c) => c.id));
  return createPokerDeck().filter((c) => !ids.has(c.id));
}

/** A heads-up state where seat 1 is all-in for its last chips and about to lose. */
function aboutToBust(stack = 1000): PokerState {
  return {
    gameType: 'poker', phase: 'betting', playerCount: 2,
    players: [
      { id: 'player-0', name: 'A', seatIndex: 0, type: 'human' },
      { id: 'player-1', name: 'B', seatIndex: 1, type: 'human' },
    ],
    options: { startingStack: stack, smallBlind: 10, bigBlind: 20, blindGrowthEveryHands: 0 },
    buttonSeat: 0, handNumber: 3, street: 'river',
    smallBlindCurrent: 10, bigBlindCurrent: 20,
    stacksBySeat: [stack, 0],
    holeCardsBySeat: [[pc('A', 'spades'), pc('A', 'hearts')], [pc('K', 'spades'), pc('K', 'hearts')]],
    board: [pc('9', 'spades'), pc('6', 'diamonds'), pc('4', 'clubs'), pc('3', 'hearts'), pc('2', 'spades')],
    deck: restOfDeck([
      pc('A', 'spades'), pc('A', 'hearts'), pc('K', 'spades'), pc('K', 'hearts'),
      pc('9', 'spades'), pc('6', 'diamonds'), pc('4', 'clubs'), pc('3', 'hearts'), pc('2', 'spades'),
    ]),
    burned: [],
    committedBySeat: [500, 500], contributedBySeat: [500, 500],
    foldedBySeat: [false, false], allInBySeat: [false, true], wasAllInBySeat: [false, true],
    actedBySeat: [false, true], raiseOpenBySeat: [true, false], eliminatedBySeat: [false, false],
    currentBet: 500, minRaise: 20, toActSeat: 0,
    revealedBySeat: [false, false], lastHand: null, winnerSeat: null, actionLog: [],
    telemetry: {
      handsPlayedBySeat: [3, 3], handsWonBySeat: [2, 0], showdownsWonBySeat: [1, 0],
      potsWonBySeat: [2, 0], biggestPotBySeat: [500, 0], allInsWonBySeat: [0, 0], royalFlushBySeat: [0, 0],
    },
    rebuyWindow: null, appliedRebuys: [],
  };
}

/** Play the hand out so seat 1 busts and the window opens. */
function bustedWindow(stack = 1000): PokerState {
  const s = pokerReducer(aboutToBust(stack), { type: 'CHECK' }) as PokerState;
  expect(s.phase).toBe('rebuy_window');
  return s;
}

describe('the window opens instead of eliminating', () => {
  it('a busted seat is NOT eliminated and the match does NOT finish', () => {
    const s = bustedWindow();
    expect(s.phase).toBe('rebuy_window');
    expect(s.eliminatedBySeat[1]).toBe(false);
    expect(s.winnerSeat).toBe(null);
    expect(s.rebuyWindow).toEqual({ handNumber: 3, eligibleSeats: [1], decisionBySeat: ['pending', 'pending'] });
    expect(checkPokerInvariants(s)).toEqual([]);
  });

  it('the showdown result stays on screen (lastHand is preserved, nobody out yet)', () => {
    const s = bustedWindow();
    expect(s.lastHand).not.toBe(null);
    expect(s.lastHand!.newlyEliminated).toEqual([]);
  });

  it('no busted seat → no window at all (unchanged behaviour)', () => {
    const base = aboutToBust();
    base.stacksBySeat = [500, 500];
    base.committedBySeat = [500, 500];
    const s = pokerReducer(base, { type: 'CHECK' }) as PokerState;
    expect(s.phase).toBe('hand_complete');
    expect(s.rebuyWindow ?? null).toBe(null);
  });

  it('the pure helpers describe the window', () => {
    const s = bustedWindow(2500);
    expect(rebuyWindowOf(s)?.eligibleSeats).toEqual([1]);
    expect(rebuyAmount(s)).toBe(2500);          // == options.startingStack, never from an action
    expect(canSeatRebuy(s, 1)).toBe(true);
    expect(canSeatRebuy(s, 0)).toBe(false);     // seat 0 still has chips
    expect(pendingRebuySeats(s)).toEqual([1]);
    expect(reboughtSeats(s)).toEqual([]);
  });
});

describe('REBUY', () => {
  it('restores exactly one starting stack and records the applied identity', () => {
    const s = bustedWindow(1000);
    const r = pokerReducer(s, { type: 'REBUY', seat: 1 }) as PokerState;
    expect(r).not.toBe(s);
    expect(r.stacksBySeat[1]).toBe(1000);
    expect(r.rebuyWindow!.decisionBySeat[1]).toBe('rebought');
    expect(r.appliedRebuys).toEqual([{ handNumber: 3, seat: 1 }]);
    expect(reboughtSeats(r)).toEqual([1]);
    expect(pendingRebuySeats(r)).toEqual([]);
  });

  it('the amount comes from options, NEVER from the action', () => {
    const s = bustedWindow(7777);
    const r = pokerReducer(s, { type: 'REBUY', seat: 1, amount: 999999 } as never) as PokerState;
    expect(r.stacksBySeat[1]).toBe(7777);
  });

  it('chip conservation grows by exactly one stack per applied rebuy', () => {
    const s = bustedWindow(1000);
    expect(totalChips(s)).toBe(2000);
    const r = pokerReducer(s, { type: 'REBUY', seat: 1 }) as PokerState;
    expect(rebuyChipsAdded(r)).toBe(1000);
    expect(totalChips(r)).toBe(3000);
    expect(r.stacksBySeat.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(checkPokerInvariants(r)).toEqual([]);
  });

  it('a DUPLICATE rebuy is a no-op with the SAME state reference (no double chips)', () => {
    const s = bustedWindow();
    const r = pokerReducer(s, { type: 'REBUY', seat: 1 }) as PokerState;
    const again = pokerReducer(r, { type: 'REBUY', seat: 1 }) as PokerState;
    expect(again).toBe(r);
    expect(again.stacksBySeat[1]).toBe(1000);
    expect(again.appliedRebuys).toHaveLength(1);
  });

  it('rejects a seat that is not busted (no arbitrary top-up)', () => {
    const s = bustedWindow();
    expect(pokerReducer(s, { type: 'REBUY', seat: 0 })).toBe(s);
  });

  it('rejects an out-of-range / non-integer / negative seat', () => {
    const s = bustedWindow();
    for (const seat of [2, -1, 1.5, Number.NaN] as number[]) {
      expect(pokerReducer(s, { type: 'REBUY', seat })).toBe(s);
    }
  });

  it('rejects a rebuy outside the window (during betting and after close)', () => {
    const live = aboutToBust();
    expect(pokerReducer(live, { type: 'REBUY', seat: 1 })).toBe(live);
    const closed = pokerReducer(bustedWindow(), { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(pokerReducer(closed, { type: 'REBUY', seat: 1 })).toBe(closed);
  });

  it('rejects a rebuy for a seat that already declined', () => {
    const s = bustedWindow();
    const d = pokerReducer(s, { type: 'DECLINE_REBUY', seat: 1 }) as PokerState;
    expect(pokerReducer(d, { type: 'REBUY', seat: 1 })).toBe(d);
  });
});

describe('DECLINE_REBUY', () => {
  it('marks the decision and is idempotent (same reference on a repeat)', () => {
    const s = bustedWindow();
    const d = pokerReducer(s, { type: 'DECLINE_REBUY', seat: 1 }) as PokerState;
    expect(d.rebuyWindow!.decisionBySeat[1]).toBe('declined');
    const again = pokerReducer(d, { type: 'DECLINE_REBUY', seat: 1 }) as PokerState;
    expect(again.rebuyWindow!.decisionBySeat[1]).toBe('declined');
    expect(pendingRebuySeats(again)).toEqual([]);
  });

  it('never undoes a paid rebuy', () => {
    const r = pokerReducer(bustedWindow(), { type: 'REBUY', seat: 1 }) as PokerState;
    expect(pokerReducer(r, { type: 'DECLINE_REBUY', seat: 1 })).toBe(r);
  });

  it('rejects a non-eligible seat', () => {
    const s = bustedWindow();
    expect(pokerReducer(s, { type: 'DECLINE_REBUY', seat: 0 })).toBe(s);
  });
});

describe('CLOSE_REBUY_WINDOW', () => {
  it('a rebought seat stays in and the match continues', () => {
    const r = pokerReducer(bustedWindow(), { type: 'REBUY', seat: 1 }) as PokerState;
    const c = pokerReducer(r, { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(c.phase).toBe('hand_complete');
    expect(c.eliminatedBySeat[1]).toBe(false);
    expect(c.rebuyWindow ?? null).toBe(null);
    expect(c.lastHand!.newlyEliminated).toEqual([]);
    expect(checkPokerInvariants(c)).toEqual([]);
  });

  it('a declined seat is eliminated and, with one survivor, the match finishes', () => {
    const d = pokerReducer(bustedWindow(), { type: 'DECLINE_REBUY', seat: 1 }) as PokerState;
    const c = pokerReducer(d, { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(c.phase).toBe('game_finished');
    expect(c.winnerSeat).toBe(0);
    expect(c.eliminatedBySeat[1]).toBe(true);
    expect(c.lastHand!.newlyEliminated).toEqual([1]);
  });

  it('an UNANSWERED seat is treated as a decline (the timeout path)', () => {
    const c = pokerReducer(bustedWindow(), { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(c.eliminatedBySeat[1]).toBe(true);
    expect(c.phase).toBe('game_finished');
  });

  it('closing twice is a no-op with the same reference', () => {
    const c = pokerReducer(bustedWindow(), { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(pokerReducer(c, { type: 'CLOSE_REBUY_WINDOW' })).toBe(c);
  });

  it('the button and the blinds only move on the NEXT deal, after the close', () => {
    const s = bustedWindow();
    expect(s.buttonSeat).toBe(0);
    expect(s.handNumber).toBe(3);
    const r = pokerReducer(s, { type: 'REBUY', seat: 1 }) as PokerState;
    expect(r.buttonSeat).toBe(0);
    expect(r.handNumber).toBe(3);                 // still the finished hand
    const c = pokerReducer(r, { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(c.buttonSeat).toBe(0);
    const next = pokerReducer(c, { type: 'START_NEXT_HAND' }) as PokerState;
    expect(next.buttonSeat).toBe(1);
    expect(next.handNumber).toBe(4);
    expect(next.phase).toBe('betting');
  });
});

describe('START_NEXT_HAND can never skip an open window', () => {
  it('is a no-op (same reference) while the window is open', () => {
    const s = bustedWindow();
    expect(pokerReducer(s, { type: 'START_NEXT_HAND' })).toBe(s);
    const r = pokerReducer(s, { type: 'REBUY', seat: 1 }) as PokerState;
    expect(pokerReducer(r, { type: 'START_NEXT_HAND' })).toBe(r); // still open until closed
  });
});

describe('multi-seat windows', () => {
  /** 4-handed: seats 1 and 2 both bust on the same hand. */
  function twoBusted(): PokerState {
    const s = aboutToBust();
    const four: PokerState = {
      ...s, playerCount: 4,
      players: [0, 1, 2, 3].map((i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type: 'human' as const })),
      stacksBySeat: [2000, 0, 0, 500],   // 2000+0+0+500 + 1500 pot = 4 x 1000 (conserved)
      holeCardsBySeat: [
        [pc('A', 'spades'), pc('A', 'hearts')], [pc('K', 'spades'), pc('K', 'hearts')],
        [pc('Q', 'spades'), pc('Q', 'hearts')], [pc('J', 'spades'), pc('J', 'hearts')],
      ],
      deck: restOfDeck([
        pc('A', 'spades'), pc('A', 'hearts'), pc('K', 'spades'), pc('K', 'hearts'),
        pc('Q', 'spades'), pc('Q', 'hearts'), pc('J', 'spades'), pc('J', 'hearts'),
        pc('9', 'spades'), pc('6', 'diamonds'), pc('4', 'clubs'), pc('3', 'hearts'), pc('2', 'spades'),
      ]),
      committedBySeat: [500, 500, 500, 0], contributedBySeat: [500, 500, 500, 0],
      foldedBySeat: [false, false, false, true],
      allInBySeat: [false, true, true, false], wasAllInBySeat: [false, true, true, false],
      actedBySeat: [false, true, true, true], raiseOpenBySeat: [true, false, false, false],
      eliminatedBySeat: [false, false, false, false],
      revealedBySeat: [false, false, false, false],
      telemetry: {
        handsPlayedBySeat: [3, 3, 3, 3], handsWonBySeat: [2, 0, 0, 0], showdownsWonBySeat: [1, 0, 0, 0],
        potsWonBySeat: [2, 0, 0, 0], biggestPotBySeat: [500, 0, 0, 0], allInsWonBySeat: [0, 0, 0, 0], royalFlushBySeat: [0, 0, 0, 0],
      },
    };
    const done = pokerReducer(four, { type: 'CHECK' }) as PokerState;
    expect(done.phase).toBe('rebuy_window');
    return done;
  }

  it('lists every busted seat and resolves them independently', () => {
    const s = twoBusted();
    expect(s.rebuyWindow!.eligibleSeats).toEqual([1, 2]);
    const a = pokerReducer(s, { type: 'REBUY', seat: 1 }) as PokerState;
    const b = pokerReducer(a, { type: 'DECLINE_REBUY', seat: 2 }) as PokerState;
    expect(pendingRebuySeats(b)).toEqual([]);
    const c = pokerReducer(b, { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(c.eliminatedBySeat[1]).toBe(false);
    expect(c.eliminatedBySeat[2]).toBe(true);
    expect(c.phase).toBe('hand_complete');       // seats 0, 1, 3 remain
    expect(c.appliedRebuys).toEqual([{ handNumber: 3, seat: 1 }]);
    expect(checkPokerInvariants(c)).toEqual([]);
  });

  it('two rebuys add exactly two stacks', () => {
    const s = twoBusted();
    const a = pokerReducer(s, { type: 'REBUY', seat: 1 }) as PokerState;
    const b = pokerReducer(a, { type: 'REBUY', seat: 2 }) as PokerState;
    expect(b.appliedRebuys).toHaveLength(2);
    expect(rebuyChipsAdded(b)).toBe(2000);
    expect(b.stacksBySeat.reduce((x, y) => x + y, 0)).toBe(totalChips(b));
    expect(checkPokerInvariants(b)).toEqual([]);
  });
});

describe('action validation at the untrusted boundary', () => {
  it('accepts a well-formed rebuy action and rejects malformed ones', () => {
    expect(isPokerAction({ type: 'REBUY', seat: 1 })).toBe(true);
    expect(isPokerAction({ type: 'DECLINE_REBUY', seat: 0 })).toBe(true);
    expect(isPokerAction({ type: 'CLOSE_REBUY_WINDOW' })).toBe(true);
    for (const bad of [
      { type: 'REBUY' }, { type: 'REBUY', seat: '1' }, { type: 'REBUY', seat: -1 },
      { type: 'REBUY', seat: 1.5 }, { type: 'REBUY', seat: null }, { type: 'DECLINE_REBUY', seat: {} },
    ]) expect(isPokerAction(bad)).toBe(false);
  });

  it('rebuy actions are LIFECYCLE — a raw seated ACTION_REQUEST can never drive them', () => {
    // Online they travel on their own authenticated intents, because the server must
    // debit a wallet before applying one.
    expect(isPokerLifecycleAction({ type: 'REBUY' })).toBe(true);
    expect(isPokerLifecycleAction({ type: 'DECLINE_REBUY' })).toBe(true);
    expect(isPokerLifecycleAction({ type: 'CLOSE_REBUY_WINDOW' })).toBe(true);
    expect(isPokerLifecycleAction({ type: 'CALL' })).toBe(false);
  });
});
