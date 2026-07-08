import { describe, expect, it } from 'vitest';
import type { Card, Suit } from '../../models/types';
import {
  determineTrickWinner,
  legalPlays,
  nextSeatCounterClockwise,
  otherTeam,
  partnerOfSeat,
  teamOfSeat,
} from './rules';
import type { TarneebPlay } from './types';

const card = (suit: Suit, rank: Card['rank']): Card => {
  const v: Record<string, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    J: 11, Q: 12, K: 13, A: 14,
  };
  return { suit, rank, value: v[rank] };
};
const play = (seat: number, c: Card, order: number): TarneebPlay => ({ seat, card: c, playOrder: order });

describe('Tarneeb seats & teams', () => {
  it('places seats 0 & 2 on team A, seats 1 & 3 on team B', () => {
    expect(teamOfSeat(0)).toBe('A');
    expect(teamOfSeat(2)).toBe('A');
    expect(teamOfSeat(1)).toBe('B');
    expect(teamOfSeat(3)).toBe('B');
  });

  it('has partners sitting opposite', () => {
    expect(partnerOfSeat(0)).toBe(2);
    expect(partnerOfSeat(2)).toBe(0);
    expect(partnerOfSeat(1)).toBe(3);
    expect(partnerOfSeat(3)).toBe(1);
  });

  it('goes counter-clockwise: 0 → 3 → 2 → 1 → 0', () => {
    expect(nextSeatCounterClockwise(0)).toBe(3);
    expect(nextSeatCounterClockwise(3)).toBe(2);
    expect(nextSeatCounterClockwise(2)).toBe(1);
    expect(nextSeatCounterClockwise(1)).toBe(0);
  });

  it('otherTeam flips A/B', () => {
    expect(otherTeam('A')).toBe('B');
    expect(otherTeam('B')).toBe('A');
  });
});

describe('Tarneeb legal plays (follow suit)', () => {
  const hand = [card('hearts', 'A'), card('hearts', '2'), card('spades', 'K'), card('clubs', '9')];

  it('may lead any card', () => {
    expect(legalPlays(hand, null)).toHaveLength(4);
  });

  it('must follow the led suit when holding it', () => {
    const legal = legalPlays(hand, 'hearts');
    expect(legal.map((c) => c.rank).sort()).toEqual(['2', 'A']);
    expect(legal.every((c) => c.suit === 'hearts')).toBe(true);
  });

  it('may play anything when void in the led suit (no obligation to trump)', () => {
    const legal = legalPlays(hand, 'diamonds');
    expect(legal).toHaveLength(4);
  });
});

describe('Tarneeb trick winner', () => {
  it('picks the highest card of the led suit when no trump is played', () => {
    const plays = [
      play(0, card('hearts', '9'), 1),
      play(3, card('hearts', 'K'), 2),
      play(2, card('hearts', '5'), 3),
      play(1, card('clubs', 'A'), 4), // off-suit discard, cannot win
    ];
    expect(determineTrickWinner(plays, 'hearts', 'spades')).toBe(3);
  });

  it('lets any trump beat the highest led-suit card', () => {
    const plays = [
      play(0, card('hearts', 'A'), 1),
      play(3, card('spades', '2'), 2), // low trump beats the ace of hearts
      play(2, card('hearts', 'K'), 3),
      play(1, card('hearts', '3'), 4),
    ];
    expect(determineTrickWinner(plays, 'hearts', 'spades')).toBe(3);
  });

  it('picks the highest trump when several are played', () => {
    const plays = [
      play(0, card('hearts', 'A'), 1),
      play(3, card('spades', '2'), 2),
      play(2, card('spades', 'Q'), 3),
      play(1, card('spades', '10'), 4),
    ];
    expect(determineTrickWinner(plays, 'hearts', 'spades')).toBe(2);
  });
});
