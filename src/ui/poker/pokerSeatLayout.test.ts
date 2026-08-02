import { describe, it, expect } from 'vitest';
import {
  positionIndexFor, seatPosition, seatLayoutFor, clearsCenterBand, CENTER_BAND, POD_HALF_HEIGHT,
} from './pokerSeatLayout';

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

// Stage 38.0.3 — the reserved CENTRE SAFE ZONE. The owner FAIL was 4-player side pods
// sitting on the community board and the pot; the structural guarantee is that no seat
// band may enter the band the board + pot own. Asserted for EVERY seat of EVERY count
// so a future coordinate tweak cannot silently re-create the overlap.
describe('centre safe zone (Stage 38.0.3)', () => {
  for (const count of [2, 3, 4, 5, 6]) {
    it(`${count} players: every pod band clears the board/pot band`, () => {
      for (const pos of seatLayoutFor(count)) {
        expect(clearsCenterBand(pos.top), `top ${pos.top} enters the centre band`).toBe(true);
      }
    });

    it(`${count} players: no two pods overlap as rectangles`, () => {
      // Pod box in % of the felt: ~20% wide at 360 (72px of ~334px) and ~18% tall.
      const HALF_W = 10, HALF_H = POD_HALF_HEIGHT;
      const seats = seatLayoutFor(count);
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          const a = seats[i], b = seats[j];
          const overlap = Math.abs(a.left - b.left) < HALF_W * 2 && Math.abs(a.top - b.top) < HALF_H * 2;
          expect(overlap, `seats ${i} and ${j} overlap`).toBe(false);
        }
      }
    });

    it(`${count} players: every pod stays inside the felt`, () => {
      for (const pos of seatLayoutFor(count)) {
        expect(pos.left).toBeGreaterThanOrEqual(20);
        expect(pos.left).toBeLessThanOrEqual(80);
        expect(pos.top).toBeGreaterThanOrEqual(10);
        expect(pos.top).toBeLessThanOrEqual(87);
      }
    });
  }

  it('the centre band is the one the stylesheet reserves (.poker-center top 42%)', () => {
    const mid = (CENTER_BAND.top + CENTER_BAND.bottom) / 2;
    expect(mid).toBe(42);
  });
});
