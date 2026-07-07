import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import type { Card, Rank, Suit } from '../../models/types';
import {
  createDebercDeck, cardPoints, trickStrength, dealDeberc, seqValue,
} from './deck';

const card = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: seqValue(rank) });

describe('deberc deck', () => {
  it('4 players → 36 unique cards (6..A × 4); 3 players → 32 (no 6s)', () => {
    const deck4 = createDebercDeck(4);
    expect(deck4).toHaveLength(36);
    expect(new Set(deck4.map((c) => `${c.rank}${c.suit}`)).size).toBe(36);

    const deck3 = createDebercDeck(3);
    expect(deck3).toHaveLength(32);
    expect(deck3.some((c) => c.rank === '6')).toBe(false); // 6s dropped for 3p
    expect(new Set(deck3.map((c) => `${c.rank}${c.suit}`)).size).toBe(32);
  });

  it('card points differ for trump vs non-trump', () => {
    expect(cardPoints(card('hearts', 'J'), 'hearts')).toBe(20); // trump J
    expect(cardPoints(card('hearts', 'J'), 'spades')).toBe(2);  // plain J
    expect(cardPoints(card('hearts', '9'), 'hearts')).toBe(14); // trump 9
    expect(cardPoints(card('hearts', '9'), 'spades')).toBe(0);  // plain 9
    expect(cardPoints(card('spades', 'A'), 'hearts')).toBe(11); // A always 11
    expect(cardPoints(card('spades', '10'), 'hearts')).toBe(10);
    expect(cardPoints(card('spades', '6'), 'hearts')).toBe(0);
  });

  it('total deck card points sum to 152 (both deck sizes — 6s are 0 pts)', () => {
    for (const n of [3, 4]) {
      const total = createDebercDeck(n).reduce((a, c) => a + cardPoints(c, 'hearts'), 0);
      expect(total).toBe(152);
    }
  });

  it('trick strength orders trump J > 9 > A and plain A > 10 > K', () => {
    const t = (r: Rank) => trickStrength(card('hearts', r), 'hearts');
    expect(t('J')).toBeGreaterThan(t('9'));
    expect(t('9')).toBeGreaterThan(t('A'));
    expect(t('A')).toBeGreaterThan(t('10'));
    const p = (r: Rank) => trickStrength(card('spades', r), 'hearts');
    expect(p('A')).toBeGreaterThan(p('10'));
    expect(p('10')).toBeGreaterThan(p('K'));
    expect(p('J')).toBeGreaterThan(p('9'));
  });
});

describe('dealDeberc (v1.1 — 6 hand + 3 прикуп)', () => {
  it('4 players: 6-card hands + 3-card прикуп each, whole deck used, no stock', () => {
    const { hands, prykup, stock, tableTrumpCard } = dealDeberc(4, 0, makeRng(1));
    expect(hands.map((h) => h.length)).toEqual([6, 6, 6, 6]);
    expect(prykup.map((p) => p.length)).toEqual([3, 3, 3, 3]);
    expect(stock).toHaveLength(0);
    // 4p: the face-up trump card is the dealer's прикуп top.
    expect(tableTrumpCard).toEqual(prykup[0][0]);
  });

  it('3 players (32-deck): 18 hand + 9 прикуп dealt, 5 left as stock; trump = stock top', () => {
    const { hands, prykup, stock, tableTrumpCard } = dealDeberc(3, 2, makeRng(7));
    expect(hands.map((h) => h.length)).toEqual([6, 6, 6]);
    expect(prykup.map((p) => p.length)).toEqual([3, 3, 3]);
    expect(stock).toHaveLength(5); // 32 − 27 dealt
    // 3p: the face-up trump card is the top of the stock (never taken).
    expect(tableTrumpCard).toEqual(stock[0]);
  });

  it('deals a partition of the deck (no dup, no loss): 32 for 3p, 36 for 4p', () => {
    for (const [n, total] of [[3, 32], [4, 36]] as const) {
      const { hands, prykup, stock } = dealDeberc(n, 0, makeRng(42));
      const all = [...hands.flat(), ...prykup.flat(), ...stock];
      expect(all).toHaveLength(total);
      expect(new Set(all.map((c) => `${c.rank}${c.suit}`)).size).toBe(total);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = dealDeberc(4, 1, makeRng(99));
    const b = dealDeberc(4, 1, makeRng(99));
    expect(a).toEqual(b);
  });
});
