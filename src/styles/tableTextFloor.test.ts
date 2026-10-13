// ---------------------------------------------------------------------------
// Stage 40.0 — the redesign's leftover debts, pinned where a refactor would undo them.
//
// The real geometry is asserted in a real browser: `npm run layout:fold` (one screen, and no
// rendered text under 12px on any table), `layout:fiftyone`, `layout:poker`. These are the
// structural facts behind those numbers.
// ---------------------------------------------------------------------------
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('text floor — no table sheet sets a font under 12px', () => {
  // The sheets a game table is drawn from. 0.75rem = 12px at the default root size.
  const TABLE_SHEETS = ['deberc', 'durak', 'fiftyone', 'poker', 'preferans', 'tarneeb', 'table', 'table-shell'];

  for (const name of TABLE_SHEETS) {
    it(`${name}.css`, () => {
      const css = noComments(read(`src/styles/${name}.css`));
      const small = [...css.matchAll(/font-size:\s*(0?\.\d+)rem/g)].map((m) => parseFloat(m[1])).filter((v) => v < 0.75);
      expect(small, `${name}.css has font sizes under 0.75rem`).toEqual([]);
    });
  }

  it('the shared pieces a table renders are at the floor too', () => {
    expect(noComments(read('src/styles/social.css'))).toMatch(/\.social-fab__badge\s*\{[^}]*font-size:\s*0\.75rem/);
    expect(noComments(read('src/styles/lobby.css'))).toMatch(/\.tag\s*\{[^}]*font-size:\s*0\.75rem/);
  });

  it('the fold gate measures it in the browser, cards exempt', () => {
    const gate = read('scripts/fold-audit.mjs');
    expect(gate).toContain('const TEXT_FLOOR_PX = 12;');
    expect(gate).toContain("el.closest('.card, [aria-hidden=\"true\"], .sr-only')");
    expect(gate).toContain('text under ${TEXT_FLOOR_PX}px');
  });

  it('Poker pods pay for the larger text with tighter leading, not with height', () => {
    const css = read('src/styles/poker.css');
    const narrow = css.slice(css.indexOf('@media (max-width: 400px) {\n  .poker-pod {'));
    expect(narrow).toContain('.poker-pod__name, .poker-pod__stack, .poker-pod__tag, .poker-pod .poker-badge { line-height: 1.05; }');
  });
});

describe('Fifty-One — the room controls share the desk row (portrait)', () => {
  const css = read('src/styles/fiftyone.css');
  const portrait = css.slice(0, css.indexOf('@media (orientation: landscape) and (max-height: 520px)'));
  const landscape = css.slice(css.indexOf('@media (orientation: landscape) and (max-height: 520px)'));

  it('the control band has no height of its own and hangs over the dock', () => {
    const band = portrait.slice(portrait.indexOf('.table-shell.fiftyone-screen > .room-social {'));
    const rule = band.slice(0, band.indexOf('}'));
    expect(rule).toMatch(/height:\s*0/);
    expect(rule).toMatch(/align-items:\s*flex-end/);
    // The row keeps its height (a flex item of a zero-height column would collapse)…
    expect(portrait).toMatch(/\.room-social > \.room-social__bar \{[^}]*flex:\s*0 0 auto/);
    // …and never reaches the piles.
    expect(portrait).toMatch(/\.room-social__bar \{[^}]*max-width:\s*calc\(100% - \(2 \* var\(--f51-pile-w\)/);
  });

  it('the prompt starts under the controls ONLY when the controls are there', () => {
    // A MARGIN, not padding: the layout gate treats the prompt's box as game content the
    // controls may not cover.
    expect(portrait).toMatch(/\.room-social ~ \.fiftyone-dock \.fiftyone-prompt \{[^}]*margin-top:\s*calc\(48px - 0\.35rem\)/);
    expect(portrait).not.toMatch(/\.fiftyone-prompt \{[^}]*padding-top/);
  });

  it('the pile width is known to the whole screen, since the control row is sized from it', () => {
    const screen = portrait.slice(portrait.indexOf('.table-shell.fiftyone-screen {'));
    expect(screen.slice(0, screen.indexOf('}'))).toContain('--f51-pile-w:');
  });

  it('landscape gives the controls their own grid area again', () => {
    expect(landscape).toMatch(/> \.room-social \{[^}]*grid-area:\s*social;[^}]*height:\s*auto;[^}]*position:\s*static/);
    expect(landscape).toContain('.fiftyone-prompt { margin-top: 0; }');
  });

  it('production gives the control row no timer — the top bar has it', () => {
    const online = read('src/ui/online/OnlineGame.tsx');
    const block = online.slice(online.indexOf('const fiftyOneSocial = ('), online.indexOf('<FiftyOneOnlineGame'));
    expect(block).not.toContain('timerSlot');
    expect(online.slice(online.indexOf('<FiftyOneOnlineGame'), online.indexOf('<FiftyOneOnlineGame') + 400)).toContain('timerSlot={timerEl}');
  });
});

describe('Deberc — the side seats clear the deck on a narrow phone', () => {
  const css = read('src/styles/deberc.css');
  const narrow = css.slice(css.lastIndexOf('@media (max-width: 400px) {'));

  it('the seat is narrower than the space the centre leaves it', () => {
    expect(narrow).toMatch(/\.deberc-screen \.durak-seat \{[^}]*width:\s*4\.7rem/);
    // centre inset 0.4rem + 4.5rem padding = 4.9rem > the 4.7rem seat.
    expect(narrow).toMatch(/\.durak-board--4 \.durak-centre \{[^}]*padding-inline:\s*4\.5rem/);
  });

  it('a wide trick cannot squeeze the deck back under the seat', () => {
    expect(narrow).toMatch(/grid-template-columns:\s*minmax\(min-content, 1fr\) auto minmax\(0, 1fr\)/);
  });
});
