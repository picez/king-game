import { describe, it, expect } from 'vitest';
import { positionIndexFor, seatPosition } from './pokerSeatLayout';

// Oval seat geometry (§16 F): the viewer is always position 0 (bottom); every other
// seat maps to a distinct position; the mapping works for 2–6 players and is stable.

describe('positionIndexFor', () => {
  it('maps the viewer to 0 and rotates the rest clockwise', () => {
    expect(positionIndexFor(2, 2, 5)).toBe(0);       // viewer seat → 0
    expect(positionIndexFor(3, 2, 5)).toBe(1);
    expect(positionIndexFor(1, 2, 5)).toBe(4);       // wraps
  });
  it('handles a spectator (viewer 0)', () => {
    expect(positionIndexFor(0, 0, 4)).toBe(0);
    expect(positionIndexFor(2, 0, 4)).toBe(2);
  });
});

describe('seatPosition', () => {
  for (const count of [2, 3, 4, 5, 6]) {
    it(`gives ${count} DISTINCT positions with the viewer at the bottom`, () => {
      const viewer = 0;
      const seen = new Set<string>();
      for (let s = 0; s < count; s++) {
        const p = seatPosition(s, viewer, count);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.left).toBeLessThanOrEqual(100);
        expect(p.top).toBeGreaterThanOrEqual(0);
        expect(p.top).toBeLessThanOrEqual(100);
        seen.add(`${p.left},${p.top}`);
      }
      expect(seen.size).toBe(count); // no two seats overlap
      // Viewer (seat 0) is at the bottom (largest top%).
      const viewerPos = seatPosition(0, viewer, count);
      for (let s = 1; s < count; s++) expect(viewerPos.top).toBeGreaterThan(seatPosition(s, viewer, count).top);
    });
  }
  it('spectator (null viewer) still resolves seat 0 to the bottom', () => {
    const p = seatPosition(0, null, 6);
    expect(p.top).toBeGreaterThan(50);
  });
});
