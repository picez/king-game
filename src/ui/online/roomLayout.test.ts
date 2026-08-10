import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GAME_TYPES, type GameType } from '../../games/catalog';
import {
  sidecarCapability, roomLayoutClass, minimumClientWidth, minimumViewportWidth,
  SIDECAR_THRESHOLD_PX, SIDECAR_FOOTPRINT_PX, SIDECAR_CHAT_PX, SIDECAR_GAP_PX,
  SIDECAR_MARGIN_PX, SCROLLBAR_GUTTER_PX,
} from './roomLayout';

const CSS = readFileSync('src/styles/social.css', 'utf8');

describe('the sidecar capability is a footprint declaration, not a game list', () => {
  it('gives every released game exactly one capability', () => {
    for (const g of GAME_TYPES) expect(['none', 'sidecar-compact', 'sidecar-wide']).toContain(sidecarCapability(g));
    expect(GAME_TYPES).toHaveLength(7);
  });

  it('only King and Poker declare a smaller scene — the two measured as centred', () => {
    expect(sidecarCapability('king')).toBe('sidecar-wide');
    expect(sidecarCapability('poker')).toBe('sidecar-compact');
    // The other five use the width they are given (top bar, seats, hand, melds), so a side
    // band would have to be taken FROM them — which is the 38.0.16 mistake.
    for (const g of ['durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one'] as GameType[]) {
      expect(sidecarCapability(g)).toBe('none');
    }
  });

  it('an unknown or missing game type falls back to no sidecar', () => {
    expect(sidecarCapability(undefined)).toBe('none');
    expect(sidecarCapability(null)).toBe('none');
    expect(sidecarCapability('solitaire' as GameType)).toBe('none');
  });
});

describe('roomLayoutClass', () => {
  it('marks only the capability and never the width', () => {
    expect(roomLayoutClass('king')).toBe('room-layout room-layout--sidecar-wide');
    expect(roomLayoutClass('poker')).toBe('room-layout room-layout--sidecar-compact');
    expect(roomLayoutClass('durak')).toBe('room-layout');
    expect(roomLayoutClass(undefined)).toBe('room-layout');
  });

  it('always keeps the base class, so the fallback contract still applies', () => {
    for (const g of GAME_TYPES) expect(roomLayoutClass(g).split(' ')[0]).toBe('room-layout');
  });
});

describe('the threshold arithmetic', () => {
  it('needs the panel column on BOTH sides, or the game would move off centre', () => {
    const band = SIDECAR_CHAT_PX + SIDECAR_GAP_PX + SIDECAR_MARGIN_PX;
    expect(band).toBe(376);
    expect(minimumClientWidth('sidecar-compact')).toBe(SIDECAR_FOOTPRINT_PX['sidecar-compact'] + 2 * band);
    expect(minimumClientWidth('sidecar-wide')).toBe(SIDECAR_FOOTPRINT_PX['sidecar-wide'] + 2 * band);
    expect(minimumClientWidth('sidecar-compact')).toBe(1456);
    expect(minimumClientWidth('sidecar-wide')).toBe(1652);
  });

  it('adds the scrollbar gutter a media query cannot see', () => {
    expect(minimumViewportWidth('sidecar-compact')).toBe(1471);
    expect(minimumViewportWidth('sidecar-wide')).toBe(1667);
    expect(SCROLLBAR_GUTTER_PX).toBe(15);
  });

  it('publishes thresholds that are never below the arithmetic', () => {
    for (const cap of ['sidecar-compact', 'sidecar-wide'] as const) {
      expect(SIDECAR_THRESHOLD_PX[cap]).toBeGreaterThanOrEqual(minimumViewportWidth(cap));
      // …and not wastefully above it either: a whole pixel of slack, no more.
      expect(SIDECAR_THRESHOLD_PX[cap] - minimumViewportWidth(cap)).toBeLessThanOrEqual(1);
    }
  });

  it('leaves the declared scene room on both sides at the threshold, worst case', () => {
    for (const cap of ['sidecar-compact', 'sidecar-wide'] as const) {
      const client = SIDECAR_THRESHOLD_PX[cap] - SCROLLBAR_GUTTER_PX;
      const freePerSide = (client - SIDECAR_FOOTPRINT_PX[cap]) / 2;
      expect(freePerSide).toBeGreaterThanOrEqual(SIDECAR_CHAT_PX + SIDECAR_GAP_PX + SIDECAR_MARGIN_PX);
    }
  });

  it('declares footprints at least as wide as the measured scenes', () => {
    // `node scripts/footprint-audit.mjs`, worst supported player count, longest test names,
    // LTR and RTL, 1366→2560: King 900.00, Poker 700.81 — constant at every width.
    expect(SIDECAR_FOOTPRINT_PX['sidecar-wide']).toBeGreaterThanOrEqual(900);
    expect(SIDECAR_FOOTPRINT_PX['sidecar-compact']).toBeGreaterThanOrEqual(700.81);
  });
});

describe('the CSS contract agrees with the arithmetic', () => {
  it('turns each capability on at exactly its published threshold', () => {
    for (const [cap, px] of Object.entries(SIDECAR_THRESHOLD_PX)) {
      const block = new RegExp(`@media \\(min-width: (\\d+)px\\) \\{[^@]*\\.room-layout--${cap}\\s*\\{[^}]*grid-template-columns`);
      const m = CSS.match(block);
      expect(m, `no grid activation found for ${cap}`).toBeTruthy();
      expect(Number(m![1])).toBe(px);
    }
  });

  it('declares the same footprint to CSS as to TypeScript', () => {
    for (const [cap, px] of Object.entries(SIDECAR_FOOTPRINT_PX)) {
      expect(CSS).toContain(`.room-layout--${cap} { --sidecar-footprint: ${px}px; }`);
    }
  });

  it('keeps the stage spanning every track wherever a sidecar is activated', () => {
    // The one rule the whole contract rests on: a side band may never be a column the stage
    // gave up. Both capabilities must span 1 / -1 inside their own media query.
    for (const cap of Object.keys(SIDECAR_THRESHOLD_PX)) {
      expect(CSS).toContain(`.room-layout--${cap} > .game-stage { grid-column: 1 / -1; grid-row: 1; }`);
      expect(CSS).toContain(`.room-layout--${cap} > .social-region { grid-column: 3; grid-row: 1; }`);
    }
  });

  it('never positions the panel out of flow, and never locks the page', () => {
    // Bounded to the sidecar block itself — the rest of the file legitimately positions
    // lightboxes and floating reactions, and sweeping those in would prove nothing.
    const start = CSS.indexOf('THE ADAPTIVE SIDECAR');
    const end = CSS.indexOf('.room-social {', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // Declarations only. The slice starts INSIDE the block comment (whose prose says "no
    // backdrop, no fixed"), so skip past its terminator first and strip any later comments —
    // matching the documentation would pass for entirely the wrong reason.
    const afterPreamble = CSS.indexOf('*/', start) + 2;
    const sidecar = CSS.slice(afterPreamble, end).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(sidecar).not.toMatch(/position:\s*(fixed|absolute|sticky)/);
    expect(sidecar).not.toMatch(/overflow:\s*hidden/);
    expect(sidecar).not.toMatch(/backdrop/);
    expect(sidecar).not.toMatch(/aria-modal/);
  });

  it('lets empty space pass a tap through to the game', () => {
    for (const cap of Object.keys(SIDECAR_THRESHOLD_PX)) {
      expect(CSS).toContain(`.room-layout--${cap} > .social-region > * { pointer-events: auto;`);
    }
    expect(CSS.match(/pointer-events: none;/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
