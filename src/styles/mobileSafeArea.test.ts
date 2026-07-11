// Source guards for the Stage 23.0 mobile / installed-PWA polish. Pure CSS/string
// checks (no jsdom): assert the reusable safe-area variables exist, that the mobile
// viewport opts into cover, that touch-critical controls meet the 44px tap floor,
// and that every FIXED bottom control clears the home-indicator safe area (so nothing
// sits under it). These are consistency locks, not layout tests.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('safe-area foundation (base.css + index.html)', () => {
  const base = read('src/styles/base.css');
  const html = read('index.html');

  it('the viewport opts into cover so env(safe-area-inset-*) is non-zero on notched devices', () => {
    expect(html).toContain('viewport-fit=cover');
  });

  it('defines reusable --safe-top/right/bottom/left aliases with a 0px desktop fallback', () => {
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(base, `--safe-${side}`).toMatch(
        new RegExp(`--safe-${side}:\\s*env\\(safe-area-inset-${side},\\s*0px\\)`),
      );
    }
  });

  it('defines the 44px comfortable tap target', () => {
    expect(base).toMatch(/--tap-min:\s*44px/);
  });

  it('the app-root .screen pads for all four insets (never less than the base gutter)', () => {
    const screen = base.slice(base.indexOf('.screen {'), base.indexOf('.screen {') + 400);
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(screen, side).toContain(`env(safe-area-inset-${side})`);
    }
  });
});

describe('installed / standalone tweaks', () => {
  const base = read('src/styles/base.css');
  it('keys installed-only tweaks off <html data-standalone="true"> (unset in a browser tab)', () => {
    expect(base).toContain('[data-standalone="true"]');
    // The top strips get a small floor so they clear the status bar when inset is 0.
    expect(base).toMatch(/\[data-standalone="true"\]\s*\.pwa-strips/);
  });
});

describe('touch tap targets meet the 44px floor', () => {
  const pwa = read('src/styles/pwa.css');
  const social = read('src/styles/social.css');

  it('PWA install/update action buttons use var(--tap-min)', () => {
    expect(pwa).toMatch(/\.pwa-install__cta\s*\{[^}]*min-height:\s*var\(--tap-min\)/);
    expect(pwa).toMatch(/\.pwa-banner__action\s*\{[^}]*min-height:\s*var\(--tap-min\)/);
  });
  it('the install dismiss (✕) has a full 44px hit area', () => {
    const x = pwa.slice(pwa.indexOf('.pwa-install__x'), pwa.indexOf('.pwa-install__x') + 260);
    expect(x).toContain('min-width: var(--tap-min)');
    expect(x).toContain('min-height: var(--tap-min)');
  });
  it('the online "Leave game" pill uses the tap floor (no sub-44px min-height)', () => {
    expect(social).toMatch(/\.social-leave\s*\{[\s\S]*?min-height:\s*var\(--tap-min\)/);
  });
});

describe('no fixed BOTTOM control sits under the home indicator', () => {
  // Every fixed element anchored to the bottom must add env(safe-area-inset-bottom)
  // to its offset so the home indicator never overlaps it.
  const cases: Array<[string, RegExp[]]> = [
    ['src/styles/pwa.css', [/\.pwa-install\b[\s\S]*?bottom:\s*calc\([^)]*env\(safe-area-inset-bottom/]],
    ['src/styles/social.css', [
      /\.social-controls\s*\{[\s\S]*?bottom:\s*calc\([^)]*env\(safe-area-inset-bottom/,
      /\.social-controls--raised\s*\{[^}]*env\(safe-area-inset-bottom/,
    ]],
    ['src/styles/game.css', [/padding-bottom:\s*calc\([^)]*env\(safe-area-inset-bottom/]],
  ];
  for (const [file, patterns] of cases) {
    const css = read(file);
    for (const re of patterns) {
      it(`${file} — ${re.source.slice(0, 32)}…`, () => {
        expect(css).toMatch(re);
      });
    }
  }
});

describe('game tables clear the bottom safe area under the hand/actions', () => {
  for (const f of ['src/styles/durak.css', 'src/styles/preferans.css']) {
    it(`${f} pads the table for the home indicator`, () => {
      expect(read(f)).toContain('env(safe-area-inset-bottom)');
    });
  }
});
