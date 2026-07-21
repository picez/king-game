// ---------------------------------------------------------------------------
// Poker (No-Limit Texas Hold'em) GameDefinition (Stage 37.4).
//
// Registers the poker pure core as a GameDefinition that plugs into the catalog
// picker / registry / serverCore / stats seams. Poker is playable local + online
// (catalog supportsLocal/Online true) and records score-only stats
// (`recordsStats: true` → the WS finish path records under game_type='poker').
// This wrapper moves no logic — it references the existing poker modules.
// Mirrors fiftyOne/definition.ts.
// ---------------------------------------------------------------------------

import type { RoomSnapshot } from '../../net/messages';
import { GAME_CATALOG } from '../catalog';
import { playerCountRange, type GameDefinition } from '../definition';
import { pokerReducer } from './engine';
import { pokerBotAction } from './ai';
import { pokerRedactStateFor } from './redact';
import { getActingPokerPlayerId, getActingPokerSeat, isPokerFinished } from './rules';
import type { PokerAction, PokerState } from './types';

const entry = GAME_CATALOG['poker'];

/**
 * START_GAME from a room snapshot. Poker seats every player individually (no
 * teams); the player count comes from the seated members (2–6). Blinds/stack are
 * fixed for the MVP, so no per-room option is threaded (unlike 51). Reached on the
 * online host path exactly like the released games.
 */
function buildPokerStartAction(room: RoomSnapshot): PokerAction {
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

/** Bot move for the current actor, or null when no seat is acting (between hands). */
function pokerDefinitionBotAction(state: PokerState): PokerAction | null {
  const seat = getActingPokerSeat(state);
  return seat == null ? null : pokerBotAction(state, seat);
}

export const pokerGameDefinition: GameDefinition<PokerState, PokerAction> = {
  id: 'poker',
  catalog: entry,
  rulesDoc: entry.rulesDoc,
  supportedPlayerCounts: playerCountRange(entry.minPlayers, entry.maxPlayers), // [2, 3, 4, 5, 6]
  reducer: pokerReducer,
  getActingPlayerId: getActingPokerPlayerId,
  buildStartAction: buildPokerStartAction,
  botAction: pokerDefinitionBotAction,
  redactStateFor: pokerRedactStateFor,
  isFinished: isPokerFinished,
  recordsStats: true,
};
