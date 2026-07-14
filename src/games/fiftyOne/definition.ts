// ---------------------------------------------------------------------------
// 51 (Syrian 51) GameDefinition (Stage 30.2).
//
// Registers the 51 pure core (Stage 30.1) as a GameDefinition so the platform is
// AWARE of the game (catalog picker, registry, /api/games). 51 is **coming_soon**:
// `supportsLocal`/`supportsOnline` are false in the catalog, so it is never
// startable local or online yet, and `recordsStats` is false. The local prototype
// is Stage 30.3 and online is 30.4–30.5. This wrapper moves no logic — it just
// references the existing fiftyOne modules. Mirrors tarneeb/definition.ts.
// ---------------------------------------------------------------------------

import type { RoomSnapshot } from '../../net/messages';
import { GAME_CATALOG } from '../catalog';
import { playerCountRange, type GameDefinition } from '../definition';
import { fiftyOneReducer } from './engine';
import { fiftyOneBotAction } from './ai';
import { fiftyOneRedactStateFor } from './redact';
import { getActingFiftyOnePlayerId, getActingFiftyOneSeat, isFiftyOneFinished } from './rules';
import type { FiftyOneAction, FiftyOneState } from './types';

const entry = GAME_CATALOG['fifty-one'];

/**
 * START_GAME from a room snapshot. 51 seats every player individually (no teams);
 * the player count comes from the seated members (2–4). NOTE: 51 is coming_soon,
 * so the server never actually reaches this path (online room creation is rejected
 * for a game with supportsOnline=false) — it exists so the definition is complete
 * and unit-testable, exactly like the released games.
 */
function buildFiftyOneStartAction(room: RoomSnapshot): FiftyOneAction {
  const players = room.members
    .filter((m) => m.role === 'player')
    .slice()
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0));
  return {
    type: 'START_GAME',
    playerNames: players.map((m) => m.name),
    playerTypes: players.map((m) => (m.type === 'ai' ? 'ai' : 'human')),
    playerCount: players.length,
  };
}

/** Bot move for the current actor, or null when no seat is acting (between rounds). */
function fiftyOneDefinitionBotAction(state: FiftyOneState): FiftyOneAction | null {
  const seat = getActingFiftyOneSeat(state);
  return seat == null ? null : fiftyOneBotAction(state, seat);
}

export const fiftyOneGameDefinition: GameDefinition<FiftyOneState, FiftyOneAction> = {
  id: 'fifty-one',
  catalog: entry,
  rulesDoc: entry.rulesDoc,
  supportedPlayerCounts: playerCountRange(entry.minPlayers, entry.maxPlayers), // [2, 3, 4]
  reducer: fiftyOneReducer,
  getActingPlayerId: getActingFiftyOnePlayerId,
  buildStartAction: buildFiftyOneStartAction,
  botAction: fiftyOneDefinitionBotAction,
  redactStateFor: fiftyOneRedactStateFor,
  isFinished: isFiftyOneFinished,
  recordsStats: false, // Stage 30.2: coming_soon — no stats until 30.6
};
