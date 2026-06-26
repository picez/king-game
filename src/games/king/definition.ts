// ---------------------------------------------------------------------------
// King GameDefinition (Stage 8.4).
//
// Wraps King's EXISTING modules — no logic is moved or changed. This is the
// single place that names King's reducer / start-action / AI, so a future game
// can mirror the shape in its own definition.
// ---------------------------------------------------------------------------

import { gameReducer, getActingPlayerId } from '../../core/gameEngine';
import { buildStartAction } from '../../net/online';
import { botAction } from '../../net/serverCore';
import { GAME_CATALOG } from '../catalog';
import { playerCountRange, type GameDefinition } from '../definition';

const entry = GAME_CATALOG.king;

export const kingGameDefinition: GameDefinition = {
  id: 'king',
  catalog: entry,
  rulesDoc: entry.rulesDoc,
  supportedPlayerCounts: playerCountRange(entry.minPlayers, entry.maxPlayers), // [3, 4]
  reducer: gameReducer,
  getActingPlayerId,
  buildStartAction,
  botAction,
  recordsStats: true,
};
