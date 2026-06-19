import { describe, it, expect } from 'vitest';
import { gamesMatrix, MATRIX_MODE_IDS } from './games';
import { freshDealerModeCounts, DEALER_MODE_COUNTS } from '../config/gameModes';
import type { GameState, ModeCounts } from '../models/types';

function stateWith(modes: Record<string, ModeCounts>, dealerIndex = 0): GameState {
  const players = Object.keys(modes).map((id, i) => ({ id, name: `P${i}`, seatIndex: i }));
  return { players, dealerIndex, dealerModes: modes } as unknown as GameState;
}

describe('gamesMatrix (per-player dealer-mode progress)', () => {
  it('a fresh game shows every mode 0/total, nothing done', () => {
    const rows = gamesMatrix(stateWith({
      'player-0': freshDealerModeCounts(),
      'player-1': freshDealerModeCounts(),
      'player-2': freshDealerModeCounts(),
    }));
    expect(rows).toHaveLength(3);
    const trump = rows[0].cells.find((c) => c.modeId === 'trump')!;
    expect(trump).toMatchObject({ total: 3, remaining: 3, played: 0, done: false });
    const noTricks = rows[0].cells.find((c) => c.modeId === 'no_tricks')!;
    expect(noTricks).toMatchObject({ total: 1, remaining: 1, played: 0, done: false });
    expect(rows.every((r) => !r.allDone)).toBe(true);
  });

  it('reflects remaining counts from dealerModes (played = total − remaining)', () => {
    const partial = freshDealerModeCounts();
    partial.trump = 1;       // 2 of 3 trumps played
    partial.no_queens = 0;   // done
    const rows = gamesMatrix(stateWith({
      'player-0': partial,
      'player-1': freshDealerModeCounts(),
    }));
    const me = rows[0].cells;
    expect(me.find((c) => c.modeId === 'trump')).toMatchObject({ played: 2, remaining: 1, done: false });
    expect(me.find((c) => c.modeId === 'no_queens')).toMatchObject({ played: 1, remaining: 0, done: true });
  });

  it('marks the current dealer row, defaulting to the state dealer', () => {
    const rows = gamesMatrix(stateWith({
      'player-0': freshDealerModeCounts(),
      'player-1': freshDealerModeCounts(),
    }, 1));
    expect(rows.find((r) => r.playerId === 'player-1')!.isDealer).toBe(true);
    expect(rows.find((r) => r.playerId === 'player-0')!.isDealer).toBe(false);
  });

  it('honours an explicit dealerId override', () => {
    const rows = gamesMatrix(stateWith({
      'player-0': freshDealerModeCounts(),
      'player-1': freshDealerModeCounts(),
    }, 0), { dealerId: 'player-1' });
    expect(rows.find((r) => r.playerId === 'player-1')!.isDealer).toBe(true);
  });

  it('allDone is true once every mode is exhausted (game finished)', () => {
    const done: ModeCounts = { ...DEALER_MODE_COUNTS };
    for (const k of MATRIX_MODE_IDS) done[k] = 0;
    const rows = gamesMatrix(stateWith({ 'player-0': done, 'player-1': done, 'player-2': done }));
    expect(rows.every((r) => r.allDone)).toBe(true);
    expect(rows[0].cells.find((c) => c.modeId === 'trump')).toMatchObject({ played: 3, total: 3, done: true });
  });

  it('works for a 4-player table (one row per player)', () => {
    const rows = gamesMatrix(stateWith({
      'player-0': freshDealerModeCounts(),
      'player-1': freshDealerModeCounts(),
      'player-2': freshDealerModeCounts(),
      'player-3': freshDealerModeCounts(),
    }));
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.cells.length === MATRIX_MODE_IDS.length)).toBe(true);
  });
});
