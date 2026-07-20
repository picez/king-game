// ---------------------------------------------------------------------------
// Tutorial framework data guards (Stage 31.1). Verifies the catalog shape, the
// 51/Durak scripts, the ≤120 s budget, key integrity, scene id uniqueness, i18n
// coverage, and purity (no engine/net/server imports). No rendering.
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

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const ENABLED = ['fifty-one', 'durak'] as const;

describe('tutorial catalog', () => {
  it('has exactly one entry per GameType (6)', () => {
    expect(Object.keys(TUTORIALS).sort()).toEqual([...GAME_TYPES].sort());
    expect(TUTORIAL_ORDER).toEqual(GAME_TYPES);
  });

  it('enables 51 + Durak; the other four are disabled placeholders with no steps', () => {
    for (const id of GAME_TYPES) {
      const enabled = (ENABLED as readonly string[]).includes(id);
      expect(isTutorialEnabled(id), id).toBe(enabled);
      if (!enabled) expect(getTutorial(id).steps, `${id} placeholder`).toHaveLength(0);
    }
  });

  it('every enabled tutorial has steps and fits the ≤120 s budget', () => {
    for (const id of ENABLED) {
      const tut = getTutorial(id);
      expect(tut.steps.length, `${id} steps`).toBeGreaterThan(0);
      expect(tutorialTotalSeconds(id), `${id} duration`).toBeLessThanOrEqual(120);
    }
    // The owner's step counts: 51 = 7, Durak = 6.
    expect(getTutorial('fifty-one').steps).toHaveLength(7);
    expect(getTutorial('durak').steps).toHaveLength(6);
  });
});

/** Every element id a scene exposes for highlighting/keys. */
function sceneCardIds(scene: TutorialScene): string[] {
  const ids: string[] = [];
  scene.hand?.forEach((c) => ids.push(c.id));
  if (scene.discardTop) ids.push(scene.discardTop.id);
  scene.melds?.forEach((m) => m.cards.forEach((c) => ids.push(c.id)));
  scene.pairs?.forEach((p) => { ids.push(p.attack.id); if (p.defense) ids.push(p.defense.id); });
  return ids;
}
function sceneTargetIds(scene: TutorialScene): Set<string> {
  const ids = new Set(sceneCardIds(scene));
  scene.melds?.forEach((m) => ids.add(m.id));
  scene.pairs?.forEach((p) => ids.add(p.id));
  scene.seats?.forEach((s) => ids.add(s.id));
  scene.chips?.forEach((ch) => ids.add(ch.id));
  if (scene.trump) ids.add('zone.trump');
  if (scene.discardTop) ids.add('zone.discard');
  if (typeof scene.drawCount === 'number') ids.add('zone.draw');
  return ids;
}

describe('tutorial step integrity', () => {
  for (const id of ENABLED) {
    const tut = getTutorial(id);
    it(`${id}: each step has title/body keys and a valid scene layout`, () => {
      for (const step of tut.steps) {
        expect(step.titleKey, `${id}/${step.id} title`).toBeTruthy();
        expect(step.bodyKey, `${id}/${step.id} body`).toBeTruthy();
        expect(['trick', 'meld', 'hand-only']).toContain(step.scene.layout);
      }
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
  it('every referenced content key exists in English (parity test covers the other 3 langs)', () => {
    const missing = allTutorialContentKeys().filter((k) => !(k in EN));
    expect(missing, `missing: ${missing.join(', ')}`).toEqual([]);
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
});

describe('tutorial purity (no engine/net/server; scripted only)', () => {
  const files = [
    'src/tutorials/types.ts', 'src/tutorials/catalog.ts',
    'src/tutorials/fiftyOneTutorial.ts', 'src/tutorials/durakTutorial.ts',
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
