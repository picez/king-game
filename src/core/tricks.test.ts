import { describe, it, expect } from 'vitest';
import { wonTrickGroups, playsInOrder } from './tricks';
import type { Card, Round, Suit, Trick } from '../models/types';

function card(rank: string, suit: Suit, value = 0): Card {
  return { rank: rank as Card['rank'], suit, value };
}

function trick(trickNumber: number, leadPlayerId: string, winnerId: string, plays: Array<[string, Card, number]>): Trick {
  return {
    trickNumber,
    leadPlayerId,
    ledSuit: plays[0][1].suit,
    winnerId,
    plays: plays.map(([playerId, c, playOrder]) => ({ playerId, card: c, playOrder })),
  };
}

function roundWith(tricks: Trick[]): Round {
  return {
    roundNumber: 1,
    mode: { id: 'no_tricks', name: 'No Tricks', type: 'negative', trumpSuit: null },
    dealerId: 'player-0',
    kitty: [],
    discard: [],
    tricks,
    collectedCards: {},
    scores: {},
    status: 'playing',
  };
}

describe('wonTrickGroups (My tricks, grouped by trick, owner-only)', () => {
  // player-1 leads trick 1 (won by player-0); player-0 leads trick 2 (won by
  // player-1); player-2 leads trick 3 (won by player-0). Plays are stored out
  // of order to prove sorting.
  const round = roundWith([
    trick(1, 'player-1', 'player-0', [['player-0', card('A', 'spades'), 2], ['player-1', card('7', 'spades'), 0], ['player-2', card('9', 'spades'), 1]]),
    trick(2, 'player-0', 'player-1', [['player-0', card('K', 'hearts'), 0], ['player-1', card('A', 'hearts'), 1], ['player-2', card('2', 'hearts'), 2]]),
    trick(3, 'player-2', 'player-0', [['player-2', card('Q', 'clubs'), 0], ['player-0', card('A', 'clubs'), 2], ['player-1', card('5', 'clubs'), 1]]),
  ]);

  it('returns only the tricks the player won', () => {
    const mine = wonTrickGroups(round, 'player-0');
    expect(mine.map((t) => t.trickNumber)).toEqual([1, 3]);

    const other = wonTrickGroups(round, 'player-1');
    expect(other.map((t) => t.trickNumber)).toEqual([2]);
  });

  it('never includes another player\'s won tricks (owner-only)', () => {
    const mine = wonTrickGroups(round, 'player-0');
    expect(mine.every((t) => t.winnerId === 'player-0')).toBe(true);
  });

  it('orders each trick\'s cards by play order (lead first)', () => {
    const [firstTrick] = wonTrickGroups(round, 'player-0');
    expect(firstTrick.plays.map((p) => p.playOrder)).toEqual([0, 1, 2]);
    expect(firstTrick.plays[0].playerId).toBe('player-1'); // the leader played first
  });

  it('groups are ordered by trick number', () => {
    const mine = wonTrickGroups(round, 'player-0');
    expect(mine[0].trickNumber).toBeLessThan(mine[1].trickNumber);
  });

  it('a player who won nothing gets an empty list', () => {
    expect(wonTrickGroups(round, 'player-2')).toEqual([]);
  });

  it('playsInOrder does not mutate the original trick', () => {
    const t = round.tricks[0];
    const before = t.plays.map((p) => p.playOrder);
    playsInOrder(t);
    expect(t.plays.map((p) => p.playOrder)).toEqual(before);
  });
});
