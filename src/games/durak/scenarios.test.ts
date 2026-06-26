import { describe, it, expect } from 'vitest';
import { cardValue } from './deck';
import { durakReducer } from './engine';
import type { Card } from '../../models/types';
import type { DurakPlayer, DurakState } from './types';

// Reducer scenarios mirroring the exact action sequences the local UI dispatches
// (DurakGameScreen). These guard the UI-critical flows end to end.

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit, value: cardValue(rank) });
const P = (seat: number, hand: Card[]): DurakPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human', hand });
const ids = (cs: Card[]) => cs.map((c) => `${c.rank}${c.suit[0]}`).sort();

function st(over: Partial<DurakState>): DurakState {
  return {
    gameType: 'durak', variant: 'simple', players: [P(0, []), P(1, [])],
    drawPile: [], trumpSuit: 'spades', trumpCard: C('6', 'spades'),
    attackerIndex: 0, defenderIndex: 1, table: [], discardPile: [],
    status: 'attack', boutLimit: 6, foolId: null, winnerIds: [], isDraw: false, ...over,
  };
}

describe('UI flow — attack → defend → pass (successful defense)', () => {
  it('discards the bout and swaps roles', () => {
    let s = st({
      players: [P(0, [C('7', 'hearts'), C('Q', 'clubs')]), P(1, [C('9', 'hearts'), C('J', 'clubs')])],
      attackerIndex: 0, defenderIndex: 1, status: 'attack',
    });
    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('7', 'hearts') })!;
    expect(s.status).toBe('defense');
    s = durakReducer(s, { type: 'DEFEND_CARD', attack: C('7', 'hearts'), card: C('9', 'hearts') })!;
    expect(s.status).toBe('attack');          // all beaten → attacker may add or pass
    s = durakReducer(s, { type: 'END_ATTACK' })!;
    expect(ids(s.discardPile)).toEqual(['7h', '9h']);
    expect(s.table).toEqual([]);
    expect(s.attackerIndex).toBe(1);          // defender became the attacker
    expect(s.defenderIndex).toBe(0);
    expect(s.status).toBe('attack');
  });
});

describe('UI flow — attack → take', () => {
  it('the defender picks up the cards; the same attacker leads again (2p)', () => {
    let s = st({
      players: [P(0, [C('7', 'hearts'), C('A', 'spades')]), P(1, [C('6', 'clubs')])],
      attackerIndex: 0, defenderIndex: 1, status: 'attack',
    });
    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('7', 'hearts') })!;
    s = durakReducer(s, { type: 'TAKE_CARDS' })!;
    expect(ids(s.players[1].hand)).toEqual(['6c', '7h']);
    expect(s.attackerIndex).toBe(0);          // attacker keeps attacking after a take
    expect(s.defenderIndex).toBe(1);
    expect(s.status).toBe('attack');
  });
});

describe('UI flow — transfer (transfer variant)', () => {
  it('the defender passes the attack to the next player with a same-rank card', () => {
    let s = st({
      variant: 'transfer', status: 'defense',
      players: [P(0, [C('7', 'clubs'), C('A', 'spades')]), P(1, [C('9', 'diamonds'), C('10', 'diamonds')]), P(2, [C('K', 'clubs')])],
      table: [{ attack: C('7', 'hearts'), defense: null }],
      attackerIndex: 2, defenderIndex: 0,     // player-0 (human) is defending
    });
    s = durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') })!;
    expect(s.table.map((p) => p.attack.rank)).toEqual(['7', '7']);
    expect(s.attackerIndex).toBe(0);          // transferrer joins the attack
    expect(s.defenderIndex).toBe(1);          // passed to the next player
    expect(s.status).toBe('defense');
    expect(s.players[0].hand.some((c) => c.rank === '7' && c.suit === 'clubs')).toBe(false);
  });
});
