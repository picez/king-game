// I18N-5: guard that every language dictionary has EXACTLY the English key set —
// no missing keys (which would silently fall back to English) and no orphan keys.
// Also flags blank values. Catches future additions that forget a language.
import { describe, it, expect } from 'vitest';
import { EN } from './dictionaries/en';
import { UK } from './dictionaries/uk';
import { DE } from './dictionaries/de';
import { AR } from './dictionaries/ar';

const LANGS = { uk: UK, de: DE, ar: AR } as const;
const enKeys = new Set(Object.keys(EN));

describe('i18n dictionary key parity', () => {
  for (const [code, dict] of Object.entries(LANGS)) {
    const keys = new Set(Object.keys(dict));

    it(`${code}: has no keys missing vs English`, () => {
      const missing = [...enKeys].filter((k) => !keys.has(k));
      expect(missing, `${code} missing: ${missing.join(', ')}`).toEqual([]);
    });

    it(`${code}: has no keys English lacks`, () => {
      const extra = [...keys].filter((k) => !enKeys.has(k));
      expect(extra, `${code} extra: ${extra.join(', ')}`).toEqual([]);
    });

    it(`${code}: has no blank values`, () => {
      const blank = Object.entries(dict).filter(([, v]) => v.trim() === '').map(([k]) => k);
      expect(blank, `${code} blank: ${blank.join(', ')}`).toEqual([]);
    });
  }

  it('English itself has no blank values', () => {
    const blank = Object.entries(EN).filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(blank).toEqual([]);
  });

  it('placeholder keys keep their {n}/{rank}/{suit} token in every language', () => {
    // A translated template that drops the token would break interpolation.
    const templates: Record<string, string> = {
      'setup.playersCount': '{n}', 'setup.playerN': '{n}',
      'card.label': '{rank}',
    };
    for (const [code, dict] of Object.entries(LANGS)) {
      for (const [key, token] of Object.entries(templates)) {
        expect(dict[key]?.includes(token), `${code}:${key} lost ${token}`).toBe(true);
      }
    }
    // card.label must carry both tokens.
    for (const dict of Object.values(LANGS)) {
      expect(dict['card.label']).toContain('{suit}');
    }
  });
});
