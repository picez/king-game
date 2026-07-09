// Source + asset guards for the Stage 12.3 art integration (menu hero + game
// icons). No jsdom: assert the helper, the wiring in the components, and the CSS
// so a regression that drops an emblem / the hero (or its graceful fallback) is
// caught by `npm test`.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gameIconSrc } from '../../visual/visualAssets';
import { GAME_TYPES } from '../../games/catalog';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('gameIconSrc helper (single source)', () => {
  it('maps every game to its /visual/icons emblem path', () => {
    for (const g of GAME_TYPES) {
      expect(gameIconSrc(g)).toBe(`/visual/icons/game-${g}.png`);
    }
  });

  it('every game emblem PNG exists on disk and is a real, non-empty PNG', () => {
    for (const g of GAME_TYPES) {
      const path = join(process.cwd(), 'public', 'visual', 'icons', `game-${g}.png`);
      expect(existsSync(path), `game-${g}.png should exist`).toBe(true);
      expect(statSync(path).size, `game-${g}.png non-empty`).toBeGreaterThan(0);
      expect(readFileSync(path).subarray(0, 8).equals(PNG_SIG), `game-${g}.png is a PNG`).toBe(true);
    }
  });
});

describe('GameIcon renders the emblem with an emoji fallback', () => {
  const gi = read('src/ui/components/GameIcon.tsx');
  it('uses gameIconSrc for the <img> and swaps to emoji on load error', () => {
    expect(gi).toContain('gameIconSrc(game)');
    expect(gi).toContain('onError={() => setFailed(true)}');
    expect(gi).toContain('GAME_EMOJI');
    expect(gi).toContain('game-icon--emoji');
  });
});

describe('SelectMenu supports an image emblem with a glyph fallback', () => {
  const sm = read('src/ui/components/SelectMenu.tsx');
  it('has an iconSrc option and a MenuIcon that falls back on error', () => {
    expect(sm).toContain('iconSrc?: string');
    expect(sm).toContain('function MenuIcon');
    expect(sm).toContain('onError={() => setFailed(true)}');
    expect(sm).toContain('select-menu__icon-img');
  });
});

describe('StartMenu wires game emblems into the picker, browser and filters', () => {
  const st = read('src/ui/StartMenu.tsx');
  it('imports the helper + component and uses them (no bare emoji icons)', () => {
    expect(st).toContain("import GameIcon from './components/GameIcon'");
    expect(st).toContain('gameIconSrc');
    expect(st).toContain('iconSrc: gameIconSrc(id)');   // game picker
    expect(st).toMatch(/<GameIcon game=\{gameType\}/);   // room browser game column
    expect(st).toMatch(/<GameIcon game=\{g\}/);          // room filter chips
  });
});

describe('Lobby shows the game emblem', () => {
  const lb = read('src/ui/online/Lobby.tsx');
  it('imports + renders GameIcon for the room game type', () => {
    expect(lb).toContain("import GameIcon from '../components/GameIcon'");
    expect(lb).toMatch(/<GameIcon game=\{gameType\}/);
  });
});

describe('CSS wires the menu hero + game-icon coin (with fallbacks)', () => {
  const lobby = read('src/styles/lobby.css');
  const select = read('src/styles/select-menu.css');

  it('menu-screen paints a responsive hero (portrait + wide) behind the UI', () => {
    expect(lobby).toContain("menu-hero-portrait.png");
    expect(lobby).toContain("menu-hero-wide.png");
    expect(lobby).toContain('.menu-screen::before');
    expect(lobby).toContain('var(--menu-hero)');
    // The felt gradient stays as the base/fallback layer under the hero.
    expect(lobby).toMatch(/\.menu-screen\s*\{[^}]*var\(--felt-mid\)/s);
  });

  it('defines the .game-icon coin frame + emoji fallback', () => {
    expect(lobby).toContain('.game-icon');
    expect(lobby).toContain('.game-icon--emoji');
    expect(select).toContain('.select-menu__icon-img');
  });
});
