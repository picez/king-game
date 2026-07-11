import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GAME_HELP, REQUIRED_HELP_SECTIONS, gameHelp, helpLabelKey, helpContentKey, allHelpContentKeys,
  type HelpSection,
} from './gameHelp';
import { GAME_TYPES } from './catalog';
import { EN } from '../i18n/dictionaries/en';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const ALL_SECTIONS: HelpSection[] = ['goal', 'players', 'deck', 'turns', 'scoring', 'notes'];

describe('game help catalog', () => {
  it('has one entry per game, covering at least the required sections', () => {
    for (const id of GAME_TYPES) {
      const entry = GAME_HELP[id];
      expect(entry.id).toBe(id);
      for (const s of REQUIRED_HELP_SECTIONS) expect(entry.sections).toContain(s);
      expect(gameHelp(id)).toBe(entry);
    }
  });

  it('builds label + content keys in the documented shape', () => {
    expect(helpLabelKey('goal')).toBe('help.label.goal');
    expect(helpContentKey('king', 'scoring')).toBe('help.king.scoring');
    // Every content key across the catalog is unique.
    const keys = allHelpContentKeys();
    expect(new Set(keys).size).toBe(keys.length);
    // 5 games × 6 sections today.
    expect(keys.length).toBe(GAME_TYPES.length * ALL_SECTIONS.length);
  });
});

describe('i18n parity — every help key is present + non-blank in all 4 languages', () => {
  const dicts = ['en', 'uk', 'de', 'ar'].map((l) => ({ lang: l, src: read(join('src/i18n/dictionaries', `${l}.ts`)) }));
  const labelKeys = ALL_SECTIONS.map(helpLabelKey);
  const chromeKeys = ['help.howToPlay', 'help.gotIt'];
  const keys = [...chromeKeys, ...labelKeys, ...allHelpContentKeys()];

  for (const key of keys) {
    it(`${key} exists everywhere`, () => {
      expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
      for (const { lang, src } of dicts) {
        expect(src.includes(`'${key}'`), `${lang} missing ${key}`).toBe(true);
      }
    });
  }
});
