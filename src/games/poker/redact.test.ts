import { describe, expect, it } from 'vitest';
import { pokerRedactStateFor } from './redact';
import type { Rank, Suit } from '../../models/types';
import type { PokerCard, PokerPlayer, PokerState } from './types';

const pc = (rank: Rank, suit: Suit): PokerCard => ({ id: `${suit}-${rank}`, suit, rank });

function sample(over: Partial<PokerState> = {}): PokerState {
  const n = 3;
  const players: PokerPlayer[] = Array.from({ length: n }, (_, i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type: 'ai' }));
  const zeros = () => Array.from({ length: n }, () => 0);
  const falses = () => Array.from({ length: n }, () => false);
  return {
    gameType: 'poker', phase: 'betting', playerCount: n, players,
    options: { startingStack: 1000, smallBlind: 10, bigBlind: 20 },
    buttonSeat: 0, handNumber: 1, street: 'flop',
    stacksBySeat: [980, 990, 980],
    holeCardsBySeat: [
      [pc('A', 'spades'), pc('K', 'spades')],
      [pc('7', 'hearts'), pc('7', 'diamonds')],
      [pc('2', 'clubs'), pc('3', 'clubs')],
    ],
    board: [pc('Q', 'hearts'), pc('J', 'diamonds'), pc('10', 'spades')],
    deck: [pc('4', 'hearts'), pc('5', 'hearts'), pc('6', 'hearts')],
    burned: [pc('9', 'clubs')],
    committedBySeat: zeros(), contributedBySeat: [20, 20, 20], foldedBySeat: falses(),
    allInBySeat: falses(), wasAllInBySeat: falses(), actedBySeat: falses(), eliminatedBySeat: falses(),
    currentBet: 0, minRaise: 20, toActSeat: 1, revealedBySeat: falses(),
    lastHand: null, winnerSeat: null,
    telemetry: {
      handsPlayedBySeat: zeros(), handsWonBySeat: zeros(), showdownsWonBySeat: zeros(),
      potsWonBySeat: zeros(), biggestPotBySeat: zeros(), allInsWonBySeat: zeros(), royalFlushBySeat: zeros(),
    },
    ...over,
  };
}

const isHidden = (c: PokerCard) => c.id === 'hidden' && c.suit === null && c.rank === null;

describe('poker redaction — hole cards / deck / burns are private (§13)', () => {
  it('shows the viewer their own hole cards and hides every opponent hand', () => {
    const state = sample();
    const view = pokerRedactStateFor(state, 0);
    expect(view.holeCardsBySeat[0]).toEqual(state.holeCardsBySeat[0]); // own hand real
    for (const seat of [1, 2]) {
      expect(view.holeCardsBySeat[seat]).toHaveLength(2);              // count kept
      expect(view.holeCardsBySeat[seat].every(isHidden)).toBe(true);  // no rank/suit
    }
  });

  it('a JSON scan of a player view leaks no opponent card id, deck order or burn', () => {
    const state = sample();
    const view = pokerRedactStateFor(state, 0);
    const json = JSON.stringify(view);
    for (const seat of [1, 2]) for (const c of state.holeCardsBySeat[seat]) {
      expect(json.includes(c.id), `leaked seat ${seat} card ${c.id}`).toBe(false);
    }
    for (const c of state.deck) expect(json.includes(c.id), `leaked deck ${c.id}`).toBe(false);
    for (const c of state.burned) expect(json.includes(c.id), `leaked burn ${c.id}`).toBe(false);
    expect(view.deck).toEqual([]);
    expect(view.burned).toEqual([]);
  });

  it('the community board, pots and stacks stay public', () => {
    const view = pokerRedactStateFor(sample(), 1);
    expect(view.board).toEqual(sample().board);
    expect(view.contributedBySeat).toEqual([20, 20, 20]);
    expect(view.stacksBySeat).toEqual([980, 990, 980]);
  });

  it('a spectator (null seat) sees NO hole cards at all', () => {
    const state = sample();
    const view = pokerRedactStateFor(state, null);
    const json = JSON.stringify(view);
    for (const seat of [0, 1, 2]) {
      expect(view.holeCardsBySeat[seat].every(isHidden)).toBe(true);
      for (const c of state.holeCardsBySeat[seat]) expect(json.includes(c.id)).toBe(false);
    }
  });

  it('reveals only showdown-eligible seats; a folded hand is never revealed', () => {
    // seat 1 revealed at showdown, seat 2 folded (not revealed).
    const state = sample({ revealedBySeat: [false, true, false], foldedBySeat: [false, false, true] });
    const view = pokerRedactStateFor(state, 0); // viewer is seat 0
    expect(view.holeCardsBySeat[1]).toEqual(state.holeCardsBySeat[1]); // revealed opponent
    expect(view.holeCardsBySeat[2].every(isHidden)).toBe(true);        // folded → hidden
    const json = JSON.stringify(view);
    for (const c of state.holeCardsBySeat[2]) expect(json.includes(c.id)).toBe(false);
  });

  it('does not mutate the authoritative state', () => {
    const state = sample();
    const before = JSON.stringify(state);
    pokerRedactStateFor(state, 0);
    pokerRedactStateFor(state, null);
    expect(JSON.stringify(state)).toBe(before);
  });
});
