// Guards for the Stage 14.0 product rebrand: the PRODUCT is "Card Majlis", while
// the GAME named King stays "King", and internal legacy namespaces are untouched.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from './i18n/dictionaries/en';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Card Majlis rebrand — product brand', () => {
  it('the product brand is "Card Majlis" across title / index / manifest', () => {
    expect(EN['app.title']).toBe('Card Majlis');
    const idx = read('index.html');
    expect(idx).toContain('<title>Card Majlis</title>');
    expect(idx).toContain('content="Card Majlis"');            // apple-mobile-web-app-title
    expect(idx).not.toMatch(/<title>[^<]*King[^<]*<\/title>/);  // no "King" app title
    const man = read('public/manifest.webmanifest');
    expect(man).toContain('"name": "Card Majlis"');
    expect(man).toContain('"short_name": "Card Majlis"');
    expect(man).not.toMatch(/"short_name":\s*"King"/);
  });

  it('StartMenu shows the brand + subtitle from i18n (no hardcoded old title)', () => {
    const menu = read('src/ui/StartMenu.tsx');
    expect(menu).toContain("t('app.title')");
    expect(menu).toContain("t('app.subtitle')");
    expect(menu).not.toContain('King — Card Game');
  });
});

describe('Card Majlis rebrand — the GAME King is unchanged', () => {
  it('gameType.king still reads "King" (only the product was renamed)', () => {
    expect(EN['gameType.king']).toBe('King');
    expect(EN['app.subtitle']).toContain('King'); // listed as one of the games
  });
});

describe('Card Majlis rebrand — internal namespaces kept (no migration)', () => {
  it('localStorage king.* keys are NOT mass-renamed and are documented as legacy', () => {
    const prefs = read('src/net/prefs.ts');
    expect(prefs).toContain("'king.nickname.v1'");
    expect(prefs).toContain('king.cardStyle.v1');
    expect(prefs).toMatch(/LEGACY internal namespace|legacy/i);
  });

  it('the internal package id is untouched (no repo/package rename)', () => {
    expect(read('package.json')).toContain('king-card-game');
  });
});
