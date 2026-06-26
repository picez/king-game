// ---------------------------------------------------------------------------
// Game definition registry (Stage 8.4; Durak added Stage 9.2).
//
// Maps each GameType to its GameDefinition. King is fully playable; Durak is
// registered but `coming_soon` (no UI/online yet — the menu disables it and the
// server never starts Durak rooms). `getGameDefinition` mirrors
// `getGameCatalogEntry` (returns null for unknown input).
// ---------------------------------------------------------------------------

import { DEFAULT_GAME_TYPE, isGameType, type GameType } from './catalog';
import type { AnyGameDefinition } from './definition';
import { kingGameDefinition } from './king/definition';
import { durakGameDefinition } from './durak/definition';

export const GAME_DEFINITIONS: Record<GameType, AnyGameDefinition> = {
  king: kingGameDefinition,
  durak: durakGameDefinition,
};

/** The definition for a game type, or null for an unknown/invalid value. */
export function getGameDefinition(value: unknown): AnyGameDefinition | null {
  return isGameType(value) ? GAME_DEFINITIONS[value] : null;
}

export const DEFAULT_GAME_DEFINITION: AnyGameDefinition = GAME_DEFINITIONS[DEFAULT_GAME_TYPE];
