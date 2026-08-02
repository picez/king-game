import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { seatPosition, positionIndexFor } from './pokerSeatLayout';

// Stage 38.0.2 item 2 — the felt was too dark to read. These pin the LIGHTER palette
// and, just as importantly, that the change was purely cosmetic: the seat geometry,
// the viewer-bottom rule and the physical (RTL-stable) layout are untouched.
// Rendered evidence: 2/4/6 seats + showdown at 360/390/1280, LTR and Arabic RTL,
// captured with Chrome device emulation — 0 clipped pods, 0 horizontal overflow.

const css = readFileSync(join(process.cwd(), 'src/styles/poker.css'), 'utf8');

/** '#1e8a56' → relative luminance 0..1 (sRGB, gamma-corrected). */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

describe('the poker felt is genuinely lighter', () => {
  const token = (name: string): string => {
    const m = new RegExp(`--poker-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
    expect(m, `--poker-${name} must be defined`).toBeTruthy();
    return m![1];
  };

  it('defines the scoped felt/rail tokens', () => {
    for (const n of ['felt-lit', 'felt', 'felt-edge', 'rail']) expect(token(n)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('every felt tone is lighter than the old #0b5d3b', () => {
    const old = luminance('#0b5d3b');
    for (const n of ['felt-lit', 'felt', 'felt-edge']) {
      expect(luminance(token(n)), `--poker-${n} must beat the old felt`).toBeGreaterThan(old);
    }
    // And the lit centre is lighter than the body, which is lighter than the rim.
    expect(luminance(token('felt-lit'))).toBeGreaterThan(luminance(token('felt')));
    expect(luminance(token('felt'))).toBeGreaterThan(luminance(token('felt-edge')));
  });

  it('the old dark felt value and the black-out inset shadow are gone', () => {
    expect(css).not.toContain('#0b5d3b');
    expect(css).not.toContain('inset 0 0 40px rgba(0, 0, 0, 0.4)');
  });

  it('the table keeps a visible rail and a lit centre', () => {
    expect(css).toMatch(/border:\s*7px solid var\(--poker-rail/);
    expect(css).toContain('radial-gradient(ellipse at 50% 40%');
  });

  it('readability aids for the brighter felt are in place', () => {
    expect(css).toContain('.poker-center__info');                 // dark plate behind pot/street
    expect(css).toMatch(/\.poker-pod--acting[^}]*box-shadow/);      // acting seat still obvious
    expect(css).toMatch(/\.poker-pod--me[^}]*border-color/);        // my seat still obvious
    expect(css).toMatch(/\.poker-card--empty[^}]*dashed/);          // board slots still visible
  });

  it('the centre plate stays narrow enough for the mid-side seat gap on small screens', () => {
    // The free gap between the two mid-side pods is ~115px at 360 / ~131px at 390 and
    // the pods paint ABOVE the centre, so the plate must shrink under 400px.
    expect(css).toMatch(/@media \(max-width: 400px\)[\s\S]*?\.poker-center__info/);
  });
});

describe('seat geometry is untouched by the re-skin', () => {
  it('the viewer is always bottom-centre for 2..6 seats', () => {
    for (let n = 2; n <= 6; n++) {
      const me = seatPosition(0, 0, n);
      expect(me.left).toBe(50);
      expect(me.top).toBeGreaterThanOrEqual(86);
    }
  });

  it('positions stay within the felt (no pod pushed off the table)', () => {
    // Bounds widened in Stage 38.0.3 when the side seats moved out of the centre
    // band; `pokerSeatLayout.test.ts` owns the safe-zone + pairwise-overlap proof.
    for (let n = 2; n <= 6; n++) {
      for (let seat = 0; seat < n; seat++) {
        const p = seatPosition(seat, 0, n);
        expect(p.left).toBeGreaterThanOrEqual(20);
        expect(p.left).toBeLessThanOrEqual(80);
        expect(p.top).toBeGreaterThanOrEqual(10);
        expect(p.top).toBeLessThanOrEqual(87);
      }
    }
  });

  it('seat identity never mirrors — the layout is indexed by distance from the viewer', () => {
    expect(positionIndexFor(3, 1, 6)).toBe(2);
    expect(positionIndexFor(0, 4, 6)).toBe(2);
    // Physical left/top only: no logical/RTL-flipping property is used for a seat.
    expect(css).not.toMatch(/\.poker-pod\s*\{[^}]*inset-inline/);
  });
});
