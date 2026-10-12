// ---------------------------------------------------------------------------
// The 51 TABLE SHELL (table redesign, stage 1).
//
// Before this stage the screen was a `min-height: 100dvh` flow column with nothing pinned.
// Measured on the layout harness (4 players, 4 melds, 8 cards in hand): 1.94 screens tall at
// 360×640, 3.44 at 667×375, the hand starting at 944px and the action bar at 1185px.
//
// The real geometry is asserted in a real browser by `npm run layout:fiftyone` (the fold
// budget, at 360×640 and 667×375 among others). These are the structural facts that make
// that geometry possible, pinned where a refactor would otherwise undo them silently.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fanRowCapacity, fanRows } from '../components/HandReorderTray';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const css = read('src/styles/fiftyone.css');
const src = read('src/ui/fiftyOne/FiftyOneGameScreen.tsx');

const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} must exist`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('the screen is the SHARED one-viewport shell (Stage 39.6)', () => {
  it('opts into the shared contract instead of restating it', () => {
    expect(src).toContain('<div className="screen table-shell fiftyone-screen">');
    expect(src).toContain('<div className="fiftyone-table table-shell__table">');
    // The height, the "children keep their height" rule and the flexible table live in
    // table-shell.css; a private copy here would drift from the other six games.
    const screen = rule('.table-shell.fiftyone-screen');
    expect(screen).not.toMatch(/(^|[\s;])height:/);
    expect(screen).not.toMatch(/overflow/);
    expect(css).not.toContain('.fiftyone-screen > * { flex: 0 0 auto');
    expect(css).not.toMatch(/^\.fiftyone-screen \{/m);
  });

  it('never clips: the private `overflow: hidden` that could cut the action bar off is gone', () => {
    expect(css).not.toMatch(/\.fiftyone-screen[^{]*\{[^}]*overflow:\s*hidden/);
  });

  it('the table band is the ONLY scroller, with a floor low enough to stay usable', () => {
    expect(rule('.table-shell.fiftyone-screen')).toMatch(/--shell-table-min:\s*6rem/);
    const table = rule('.table-shell.fiftyone-screen > .fiftyone-table');
    expect(table).toMatch(/overflow-y:\s*auto/);
    expect(table).not.toMatch(/flex:/);          // the shell's `flex: 1 1 0` applies
    // No other band of the stage may scroll vertically (the layoff dialog is a modal).
    const others = css.split('}').filter((r) => /overflow-y:\s*(auto|scroll)/.test(r));
    expect(others.map((r) => r.slice(r.lastIndexOf('\n.') + 1, r.indexOf('{')).trim()))
      .toEqual(['.table-shell.fiftyone-screen > .fiftyone-table', '.fiftyone-layoff-dialog']);
  });

  it('keeps its OWN landscape arrangement, out-ranking the shell on every band', () => {
    const land = css.slice(css.indexOf('@media (orientation: landscape) and (max-height: 520px)'));
    for (const band of ['.fiftyone-topbar', '.fiftyone-scoreboard', '.room-social', '.fiftyone-table', '.fiftyone-dock', '.fiftyone-actions']) {
      expect(land, band).toContain(`.screen.table-shell.fiftyone-screen > ${band} {`);
    }
  });
});

describe('the hand and the action bar are pinned OUTSIDE the scroller', () => {
  const order = (needle: string) => {
    const at = src.indexOf(needle);
    expect(at, `${needle} must be rendered`).toBeGreaterThan(-1);
    return at;
  };
  const tableOpen = order('<div className="fiftyone-table table-shell__table">');
  const social = order('{socialSlot}\n');
  const dock = order('<div className="fiftyone-dock">');
  const hand = order('<HandReorderTray');
  const actions = order('<div className="fiftyone-actions">');

  it('bands render in budget order: table → social → dock (piles, hand) → actions', () => {
    expect(tableOpen).toBeLessThan(social);
    expect(social).toBeLessThan(dock);
    expect(dock).toBeLessThan(hand);
    expect(hand).toBeLessThan(actions);
  });

  it('the table band holds the public melds and nothing a player must reach to move', () => {
    const table = src.slice(tableOpen, social);
    expect(table).toContain('fiftyone-melds');
    for (const pinned of ['fiftyone-piles', 'fiftyone-prompt', 'HandReorderTray', 'fiftyone-actions', 'fiftyone-selbuilder']) {
      expect(table, `${pinned} must not be inside the scrolling table`).not.toContain(pinned);
    }
  });

  it('the piles sit in the dock, and the draw pile is itself the draw control', () => {
    const dockSrc = src.slice(dock, hand);
    expect(dockSrc).toContain('fiftyone-piles');
    expect(dockSrc).toMatch(/fiftyone-drawpile[\s\S]{0,200}onClick=\{drawStep \? \(\) => apply\(\{ type: 'DRAW_FROM_DECK' \}\) : undefined\}/);
  });

  it('the hand is the shared tray in FAN layout', () => {
    expect(src.slice(hand, actions)).toContain('layout="fan"');
  });
});

describe('card sizes follow the space, not width breakpoints', () => {
  it('the hand card is bounded by BOTH axes', () => {
    expect(rule('.fiftyone-dock')).toMatch(/--card-w:\s*clamp\(46px, min\(15vw, 10dvh\), 78px\)/);
  });

  it('a short, wide phone gets its own arrangement keyed on HEIGHT and orientation', () => {
    expect(css).toContain('@media (orientation: landscape) and (max-height: 520px)');
    const land = css.slice(css.indexOf('@media (orientation: landscape) and (max-height: 520px)'));
    expect(land).toContain('"top   score social"');
    expect(land).toContain('"dock  dock  actions"');
  });
});

describe('fan rows', () => {
  it('capacity keeps a thumb-wide strip per card', () => {
    // 344px row, 54px card: (344 − 54) / 30 + 1 = 10 cards.
    expect(fanRowCapacity(344, 54)).toBe(10);
    expect(fanRowCapacity(635, 46)).toBe(20);
    // Not measured yet (SSR / first paint) → never forces a second row.
    expect(fanRowCapacity(0, 54)).toBe(Infinity);
    expect(fanRowCapacity(344, 0)).toBe(Infinity);
  });

  it('one row while it fits; otherwise two balanced rows — never three', () => {
    const hand = Array.from({ length: 14 }, (_, i) => i);
    expect(fanRows(hand, 20, true)).toEqual([hand]);
    expect(fanRows(hand, 10, true).map((r) => r.length)).toEqual([7, 7]);
    expect(fanRows(hand.slice(0, 13), 10, true).map((r) => r.length)).toEqual([7, 6]);
    expect(fanRows(hand, 4, true)).toHaveLength(2);
    // Order is preserved across the split: it is the player's own arrangement.
    expect(fanRows(hand, 10, true).flat()).toEqual(hand);
  });

  it('a short viewport (phone landscape) never gets a second row', () => {
    const hand = Array.from({ length: 14 }, (_, i) => i);
    expect(fanRows(hand, 10, false)).toEqual([hand]);
  });
});
