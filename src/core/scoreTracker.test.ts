import { describe, it, expect } from 'vitest';
import { buildScoreTracker, columnForRecord, TRACKER_COLUMNS } from './scoreTracker';
import type { GameState, RoundRecord } from '../models/types';

function stateWith(playerIds: string[], history: RoundRecord[]): GameState {
  const players = playerIds.map((id, i) => ({ id, name: id.toUpperCase(), seatIndex: i, hand: [], isDealer: false, type: 'human' }));
  return { players, roundHistory: history } as unknown as GameState;
}
function rec(roundNumber: number, dealerId: string, modeId: RoundRecord['modeId'], trumpOccurrence: number, scoreByPlayer: Record<string, number>): RoundRecord {
  return { roundNumber, dealerId, modeId, trumpOccurrence, scoreByPlayer };
}
const cell = (row: { cells: { column: string; score: number | null }[] }, col: string) =>
  row.cells.find((c) => c.column === col)!;

describe('columnForRecord', () => {
  it('maps negative modes to their own column', () => {
    expect(columnForRecord({ modeId: 'no_hearts', trumpOccurrence: 0 })).toBe('no_hearts');
    expect(columnForRecord({ modeId: 'king_of_hearts', trumpOccurrence: 0 })).toBe('king_of_hearts');
  });
  it('maps trump occurrences to trump1/2/3', () => {
    expect(columnForRecord({ modeId: 'trump', trumpOccurrence: 1 })).toBe('trump1');
    expect(columnForRecord({ modeId: 'trump', trumpOccurrence: 2 })).toBe('trump2');
    expect(columnForRecord({ modeId: 'trump', trumpOccurrence: 3 })).toBe('trump3');
  });
});

describe('buildScoreTracker', () => {
  it('has 9 game columns plus the order Jacks-before-Queens, Trump 1/2/3 last', () => {
    expect(TRACKER_COLUMNS.map((c) => c.id)).toEqual([
      'no_tricks', 'no_hearts', 'no_jacks', 'no_queens', 'king_of_hearts',
      'last_two_tricks', 'trump1', 'trump2', 'trump3',
    ]);
  });

  it('a score lands in the correct mode column for its dealer', () => {
    const m = buildScoreTracker(stateWith(['p0', 'p1', 'p2'], [
      rec(0, 'p0', 'no_queens', 0, { p0: -20, p1: 0, p2: 0 }),
    ]));
    const p0 = m.rows.find((r) => r.playerId === 'p0')!;
    expect(cell(p0, 'no_queens').score).toBe(-20);
    expect(cell(p0, 'no_tricks').score).toBeNull(); // not played → empty
    // p1 never dealt → whole row empty
    const p1 = m.rows.find((r) => r.playerId === 'p1')!;
    expect(p1.cells.every((c) => c.score === null)).toBe(true);
  });

  it('three Trump games fill Trump 1 / 2 / 3 in play order', () => {
    const m = buildScoreTracker(stateWith(['p0', 'p1', 'p2'], [
      rec(0, 'p0', 'trump', 1, { p0: 24, p1: 0, p2: 8 }),
      rec(3, 'p0', 'trump', 2, { p0: 16, p1: 8, p2: 0 }),
      rec(6, 'p0', 'trump', 3, { p0: 0, p1: 16, p2: 8 }),
    ]));
    const p0 = m.rows.find((r) => r.playerId === 'p0')!;
    expect(cell(p0, 'trump1').score).toBe(24);
    expect(cell(p0, 'trump2').score).toBe(16);
    expect(cell(p0, 'trump3').score).toBe(0);
  });

  it('Total is the overall standing (sum across ALL rounds, including others-dealt)', () => {
    const m = buildScoreTracker(stateWith(['p0', 'p1', 'p2'], [
      rec(0, 'p0', 'no_tricks', 0, { p0: -8, p1: -4, p2: 0 }),
      rec(1, 'p1', 'trump', 1, { p0: 8, p1: 16, p2: 0 }),
    ]));
    const p0 = m.rows.find((r) => r.playerId === 'p0')!;
    const p1 = m.rows.find((r) => r.playerId === 'p1')!;
    expect(p0.total).toBe(0);   // -8 + 8
    expect(p1.total).toBe(12);  // -4 + 16
    // p0 did not deal trump → its trump1 cell stays empty even though it scored that round
    expect(cell(p0, 'trump1').score).toBeNull();
    expect(cell(p1, 'trump1').score).toBe(16);
    expect(cell(p0, 'no_tricks').score).toBe(-8);
  });

  it('records the last round number for highlighting', () => {
    const m = buildScoreTracker(stateWith(['p0', 'p1'], [
      rec(0, 'p0', 'no_tricks', 0, { p0: -8, p1: 0 }),
      rec(5, 'p1', 'no_hearts', 0, { p0: -5, p1: -10 }),
    ]));
    expect(m.lastRoundNumber).toBe(5);
    const p1 = m.rows.find((r) => r.playerId === 'p1')!;
    expect(cell(p1, 'no_hearts').roundNumber).toBe(5);
  });

  it('an empty history yields all-empty rows and zero totals', () => {
    const m = buildScoreTracker(stateWith(['p0', 'p1', 'p2'], []));
    expect(m.lastRoundNumber).toBeNull();
    for (const row of m.rows) {
      expect(row.total).toBe(0);
      expect(row.cells.every((c) => c.score === null)).toBe(true);
    }
  });

  it('works for a 4-player table', () => {
    const m = buildScoreTracker(stateWith(['p0', 'p1', 'p2', 'p3'], [
      rec(0, 'p3', 'last_two_tricks', 0, { p0: 0, p1: -20, p2: 0, p3: -40 }),
    ]));
    expect(m.rows).toHaveLength(4);
    const p3 = m.rows.find((r) => r.playerId === 'p3')!;
    expect(cell(p3, 'last_two_tricks').score).toBe(-40);
  });
});
