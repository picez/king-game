// ---------------------------------------------------------------------------
// Durak GameDefinition (Stage 9.2).
//
// Registers Durak's pure core (Stage 9.1) as a GameDefinition. It is wired into
// the registry/catalog as `coming_soon` — the menu shows it but cannot start it,
// and the server never creates Durak rooms yet (no protocol/UI). No King code or
// runtime behaviour changes.
// ---------------------------------------------------------------------------

import type { RoomSnapshot } from '../../net/messages';
import { GAME_CATALOG } from '../catalog';
import { playerCountRange, type GameDefinition } from '../definition';
import { durakReducer, getActingDurakPlayerId } from './engine';
import { durakBotAction } from './ai';
import type { DurakAction, DurakState } from './types';

const entry = GAME_CATALOG.durak;

/** START_DURAK from a room snapshot. Variant defaults to 'simple' until the
 *  protocol carries it (Stage 9.3); not called until Durak rooms exist. */
function buildDurakStartAction(room: RoomSnapshot): DurakAction {
  const players = room.members
    .filter((m) => m.role === 'player')
    .slice()
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0));
  return {
    type: 'START_DURAK',
    playerNames: players.map((m) => m.name),
    playerTypes: players.map((m) => (m.type === 'ai' ? 'ai' : 'human')),
    variant: 'simple',
  };
}

export const durakGameDefinition: GameDefinition<DurakState, DurakAction> = {
  id: 'durak',
  catalog: entry,
  rulesDoc: entry.rulesDoc,
  supportedPlayerCounts: playerCountRange(entry.minPlayers, entry.maxPlayers), // [2, 3, 4]
  reducer: durakReducer,
  getActingPlayerId: getActingDurakPlayerId,
  buildStartAction: buildDurakStartAction,
  botAction: durakBotAction,
  recordsStats: false, // stats wiring lands in Stage 9.4
};
