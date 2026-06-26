// ---------------------------------------------------------------------------
// King GameDefinition (Stage 8.4).
//
// Wraps King's EXISTING modules — no logic is moved or changed. This is the
// single place that names King's reducer / start-action / AI, so a future game
// can mirror the shape in its own definition.
// ---------------------------------------------------------------------------

import { gameReducer, getActingPlayerId, type GameAction } from '../../core/gameEngine';
import type { GameState } from '../../models/types';
import { buildStartAction, seatToPlayerId } from '../../net/online';
// Import botAction from its own module (NOT serverCore) so this definition does
// not import serverCore — serverCore imports the registry, which imports this.
import { botAction } from '../../net/botAction';
import { redactStateFor } from '../../net/messages';
import { GAME_CATALOG } from '../catalog';
import { playerCountRange, type GameDefinition } from '../definition';

const entry = GAME_CATALOG.king;

export const kingGameDefinition: GameDefinition<GameState, GameAction> = {
  id: 'king',
  catalog: entry,
  rulesDoc: entry.rulesDoc,
  supportedPlayerCounts: playerCountRange(entry.minPlayers, entry.maxPlayers), // [3, 4]
  reducer: gameReducer,
  getActingPlayerId,
  buildStartAction,
  botAction,
  // King redaction is by player id; bridge the seat the server knows.
  redactStateFor: (state, viewerSeat) =>
    redactStateFor(state, viewerSeat != null ? seatToPlayerId(viewerSeat) : null) as GameState,
  isFinished: (state) => state.status === 'game_finished',
  recordsStats: true,
};
