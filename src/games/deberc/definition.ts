// ---------------------------------------------------------------------------
// Deberc GameDefinition (Stage 4).
//
// Registers Deberc's pure core (Stages 1–3) as a GameDefinition so the shared
// server seam (serverCore) can route its reducer / redaction / bot / start
// action without any King- or Durak-specific code. Mirrors durak/definition.ts.
//
// `trick_complete` and `hand_scoring` are server-advanced public screens (see
// getActingDebercPlayerId + serverCore.autoAdvance), so NEXT_TRICK / NEXT_HAND
// are never client actions — NEXT_HAND re-deals under a server seed.
// ---------------------------------------------------------------------------

import type { RoomSnapshot } from '../../net/messages';
import { GAME_CATALOG } from '../catalog';
import { playerCountRange, type GameDefinition } from '../definition';
import { debercReducer, getActingDebercPlayerId, isDebercFinished } from './engine';
import { debercBotAction } from './ai';
import { debercRedactStateFor } from './redact';
import type { DebercAction, DebercMatchSize, DebercState } from './types';

const entry = GAME_CATALOG.deberc;

/** START_DEBERC from a room snapshot. Uses the room's chosen match size (small/big). */
function buildDebercStartAction(room: RoomSnapshot): DebercAction {
  const players = room.members
    .filter((m) => m.role === 'player')
    .slice()
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0));
  const matchSize: DebercMatchSize = room.matchSize === 'big' ? 'big' : 'small';
  return {
    type: 'START_DEBERC',
    playerNames: players.map((m) => m.name),
    playerTypes: players.map((m) => (m.type === 'ai' ? 'ai' : 'human')),
    matchSize,
  };
}

export const debercGameDefinition: GameDefinition<DebercState, DebercAction> = {
  id: 'deberc',
  catalog: entry,
  rulesDoc: entry.rulesDoc,
  supportedPlayerCounts: playerCountRange(entry.minPlayers, entry.maxPlayers), // [3, 4]
  reducer: debercReducer,
  getActingPlayerId: getActingDebercPlayerId,
  buildStartAction: buildDebercStartAction,
  botAction: debercBotAction,
  redactStateFor: debercRedactStateFor,
  isFinished: isDebercFinished,
  recordsStats: true, // DEBERC-STATS-1: outcome-only stats (win/jackpot) per game_type='deberc'
};
