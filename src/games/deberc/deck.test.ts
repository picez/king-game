import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import type { Card, Rank, Suit } from '../../models/types';
import {
  createDebercDeck, cardPoints, trickStrength, dealDeberc, seqValue,
} from './deck';

const card = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: seqValue(rank) });

describe('deberc deck', () => {
  it('has 36 unique cards (6..A × 4)', () => {
    const deck = createDebercDeck();
    expect(deck).toHaveLength(36);
    const keys = new Set(deck.map((c) => `${c.rank}${c.suit}`));
    expect(keys.size).toBe(36);
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

  it('total deck card points sum to 152', () => {
    const total = createDebercDeck().reduce((a, c) => a + cardPoints(c, 'hearts'), 0);
    expect(total).toBe(152);
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

describe('dealDeberc', () => {
  it('4 players: every seat gets 9, whole deck used, no stock', () => {
    const { hands, stock, tableTrumpCard } = dealDeberc(4, 0, makeRng(1));
    expect(hands.map((h) => h.length)).toEqual([9, 9, 9, 9]);
    expect(stock).toHaveLength(0);
    // trump card is the об'яз's last dealt card
    expect(tableTrumpCard).toEqual(hands[0][8]);
  });

  it('3 players: 27 dealt, 9 left as stock', () => {
    const { hands, stock } = dealDeberc(3, 2, makeRng(7));
    expect(hands.map((h) => h.length)).toEqual([9, 9, 9]);
    expect(stock).toHaveLength(9);
  });

  it('deals a partition of the 36-card deck (no dup, no loss)', () => {
    const { hands, stock } = dealDeberc(3, 0, makeRng(42));
    const all = [...hands.flat(), ...stock];
    expect(all).toHaveLength(36);
    expect(new Set(all.map((c) => `${c.rank}${c.suit}`)).size).toBe(36);
  });

  it('is deterministic for a fixed seed', () => {
    const a = dealDeberc(4, 1, makeRng(99));
    const b = dealDeberc(4, 1, makeRng(99));
    expect(a).toEqual(b);
  });
});
