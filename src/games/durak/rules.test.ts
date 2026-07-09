import { describe, it, expect } from 'vitest';
import { cardValue } from './deck';
import { beats, getValidAttackCards, getValidDefenseCards, canTransfer } from './rules';
import type { Card } from '../../models/types';
import type { DurakPlayer, DurakState } from './types';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit, value: cardValue(rank) });
const P = (seat: number, hand: Card[]): DurakPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human', hand });

function st(over: Partial<DurakState>): DurakState {
  const s: DurakState = {
    gameType: 'durak', variant: 'simple', players: [P(0, []), P(1, [])],
    drawPile: [], trumpSuit: 'spades', trumpCard: C('6', 'spades'),
    attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0, passedAttackers: [],
    table: [], discardPile: [],
    status: 'attack', boutLimit: 6, trumpShowUsed: false, lastTrumpShow: null,
    foolId: null, winnerIds: [], isDraw: false, ...over,
  };
  if (over.throwerIndex === undefined) s.throwerIndex = s.attackerIndex;
  if (over.lastThrowerIndex === undefined) s.lastThrowerIndex = s.throwerIndex;
  return s;
}

describe('beats()', () => {
  it('higher card of the same suit beats', () => {
    expect(beats(C('9', 'hearts'), C('7', 'hearts'), 'spades')).toBe(true);
    expect(beats(C('6', 'hearts'), C('7', 'hearts'), 'spades')).toBe(false);
  });
  it('any trump beats a non-trump', () => {
    expect(beats(C('6', 'spades'), C('A', 'hearts'), 'spades')).toBe(true);
  });
  it('a trump attack is only beaten by a higher trump', () => {
    expect(beats(C('K', 'spades'), C('Q', 'spades'), 'spades')).toBe(true);
    expect(beats(C('9', 'spades'), C('Q', 'spades'), 'spades')).toBe(false);
    expect(beats(C('A', 'hearts'), C('6', 'spades'), 'spades')).toBe(false); // non-trump can't beat trump
  });
  it('different non-trump suit never beats', () => {
    expect(beats(C('A', 'clubs'), C('6', 'hearts'), 'spades')).toBe(false);
  });
});

describe('valid attack / defense cards', () => {
  it('any card opens when the table is empty', () => {
    const s = st({ players: [P(0, [C('6', 'hearts'), C('A', 'spades')]), P(1, [])], status: 'attack' });
    expect(getValidAttackCards(s)).toHaveLength(2);
  });
  it('throw-ins must match a rank on the table and respect the limit', () => {
    const s = st({
      players: [P(0, [C('7', 'clubs'), C('9', 'diamonds')]), P(1, [])],
      table: [{ attack: C('7', 'hearts'), defense: C('8', 'hearts') }], status: 'attack', boutLimit: 6,
    });
    expect(getValidAttackCards(s).map((c) => c.rank)).toEqual(['7']); // 7 matches; 9 doesn't (8 is on table though)
  });
  it('no throw-ins once the attack limit is reached', () => {
    const s = st({
      players: [P(0, [C('7', 'clubs')]), P(1, [])],
      table: [{ attack: C('7', 'hearts'), defense: C('8', 'hearts') }], status: 'attack', boutLimit: 1,
    });
    expect(getValidAttackCards(s)).toEqual([]);
  });
  it('defense cards must beat the target attack', () => {
    const s = st({
      players: [P(0, []), P(1, [C('9', 'hearts'), C('6', 'spades'), C('6', 'hearts')])],
      table: [{ attack: C('7', 'hearts'), defense: null }], status: 'defense',
    });
    expect(getValidDefenseCards(s, C('7', 'hearts')).map((c) => `${c.rank}${c.suit[0]}`).sort())
      .toEqual(['6s', '9h']); // 9♥ higher same suit, 6♠ trump; 6♥ too low
  });
});

describe('canTransfer()', () => {
  const transferState = (over: Partial<DurakState>) => st({
    variant: 'transfer', status: 'defense',
    players: [P(0, []), P(1, [C('7', 'clubs')]), P(2, [C('9', 'clubs'), C('10', 'clubs')])],
    table: [{ attack: C('7', 'hearts'), defense: null }], attackerIndex: 0, defenderIndex: 1, ...over,
  });
  it('allows a same-rank transfer within the next defender capacity', () => {
    expect(canTransfer(transferState({}))).toBe(true);
  });
  it('forbids transfer in the simple variant', () => {
    expect(canTransfer(transferState({ variant: 'simple' }))).toBe(false);
  });
  it('forbids transfer after any card was beaten', () => {
    expect(canTransfer(transferState({
      table: [{ attack: C('7', 'hearts'), defense: C('8', 'hearts') }, { attack: C('7', 'diamonds'), defense: null }],
    }))).toBe(false);
  });
  it('forbids transfer over the next defender hand capacity', () => {
    expect(canTransfer(transferState({
      players: [P(0, []), P(1, [C('7', 'clubs')]), P(2, [C('9', 'clubs')])], // next defender holds only 1; total would be 2
    }))).toBe(false);
  });
  it('forbids transfer when the defender holds no matching rank', () => {
    expect(canTransfer(transferState({
      players: [P(0, []), P(1, [C('8', 'clubs')]), P(2, [C('9', 'clubs'), C('10', 'clubs')])],
    }))).toBe(false);
  });
});
