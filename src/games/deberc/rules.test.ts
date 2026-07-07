import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../../models/types';
import { seqValue } from './deck';
import { legalPlays, isLegalPlay, resolveTrick, isTrump } from './rules';
import type { DebercPlay } from './types';

const card = (suit: Suit, rank: Rank): Card => ({ suit, rank, value: seqValue(rank) });
const play = (seatIndex: number, c: Card, playOrder: number): DebercPlay => ({ seatIndex, card: c, playOrder });

describe('legalPlays (DEBERC_RULES §5)', () => {
  const trump: Suit = 'hearts';

  it('leading: any card is legal', () => {
    const hand = [card('spades', 'A'), card('hearts', '7')];
    expect(legalPlays(hand, null, trump)).toHaveLength(2);
  });

  it('must follow the led suit when able', () => {
    const hand = [card('spades', 'A'), card('spades', '7'), card('hearts', 'K')];
    const legal = legalPlays(hand, 'spades', trump);
    expect(legal.every((c) => c.suit === 'spades')).toBe(true);
    expect(legal).toHaveLength(2);
  });

  it('void in led suit but holding trump: must play trump (any trump)', () => {
    const hand = [card('clubs', 'A'), card('hearts', '7'), card('hearts', 'K')];
    const legal = legalPlays(hand, 'spades', trump);
    expect(legal.every((c) => c.suit === 'hearts')).toBe(true);
    expect(legal).toHaveLength(2); // over-trumping NOT required — both trumps legal
  });

  it('void in both led suit and trump: any card is legal', () => {
    const hand = [card('clubs', 'A'), card('diamonds', '7')];
    expect(legalPlays(hand, 'spades', trump)).toHaveLength(2);
  });

  it('isLegalPlay agrees with legalPlays', () => {
    const hand = [card('spades', 'A'), card('hearts', 'K')];
    expect(isLegalPlay(card('spades', 'A'), hand, 'spades', trump)).toBe(true);
    expect(isLegalPlay(card('hearts', 'K'), hand, 'spades', trump)).toBe(false);
  });
});

describe('resolveTrick (DEBERC_RULES §5)', () => {
  const trump: Suit = 'hearts';

  it('highest card of the led suit wins with no trump', () => {
    const plays = [
      play(0, card('spades', '10'), 1),
      play(1, card('spades', 'A'), 2),
      play(2, card('spades', 'K'), 3),
    ];
    expect(resolveTrick(plays, 'spades', trump)).toBe(1); // A > 10 > K
  });

  it('a trump beats any led-suit card', () => {
    const plays = [
      play(0, card('spades', 'A'), 1),
      play(1, card('hearts', '6'), 2), // lowest trump still wins
      play(2, card('spades', '10'), 3),
    ];
    expect(resolveTrick(plays, 'spades', trump)).toBe(1);
  });

  it('strongest trump wins when several are played (J > 9)', () => {
    const plays = [
      play(0, card('spades', 'A'), 1),
      play(1, card('hearts', '9'), 2),
      play(2, card('hearts', 'J'), 3),
    ];
    expect(resolveTrick(plays, 'spades', trump)).toBe(2); // trump J
  });

  it('off-suit non-trump discard cannot win', () => {
    const plays = [
      play(0, card('spades', '7'), 1),
      play(1, card('clubs', 'A'), 2), // discard, cannot win
    ];
    expect(resolveTrick(plays, 'spades', trump)).toBe(0);
  });

  it('isTrump helper', () => {
    expect(isTrump(card('hearts', '6'), 'hearts')).toBe(true);
    expect(isTrump(card('spades', '6'), 'hearts')).toBe(false);
    expect(isTrump(card('hearts', '6'), null)).toBe(false);
  });
});
