// ---------------------------------------------------------------------------
// Tutorial catalog. One entry per GameType. As of Stage 31.2 ALL SIX games ship a
// full scripted tutorial (Stage 31.1 shipped 51 + Durak; 31.2 added King, Deberc,
// Tarneeb, Preferans). Pure — mirrors src/games/gameHelp.ts. No engine/net imports.
// ---------------------------------------------------------------------------

import { GAME_TYPES, type GameType } from '../games/catalog';
import { DEFAULT_STEP_SECONDS, type Tutorial, type TutorialCatalog } from './types';
import { fiftyOneTutorial } from './fiftyOneTutorial';
import { durakTutorial } from './durakTutorial';
import { kingTutorial } from './kingTutorial';
import { debercTutorial } from './debercTutorial';
import { tarneebTutorial } from './tarneebTutorial';
import { preferansTutorial } from './preferansTutorial';

export const TUTORIALS: TutorialCatalog = {
  king: kingTutorial,
  durak: durakTutorial,
  deberc: debercTutorial,
  tarneeb: tarneebTutorial,
  preferans: preferansTutorial,
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
