import { describe, it, expect } from 'vitest';
import type { Card, Rank, ScoringConfig, Suit, Trick } from '../models/types';
import { calculateRoundScore } from './scoring';
import { getConfig } from '../config/gameConfigs';

const SCORING: ScoringConfig = {
  perTrick: -4,
  perHeart: -5,
  perQueen: -10,
  perJack: -10,
  kingOfHearts: -40,
  perLastTrick: -20,
  trumpRewardPerTrick: 8,
};

function card(suit: Suit, rank: Rank, value = 1): Card {
  return { suit, rank, value };
}

/** A trick that only records its winner — enough for trick-counting modes. */
function wonTrick(n: number, winnerId: string): Trick {
  return {
    trickNumber: n,
    leadPlayerId: winnerId,
    ledSuit: 'spades',
    plays: [],
    winnerId,
  };
}

const IDS = ['a', 'b', 'c'];

function emptyCollected(): Record<string, Card[]> {
  return { a: [], b: [], c: [] };
}

/** Normalise -0 (produced by `0 * negative`) to +0 for stable equality. */
function norm(scores: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(scores).map(([k, v]) => [k, v === 0 ? 0 : v]),
  );
}

describe('calculateRoundScore', () => {
  it('no_tricks: penalises each trick won', () => {
    const tricks = [wonTrick(1, 'a'), wonTrick(2, 'a'), wonTrick(3, 'b')];
    const scores = calculateRoundScore('no_tricks', tricks, emptyCollected(), IDS, SCORING);
    expect(scores).toEqual({ a: -8, b: -4, c: 0 });
  });

  it('no_hearts: penalises per collected heart', () => {
    const collected = emptyCollected();
    collected.a = [card('hearts', '7'), card('hearts', 'A'), card('spades', 'K')];
    collected.b = [card('hearts', '9')];
    const scores = norm(calculateRoundScore('no_hearts', [], collected, IDS, SCORING));
    expect(scores).toEqual({ a: -10, b: -5, c: 0 });
  });

  it('no_queens: penalises per collected queen', () => {
    const collected = emptyCollected();
    collected.a = [card('spades', 'Q'), card('hearts', 'Q')];
    collected.c = [card('clubs', 'Q')];
    const scores = norm(calculateRoundScore('no_queens', [], collected, IDS, SCORING));
    expect(scores).toEqual({ a: -20, b: 0, c: -10 });
  });

  it('no_jacks: penalises per collected jack', () => {
    const collected = emptyCollected();
    collected.b = [card('spades', 'J'), card('diamonds', 'J')];
    const scores = norm(calculateRoundScore('no_jacks', [], collected, IDS, SCORING));
    expect(scores).toEqual({ a: 0, b: -20, c: 0 });
  });

  it('king_of_hearts: penalises only the holder of K♥', () => {
    const collected = emptyCollected();
    collected.c = [card('hearts', 'K'), card('hearts', '7')];
    const scores = calculateRoundScore('king_of_hearts', [], collected, IDS, SCORING);
    expect(scores).toEqual({ a: 0, b: 0, c: -40 });
  });

  it('last_two_tricks: penalises only the final two tricks', () => {
    const tricks = [
      wonTrick(1, 'a'),
      wonTrick(2, 'a'),
      wonTrick(3, 'b'), // 2nd-to-last
      wonTrick(4, 'c'), // last
    ];
    const scores = calculateRoundScore('last_two_tricks', tricks, emptyCollected(), IDS, SCORING);
    expect(scores).toEqual({ a: 0, b: -20, c: -20 });
  });

  it('trump: rewards each trick won', () => {
    const tricks = [wonTrick(1, 'a'), wonTrick(2, 'c'), wonTrick(3, 'c')];
    const scores = calculateRoundScore('trump', tricks, emptyCollected(), IDS, SCORING);
    expect(scores).toEqual({ a: 8, b: 0, c: 16 });
  });
});

describe('configured scoring matches KING_RULES.md', () => {
  it('3-player scoring values', () => {
    const s = getConfig(3).scoring;
    expect(s).toEqual({
      perTrick: -4,
      perHeart: -5,
      perQueen: -10,
      perJack: -10,
      kingOfHearts: -40,
      perLastTrick: -20,
      trumpRewardPerTrick: 8,
    });
  });

  it('4-player scoring values', () => {
    const s = getConfig(4).scoring;
    expect(s).toEqual({
      perTrick: -4,
      perHeart: -4,
      perQueen: -13,
      perJack: -13,
      kingOfHearts: -52,
      perLastTrick: -26,
      trumpRewardPerTrick: 4,
    });
  });
});
