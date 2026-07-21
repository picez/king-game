import { describe, it, expect } from 'vitest';
import {
  isFinishedDurakGame, summarizeFinishedDurakGame, computeDurakStatDeltas, durakFinishSignature,
} from './durakStats';
import type { DurakPlayer, DurakState } from '../games/durak/types';

const P = (seat: number): DurakPlayer => ({ id: `player-${seat}`, name: `P${seat}`, seatIndex: seat, type: seat === 2 ? 'ai' : 'human', hand: [] });

function finished(over: Partial<DurakState>): DurakState {
  return {
    gameType: 'durak', variant: 'simple', players: [P(0), P(1), P(2)],
    drawPile: [], trumpSuit: 'spades', trumpCard: { rank: '6', suit: 'spades', value: 6 },
    attackerIndex: 0, defenderIndex: 1, throwerIndex: 0, lastThrowerIndex: 0, passedAttackers: [],
    table: [], discardPile: [], status: 'finished', boutLimit: 6,
    foolId: 'player-1', winnerIds: ['player-0', 'player-2'], isDraw: false, ...over,
  };
}

describe('isFinishedDurakGame', () => {
  it('is true only when finished', () => {
    expect(isFinishedDurakGame(finished({}))).toBe(true);
    expect(isFinishedDurakGame(finished({ status: 'attack' }))).toBe(false);
    expect(isFinishedDurakGame(null)).toBe(false);
  });
});

describe('summarizeFinishedDurakGame', () => {
  it('marks the fool as loser and everyone else as winner', () => {
    const s = summarizeFinishedDurakGame(finished({}));
    expect(s.playerCount).toBe(3);
    expect(s.foolId).toBe('player-1');
    expect(s.isDraw).toBe(false);
    const byId = Object.fromEntries(s.players.map((p) => [p.playerId, p]));
    expect(byId['player-1'].isFool).toBe(true);
    expect(byId['player-1'].isWinner).toBe(false);
    expect(byId['player-0'].isWinner).toBe(true);
    expect(byId['player-2'].isWinner).toBe(true);
    expect(byId['player-2'].type).toBe('ai');
    expect(s.winners.sort()).toEqual(['player-0', 'player-2']);
  });

  it('a draw has no fool and everyone wins', () => {
    const s = summarizeFinishedDurakGame(finished({ isDraw: true, foolId: null, winnerIds: ['player-0', 'player-1', 'player-2'] }));
    expect(s.isDraw).toBe(true);
    expect(s.foolId).toBeNull();
    expect(s.players.every((p) => p.isWinner && !p.isFool)).toBe(true);
  });
});

describe('computeDurakStatDeltas', () => {
  it('flags won / isFool / isDraw per player', () => {
    const deltas = computeDurakStatDeltas(summarizeFinishedDurakGame(finished({})));
    const byId = Object.fromEntries(deltas.map((d) => [d.playerId, d]));
    expect(byId['player-1']).toMatchObject({ won: false, isFool: true, isDraw: false });
    expect(byId['player-0']).toMatchObject({ won: true, isFool: false, isDraw: false });
  });

  it('a draw counts as won for all, fool for none', () => {
    const deltas = computeDurakStatDeltas(summarizeFinishedDurakGame(
      finished({ isDraw: true, foolId: null, winnerIds: ['player-0', 'player-1', 'player-2'] })));
    expect(deltas.every((d) => d.won && !d.isFool && d.isDraw)).toBe(true);
  });
});

describe('Stage 37.3 — all-sixes finishing attack (win/lose by sixes)', () => {
  const six = (suit: 'spades' | 'hearts' | 'diamonds' | 'clubs') => ({ rank: '6' as const, suit, value: 6 });
  const seven = { rank: '7' as const, suit: 'hearts' as const, value: 7 };
  // Default finished(): foolId='player-1', defenderIndex=1 (the taker), attackerIndex=0.
  const sixBout = [
    { attack: six('spades'), beat: null },
    { attack: six('hearts'), beat: null },
  ];

  it('credits the attacker (win) and the fool (lose) when every last-bout attack is a six', () => {
    const sum = summarizeFinishedDurakGame(finished({ lastBout: sixBout }));
    expect(sum.sixAttack).toEqual({ winnerId: 'player-0', loserId: 'player-1' });
    const byId = Object.fromEntries(computeDurakStatDeltas(sum).map((d) => [d.playerId, d]));
    expect(byId['player-0']).toMatchObject({ wonBySixes: true, lostBySixes: false });
    expect(byId['player-1']).toMatchObject({ wonBySixes: false, lostBySixes: true });
    expect(byId['player-2']).toMatchObject({ wonBySixes: false, lostBySixes: false });
  });

  it('does NOT fire when any attack card is not a six', () => {
    const sum = summarizeFinishedDurakGame(finished({ lastBout: [{ attack: six('spades'), beat: null }, { attack: seven, beat: null }] }));
    expect(sum.sixAttack).toBeNull();
    expect(computeDurakStatDeltas(sum).every((d) => !d.wonBySixes && !d.lostBySixes)).toBe(true);
  });

  it('does NOT fire when the fool did not take the finishing bout (fool ≠ defender)', () => {
    // Successful-defense finish: the last bout was taken by seat 2, but the fool is seat 1.
    const sum = summarizeFinishedDurakGame(finished({ lastBout: sixBout, defenderIndex: 2 }));
    expect(sum.sixAttack).toBeNull();
  });

  it('does NOT fire on a draw or with no last bout', () => {
    expect(summarizeFinishedDurakGame(finished({ isDraw: true, foolId: null, lastBout: sixBout })).sixAttack).toBeNull();
    expect(summarizeFinishedDurakGame(finished({})).sixAttack).toBeNull(); // lastBout undefined
  });
});

describe('durakFinishSignature', () => {
  it('is stable for the same outcome and differs for a different fool', () => {
    const a = durakFinishSignature(finished({}));
    expect(a).toBe(durakFinishSignature(finished({})));
    const b = durakFinishSignature(finished({ foolId: 'player-0', winnerIds: ['player-1', 'player-2'] }));
    expect(b).not.toBe(a);
  });

  it('a draw has its own signature', () => {
    const draw = durakFinishSignature(finished({ isDraw: true, foolId: null, winnerIds: ['player-0', 'player-1', 'player-2'] }));
    expect(draw).toContain('draw');
  });
});
