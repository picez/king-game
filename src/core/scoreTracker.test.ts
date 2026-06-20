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
const row = (m: ReturnType<typeof buildScoreTracker>, playerId: string) =>
  m.rows.find((r) => r.playerId === playerId)!;
const cell = (m: ReturnType<typeof buildScoreTracker>, playerId: string, col: string) =>
  row(m, playerId).cells.find((c) => c.column === col)!;

describe('columnForRecord', () => {
  it('maps modes and trump occurrences', () => {
    expect(columnForRecord({ modeId: 'no_hearts', trumpOccurrence: 0 })).toBe('no_hearts');
    expect(columnForRecord({ modeId: 'trump', trumpOccurrence: 3 })).toBe('trump3');
  });
});

describe('buildScoreTracker — single table', () => {
  it('column order: Jacks before Queens; Trump 1/2/3 last', () => {
    expect(TRACKER_COLUMNS.map((c) => c.id)).toEqual([
      'no_tricks', 'no_hearts', 'no_jacks', 'no_queens', 'king_of_hearts',
      'last_two_tricks', 'trump1', 'trump2', 'trump3',
    ]);
  });

  it('legend assigns stable markers ①②③ by seat', () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], []));
    expect(m.legend.map((l) => l.marker)).toEqual(['①', '②', '③']);
    expect(m.legend.map((l) => l.playerId)).toEqual(['alice', 'bob', 'carol']);
  });

  it("a Trump round records ALL players' scores in one table, tagged with the dealer's marker", () => {
    // Bob (marker ②) deals Trump #2: Alice +32, Bob +48, Carol +16.
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'bob', 'trump', 2, { alice: 32, bob: 48, carol: 16 }),
    ]));
    expect(cell(m, 'alice', 'trump2').entries).toEqual([
      expect.objectContaining({ dealerMarker: '②', score: 32 }),
    ]);
    expect(cell(m, 'bob', 'trump2').entries[0]).toMatchObject({ dealerMarker: '②', score: 48 });
    expect(cell(m, 'carol', 'trump2').entries[0]).toMatchObject({ dealerMarker: '②', score: 16 });
  });

  it('the played dot is only on the row of the player who dealt that game', () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'bob', 'trump', 2, { alice: 32, bob: 48, carol: 16 }),
    ]));
    expect(cell(m, 'bob', 'trump2').playedByRow).toBe(true);     // Bob dealt it
    expect(cell(m, 'alice', 'trump2').playedByRow).toBe(false);
    expect(cell(m, 'carol', 'trump2').playedByRow).toBe(false);
    // and Bob has no dot on trump1 (didn't deal that yet)
    expect(cell(m, 'bob', 'trump1').playedByRow).toBe(false);
  });

  it('several dealers of the same mode stack as multiple marker-tagged entries', () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'alice', 'no_hearts', 0, { alice: -5, bob: -25, carol: 0 }),
      rec(1, 'bob', 'no_hearts', 0, { alice: -10, bob: 0, carol: -20 }),
    ]));
    // Carol's No Hearts cell shows her score in BOTH dealers' rounds.
    const c = cell(m, 'carol', 'no_hearts');
    expect(c.entries).toHaveLength(2);
    expect(c.entries.map((e) => e.dealerMarker)).toEqual(['①', '②']); // alice, bob
    expect(c.entries.map((e) => e.score)).toEqual([0, -20]);
  });

  it('three Trump rounds by a dealer fill Trump 1/2/3', () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'bob', 'trump', 1, { alice: 8, bob: 24, carol: 32 }),
      rec(3, 'bob', 'trump', 2, { alice: 32, bob: 16, carol: 16 }),
      rec(6, 'bob', 'trump', 3, { alice: 16, bob: 40, carol: 8 }),
    ]));
    expect(cell(m, 'bob', 'trump1').entries[0].score).toBe(24);
    expect(cell(m, 'bob', 'trump2').entries[0].score).toBe(16);
    expect(cell(m, 'bob', 'trump3').entries[0].score).toBe(40);
    expect(cell(m, 'bob', 'trump1').playedByRow).toBe(true);
    expect(cell(m, 'bob', 'trump3').playedByRow).toBe(true);
  });

  it('totals equal the sum across all rounds for each player', () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'bob', 'trump', 2, { alice: 32, bob: 48, carol: 16 }),
      rec(1, 'alice', 'no_hearts', 0, { alice: -5, bob: -25, carol: 0 }),
    ]));
    expect(row(m, 'alice').total).toBe(27);
    expect(row(m, 'bob').total).toBe(23);
    expect(row(m, 'carol').total).toBe(16);
  });

  it('unplayed cells are empty; isLast flags the most recent round', () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob'], [
      rec(5, 'bob', 'no_hearts', 0, { alice: -5, bob: -10 }),
    ]));
    expect(cell(m, 'alice', 'no_tricks').entries).toHaveLength(0);
    expect(cell(m, 'alice', 'no_hearts').isLast).toBe(true);
    expect(m.lastRoundNumber).toBe(5);
  });

  it('works for a 4-player table', () => {
    const m = buildScoreTracker(stateWith(['p0', 'p1', 'p2', 'p3'], [
      rec(0, 'p3', 'last_two_tricks', 0, { p0: 0, p1: -26, p2: 0, p3: -52 }),
    ]));
    expect(m.legend).toHaveLength(4);
    expect(cell(m, 'p1', 'last_two_tricks').entries[0]).toMatchObject({ dealerMarker: '④', score: -26 });
    expect(cell(m, 'p3', 'last_two_tricks').playedByRow).toBe(true);
  });
});
