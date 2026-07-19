// ---------------------------------------------------------------------------
// 51 (Syrian 51) GameDefinition (Stage 30.2; online 30.5; stats 30.6).
//
// Registers the 51 pure core (Stage 30.1) as a GameDefinition that plugs into the
// catalog picker / registry / serverCore / stats seams. 51 is playable **local +
// online** (catalog supportsLocal/Online true) and records score-only stats
// (`recordsStats: true` → the WS finish path records under game_type='fifty-one').
// As of Stage 30.7 it is FULLY RELEASED (`status: 'available'` — favorite +
// achievement + PNG icon). This wrapper moves no logic — it just references the
// existing fiftyOne modules. Mirrors tarneeb/definition.ts.
// ---------------------------------------------------------------------------

import type { RoomSnapshot } from '../../net/messages';
import { GAME_CATALOG } from '../catalog';
import { playerCountRange, type GameDefinition } from '../definition';
import { fiftyOneReducer } from './engine';
import { fiftyOneBotAction } from './ai';
import { fiftyOneRedactStateFor } from './redact';
import { getActingFiftyOnePlayerId, getActingFiftyOneSeat, isFiftyOneFinished, normalizeEliminationScore } from './rules';
import type { FiftyOneAction, FiftyOneState } from './types';

const entry = GAME_CATALOG['fifty-one'];

/**
 * START_GAME from a room snapshot. 51 seats every player individually (no teams);
 * the player count comes from the seated members (2–4). Reached on the online host
 * path (Stage 30.5) exactly like the released games. The elimination score is the
 * host's choice (Stage 30.15); a missing/legacy value normalises to the default 510.
 */
function buildFiftyOneStartAction(room: RoomSnapshot): FiftyOneAction {
  const players = room.members
    .filter((m) => m.role === 'player')
    .slice()
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0));
  const targetPenalty = normalizeEliminationScore(room.fiftyOneEliminationScore);
  return {
    type: 'START_GAME',
    playerNames: players.map((m) => m.name),
    playerTypes: players.map((m) => (m.type === 'ai' ? 'ai' : 'human')),
    playerCount: players.length,
    options: { targetPenalty },
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
  // Stage 30.6: online finished 51 games record score-only stats under
  // game_type='fifty-one' (see server/db/fiftyOneStats.ts). As of Stage 30.7 51 is
  // fully `available` — favoritable + achievement-eligible + stats + leaderboard.
  recordsStats: true,
};
