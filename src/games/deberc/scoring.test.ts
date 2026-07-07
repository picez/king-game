import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { seqValue } from './deck';
import { detectBestSequence } from './melds';
import { scoreHand, sumCardPoints, LAST_TRICK_BONUS, BELLA_POINTS } from './scoring';

const card = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: seqValue(rank) });
const run = (suit: Suit, ranks: Rank[]): Card[] => ranks.map((r) => card(suit, r));

describe('sumCardPoints', () => {
  it('sums with trump-aware values', () => {
    const cards = [card('hearts', 'J'), card('hearts', '9'), card('spades', 'A')];
    expect(sumCardPoints(cards, 'hearts')).toBe(20 + 14 + 11);
  });
});

describe('scoreHand (DEBERC_RULES §6)', () => {
  // 4 players, 2 teams: seats 0&2 vs 1&3
  const teamOf = [0, 1, 0, 1];
  const teamCount = 2;

  it('adds card points + last-trick bonus per team', () => {
    const wonCards: Card[][] = [
      [card('spades', 'A')],     // seat0 → team0: 11
      [card('spades', '10')],    // seat1 → team1: 10
      [card('hearts', 'J')],     // seat2 → team0: 20 (trump J)
      [],                        // seat3
    ];
    const res = scoreHand({
      wonCards, trumpSuit: 'hearts', lastTrickWinnerSeat: 1,
      teamOf, teamCount, bestSequences: [null, null, null, null], bellaSeats: [],
    });
    expect(res.cardPoints[0]).toBe(11 + 20);
    expect(res.cardPoints[1]).toBe(10 + LAST_TRICK_BONUS);
    expect(res.meldPoints).toEqual([0, 0]);
  });

  it('adds scoring sequence melds by the hierarchy', () => {
    const seat0 = detectBestSequence(run('spades', ['7', '8', '9']), 0, 'hearts');       // terz 20
    const seat1 = detectBestSequence(run('clubs', ['9', '10', 'J', 'Q']), 1, 'hearts');  // platina 50 → cancels terz
    const res = scoreHand({
      wonCards: [[], [], [], []], trumpSuit: 'hearts', lastTrickWinnerSeat: 0,
      teamOf, teamCount, bestSequences: [seat0, seat1, null, null], bellaSeats: [],
    });
    expect(res.meldPoints[0]).toBe(0);   // terz shut out
    expect(res.meldPoints[1]).toBe(50);  // platina scores
  });

  it('adds bella to the earning seat’s team', () => {
    const res = scoreHand({
      wonCards: [[], [], [], []], trumpSuit: 'hearts', lastTrickWinnerSeat: 0,
      teamOf, teamCount, bestSequences: [null, null, null, null], bellaSeats: [2],
    });
    expect(res.meldPoints[0]).toBe(BELLA_POINTS);
    expect(res.teamPoints[0]).toBe(LAST_TRICK_BONUS + BELLA_POINTS);
  });
});
