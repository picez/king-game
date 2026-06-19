import { describe, it, expect } from 'vitest';
import { tablePositions } from './TablePlayers';

describe('tablePositions (clockwise seat layout)', () => {
  it('3 players: bottom (viewer), then left and right corners', () => {
    expect(tablePositions(3)).toEqual(['bottom', 'left', 'right']);
  });

  it('4 players: bottom, left, top, right (clockwise)', () => {
    expect(tablePositions(4)).toEqual(['bottom', 'left', 'top', 'right']);
  });

  it('the viewer is always at index 0 (bottom)', () => {
    expect(tablePositions(3)[0]).toBe('bottom');
    expect(tablePositions(4)[0]).toBe('bottom');
  });
});
