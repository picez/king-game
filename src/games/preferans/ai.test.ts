import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { rankValueOf } from './deck';
import { preferansBotAction } from './ai';
import { canBid, canDiscard, canPlayCard, getValidPlayableCards } from './rules';
import type { PreferansState } from './types';

const C = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: rankValueOf(rank) });

function base(partial: Partial<PreferansState>): PreferansState {
  return {
    gameType: 'preferans', phase: 'bidding',
    players: [0, 1, 2].map((i) => ({ id: `player-${i}`, name: 'x', seatIndex: i, type: 'ai' as const })),
    dealerSeat: 0, currentSeat: 0, handsBySeat: [[], [], []], talon: [], discards: [],
    bids: [], passed: [false, false, false], highBid: null, declarerSeat: null, contract: null,
    currentTrick: null, completedTricks: [], tricksBySeat: [0, 0, 0], scores: [0, 0, 0],
    handNumber: 1, targetScore: 10, options: { targetScore: 10 }, lastHand: null, handHistory: [], winnerSeat: null,
    ...partial,
  };
}

describe('bot bidding', () => {
  it('opens the minimum contract in its longest suit when it is 4+ long', () => {
    const hand = [C('spades', '7'), C('spades', '8'), C('spades', '9'), C('spades', '10'),
      C('hearts', 'A'), C('clubs', 'K'), C('diamonds', 'Q'), C('clubs', '7'), C('diamonds', '8'), C('hearts', '9')];
    const s = base({ currentSeat: 0, handsBySeat: [hand, [], []] });
    const a = preferansBotAction(s, 0);
    expect(a).toEqual({ type: 'BID', level: 6, suit: 'spades' });
    expect(canBid(s, 0, 6, 'spades')).toBe(true);
  });

  it('passes when no suit is 4+ long (e.g. a 3-3-3-1 hand)', () => {
    const hand = [C('spades', '7'), C('spades', '8'), C('spades', '9'),
      C('clubs', '7'), C('clubs', '8'), C('clubs', '9'),
      C('diamonds', '7'), C('diamonds', '8'), C('diamonds', '9'), C('hearts', 'A')];
    const s = base({ currentSeat: 0, handsBySeat: [hand, [], []] });
    expect(preferansBotAction(s, 0)).toEqual({ type: 'PASS_BID' });
  });

  it('does not escalate above a high bid it cannot beat with a level-6 in its suit', () => {
    const hand = [C('spades', '7'), C('spades', '8'), C('spades', '9'), C('spades', '10'), C('spades', 'J'),
      C('hearts', 'A'), C('clubs', 'K'), C('diamonds', 'Q'), C('clubs', '7'), C('diamonds', '8')];
    // high bid already 6♥ (above any level-6 spade bid) → the bot passes.
    const s = base({ currentSeat: 0, handsBySeat: [hand, [], []], highBid: { level: 6, suit: 'hearts', seat: 1 } });
    expect(preferansBotAction(s, 0)).toEqual({ type: 'PASS_BID' });
  });
});

describe('bot talon flow', () => {
  const declHand = [C('spades', '7'), C('spades', '8'), C('spades', '9'), C('spades', '10'),
    C('hearts', 'A'), C('clubs', 'K'), C('diamonds', 'Q'), C('clubs', '7'), C('diamonds', '8'), C('hearts', '9')];

  it('takes the talon, then discards exactly 2 legal cards, then declares the winning bid', () => {
    const talonState = base({
      phase: 'talon', currentSeat: 1, declarerSeat: 1, handsBySeat: [[], declHand, []],
      talon: [C('hearts', 'K'), C('clubs', 'A')], highBid: { level: 6, suit: 'spades', seat: 1 },
    });
    expect(preferansBotAction(talonState, 1)).toEqual({ type: 'TAKE_TALON' });

    const taken = base({
      phase: 'talon', currentSeat: 1, declarerSeat: 1,
      handsBySeat: [[], [...declHand, C('hearts', 'K'), C('clubs', 'A')], []],
      talon: [], discards: [], highBid: { level: 6, suit: 'spades', seat: 1 },
    });
    const discard = preferansBotAction(taken, 1);
    expect(discard.type).toBe('DISCARD');
    if (discard.type === 'DISCARD') expect(canDiscard(taken, 1, discard.cards)).toBe(true);

    const discarded = base({
      phase: 'talon', currentSeat: 1, declarerSeat: 1, handsBySeat: [[], declHand, []],
      talon: [], discards: [C('spades', '7'), C('spades', '8')], highBid: { level: 6, suit: 'spades', seat: 1 },
    });
    expect(preferansBotAction(discarded, 1)).toEqual({ type: 'DECLARE_CONTRACT', level: 6, suit: 'spades' });
  });
});

describe('bot play', () => {
  it('always returns a legal card', () => {
    const s = base({
      phase: 'playing', currentSeat: 0, contract: { level: 6, suit: 'spades' }, declarerSeat: 2,
      handsBySeat: [[C('hearts', 'K'), C('spades', '7'), C('clubs', '9')], [], []],
      currentTrick: { leadSeat: 2, ledSuit: 'hearts', winnerSeat: null, plays: [{ seat: 2, card: C('hearts', '8'), playOrder: 1 }, { seat: 1, card: C('hearts', '10'), playOrder: 2 }] },
    });
    const a = preferansBotAction(s, 0);
    expect(a.type).toBe('PLAY_CARD');
    if (a.type === 'PLAY_CARD') {
      expect(canPlayCard(s, 0, a.card)).toBe(true);
      // Must follow hearts (only K♥ is legal here).
      expect(getValidPlayableCards(s, 0).map((c) => c.rank)).toEqual(['K']);
      expect(a.card.rank).toBe('K');
    }
  });

  it('advances a finished hand', () => {
    const s = base({ phase: 'hand_complete', currentSeat: 0 });
    expect(preferansBotAction(s, 0)).toEqual({ type: 'START_NEXT_HAND' });
  });
});
