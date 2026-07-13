import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCelebratoryKind, type CelebrationKind } from './WinnerCelebration';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('WinnerCelebration — celebratory kinds (Stage 13.7)', () => {
  it('celebrates ONLY an outright win / team win', () => {
    expect(isCelebratoryKind('win')).toBe(true);
    expect(isCelebratoryKind('teamWin')).toBe(true);
  });

  it('a draw / fool / loss is a calm state (no winner effect)', () => {
    for (const k of ['draw', 'fool', 'loss'] as CelebrationKind[]) {
      expect(isCelebratoryKind(k)).toBe(false);
    }
  });

  it('the component renders nothing for a non-winner kind (source guard)', () => {
    const src = read('src/ui/components/WinnerCelebration.tsx');
    expect(src).toContain('isCelebratoryKind(kind)');
    expect(src).toContain('return null');          // draw/fool/loss → no effect layer
    expect(src).toContain('aria-hidden="true"');    // decorative only, hidden from AT
  });
});

describe('WinnerCelebration CSS respects motion + never blocks clicks', () => {
  const css = read('src/styles/winner.css');

  it('every decorative layer is pointer-events:none (buttons stay clickable)', () => {
    expect(css).toContain('pointer-events: none');
  });

  it('has NO infinite animation (a one-shot intro that settles)', () => {
    // No `infinite` in any animation shorthand or iteration-count declaration.
    expect(css).not.toMatch(/animation[^;{]*:[^;]*infinite/);
    expect(css).not.toMatch(/iteration-count[^;]*infinite/);
  });

  it('honours the animation store (reduced + off) and the OS safety net', () => {
    expect(css).toContain('[data-motion-effective="reduced"]');
    expect(css).toContain('[data-motion-effective="off"]');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    // Off keeps the final decorative state visible (no animation, opacity held).
    const off = css.slice(css.indexOf('[data-motion-effective="off"]'));
    expect(off).toContain('animation: none !important');
  });

  it('is imported into the app stylesheet', () => {
    expect(read('src/App.css')).toContain("@import './styles/winner.css'");
  });
});

describe('all four finished screens render the celebration', () => {
  const screens: [string, string][] = [
    ['src/ui/GameFinishedScreen.tsx', "kind={winners.length === 1 ? 'win' : 'draw'}"],
    ['src/ui/durak/DurakFinished.tsx', "humanIsFool ? 'fool' : 'win'"],
    ['src/ui/deberc/DebercFinished.tsx', "won ? (state.teamCount === 2 ? 'teamWin' : 'win') : 'loss'"],
    ['src/ui/tarneeb/TarneebFinished.tsx', "humanWon ? 'teamWin' : 'loss'"],
  ];

  it('imports + renders <WinnerCelebration> with a kind derived from state', () => {
    for (const [file, kindExpr] of screens) {
      const src = read(file);
      expect(src, file).toMatch(/import WinnerCelebration from '\.[./]*components\/WinnerCelebration'/);
      expect(src, file).toContain('<WinnerCelebration');
      expect(src, file).toContain(kindExpr);
    }
  });
});
