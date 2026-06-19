import { describe, it, expect } from 'vitest';
import type { Card, Suit, Trick, TrickPlay } from '../models/types';
import { getValidCards, isValidPlay, resolveTrick } from './rules';

function card(suit: Suit, value: number): Card {
  return { suit, rank: String(value) as Card['rank'], value };
}

function trick(plays: TrickPlay[], ledSuit: Suit): Trick {
  return {
    trickNumber: 1,
    leadPlayerId: plays[0].playerId,
    ledSuit,
    plays,
    winnerId: null,
  };
}

describe('getValidCards', () => {
  const hand: Card[] = [card('spades', 5), card('spades', 9), card('hearts', 3)];

  it('allows any card when leading', () => {
    expect(getValidCards(hand, null)).toHaveLength(3);
  });

  it('forces following the led suit when possible', () => {
    const valid = getValidCards(hand, 'spades');
    expect(valid).toHaveLength(2);
    expect(valid.every((c) => c.suit === 'spades')).toBe(true);
  });

  it('allows any card when void in the led suit', () => {
    const valid = getValidCards(hand, 'clubs');
    expect(valid).toHaveLength(3);
  });
});

describe('getValidCards — no leading hearts (No Hearts / King of Hearts)', () => {
  it('cannot lead a heart while holding non-hearts', () => {
    const h: Card[] = [card('hearts', 5), card('spades', 9), card('clubs', 3)];
    const valid = getValidCards(h, null, 'no_hearts');
    expect(valid.some((c) => c.suit === 'hearts')).toBe(false);
    expect(valid).toHaveLength(2);
    // King of Hearts mode has the same lead restriction.
    expect(getValidCards(h, null, 'king_of_hearts').some((c) => c.suit === 'hearts')).toBe(false);
  });

  it('may lead a heart when only hearts remain', () => {
    const onlyHearts: Card[] = [card('hearts', 5), card('hearts', 9)];
    expect(getValidCards(onlyHearts, null, 'no_hearts')).toHaveLength(2);
  });

  it('no restriction in other modes, or when following suit', () => {
    const h: Card[] = [card('hearts', 5), card('spades', 9)];
    expect(getValidCards(h, null, 'no_tricks')).toHaveLength(2); // can lead anything
    // Following a led heart is always allowed.
    expect(getValidCards(h, 'hearts', 'no_hearts').some((c) => c.suit === 'hearts')).toBe(true);
  });

  it('isValidPlay rejects leading a heart in No Hearts while holding others', () => {
    const h: Card[] = [card('hearts', 5), card('spades', 9)];
    expect(isValidPlay(card('hearts', 5), h, null, 'no_hearts')).toBe(false);
    expect(isValidPlay(card('spades', 9), h, null, 'no_hearts')).toBe(true);
  });
});

describe('isValidPlay', () => {
  const hand: Card[] = [card('spades', 5), card('hearts', 3)];

  it('rejects an off-suit card while holding the led suit', () => {
    expect(isValidPlay(card('hearts', 3), hand, 'spades')).toBe(false);
  });

  it('accepts the led-suit card', () => {
    expect(isValidPlay(card('spades', 5), hand, 'spades')).toBe(true);
  });

  it('accepts any held card when void in the led suit', () => {
    expect(isValidPlay(card('hearts', 3), hand, 'clubs')).toBe(true);
  });
});

describe('resolveTrick — no trump', () => {
  it('the highest card of the led suit wins', () => {
    const t = trick(
      [
        { playerId: 'a', card: card('spades', 5), playOrder: 1 },
        { playerId: 'b', card: card('spades', 9), playOrder: 2 },
        { playerId: 'c', card: card('hearts', 14), playOrder: 3 }, // off-suit, ignored
      ],
      'spades',
    );
    expect(resolveTrick(t, null)).toBe('b');
  });

  it('off-suit high cards never win without trump', () => {
    const t = trick(
      [
        { playerId: 'a', card: card('clubs', 2), playOrder: 1 },
        { playerId: 'b', card: card('hearts', 14), playOrder: 2 },
      ],
      'clubs',
    );
    expect(resolveTrick(t, null)).toBe('a');
  });
});

describe('resolveTrick — with trump', () => {
  it('a trump card beats the highest led-suit card', () => {
    const t = trick(
      [
        { playerId: 'a', card: card('spades', 13), playOrder: 1 },
        { playerId: 'b', card: card('hearts', 2), playOrder: 2 }, // trump
      ],
      'spades',
    );
    expect(resolveTrick(t, 'hearts')).toBe('b');
  });

  it('the highest trump wins when several are played', () => {
    const t = trick(
      [
        { playerId: 'a', card: card('hearts', 5), playOrder: 1 },
        { playerId: 'b', card: card('hearts', 9), playOrder: 2 },
        { playerId: 'c', card: card('spades', 14), playOrder: 3 },
      ],
      'hearts',
    );
    expect(resolveTrick(t, 'hearts')).toBe('b');
  });
});
