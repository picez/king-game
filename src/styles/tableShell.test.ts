// ---------------------------------------------------------------------------
// The TABLE SHELL contract (table redesign, stage 2).
//
// The geometry itself is asserted in a real browser by `npm run layout:fold` (one screen
// tall; hand and actions inside it; seven viewports including 360×640 and 667×375). These
// are the structural facts that make it true, pinned where a refactor would silently undo
// them — one screen quietly dropping the class is enough to bring a 1.5-screen table back.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const css = read('src/styles/table-shell.css');
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} must exist`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

describe('the shell is one viewport tall, and only the table is flexible', () => {
  it('a fixed height on both units, never a minimum', () => {
    const shell = rule('.screen.table-shell');
    expect(shell).toMatch(/height:\s*100vh;\s*height:\s*100dvh/);
    expect(shell).toMatch(/min-height:\s*0/);
  });

  it('the stage SCROLLS as a last resort — it never clips a control out of reach', () => {
    const shell = rule('.screen.table-shell');
    expect(shell).toMatch(/overflow-y:\s*auto/);
    expect(shell).not.toMatch(/overflow(-y)?:\s*hidden/);
  });

  it('every child keeps its height; the table takes the rest, above a floor', () => {
    expect(css).toContain('.screen.table-shell > * { flex: 0 0 auto; min-width: 0; }');
    const table = rule('.screen.table-shell > .table-shell__table');
    expect(table).toMatch(/flex:\s*1 1 0/);
    expect(table).toMatch(/min-height:\s*var\(--shell-table-min, 10rem\)/);
  });

  it('card sizes are bounded by BOTH axes', () => {
    const shell = rule('.screen.table-shell');
    expect(shell).toMatch(/--card-w:\s*clamp\(44px, min\(15vw, 10dvh\), 78px\)/);
    expect(shell).toMatch(/--card-w-table:\s*clamp\(40px, min\(14vw, 9\.5dvh\), 74px\)/);
  });

  it('phone landscape is keyed on HEIGHT + orientation, with the hand under the table', () => {
    const land = css.slice(css.indexOf('@media (orientation: landscape) and (max-height: 520px)'));
    expect(land.length).toBeGreaterThan(0);
    expect(land).toMatch(/\.table-shell__table \{[^}]*grid-column: 1; grid-row: 1 \/ 10/);
    expect(land).toMatch(/\.hand-reorder-wrap \{ grid-column: 1; grid-row: 10/);
    // Eight empty auto tracks would each add a gap, so the row gap must stay zero.
    expect(land).toMatch(/row-gap:\s*0/);
  });

  it('is imported AFTER the per-game sheets, so a game\'s own min-height cannot win', () => {
    const imports = read('src/App.css').split(/\r?\n/).filter((l) => l.startsWith('@import'));
    expect(imports[imports.length - 1]).toContain('table-shell.css');
  });
});

describe('the games on the shell opt in the same way', () => {
  const SCREENS: Array<[string, string]> = [
    ['tarneeb', 'src/ui/tarneeb/TarneebGameScreen.tsx'],
    ['preferans', 'src/ui/preferans/PreferansGameScreen.tsx'],
    ['deberc', 'src/ui/deberc/DebercGameScreen.tsx'],
    ['durak', 'src/ui/durak/DurakGameScreen.tsx'],
  ];

  for (const [game, file] of SCREENS) {
    it(`${game}: shell root, exactly one table band, and the hand as a fan`, () => {
      const src = read(file);
      expect(src).toMatch(/className=\{?[`"]screen table-shell /);
      expect((src.match(/table-shell__table/g) ?? []).length).toBe(1);
      expect(src).toMatch(/<HandReorderTray\s+layout="fan"/);
    });
  }

  it('the fold gate asserts exactly the games that are on the shell', () => {
    const gate = read('scripts/fold-audit.mjs');
    const list = gate.slice(gate.indexOf('const ON_SHELL = {'), gate.indexOf('};', gate.indexOf('const ON_SHELL = {')));
    for (const game of ['fiftyone', 'tarneeb', 'deberc', 'durak', 'preferans']) expect(list, game).toContain(`${game}:`);
    for (const game of ['king', 'poker']) expect(list, game).not.toContain(`${game}:`);
  });
});
