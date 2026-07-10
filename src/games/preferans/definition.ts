// ---------------------------------------------------------------------------
// Preferans GameDefinition (Stage 19.2).
//
// Registers Preferans's pure core (Stage 19.1) as a GameDefinition so the game is
// known to the catalog/registry/API. It is `coming_soon`: NOT startable locally or
// online yet (supportsLocal/supportsOnline = false in the catalog), so this wrapper
// exists but is not driven by any UI/server runtime. Client-safe (no server/db
// imports). Mirrors durak/deberc/tarneeb definition.ts.
// ---------------------------------------------------------------------------

import type { RoomSnapshot } from '../../net/messages';
import { GAME_CATALOG } from '../catalog';
import { playerCountRange, type GameDefinition } from '../definition';
import { preferansReducer } from './engine';
import { preferansBotAction } from './ai';
import { preferansRedactStateFor } from './redact';
import { getActingPreferansPlayerId, getActingPreferansSeat, isPreferansFinished } from './rules';
import type { PreferansAction, PreferansState } from './types';

const entry = GAME_CATALOG.preferans;

/**
 * START_GAME from a room snapshot. Preferans is always 3 seats, target 10
 * (PREFERANS_RULES.md §2, §11). Present for the seam even though online rooms are
 * not enabled yet (coming_soon).
 */
function buildPreferansStartAction(room: RoomSnapshot): PreferansAction {
  const players = room.members
    .filter((m) => m.role === 'player')
    .slice()
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0));
  return {
    type: 'START_GAME',
    playerNames: players.map((m) => m.name),
    playerTypes: players.map((m) => (m.type === 'ai' ? 'ai' : 'human')),
    options: { targetScore: 10 },
  };
}

/** Bot move for the current actor, or null when no seat is acting (between hands). */
function preferansDefinitionBotAction(state: PreferansState): PreferansAction | null {
  const seat = getActingPreferansSeat(state);
  return seat == null ? null : preferansBotAction(state, seat);
}

export const preferansGameDefinition: GameDefinition<PreferansState, PreferansAction> = {
  id: 'preferans',
  catalog: entry,
  rulesDoc: entry.rulesDoc,
  supportedPlayerCounts: playerCountRange(entry.minPlayers, entry.maxPlayers), // [3]
  reducer: preferansReducer,
  getActingPlayerId: getActingPreferansPlayerId,
  buildStartAction: buildPreferansStartAction,
  botAction: preferansDefinitionBotAction,
  redactStateFor: preferansRedactStateFor,
  isFinished: isPreferansFinished,
  recordsStats: false, // no stats until a later stage (coming_soon)
};
