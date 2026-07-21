// ---------------------------------------------------------------------------
// Tutorial framework data guards (Stage 31.1, extended 31.2). Verifies the catalog
// shape (all 6 enabled), each script's step count + ≤120 s budget, key integrity,
// scene id uniqueness, no-duplicate step ids, highlight-target integrity, i18n
// coverage, the "Палтіна" spelling, the Preferans "no unsupported variants as
// playable" rule, and purity (no engine/net/server imports). No rendering.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_TYPES } from '../games/catalog';
import {
  TUTORIALS, getTutorial, isTutorialEnabled, tutorialTotalSeconds, allTutorialContentKeys, TUTORIAL_ORDER,
} from './catalog';
import type { TutorialScene } from './types';
import { EN } from '../i18n/dictionaries/en';
import { UK } from '../i18n/dictionaries/uk';
import { DE } from '../i18n/dictionaries/de';
import { AR } from '../i18n/dictionaries/ar';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const EXPECTED_STEPS: Record<string, number> = {
  king: 6, durak: 6, deberc: 7, tarneeb: 6, preferans: 6, 'fifty-one': 7, poker: 7,
};

describe('tutorial catalog', () => {
  it('has exactly one entry per GameType (6), in catalog order', () => {
    expect(Object.keys(TUTORIALS).sort()).toEqual([...GAME_TYPES].sort());
    expect(TUTORIAL_ORDER).toEqual(GAME_TYPES);
  });

  it('enables ALL SIX games (no "coming next" placeholders remain)', () => {
    for (const id of GAME_TYPES) {
      expect(isTutorialEnabled(id), id).toBe(true);
      expect(getTutorial(id).steps.length, `${id} steps`).toBeGreaterThan(0);
    }
  });

  it('every tutorial has 5–8 steps and fits the ≤120 s budget', () => {
    for (const id of GAME_TYPES) {
      const tut = getTutorial(id);
      expect(tut.steps.length, `${id} steps`).toBeGreaterThanOrEqual(5);
      expect(tut.steps.length, `${id} steps`).toBeLessThanOrEqual(8);
      expect(tut.steps.length, `${id} exact`).toBe(EXPECTED_STEPS[id]);
      expect(tutorialTotalSeconds(id), `${id} duration`).toBeLessThanOrEqual(120);
    }
  });
});

/** Every element id a scene exposes for highlighting/keys. */
function sceneCardIds(scene: TutorialScene): string[] {
  const ids: string[] = [];
  scene.hand?.forEach((c) => ids.push(c.id));
  if (scene.discardTop) ids.push(scene.discardTop.id);
  scene.melds?.forEach((m) => m.cards.forEach((c) => ids.push(c.id)));
  scene.pairs?.forEach((p) => { ids.push(p.attack.id); if (p.defense) ids.push(p.defense.id); });
  scene.trick?.forEach((t) => ids.push(t.card.id));
  return ids;
}
function sceneTargetIds(scene: TutorialScene): Set<string> {
  const ids = new Set(sceneCardIds(scene));
  scene.melds?.forEach((m) => ids.add(m.id));
  scene.pairs?.forEach((p) => ids.add(p.id));
  scene.trick?.forEach((t) => ids.add(t.id));
  scene.seats?.forEach((s) => ids.add(s.id));
  scene.chips?.forEach((ch) => ids.add(ch.id));
  if (scene.trump) ids.add('zone.trump');
  if (scene.discardTop) ids.add('zone.discard');
  if (typeof scene.drawCount === 'number') ids.add('zone.draw');
  return ids;
}

describe('tutorial step integrity', () => {
  for (const id of GAME_TYPES) {
    const tut = getTutorial(id);
    it(`${id}: each step has title/body keys and a valid scene layout`, () => {
      for (const step of tut.steps) {
        expect(step.titleKey, `${id}/${step.id} title`).toBeTruthy();
        expect(step.bodyKey, `${id}/${step.id} body`).toBeTruthy();
        expect(['trick', 'meld', 'hand-only']).toContain(step.scene.layout);
      }
    });

    it(`${id}: step ids are unique`, () => {
      const stepIds = tut.steps.map((s) => s.id);
      expect(new Set(stepIds).size, `${id}`).toBe(stepIds.length);
    });

    it(`${id}: card ids are unique within a step (safe React keys)`, () => {
      for (const step of tut.steps) {
        const cardIds = sceneCardIds(step.scene);
        expect(new Set(cardIds).size, `${id}/${step.id}`).toBe(cardIds.length);
      }
    });

    it(`${id}: every highlight targets an element present in its scene`, () => {
      for (const step of tut.steps) {
        const targets = sceneTargetIds(step.scene);
        for (const h of step.highlight ?? []) {
          expect(targets.has(h.targetId), `${id}/${step.id} → ${h.targetId}`).toBe(true);
        }
      }
    });
  }
});

describe('tutorial i18n', () => {
  it('every referenced content key exists in all four languages', () => {
    const keys = allTutorialContentKeys();
    for (const [lang, dict] of [['en', EN], ['uk', UK], ['de', DE], ['ar', AR]] as const) {
      const missing = keys.filter((k) => !(k in dict));
      expect(missing, `${lang} missing: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('menu + hub/player control keys exist', () => {
    for (const k of [
      'menu.tutorialsTitle', 'menu.tutorialsSub', 'tutorials.title', 'tutorials.subtitle',
      'tutorials.start', 'tutorials.comingNext', 'tutorials.duration', 'tutorials.stepProgress',
      'tutorials.next', 'tutorials.back', 'tutorials.done', 'tutorials.skip',
    ]) {
      expect(k in EN, k).toBe(true);
    }
  });

  it('Deberc uses "Палтіна" (never the old "Платіна") in every language', () => {
    for (const [lang, dict] of [['en', EN], ['uk', UK], ['de', DE], ['ar', AR]] as const) {
      for (const [key, val] of Object.entries(dict)) {
        if (key.startsWith('tutorial.')) {
          expect(val.includes('Платіна'), `${lang}:${key}`).toBe(false);
        }
      }
    }
    // The Cyrillic form is actually present where the concept is taught.
    expect(UK['tutorial.deberc.length.body']).toContain('Палтіна');
    expect(EN['tutorial.deberc.length.title']).toContain('Палтіна');
  });

  it('Preferans never presents unsupported variants as playable', () => {
    for (const [lang, dict] of [['en', EN], ['uk', UK], ['de', DE], ['ar', AR]] as const) {
      for (const [key, val] of Object.entries(dict)) {
        if (!key.startsWith('tutorial.preferans.')) continue;
        // Any mention of a classic variant must be negated ("not in the app yet" / "немає" / "noch nicht" / "ليست").
        const mentionsVariant = /mis[eè]re|misère|мізер|Misère|ميزير/i.test(val);
        if (mentionsVariant) {
          const negated = /not in the app yet|поки немає|noch nicht in der App|ليست في التطبيق بعد/.test(val);
          expect(negated, `${lang}:${key} mentions a variant without a "not yet" qualifier`).toBe(true);
        }
      }
    }
  });
});

describe('tutorial purity (no engine/net/server; scripted only)', () => {
  const files = [
    'src/tutorials/types.ts', 'src/tutorials/catalog.ts',
    'src/tutorials/fiftyOneTutorial.ts', 'src/tutorials/durakTutorial.ts',
    'src/tutorials/kingTutorial.ts', 'src/tutorials/debercTutorial.ts',
    'src/tutorials/tarneebTutorial.ts', 'src/tutorials/preferansTutorial.ts',
    'src/tutorials/pokerTutorial.ts',
  ];
  for (const f of files) {
    it(`${f} imports no server/db/net/ws and runs no reducer`, () => {
      const src = read(f);
      const importLines = src.split('\n').filter((l) => l.trimStart().startsWith('import'));
      for (const line of importLines) {
        expect(line, `${f}: ${line}`).not.toMatch(/\/(net|server|db)\/|\bws\b|Reducer|serverCore|wsHandlers/i);
      }
      expect(src).not.toMatch(/Math\.random|Reducer\(/);
    });
  }
});
