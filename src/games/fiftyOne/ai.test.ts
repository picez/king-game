import { describe, expect, it } from 'vitest';
import { makeRng } from '../../core/rng';
import { fiftyOneReducer } from './engine';
import { fiftyOneBotAction } from './ai';
import type { Rank, Suit } from '../../models/types';
import type { FiftyOneContext, FiftyOneCard, FiftyOneState } from './types';

const c = (rank: Rank, suit: Suit, d = 0): FiftyOneCard => ({ id: `${d}-${suit}-${rank}`, joker: false, suit, rank });

function baseState(hands: FiftyOneCard[][], over: Partial<FiftyOneState> = {}): FiftyOneState {
  const playerCount = hands.length;
  return {
    gameType: 'fifty-one', phase: 'playing', playerCount,
    players: hands.map((_, i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type: 'ai' })),
    dealerSeat: 0, starterSeat: 1, currentSeat: 0, turnStep: 'meld_discard',
    handsBySeat: hands, drawPile: [], discardPile: [],
    openedBySeat: hands.map(() => false), publicMelds: [],
    scoresBySeat: hands.map(() => 0), eliminatedSeats: hands.map(() => false),
    roundNumber: 1, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 }, ...over,
  };
}

describe('51 bot', () => {
  it('opens when it can assemble ≥ 51 from its own hand', () => {
    const hand = [
      c('10', 'hearts'), c('J', 'hearts'), c('Q', 'hearts'), // 30
      c('7', 'clubs'), c('7', 'diamonds'), c('7', 'spades'), // 21
      c('2', 'clubs'),                                        // spare
    ];
    const s = baseState([hand, [c('3', 'clubs')]], { currentSeat: 0 });
    const action = fiftyOneBotAction(s, 0);
    expect(action.type).toBe('OPEN_MELDS');
    const applied = fiftyOneReducer(s, action) as FiftyOneState;
    expect(applied.openedBySeat[0]).toBe(true);
    expect(applied.publicMelds.length).toBeGreaterThanOrEqual(2);
  });

  it('does not open when it cannot reach 51, and discards instead', () => {
    const hand = [c('2', 'clubs'), c('3', 'diamonds'), c('9', 'spades'), c('4', 'hearts')];
    const s = baseState([hand, [c('3', 'clubs')]], { currentSeat: 0 });
    const action = fiftyOneBotAction(s, 0);
    expect(action.type).toBe('DISCARD');
  });

  it('draws from the deck at the draw step (before opening)', () => {
    const s = baseState([[c('2', 'clubs')], [c('3', 'clubs')]], {
      currentSeat: 0, turnStep: 'draw', drawPile: [c('9', 'spades')], discardPile: [c('K', 'hearts')],
    });
    expect(fiftyOneBotAction(s, 0).type).toBe('DRAW_FROM_DECK');
  });

  it('takes the discard AND opens with it when the top completes a ≥51 opening (30.13)', () => {
    // Hand alone can't open (30 run + two loose 7s); with the discard 7♠ it makes a
    // set of 7s (21) → 51, so the bot takes-and-opens (never taking the discard bare).
    const hand = [
      c('7', 'clubs'), c('7', 'diamonds'),
      c('10', 'hearts'), c('J', 'hearts'), c('Q', 'hearts'), c('2', 'clubs'),
    ];
    const s = baseState([hand, [c('3', 'clubs')]], {
      currentSeat: 0, turnStep: 'draw', drawPile: [c('9', 'spades')], discardPile: [c('7', 'spades')],
    });
    const action = fiftyOneBotAction(s, 0);
    expect(action.type).toBe('TAKE_DISCARD_AND_OPEN');
    const applied = fiftyOneReducer(s, action) as FiftyOneState;
    expect(applied.openedBySeat[0]).toBe(true);
    expect(applied.discardPile).toHaveLength(0);           // the top was used to open
    expect(applied.turnStep).toBe('meld_discard');
  });

  it('does NOT take the discard when its hand can already open on its own', () => {
    // A full ≥51 opening is in-hand → the bot just draws (never takes the discard bare).
    const hand = [
      c('10', 'hearts'), c('J', 'hearts'), c('Q', 'hearts'),
      c('8', 'clubs'), c('8', 'diamonds'), c('8', 'spades'), c('2', 'clubs'),
    ];
    const s = baseState([hand, [c('3', 'clubs')]], {
      currentSeat: 0, turnStep: 'draw', drawPile: [c('9', 'spades')], discardPile: [c('7', 'spades')],
    });
    expect(fiftyOneBotAction(s, 0).type).toBe('DRAW_FROM_DECK');
  });

  it('goes out by discarding its last card when opened', () => {
    const s = baseState([[c('2', 'clubs')], [c('3', 'clubs')]], { currentSeat: 0, openedBySeat: [true, false] });
    const action = fiftyOneBotAction(s, 0);
    expect(action).toEqual({ type: 'DISCARD', card: c('2', 'clubs') });
    const done = fiftyOneReducer(s, action) as FiftyOneState;
    expect(done.phase).toBe('round_complete');
    expect(done.roundWinnerSeat).toBe(0);
  });

  it('takes the discard top when opened and it extends a public meld', () => {
    const meld = {
      id: 'm-1-0-0', ownerSeat: 0, type: 'run' as const,
      cards: [c('5', 'spades'), c('6', 'spades'), c('7', 'spades')], jokerRepresents: {}, value: 18,
    };
    const s = baseState([[c('2', 'clubs')], [c('K', 'hearts')]], {
      currentSeat: 0, turnStep: 'draw', openedBySeat: [true, false],
      publicMelds: [meld], drawPile: [c('9', 'diamonds')], discardPile: [c('8', 'spades')],
    });
    expect(fiftyOneBotAction(s, 0).type).toBe('TAKE_DISCARD');
  });

  it('always returns a legal action for the acting seat over a full bot game', () => {
    const ctx: FiftyOneContext = { rng: makeRng(11) };
    let state = fiftyOneReducer(null, {
      type: 'START_GAME', playerNames: ['B0', 'B1', 'B2', 'B3'], playerTypes: ['ai', 'ai', 'ai', 'ai'], dealerSeat: 0,
    }, ctx) as FiftyOneState;
    let steps = 0;
    let roundsCompleted = 0;
    while (state.phase !== 'game_finished' && steps++ < 4000) {
      if (state.phase === 'round_complete') roundsCompleted++;
      const action = state.phase === 'round_complete'
        ? ({ type: 'START_NEXT_ROUND' } as const)
        : fiftyOneBotAction(state, state.currentSeat);
      const next = fiftyOneReducer(state, action, ctx) as FiftyOneState;
      expect(next, `stalled at step ${steps} (${action.type})`).not.toBe(state);
      state = next;
    }
    // No stall over the whole game, and real progress (rounds actually resolved).
    expect(roundsCompleted).toBeGreaterThanOrEqual(1);
  }, 20_000);
});
