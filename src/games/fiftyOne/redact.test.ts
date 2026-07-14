import { describe, expect, it } from 'vitest';
import { fiftyOneRedactStateFor } from './redact';
import type { Rank, Suit } from '../../models/types';
import type { FiftyOneCard, FiftyOneState } from './types';

const c = (rank: Rank, suit: Suit, d = 0): FiftyOneCard => ({ id: `${d}-${suit}-${rank}`, joker: false, suit, rank });
const J = (n: number): FiftyOneCard => ({ id: `joker-${n}`, joker: true, suit: null, rank: null });

function sample(): FiftyOneState {
  const meld = {
    id: 'm-1-0-0', ownerSeat: 0, type: 'run' as const,
    cards: [c('7', 'spades'), J(0), c('9', 'spades')],
    jokerRepresents: { 1: { suit: 'spades' as Suit, rank: '8' as Rank } }, value: 24,
  };
  return {
    gameType: 'fifty-one', phase: 'playing', playerCount: 3,
    players: [0, 1, 2].map((i) => ({ id: `player-${i}`, name: `P${i}`, seatIndex: i, type: 'ai' as const })),
    dealerSeat: 0, starterSeat: 1, currentSeat: 1, turnStep: 'draw',
    handsBySeat: [
      [c('A', 'hearts'), c('K', 'diamonds')],
      [c('2', 'clubs'), c('3', 'clubs'), c('4', 'clubs')],
      [c('5', 'hearts')],
    ],
    drawPile: [c('Q', 'hearts'), c('J', 'diamonds'), c('10', 'spades')],
    discardPile: [c('6', 'clubs'), c('7', 'hearts')],
    openedBySeat: [true, false, false], publicMelds: [meld],
    scoresBySeat: [0, 30, 12], eliminatedSeats: [false, false, false],
    roundNumber: 1, roundWinnerSeat: null, winnerSeat: null, lastRound: null,
    options: { targetPenalty: 510 },
  };
}

const realIds = (cards: FiftyOneCard[]) => cards.filter((x) => x.id !== 'hidden' && !x.joker);

describe('51 redaction (§14)', () => {
  it('shows the viewer their own hand and hides every other hand (count kept)', () => {
    const r = fiftyOneRedactStateFor(sample(), 1);
    expect(r.handsBySeat[1].map((x) => x.id)).toEqual(['0-clubs-2', '0-clubs-3', '0-clubs-4']);
    // Other hands: same length, but no suit/rank leaks.
    expect(r.handsBySeat[0]).toHaveLength(2);
    expect(r.handsBySeat[2]).toHaveLength(1);
    expect(realIds(r.handsBySeat[0])).toHaveLength(0);
    expect(r.handsBySeat[0].every((x) => x.suit === null && x.rank === null)).toBe(true);
  });

  it('hides the draw pile order/contents but keeps the count', () => {
    const r = fiftyOneRedactStateFor(sample(), 1);
    expect(r.drawPile).toHaveLength(3);
    expect(realIds(r.drawPile)).toHaveLength(0);
    expect(r.drawPile.every((x) => x.suit === null && x.rank === null)).toBe(true);
  });

  it('keeps the discard pile and public melds (incl. joker representation) public', () => {
    const r = fiftyOneRedactStateFor(sample(), 1);
    expect(r.discardPile.map((x) => x.id)).toEqual(['0-clubs-6', '0-hearts-7']);
    expect(r.publicMelds[0].cards.map((x) => x.id)).toEqual(['0-spades-7', 'joker-0', '0-spades-9']);
    expect(r.publicMelds[0].jokerRepresents[1]).toEqual({ suit: 'spades', rank: '8' });
  });

  it('keeps scores, eliminations, turn and step public', () => {
    const r = fiftyOneRedactStateFor(sample(), 1);
    expect(r.scoresBySeat).toEqual([0, 30, 12]);
    expect(r.currentSeat).toBe(1);
    expect(r.turnStep).toBe('draw');
    expect(r.openedBySeat).toEqual([true, false, false]);
  });

  it('hides every hand from a spectator (null viewer)', () => {
    const r = fiftyOneRedactStateFor(sample(), null);
    for (const hand of r.handsBySeat) expect(realIds(hand)).toHaveLength(0);
  });

  it('never leaks a private card id to the wrong viewer', () => {
    const state = sample();
    const r = fiftyOneRedactStateFor(state, 0);
    // Seats 1 & 2 must not expose any of their real card ids to viewer 0.
    const leaked = [...r.handsBySeat[1], ...r.handsBySeat[2]].filter((x) => x.id !== 'hidden');
    expect(leaked).toHaveLength(0);
  });
});
