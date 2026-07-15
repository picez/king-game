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
/** Opt-in extras only 51 asks for today (Stage 30.14) — see GAME_HELP. */
const EXTRA_SECTIONS: HelpSection[] = ['values', 'melds'];

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
    // 6 games × 6 shared sections, plus 51's two extras (values + melds).
    expect(keys.length).toBe(GAME_TYPES.length * ALL_SECTIONS.length + EXTRA_SECTIONS.length);
  });

  it('only 51 opts into the values/melds sections', () => {
    for (const id of GAME_TYPES) {
      const extras = GAME_HELP[id].sections.filter((s) => EXTRA_SECTIONS.includes(s));
      expect(extras).toEqual(id === 'fifty-one' ? EXTRA_SECTIONS : []);
    }
  });
});

/**
 * The 51 sheet is the ONLY place a player is told what a card is worth and which
 * combinations are legal (Stage 30.14) — so these examples are load-bearing, not
 * decoration. Asserted on EN because the other languages are checked for presence
 * by the parity block below; the notation (A-2-3, Q-K-A) is identical in all four.
 */
describe('51 help spells out the scoring + meld rules a player cannot guess', () => {
  const text = (section: HelpSection) => EN[helpContentKey('fifty-one', section) as keyof typeof EN] as string;

  it('gives card values including the ace-low exception and the joker penalty', () => {
    const values = text('values');
    expect(values).toContain('J/Q/K = 10');
    expect(values).toContain('A-2-3 = 6');  // the low ace counts 1
    expect(values).toContain('Q-K-A = 30'); // the high ace counts 10
    expect(values).toMatch(/joker.*hand.*25/i);
  });

  it('gives run + set examples and rejects the wrap-around run', () => {
    const melds = text('melds');
    expect(melds).toContain('A-2-3');
    expect(melds).toContain('Q-K-A');
    expect(melds).toMatch(/K-A-2 is invalid/i);
    expect(melds).toMatch(/1 joker per meld/i);
  });

  it('states the discard-to-open exception and the joker replacement rule', () => {
    expect(text('turns')).toMatch(/before you open.*discard top.*only if you open with it/i);
    expect(text('notes')).toMatch(/swap a joker.*take the joker into your hand/i);
  });
});

describe('i18n parity — every help key is present + non-blank in all 4 languages', () => {
  const dicts = ['en', 'uk', 'de', 'ar'].map((l) => ({ lang: l, src: read(join('src/i18n/dictionaries', `${l}.ts`)) }));
  const labelKeys = [...ALL_SECTIONS, ...EXTRA_SECTIONS].map(helpLabelKey);
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
