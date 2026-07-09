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

  it('hand keys are index-free (suit+rank) so deal-in never replays on a play', () => {
    // King PlayerHand.
    expect(read('src/ui/components/PlayerHand.tsx')).toContain('key={`${card.suit}-${card.rank}`}');
    // Durak / Deberc / Tarneeb hands.
    // The hand render in each game uses the index-free key (other non-hand card
    // lists — e.g. deberc meld reveals — may keep an index and are not animated).
    for (const f of [
      'src/ui/durak/DurakGameScreen.tsx',
      'src/ui/deberc/DebercGameScreen.tsx',
      'src/ui/tarneeb/TarneebGameScreen.tsx',
    ]) {
      expect(read(f), f).toContain('key={`${c.rank}${c.suit}`}');
    }
  });
});
