import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { cardValue, findLowestTrumpHolder } from './deck';
import { durakReducer, getActingDurakPlayerId } from './engine';
import type { Card } from '../../models/types';
import type { DurakAction, DurakPlayer, DurakState } from './types';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit, value: cardValue(rank) });
const P = (seat: number, hand: Card[]): DurakPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human', hand });
const ids = (cards: Card[]) => cards.map((c) => `${c.rank}${c.suit[0]}`).sort();

function st(over: Partial<DurakState>): DurakState {
  return {
    gameType: 'durak', variant: 'simple', players: [P(0, []), P(1, [])],
    drawPile: [], trumpSuit: 'spades', trumpCard: C('6', 'spades'),
    attackerIndex: 0, defenderIndex: 1, table: [], discardPile: [],
    status: 'attack', boutLimit: 6, foolId: null, winnerIds: [], isDraw: false, ...over,
  };
}

describe('START_DURAK', () => {
  it.each([2, 3, 4])('deals %i players 6 cards and picks the lowest-trump first attacker', (n) => {
    const names = Array.from({ length: n }, (_, i) => `P${i}`);
    const s = durakReducer(null, { type: 'START_DURAK', playerNames: names, variant: 'simple' }, { rng: makeRng(99) })!;
    expect(s.players).toHaveLength(n);
    expect(s.players.every((p) => p.hand.length === 6)).toBe(true);
    expect(s.drawPile).toHaveLength(36 - 6 * n);
    expect(s.status).toBe('attack');
    const expected = findLowestTrumpHolder(s.players.map((p) => p.hand), s.trumpSuit) ?? 0;
    expect(s.attackerIndex).toBe(expected);
    expect(s.defenderIndex).toBe((expected + 1) % n);
    expect(getActingDurakPlayerId(s)).toBe(`player-${expected}`);
  });

  it('rejects an already-started game (same reference) and a null non-start action', () => {
    const s = st({});
    expect(durakReducer(s, { type: 'START_DURAK', playerNames: ['A', 'B'], variant: 'simple' })).toBe(s);
    expect(durakReducer(null, { type: 'TAKE_CARDS' })).toBeNull();
  });
});

describe('attack', () => {
  it('accepts a legal opening card and flips to defense', () => {
    const s = st({ players: [P(0, [C('7', 'hearts'), C('A', 'spades')]), P(1, [])], status: 'attack' });
    const next = durakReducer(s, { type: 'ATTACK_CARD', card: C('7', 'hearts') })!;
    expect(next.table).toEqual([{ attack: C('7', 'hearts'), defense: null }]);
    expect(next.status).toBe('defense');
    expect(next.players[0].hand).toHaveLength(1); // card left the hand
  });

  it('rejects a card the attacker does not hold (same reference)', () => {
    const s = st({ players: [P(0, [C('7', 'hearts')]), P(1, [])], status: 'attack' });
    expect(durakReducer(s, { type: 'ATTACK_CARD', card: C('K', 'clubs') })).toBe(s);
  });

  it('rejects a throw-in whose rank is not on the table', () => {
    const s = st({
      players: [P(0, [C('9', 'diamonds')]), P(1, [])],
      table: [{ attack: C('7', 'hearts'), defense: C('8', 'hearts') }], status: 'attack',
    });
    expect(durakReducer(s, { type: 'ATTACK_CARD', card: C('9', 'diamonds') })).toBe(s);
  });
});

describe('defense', () => {
  it('beats a card and (all beaten) returns to the attacker', () => {
    const s = st({
      players: [P(0, []), P(1, [C('9', 'hearts')])],
      table: [{ attack: C('7', 'hearts'), defense: null }], status: 'defense',
    });
    const next = durakReducer(s, { type: 'DEFEND_CARD', attack: C('7', 'hearts'), card: C('9', 'hearts') })!;
    expect(next.table[0].defense).toEqual(C('9', 'hearts'));
    expect(next.status).toBe('attack');
  });

  it('rejects a defense that does not beat the attack (same reference)', () => {
    const s = st({
      players: [P(0, []), P(1, [C('6', 'hearts')])],
      table: [{ attack: C('7', 'hearts'), defense: null }], status: 'defense',
    });
    expect(durakReducer(s, { type: 'DEFEND_CARD', attack: C('7', 'hearts'), card: C('6', 'hearts') })).toBe(s);
  });
});

describe('take', () => {
  it('defender picks up all table cards; next attacker is the player after the defender', () => {
    const s = st({
      players: [P(0, [C('8', 'clubs')]), P(1, [C('6', 'clubs')])],
      table: [{ attack: C('7', 'hearts'), defense: null }], status: 'defense',
      attackerIndex: 0, defenderIndex: 1,
    });
    const next = durakReducer(s, { type: 'TAKE_CARDS' })!;
    expect(ids(next.players[1].hand)).toEqual(['6c', '7h']); // took the 7♥
    expect(next.table).toEqual([]);
    expect(next.status).toBe('attack');
    expect(next.attackerIndex).toBe(0); // 2-player: after the defender wraps back to seat 0
    expect(next.defenderIndex).toBe(1);
  });
});

describe('successful defense (END_ATTACK) + draw order', () => {
  it('discards the table, refills attacker-first then defender, and the defender becomes attacker', () => {
    const fill = (suit: Card['suit']) => [C('6', suit), C('7', suit), C('8', suit), C('9', suit), C('10', suit)];
    const s = st({
      players: [P(0, fill('hearts')), P(1, fill('diamonds'))], // 5 each
      drawPile: [C('A', 'clubs'), C('K', 'clubs')],            // front A drawn first
      table: [{ attack: C('Q', 'clubs'), defense: C('A', 'spades') }], // already beaten
      status: 'attack', attackerIndex: 0, defenderIndex: 1,
    });
    const next = durakReducer(s, { type: 'END_ATTACK' })!;
    expect(next.discardPile).toEqual([C('Q', 'clubs'), C('A', 'spades')]);
    expect(next.table).toEqual([]);
    // attacker (seat 0) draws first → gets the A♣; defender (seat 1) → K♣.
    expect(next.players[0].hand.map((c) => `${c.rank}${c.suit[0]}`)).toContain('Ac');
    expect(next.players[1].hand.map((c) => `${c.rank}${c.suit[0]}`)).toContain('Kc');
    expect(next.players.every((p) => p.hand.length === 6)).toBe(true);
    expect(next.attackerIndex).toBe(1); // defender became the attacker
    expect(next.defenderIndex).toBe(0);
    expect(next.status).toBe('attack');
  });
});

describe('finish', () => {
  it('ends with the last card-holder as the fool', () => {
    const s = st({
      players: [P(0, []), P(1, [C('A', 'spades')])], drawPile: [],
      table: [{ attack: C('6', 'clubs'), defense: C('7', 'clubs') }], status: 'attack',
      attackerIndex: 0, defenderIndex: 1,
    });
    const next = durakReducer(s, { type: 'END_ATTACK' })!;
    expect(next.status).toBe('finished');
    expect(next.foolId).toBe('player-1');
    expect(next.isDraw).toBe(false);
    expect(next.winnerIds).toEqual(['player-0']);
  });

  it('is a draw when the last players empty simultaneously', () => {
    const s = st({
      players: [P(0, []), P(1, [])], drawPile: [],
      table: [{ attack: C('6', 'clubs'), defense: C('7', 'clubs') }], status: 'attack',
    });
    const next = durakReducer(s, { type: 'END_ATTACK' })!;
    expect(next.status).toBe('finished');
    expect(next.foolId).toBeNull();
    expect(next.isDraw).toBe(true);
    expect(next.winnerIds.sort()).toEqual(['player-0', 'player-1']);
  });
});

describe('transfer variant', () => {
  const base = (over: Partial<DurakState>) => st({
    variant: 'transfer', status: 'defense',
    players: [P(0, []), P(1, [C('7', 'clubs')]), P(2, [C('9', 'clubs'), C('10', 'clubs')])],
    table: [{ attack: C('7', 'hearts'), defense: null }], attackerIndex: 0, defenderIndex: 1, ...over,
  });

  it('simple variant rejects TRANSFER_ATTACK (same reference)', () => {
    const s = base({ variant: 'simple' });
    expect(durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') })).toBe(s);
  });

  it('accepts a legal same-rank transfer and passes defense to the next player', () => {
    const s = base({});
    const next = durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') })!;
    expect(next.table.map((p) => p.attack.rank)).toEqual(['7', '7']);
    expect(next.attackerIndex).toBe(1); // the transferrer joins the attack
    expect(next.defenderIndex).toBe(2); // passed to the next player
    expect(next.status).toBe('defense');
    expect(next.players[1].hand).toHaveLength(0); // the 7♣ left the hand
  });

  it('rejects a transfer that exceeds the next defender capacity (same reference)', () => {
    const s = base({ players: [P(0, []), P(1, [C('7', 'clubs')]), P(2, [C('9', 'clubs')])] });
    expect(durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') })).toBe(s);
  });

  it('rejects a transfer after a card was beaten (same reference)', () => {
    const s = base({
      table: [{ attack: C('7', 'hearts'), defense: C('8', 'hearts') }, { attack: C('7', 'diamonds'), defense: null }],
    });
    expect(durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') })).toBe(s);
  });
});
