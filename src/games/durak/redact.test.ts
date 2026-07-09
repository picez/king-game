import { describe, it, expect } from 'vitest';
import { cardValue } from './deck';
import { durakRedactStateFor } from './redact';
import type { Card } from '../../models/types';
import type { DurakPlayer, DurakState } from './types';

const C = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit, value: cardValue(rank) });
const P = (seat: number, hand: Card[]): DurakPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: 'human', hand });

const base: DurakState = {
  gameType: 'durak', variant: 'simple',
  players: [P(0, [C('7', 'hearts'), C('K', 'spades')]), P(1, [C('9', 'hearts'), C('6', 'clubs')])],
  drawPile: [C('A', 'spades'), C('Q', 'diamonds')],
  trumpSuit: 'spades', trumpCard: C('6', 'spades'),
  attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0, passedAttackers: [],
  table: [{ attack: C('8', 'clubs'), defense: C('10', 'clubs') }],
  discardPile: [C('J', 'diamonds')],
  status: 'defense', boutLimit: 6, trumpShowUsed: false, lastTrumpShow: null,
  foolId: null, winnerIds: [], isDraw: false,
};

describe('durakRedactStateFor', () => {
  it('shows the viewer their own hand and hides every opponent hand', () => {
    const v = durakRedactStateFor(base, 0);
    expect(v.players[0].hand).toEqual(base.players[0].hand);     // own hand real
    expect(v.players[1].hand).toHaveLength(2);                   // count preserved
    expect(v.players[1].hand.every((c) => c.rank === '?')).toBe(true); // hidden
    expect(JSON.stringify(v.players[1].hand)).not.toContain('9'); // no rank leak
  });

  it('hides the draw pile and discard, keeping their counts', () => {
    const v = durakRedactStateFor(base, 0);
    expect(v.drawPile).toHaveLength(2);
    expect(v.drawPile.every((c) => c.rank === '?')).toBe(true);
    expect(v.discardPile.every((c) => c.rank === '?')).toBe(true);
  });

  it('keeps the table, trump and roles public', () => {
    const v = durakRedactStateFor(base, 0);
    expect(v.table).toEqual(base.table);                        // attack/defense visible
    expect(v.trumpSuit).toBe('spades');
    expect(v.trumpCard).toEqual(base.trumpCard);
    expect(v.attackerIndex).toBe(0);
    expect(v.defenderIndex).toBe(1);
    expect(v.status).toBe('defense');
  });

  it('hides ALL hands for a spectator (viewerSeat null)', () => {
    const v = durakRedactStateFor(base, null);
    expect(v.players.every((p) => p.hand.every((c) => c.rank === '?'))).toBe(true);
  });

  it('does not mutate the source state', () => {
    const snapshot = JSON.stringify(base);
    durakRedactStateFor(base, 0);
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});
