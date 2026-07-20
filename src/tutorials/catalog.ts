// ---------------------------------------------------------------------------
// Tutorial catalog (Stage 31.1). One entry per GameType. 51 + Durak ship full
// scripted tutorials; the other four are "coming next" hub placeholders (enabled:
// false, no steps). Pure — mirrors src/games/gameHelp.ts. No engine/net imports.
// ---------------------------------------------------------------------------

import { GAME_TYPES, type GameType } from '../games/catalog';
import { DEFAULT_STEP_SECONDS, type Tutorial, type TutorialCatalog } from './types';
import { fiftyOneTutorial } from './fiftyOneTutorial';
import { durakTutorial } from './durakTutorial';

/** A disabled hub placeholder for a game whose tutorial is not authored yet. */
function comingNext(id: GameType): Tutorial {
  return { id, enabled: false, learnKey: `tutorial.${id}.learn`, steps: [] };
}

export const TUTORIALS: TutorialCatalog = {
  king: comingNext('king'),
  durak: durakTutorial,
  deberc: comingNext('deberc'),
  tarneeb: comingNext('tarneeb'),
  preferans: comingNext('preferans'),
  'fifty-one': fiftyOneTutorial,
};

/** The tutorial for a game (never null — every GameType has an entry). */
export function getTutorial(id: GameType): Tutorial {
  return TUTORIALS[id];
}

/** Whether a game has a full, playable tutorial (vs a hub placeholder). */
export function isTutorialEnabled(id: GameType): boolean {
  return TUTORIALS[id].enabled;
}

/** Estimated total seconds for a tutorial (sum of per-step estimates). */
export function tutorialTotalSeconds(id: GameType): number {
  return TUTORIALS[id].steps.reduce((sum, s) => sum + (s.estimatedSeconds ?? DEFAULT_STEP_SECONDS), 0);
}

/** The games in catalog order, for the hub list. */
export const TUTORIAL_ORDER: readonly GameType[] = GAME_TYPES;

/**
 * Every i18n key a tutorial references (for the parity check): each game's hub
 * `learnKey`, plus — for enabled tutorials — every step's title/body/actionHint.
 */
export function allTutorialContentKeys(): string[] {
  const keys: string[] = [];
  for (const id of GAME_TYPES) {
    const tut = TUTORIALS[id];
    keys.push(tut.learnKey);
    for (const step of tut.steps) {
      keys.push(step.titleKey, step.bodyKey);
      if (step.actionHintKey) keys.push(step.actionHintKey);
    }
  }
  return keys;
}
