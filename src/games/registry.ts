// ---------------------------------------------------------------------------
// Game definition registry (Stage 8.4; Durak Stage 9.2; Tarneeb Stage 10.2).
//
// Maps each GameType to its GameDefinition. King, Durak, Deberc, Tarneeb, and
// Preferans are all fully playable (`available`) — local + server-authoritative online.
// `getGameDefinition` mirrors `getGameCatalogEntry` (returns null for unknown
// input).
// ---------------------------------------------------------------------------

import { DEFAULT_GAME_TYPE, isGameType, type GameType } from './catalog';
import type { AnyGameDefinition } from './definition';
import { kingGameDefinition } from './king/definition';
import { durakGameDefinition } from './durak/definition';
import { debercGameDefinition } from './deberc/definition';
import { tarneebGameDefinition } from './tarneeb/definition';
import { preferansGameDefinition } from './preferans/definition';
import { fiftyOneGameDefinition } from './fiftyOne/definition';

export const GAME_DEFINITIONS: Record<GameType, AnyGameDefinition> = {
  king: kingGameDefinition,
  durak: durakGameDefinition,
  deberc: debercGameDefinition,
  tarneeb: tarneebGameDefinition,
  preferans: preferansGameDefinition, // Stage 19.7: released (available, local + online + stats)
  'fifty-one': fiftyOneGameDefinition, // Stage 30.2: registered coming_soon (not playable yet)
};

/** The definition for a game type, or null for an unknown/invalid value. */
export function getGameDefinition(value: unknown): AnyGameDefinition | null {
  return isGameType(value) ? GAME_DEFINITIONS[value] : null;
}

export const DEFAULT_GAME_DEFINITION: AnyGameDefinition = GAME_DEFINITIONS[DEFAULT_GAME_TYPE];
