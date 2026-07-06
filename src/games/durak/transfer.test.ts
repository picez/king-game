import { describe, it, expect } from 'vitest';
import { makeRng } from '../../core/rng';
import { cardValue } from './deck';
import { durakReducer } from './engine';
import { durakBotAction } from './ai';
import type { Card } from '../../models/types';
import type { DurakPlayer, DurakState, DurakVariant } from './types';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit, value: cardValue(rank) });
const P = (seat: number, hand: Card[]): DurakPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human', hand });

function st(over: Partial<DurakState>): DurakState {
  const s: DurakState = {
    gameType: 'durak', variant: 'transfer', players: [P(0, []), P(1, [])],
    drawPile: [], trumpSuit: 'spades', trumpCard: C('6', 'spades'),
    attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0, passedAttackers: [],
    table: [], discardPile: [],
    status: 'attack', boutLimit: 6, foolId: null, winnerIds: [], isDraw: false, ...over,
  };
  if (over.throwerIndex === undefined) s.throwerIndex = s.attackerIndex;
  if (over.lastThrowerIndex === undefined) s.lastThrowerIndex = s.throwerIndex;
  return s;
}

describe('transfer chaining around the table (engine)', () => {
  it('a same-rank transfer hops the bout forward twice (P1→P2→P3)', () => {
    // Trump is spades; all sevens below are non-trump so each may be transferred.
    let s = st({
      players: [
        P(0, [C('7', 'hearts'), C('9', 'clubs')]),
        P(1, [C('7', 'clubs'), C('8', 'hearts')]),
        P(2, [C('7', 'diamonds'), C('8', 'clubs'), C('9', 'diamonds')]),
        P(3, [C('8', 'diamonds'), C('9', 'hearts'), C('10', 'diamonds'), C('J', 'clubs')]),
      ],
      attackerIndex: 0, defenderIndex: 1, status: 'attack',
    });

    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('7', 'hearts') })!;
    expect(s.status).toBe('defense');
    expect(s.defenderIndex).toBe(1);

    // P1 transfers with 7♣ → P1 becomes attacker, P2 the new defender.
    s = durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') })!;
    expect(s.status).toBe('defense');
    expect(s.attackerIndex).toBe(1);
    expect(s.defenderIndex).toBe(2);
    expect(s.table).toHaveLength(2);

    // P2 transfers again with 7♦ → P2 attacker, P3 defender, three cards on the table.
    s = durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'diamonds') })!;
    expect(s.status).toBe('defense');
    expect(s.attackerIndex).toBe(2);
    expect(s.defenderIndex).toBe(3);
    expect(s.table).toHaveLength(3);
    // Every card on the table is still an unbeaten same-rank seven.
    expect(s.table.every((p) => p.defense === null && p.attack.rank === '7')).toBe(true);
  });

  it('rejects a transfer once a card has been beaten (no-op)', () => {
    let s = st({
      players: [P(0, [C('7', 'hearts')]), P(1, [C('9', 'hearts'), C('7', 'clubs')]), P(2, [C('8', 'clubs'), C('9', 'clubs')])],
      attackerIndex: 0, defenderIndex: 1, status: 'attack',
    });
    s = durakReducer(s, { type: 'ATTACK_CARD', card: C('7', 'hearts') })!;
    s = durakReducer(s, { type: 'DEFEND_CARD', attack: C('7', 'hearts'), card: C('9', 'hearts') })!;
    // A card is beaten now → transfer is illegal even though P1 holds another 7.
    const before = s;
    const after = durakReducer(s, { type: 'TRANSFER_ATTACK', card: C('7', 'clubs') });
    expect(after).toBe(before); // reducer no-op
  });
});

describe('the bot actually uses TRANSFER_ATTACK', () => {
  function countBotTransfers(numPlayers: number, variant: DurakVariant, seed: number): number {
    const names = Array.from({ length: numPlayers }, (_, i) => `Bot${i}`);
    let s = durakReducer(null, { type: 'START_DURAK', playerNames: names, variant }, { rng: makeRng(seed) })!;
    let transfers = 0;
    for (let step = 0; step < 5000 && s.status !== 'finished'; step++) {
      const action = durakBotAction(s);
      if (!action) break;
      if (action.type === 'TRANSFER_ATTACK') transfers++;
      const next = durakReducer(s, action);
      if (next === null || next === s) throw new Error(`illegal bot action: ${JSON.stringify(action)}`);
      s = next;
    }
    return transfers;
  }

  it('emits at least one transfer across a spread of transfer-variant games', () => {
    let total = 0;
    for (const seed of [1, 7, 42, 100, 2026, 31337]) {
      for (const n of [3, 4]) total += countBotTransfers(n, 'transfer', seed);
    }
    expect(total).toBeGreaterThan(0);
  });

  it('never transfers in the simple variant', () => {
    let total = 0;
    for (const seed of [1, 7, 42]) total += countBotTransfers(3, 'simple', seed);
    expect(total).toBe(0);
  });
});
