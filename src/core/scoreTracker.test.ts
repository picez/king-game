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
const sectionFor = (m: ReturnType<typeof buildScoreTracker>, dealerId: string) =>
  m.sections.find((s) => s.dealerId === dealerId)!;
const cell = (m: ReturnType<typeof buildScoreTracker>, dealerId: string, playerId: string, col: string) =>
  sectionFor(m, dealerId).rows.find((r) => r.playerId === playerId)!.cells.find((c) => c.column === col)!;

describe('columnForRecord', () => {
  it('maps modes and trump occurrences', () => {
    expect(columnForRecord({ modeId: 'no_hearts', trumpOccurrence: 0 })).toBe('no_hearts');
    expect(columnForRecord({ modeId: 'trump', trumpOccurrence: 2 })).toBe('trump2');
  });
});

describe('buildScoreTracker — all players recorded per round (the fix)', () => {
  it('column order: Jacks before Queens; Trump 1/2/3 last', () => {
    expect(TRACKER_COLUMNS.map((c) => c.id)).toEqual([
      'no_tricks', 'no_hearts', 'no_jacks', 'no_queens', 'king_of_hearts',
      'last_two_tricks', 'trump1', 'trump2', 'trump3',
    ]);
  });

  it("Trump round: ALL players' scores land in that Trump slot (not just the dealer)", () => {
    // Bob deals Trump #2; Alice +32, Bob +48, Carol +16.
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'bob', 'trump', 2, { alice: 32, bob: 48, carol: 16 }),
    ]));
    expect(cell(m, 'bob', 'alice', 'trump2').score).toBe(32);
    expect(cell(m, 'bob', 'bob', 'trump2').score).toBe(48);
    expect(cell(m, 'bob', 'carol', 'trump2').score).toBe(16);
    // not the dealer-only bug: every player's row in Bob's section is filled.
    expect(sectionFor(m, 'bob').rows.every((r) => r.cells.find((c) => c.column === 'trump2')!.score !== null)).toBe(true);
    // other Trump columns remain empty
    expect(cell(m, 'bob', 'alice', 'trump1').score).toBeNull();
  });

  it("negative round: all players' scores land in the chosen mode slot", () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'alice', 'no_hearts', 0, { alice: -5, bob: -25, carol: 0 }),
    ]));
    expect(cell(m, 'alice', 'alice', 'no_hearts').score).toBe(-5);
    expect(cell(m, 'alice', 'bob', 'no_hearts').score).toBe(-25);
    expect(cell(m, 'alice', 'carol', 'no_hearts').score).toBe(0);
  });

  it('three Trump rounds by the same dealer fill Trump 1/2/3 with all players', () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'bob', 'trump', 1, { alice: 8, bob: 24, carol: 32 }),
      rec(3, 'bob', 'trump', 2, { alice: 32, bob: 16, carol: 16 }),
      rec(6, 'bob', 'trump', 3, { alice: 16, bob: 40, carol: 8 }),
    ]));
    expect(cell(m, 'bob', 'alice', 'trump1').score).toBe(8);
    expect(cell(m, 'bob', 'alice', 'trump2').score).toBe(32);
    expect(cell(m, 'bob', 'alice', 'trump3').score).toBe(16);
    expect(cell(m, 'bob', 'carol', 'trump2').score).toBe(16);
  });

  it('grand total matches the sum across all rounds for each player', () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'bob', 'trump', 2, { alice: 32, bob: 48, carol: 16 }),
      rec(1, 'alice', 'no_hearts', 0, { alice: -5, bob: -25, carol: 0 }),
    ]));
    const total = (id: string) => m.grandTotals.find((g) => g.playerId === id)!.total;
    expect(total('alice')).toBe(27);  // 32 - 5
    expect(total('bob')).toBe(23);    // 48 - 25
    expect(total('carol')).toBe(16);  // 16 + 0
    // per-section subtotal is that dealer's slice only
    expect(sectionFor(m, 'bob').rows.find((r) => r.playerId === 'alice')!.subtotal).toBe(32);
    expect(sectionFor(m, 'alice').rows.find((r) => r.playerId === 'bob')!.subtotal).toBe(-25);
  });

  it('unplayed games are empty; sections exist for every player', () => {
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], []));
    expect(m.sections).toHaveLength(3);
    expect(m.sections.every((s) => !s.hasPlayed)).toBe(true);
    expect(cell(m, 'alice', 'bob', 'no_tricks').score).toBeNull();
    expect(m.grandTotals.every((g) => g.total === 0)).toBe(true);
  });

  it('an early-ended round is recorded for all players like any other', () => {
    // Same shape as a normal record — the engine appends early-ends identically.
    const m = buildScoreTracker(stateWith(['alice', 'bob', 'carol'], [
      rec(0, 'carol', 'king_of_hearts', 0, { alice: 0, bob: 0, carol: -40 }),
    ]));
    expect(cell(m, 'carol', 'carol', 'king_of_hearts').score).toBe(-40);
    expect(cell(m, 'carol', 'alice', 'king_of_hearts').score).toBe(0);
    expect(m.lastRoundNumber).toBe(0);
  });

  it('works for a 4-player table (4 sections, 4 rows each)', () => {
    const m = buildScoreTracker(stateWith(['p0', 'p1', 'p2', 'p3'], [
      rec(0, 'p3', 'last_two_tricks', 0, { p0: 0, p1: -26, p2: 0, p3: -52 }),
    ]));
    expect(m.sections).toHaveLength(4);
    expect(m.sections.every((s) => s.rows.length === 4)).toBe(true);
    expect(cell(m, 'p3', 'p1', 'last_two_tricks').score).toBe(-26);
    expect(cell(m, 'p3', 'p3', 'last_two_tricks').score).toBe(-52);
  });
});
