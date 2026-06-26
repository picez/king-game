// ---------------------------------------------------------------------------
// Game definition registry (Stage 8.4).
//
// Maps each GameType to its GameDefinition. Today only King is registered; a
// second game is added here (plus its own definition file) without touching the
// shared core. `getGameDefinition` mirrors `getGameCatalogEntry` (returns null
// for unknown input). Nothing in the runtime hot path requires this yet — it is
// the seam the next stage builds on.
// ---------------------------------------------------------------------------

import { DEFAULT_GAME_TYPE, isGameType, type GameType } from './catalog';
import type { GameDefinition } from './definition';
import { kingGameDefinition } from './king/definition';

export const GAME_DEFINITIONS: Record<GameType, GameDefinition> = {
  king: kingGameDefinition,
};

/** The definition for a game type, or null for an unknown/invalid value. */
export function getGameDefinition(value: unknown): GameDefinition | null {
  return isGameType(value) ? GAME_DEFINITIONS[value] : null;
}

export const DEFAULT_GAME_DEFINITION: GameDefinition = GAME_DEFINITIONS[DEFAULT_GAME_TYPE];
