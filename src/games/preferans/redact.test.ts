import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { rankValueOf } from './deck';
import { preferansRedactStateFor } from './redact';
import type { PreferansState } from './types';

const C = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: rankValueOf(rank) });
const key = (c: Card) => `${c.suit}:${c.rank}`;

function stateWithHands(): PreferansState {
  return {
    gameType: 'preferans', phase: 'playing',
    players: [0, 1, 2].map((i) => ({ id: `player-${i}`, name: 'x', seatIndex: i, type: 'ai' as const })),
    dealerSeat: 0, currentSeat: 1,
    handsBySeat: [
      [C('spades', 'A'), C('spades', 'K')],
      [C('hearts', 'A'), C('hearts', 'K')],
      [C('clubs', 'A'), C('clubs', 'K')],
    ],
    talon: [C('diamonds', 'A'), C('diamonds', 'K')],
    discards: [C('diamonds', 'Q'), C('diamonds', 'J')],
    bids: [{ seat: 1, bid: { level: 6, suit: 'spades' } }], passed: [false, false, false],
    highBid: { level: 6, suit: 'spades', seat: 1 }, declarerSeat: 1, contract: { level: 6, suit: 'spades' },
    currentTrick: { leadSeat: 1, ledSuit: null, plays: [], winnerSeat: null },
    completedTricks: [], tricksBySeat: [0, 0, 0], scores: [1, -1, 0], handNumber: 2,
    targetScore: 10, options: { targetScore: 10 }, lastHand: null, handHistory: [], winnerSeat: null,
  };
}

describe('preferansRedactStateFor', () => {
  it('shows only the viewer own hand; hides other hands, talon, and discards (counts kept)', () => {
    const s = stateWithHands();
    const view = preferansRedactStateFor(s, 0);
    // Own hand real.
    expect(view.handsBySeat[0].map(key)).toEqual(['spades:A', 'spades:K']);
    // Other hands hidden (placeholders), same counts.
    expect(view.handsBySeat[1]).toHaveLength(2);
    expect(view.handsBySeat[2]).toHaveLength(2);
    expect(view.handsBySeat[1].every((c) => c.rank === '?')).toBe(true);
    expect(view.handsBySeat[2].every((c) => c.rank === '?')).toBe(true);
    // Talon + discards hidden, counts kept.
    expect(view.talon).toHaveLength(2);
    expect(view.discards).toHaveLength(2);
    expect([...view.talon, ...view.discards].every((c) => c.rank === '?')).toBe(true);
  });

  it('never leaks another seat card, the talon, or the discards', () => {
    const s = stateWithHands();
    const view = preferansRedactStateFor(s, 0);
    const leakedKeys = new Set([
      ...s.handsBySeat[1], ...s.handsBySeat[2], ...s.talon, ...s.discards,
    ].map(key));
    const visible = [
      ...view.handsBySeat.flat(), ...view.talon, ...view.discards,
    ].filter((c) => c.rank !== '?').map(key);
    for (const k of visible) expect(leakedKeys.has(k)).toBe(false); // only seat-0 cards remain visible
  });

  it('keeps public fields intact and hides ALL hands for a spectator (null)', () => {
    const s = stateWithHands();
    const spectator = preferansRedactStateFor(s, null);
    expect(spectator.handsBySeat.every((h) => h.every((c) => c.rank === '?'))).toBe(true);
    // Public info unchanged.
    expect(spectator.bids).toEqual(s.bids);
    expect(spectator.highBid).toEqual(s.highBid);
    expect(spectator.contract).toEqual(s.contract);
    expect(spectator.scores).toEqual(s.scores);
    expect(spectator.tricksBySeat).toEqual(s.tricksBySeat);
    expect(spectator.currentTrick).toEqual(s.currentTrick);
  });
});
