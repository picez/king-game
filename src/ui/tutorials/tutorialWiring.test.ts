// ---------------------------------------------------------------------------
// Tutorial UI wiring guards (Stage 31.1) — source-level (no jsdom). The menu
// exposes a Tutorials pane; the hub lists games and gates enabled vs coming-next;
// the player exposes Back/Next/Skip/Done + progress + keyboard; the whole tutorial
// UI is client-only (no net/server/db/ws, no reducer, no stats/achievements); and
// the CSS keeps mobile tap targets + no page overflow.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('StartMenu wires the Tutorials pane', () => {
  const menu = read('src/ui/StartMenu.tsx');
  it('adds a tutorials pane, a menu tile, and renders TutorialHub', () => {
    expect(menu).toMatch(/type Pane =[^;]*'tutorials'/);
    expect(menu).toContain("import TutorialHub from './tutorials/TutorialHub'");
    expect(menu).toContain("setPane('tutorials')");
    expect(menu).toContain("t('menu.tutorialsTitle')");
    expect(menu).toMatch(/pane === 'tutorials'[\s\S]*<TutorialHub onExit=/);
  });
});

describe('TutorialHub', () => {
  const hub = read('src/ui/tutorials/TutorialHub.tsx');
  it('lists all games, gates enabled (Start) vs disabled (Coming next), and opens the player', () => {
    expect(hub).toContain('TUTORIAL_ORDER');
    expect(hub).toContain('isTutorialEnabled');
    expect(hub).toContain("t('tutorials.start')");
    expect(hub).toContain("t('tutorials.comingNext')");
    expect(hub).toContain('TutorialPlayer');
    expect(hub).toContain('GameIcon');
  });
  it('back returns to the menu (onExit), not a live game', () => {
    expect(hub).toContain('onExit');
  });
});

describe('TutorialPlayer', () => {
  const player = read('src/ui/tutorials/TutorialPlayer.tsx');
  it('has Back / Next / Skip / Done and a step progress readout', () => {
    for (const k of ['tutorials.back', 'tutorials.next', 'tutorials.done', 'tutorials.skip', 'tutorials.stepProgress']) {
      expect(player, k).toContain(`'${k}'`);
    }
  });
  it('supports keyboard ← / → / Esc', () => {
    expect(player).toContain('ArrowLeft');
    expect(player).toContain('ArrowRight');
    expect(player).toContain('Escape');
  });
  it('Done/Skip route via onExit (back to the hub), never to a live game', () => {
    expect(player).toContain('onExit');
    expect(player).not.toMatch(/onLocal|onOnline|START_GAME|dispatch\(/);
  });
});

describe('tutorial UI is client-only (no engine/net/server/stats)', () => {
  const files = [
    'src/ui/tutorials/TutorialHub.tsx',
    'src/ui/tutorials/TutorialPlayer.tsx',
    'src/ui/tutorials/TutorialBoard.tsx',
  ];
  for (const f of files) {
    it(`${f} imports no net/server/db/ws and no reducer/stats`, () => {
      const src = read(f);
      const importLines = src.split('\n').filter((l) => l.trimStart().startsWith('import'));
      for (const line of importLines) {
        expect(line, `${f}: ${line}`).not.toMatch(/\/(net|server|db)\/|\bws\b|Reducer|serverCore|wsHandlers|recordStats|achievements/i);
      }
      expect(src).not.toMatch(/ACTION_REQUEST|WebSocket|fetch\(|localStorage/);
    });
  }
  it('TutorialBoard renders cards via the shared CardView', () => {
    expect(read('src/ui/tutorials/TutorialBoard.tsx')).toContain('CardView');
  });
});

describe('tutorial CSS keeps mobile ergonomics', () => {
  const css = read('src/styles/tutorials.css');
  it('control + CTA tap targets are ≥ 44px', () => {
    expect(css).toMatch(/\.tutorial-btn\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.tutorial-row__cta\s*\{[^}]*min-height:\s*44px/);
  });
  it('card rows scroll inside their box (no horizontal PAGE overflow)', () => {
    expect(css).toMatch(/\.tutorial-hand\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toMatch(/\.tutorial-meld\s*\{[^}]*overflow-x:\s*auto/);
  });
  it('honours reduced-motion for the highlight pulse', () => {
    expect(css).toContain('prefers-reduced-motion');
  });
  it('is registered in the App stylesheet', () => {
    expect(read('src/App.css')).toContain("@import './styles/tutorials.css'");
  });
});
