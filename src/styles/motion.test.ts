// Source guards for the Stage 12.5 table-motion system. Pure CSS/string checks
// (no jsdom): assert the shared keyframes exist, are wired to the right class
// hooks in every game, that hands use card-stable keys (so deal-in fires only on
// a real deal, never on every play), and that every animation is stilled under
// prefers-reduced-motion.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('motion.css — shared table-motion layer', () => {
  const css = read('src/styles/motion.css');

  it('defines the four namespaced keyframes', () => {
    for (const kf of ['card-deal-in', 'card-table-settle', 'seat-active-glow', 'panel-reveal']) {
      expect(css.includes(`@keyframes ${kf}`), kf).toBe(true);
    }
  });

  it('deals hand cards in across all three hand containers (transform/opacity only)', () => {
    expect(css).toContain('.player-hand, .durak-hand, .tarneeb-hand');
    expect(css).toContain('animation: card-deal-in');
    // No layout-animating props in the keyframe.
    const dealKf = css.slice(css.indexOf('@keyframes card-deal-in'), css.indexOf('@keyframes card-table-settle'));
    expect(dealKf).not.toMatch(/\b(width|height|top|left|right|bottom)\s*:/);
  });

  it('settles played cards on the inner .card of each game’s trick slot', () => {
    expect(css).toContain('.trick-slot > .card');
    expect(css).toContain('.tarneeb-play > .card');
    expect(css).toContain('.durak-pair > .card');
    expect(css).toContain('animation: card-table-settle');
  });

  it('pulses the active seat consistently for Durak/Deberc/Tarneeb', () => {
    expect(css).toContain('.durak-seat--acting');
    expect(css).toContain('.tarneeb-seat--acting');
    expect(css).toContain('animation: seat-active-glow');
  });

  it('reveals bid/trump/status panels on appear', () => {
    expect(css).toContain('animation: panel-reveal');
    expect(css).toContain('.tarneeb-seat__bid');
    expect(css).toContain('.tarneeb-trumpbar');
  });

  it('stills every table animation under prefers-reduced-motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toContain('animation: none !important');
    // No infinite pulse survives: the acting-seat glow must be inside the guard.
    expect(rm).toContain('.durak-seat--acting');
    expect(rm).toContain('.tarneeb-seat--acting');
  });
});

describe('motion.css — animation-intensity preference (Stage 13.2)', () => {
  const css = read('src/styles/motion.css');

  it('keys motion off the resolved data-motion-effective attribute (off + reduced)', () => {
    expect(css).toContain('[data-motion-effective="off"]');
    expect(css).toContain('[data-motion-effective="reduced"]');
  });

  it('keeps the prefers-reduced-motion @media guard as an always-on safety net', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('off stills decorative motion AND neutralises transitions (nothing hidden)', () => {
    const off = css.slice(css.indexOf('[data-motion-effective="off"]'));
    expect(off).toContain('animation: none !important');
    expect(off).toContain('transition: none !important');
  });

  it('keeps the reaction chip visible + self-removing under reduced/off (opacity fade)', () => {
    // A time-based auto-dismiss must not be zeroed away, or the chip would vanish.
    expect(css).toContain('sticker-fade 2.6s linear forwards !important');
  });
});

describe('social.css — sticker pop', () => {
  const css = read('src/styles/social.css');
  it('uses a sticker-pop entrance with a reduced-motion fade fallback', () => {
    expect(css).toContain('@keyframes sticker-pop');
    expect(css).toContain('animation: sticker-pop');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('sticker-fade'); // opacity-only fallback
  });
});

describe('game.css — card interaction polish', () => {
  const css = read('src/styles/game.css');
  it('transitions opacity/filter so illegal cards dim smoothly + adds a press state', () => {
    expect(css).toMatch(/transition:[^;]*opacity[^;]*filter/);
    expect(css).toMatch(/\.card[^{]*:active[^{]*\{\s*transform: scale/);
  });
});

describe('motion is imported + hands use card-stable keys', () => {
  it('App.css imports the motion layer', () => {
    expect(read('src/App.css')).toContain("@import './styles/motion.css'");
  });

  it('hand keys are index-free (a stable card id) so a reorder/play never remounts', () => {
    // The shared draggable tray keys each slot by the caller's stable card id, and
    // the single-deck id is `${suit}-${rank}` (index-free) — so React never remounts
    // a card on a reorder or a play (which would replay the deal-in animation).
    const tray = read('src/ui/components/HandReorderTray.tsx');
    expect(tray).toContain('const id = cardId(c);');
    expect(tray).toContain('key={id}');
    expect(read('src/hooks/useManualHandOrder.ts')).toContain('return `${c.suit}-${c.rank}`;');
    // Every game feeds the tray a stable id fn (never an array index).
    for (const f of [
      'src/ui/components/PlayerHand.tsx',
      'src/ui/durak/DurakGameScreen.tsx',
      'src/ui/deberc/DebercGameScreen.tsx',
      'src/ui/tarneeb/TarneebGameScreen.tsx',
      'src/ui/preferans/PreferansGameScreen.tsx',
    ]) {
      expect(read(f), f).toContain('cardId={singleDeckCardId}');
    }
    expect(read('src/ui/fiftyOne/FiftyOneGameScreen.tsx')).toContain('cardId={fiftyOneCardId}');
  });
});
