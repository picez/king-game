// Source-level guards for the Stage 12.2 art integration (card back + felt
// texture). No jsdom: assert the wiring in the component + CSS so a regression
// that drops the back image / felt tile (or its graceful fallback) is caught.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('CardView renders the ornamental back for hidden cards', () => {
  const cv = read('src/ui/components/CardView.tsx');
  it('detects a redacted "?" card and shows the back image via CARD_BACK_URL', () => {
    expect(cv).toMatch(/card\.rank[^=]*===\s*'\?'/); // isHidden check (tolerates a cast)
    expect(cv).toContain('CARD_BACK_URL');
    expect(cv).toContain('className="card__back"');
    expect(cv).toContain("' card--back'");
  });
  it('falls back gracefully if the back image 404s (onError → CSS back)', () => {
    expect(cv).toContain('setBackFailed(true)');
    expect(cv).toContain('showBack');
    // A hidden card gets a proper accessible label (not "? of spades").
    expect(cv).toContain("t('card.hidden')");
  });
});

describe('CSS wires the card back + felt texture (with fallbacks)', () => {
  const base = read('src/styles/base.css');
  const game = read('src/styles/game.css');
  const table = read('src/styles/table.css');
  const durak = read('src/styles/durak.css');
  const tarneeb = read('src/styles/tarneeb.css');
  const screens = read('src/styles/screens.css');

  it('base.css defines single-source --felt-tile and --card-back vars', () => {
    expect(base).toContain("--felt-tile:    url('/visual/felt-tile.png')");
    expect(base).toContain("--card-back:    url('/cards/back/back-green.png')");
  });

  it('game.css styles .card__back over a CSS fallback and hides the text layer', () => {
    expect(game).toContain('.card__back');
    expect(game).toContain('.card--back');
    expect(game).toMatch(/\.card--back \.card__corner/);
  });

  it('the felt tile is layered onto every game table felt (soft-light, gradients kept)', () => {
    for (const [name, css] of [['table', table], ['durak', durak], ['tarneeb', tarneeb]] as const) {
      expect(css.includes('var(--felt-tile)'), `${name}.css uses --felt-tile`).toBe(true);
      expect(css.includes('background-blend-mode'), `${name}.css blends the tile`).toBe(true);
      expect(css.includes('var(--felt-lit)'), `${name}.css keeps the felt gradient`).toBe(true);
    }
  });

  it('deck backs + King opponent fan use the card back over a CSS fallback', () => {
    // Durak/Deberc share .durak-deck__back; King fan uses .ai-card-back.
    expect(durak).toMatch(/\.durak-deck__back[^}]*var\(--card-back\)/s);
    expect(durak).toMatch(/\.durak-deck__back[^}]*linear-gradient/s); // fallback kept
    expect(screens).toMatch(/\.ai-card-back[^}]*var\(--card-back\)/s);
    expect(screens).toMatch(/\.ai-card-back[^}]*linear-gradient/s);   // fallback kept
  });
});
