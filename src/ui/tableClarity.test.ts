// Source guards for the Stage 27.0 table-clarity + Deberc UI pass: a lead-card badge on every
// trick game, the Deberc skip-meld button reads as destructive (red), Deberc table cards are
// enlarged, and the "Platina" meld is displayed as "Paltina/Палтіна" in all four languages.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('lead-card highlight (Stage 27.0)', () => {
  it('CardView supports a `lead` prop that adds the card--lead class', () => {
    const cv = read('src/ui/components/CardView.tsx');
    expect(cv).toMatch(/lead\?: boolean/);
    expect(cv).toMatch(/lead \? ' card--lead' : ''/);
  });
  it('the CSS marks the lead card distinctly (a badge + ring)', () => {
    const css = read('src/styles/game.css');
    expect(css).toContain('.card--lead');
    expect(css).toContain(".card--lead::after");
  });
  it('every trick game screen flags the lead card of the current trick', () => {
    for (const f of ['src/ui/tarneeb/TarneebGameScreen.tsx', 'src/ui/preferans/PreferansGameScreen.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/const lead = play\.seat === trick\.leadSeat/);
      expect(src, f).toMatch(/lead=\{lead\}/);
    }
    expect(read('src/ui/deberc/DebercGameScreen.tsx')).toMatch(/lead=\{i === 0\}/);
  });
});

describe('Deberc UI corrections (Stage 27.0)', () => {
  const screen = read('src/ui/deberc/DebercGameScreen.tsx');
  const css = read('src/styles/deberc.css');
  it('the skip-meld button is destructive/red (btn--danger)', () => {
    expect(screen).toMatch(/btn--danger deberc-skip-meld[\s\S]*?DECLARE_MELD', melds: \[\]/);
  });
  it('table cards are sized for readability without dwarfing the trump (Stage 29.0: ×1.15)', () => {
    expect(css).toMatch(/\.deberc-screen \.durak-table__cards \.card--table[\s\S]*?1\.15/);
  });
  it('the trump + stock deck is enlarged ~20% (Stage 29.0: scale 1.02, was 0.85)', () => {
    expect(css).toMatch(/\.deberc-screen \.durak-deck \{[^}]*transform: scale\(1\.02\)/);
  });
});

describe('Deberc "Paltina" rename (Stage 27.0) — display only, key unchanged', () => {
  it('all four languages render the Paltina/Палтіна form (never the old spelling)', () => {
    const forms: Record<string, string> = { en: 'Paltina', de: 'Paltina', uk: 'Палтіна', ar: 'بالتينا' };
    for (const [lang, form] of Object.entries(forms)) {
      const dict = read(`src/i18n/dictionaries/${lang}.ts`);
      expect(dict, lang).toMatch(new RegExp(`'deberc.meldPlatina':\\s*'${form}'`));
      // No user-facing OLD spelling survives in a VALUE (strip keys, which legitimately contain
      // "meldPlatina"). Checks the text between the value's quotes only.
      const values = (dict.match(/:\s*'[^']*'/g) ?? []).join(' ');
      expect(values, lang).not.toMatch(/[Pp]latina|платіна/);
    }
    // The internal enum key stays `platina` (no risky data rename).
    expect(read('src/ui/deberc/DebercGameScreen.tsx')).toContain("kind === 'platina'");
  });
});
