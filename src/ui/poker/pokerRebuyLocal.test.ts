import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import PokerRebuyPanel from './PokerRebuyPanel';
import PokerGameScreen from './PokerGameScreen';
import { pokerReducer } from '../../games/poker/engine';
import { createPokerDeck } from '../../games/poker/deck';
import { rebuyWindowOf, rebuyAmount } from '../../games/poker/rules';
import type { PokerCard, PokerState, Rank, Suit } from '../../games/poker/types';

// Stage 38.0.3B §17 — the LOCAL free rebuy. The device owner decides for EVERY busted
// seat (human or bot), the chips are free, and an explicit Continue closes the window.
// Nothing here may touch a wallet, an API or the network.

const html = (el: ReactElement) => renderToStaticMarkup(el);
const pc = (rank: Rank, suit: Suit): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });
const restOfDeck = (used: PokerCard[]) => {
  const ids = new Set(used.map((c) => c.id));
  return createPokerDeck().filter((c) => !ids.has(c.id));
};

/** Human seat 0 vs BOT seat 1; seat 1 is all-in and about to bust. */
function bustedWindow(stack = 1000, botSeatType: 'ai' | 'human' = 'ai'): PokerState {
  const used = [
    pc('A', 'spades'), pc('A', 'hearts'), pc('K', 'spades'), pc('K', 'hearts'),
    pc('9', 'spades'), pc('6', 'diamonds'), pc('4', 'clubs'), pc('3', 'hearts'), pc('2', 'spades'),
  ];
  const s: PokerState = {
    gameType: 'poker', phase: 'betting', playerCount: 2,
    players: [
      { id: 'player-0', name: 'You', seatIndex: 0, type: 'human' },
      { id: 'player-1', name: 'Botty', seatIndex: 1, type: botSeatType },
    ],
    options: { startingStack: stack, smallBlind: 10, bigBlind: 20, blindGrowthEveryHands: 0, mode: 'local_free' },
    buttonSeat: 0, handNumber: 2, street: 'river', smallBlindCurrent: 10, bigBlindCurrent: 20,
    stacksBySeat: [stack, 0],
    holeCardsBySeat: [[used[0], used[1]], [used[2], used[3]]],
    board: used.slice(4), deck: restOfDeck(used), burned: [],
    committedBySeat: [500, 500], contributedBySeat: [500, 500],
    foldedBySeat: [false, false], allInBySeat: [false, true], wasAllInBySeat: [false, true],
    actedBySeat: [false, true], raiseOpenBySeat: [true, false], eliminatedBySeat: [false, false],
    currentBet: 500, minRaise: 20, toActSeat: 0,
    revealedBySeat: [false, false], lastHand: null, winnerSeat: null, actionLog: [],
    telemetry: {
      handsPlayedBySeat: [2, 2], handsWonBySeat: [1, 0], showdownsWonBySeat: [1, 0],
      potsWonBySeat: [1, 0], biggestPotBySeat: [500, 0], allInsWonBySeat: [0, 0], royalFlushBySeat: [0, 0],
    },
    rebuyWindow: null, appliedRebuys: [],
  };
  return pokerReducer(s, { type: 'CHECK' }) as PokerState;
}

const panel = (state: PokerState, over: Partial<Parameters<typeof PokerRebuyPanel>[0]> = {}) =>
  createElement(PokerRebuyPanel, {
    state, amount: rebuyAmount(state),
    actionableSeats: rebuyWindowOf(state)?.eligibleSeats ?? [],
    onRebuy: () => {}, onDecline: () => {}, onContinue: () => {}, ...over,
  });

describe('local rebuy — a busted seat can buy back in for free', () => {
  it('a HUMAN bust offers the rebuy with the chosen starting stack', () => {
    const s = bustedWindow(5000, 'human');
    const out = html(panel(s));
    expect(out).toContain('poker-rebuy');
    expect(out).toMatch(/5[\s ,.']?000/);      // the amount is the configured stack
    expect(out).toContain('poker-rebuy__continue');
  });

  it('a BOT bust is offered too — the device owner may keep a bot in the game', () => {
    const s = bustedWindow(1000, 'ai');
    expect(rebuyWindowOf(s)?.eligibleSeats).toEqual([1]);
    const out = html(panel(s));
    expect(out).toContain('Botty');
    expect(out).toContain('poker-rebuy__add');   // an actionable Add button for the bot seat
  });

  it('applying the rebuy restores the stack and marks the seat', () => {
    const s = bustedWindow(1000);
    const r = pokerReducer(s, { type: 'REBUY', seat: 1 }) as PokerState;
    expect(r.stacksBySeat[1]).toBe(1000);
    const out = html(panel(r));
    expect(out).not.toContain('poker-rebuy__add');   // no second Add for a resolved seat
    expect(out).toContain('poker-rebuy__state');
  });

  it('a duplicate click cannot add chips twice (reducer no-op, same reference)', () => {
    const s = bustedWindow(1000);
    const once = pokerReducer(s, { type: 'REBUY', seat: 1 }) as PokerState;
    const twice = pokerReducer(once, { type: 'REBUY', seat: 1 }) as PokerState;
    expect(twice).toBe(once);
    expect(twice.stacksBySeat[1]).toBe(1000);
    expect(twice.appliedRebuys).toHaveLength(1);
  });

  it('declining then continuing eliminates the seat and finishes a heads-up match', () => {
    const s = bustedWindow();
    const d = pokerReducer(s, { type: 'DECLINE_REBUY', seat: 1 }) as PokerState;
    const c = pokerReducer(d, { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(c.phase).toBe('game_finished');
    expect(c.winnerSeat).toBe(0);
  });

  it('continuing WITHOUT deciding also finishes (no rebuy taken)', () => {
    const c = pokerReducer(bustedWindow(), { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(c.phase).toBe('game_finished');
  });

  it('after a rebuy, Continue resumes the match instead of finishing it', () => {
    const r = pokerReducer(bustedWindow(), { type: 'REBUY', seat: 1 }) as PokerState;
    const c = pokerReducer(r, { type: 'CLOSE_REBUY_WINDOW' }) as PokerState;
    expect(c.phase).toBe('hand_complete');
    const next = pokerReducer(c, { type: 'START_NEXT_HAND' }) as PokerState;
    expect(next.phase).toBe('betting');
    expect(next.handNumber).toBe(3);
  });
});

describe('the panel is wired into the table under the hand review', () => {
  it('PokerGameScreen renders the rebuy slot and keeps the showdown review up', () => {
    const s = bustedWindow();
    const out = html(createElement(PokerGameScreen, {
      state: s, mySeat: 0, apply: () => {}, onExit: () => {},
      rebuySlot: createElement('div', { className: 'probe-rebuy' }),
    }));
    expect(out).toContain('probe-rebuy');
    expect(out).toContain('poker-review');                      // review still on screen
    const review = out.indexOf('poker-review');
    const rebuy = out.indexOf('probe-rebuy');
    expect(rebuy).toBeGreaterThan(review);                      // panel sits UNDER the review
  });

  it('the manual "next hand" control is withheld while the window is open', () => {
    const s = bustedWindow();
    const dispatch = vi.fn();
    const out = html(createElement(PokerGameScreen, {
      state: s, mySeat: 0, apply: dispatch, onExit: () => {},
    }));
    // Local review normally offers Next; during a rebuy window it must not.
    expect(out).not.toContain('poker-review__next');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('local rebuy touches NO economy', () => {
  const localSrc = readFileSync(join(process.cwd(), 'src/ui/poker/PokerLocalGame.tsx'), 'utf8');
  const panelSrc = readFileSync(join(process.cwd(), 'src/ui/poker/PokerRebuyPanel.tsx'), 'utf8');

  it('neither the local game nor the panel imports a wallet/network module', () => {
    for (const src of [localSrc, panelSrc]) {
      expect(src).not.toContain('pokerWalletApi');
      expect(src).not.toContain('usePokerWallet');
      expect(src).not.toMatch(/\bfetch\(/);
      expect(src).not.toContain('WebSocket');
    }
  });

  it('the local window is driven by the pure reducer actions only', () => {
    expect(localSrc).toContain("type: 'REBUY'");
    expect(localSrc).toContain("type: 'DECLINE_REBUY'");
    expect(localSrc).toContain("type: 'CLOSE_REBUY_WINDOW'");
    // Every busted seat is actionable locally (human AND bot).
    expect(localSrc).toContain('actionableSeats={win.eligibleSeats}');
  });

  it('starting a new match clears any rebuy state', () => {
    // `start()` and `playAgain()` reset the whole state; the window lives on the state.
    expect(localSrc).toMatch(/function playAgain\(\)[\s\S]*setState\(null\)/);
    const fresh = pokerReducer(null, {
      type: 'START_GAME', playerNames: ['A', 'B'], playerTypes: ['human', 'ai'],
      playerCount: 2, options: { startingStack: 1000, mode: 'local_free' },
    })!;
    expect(fresh.rebuyWindow ?? null).toBe(null);
    expect(fresh.appliedRebuys).toEqual([]);
  });
});
