// ---------------------------------------------------------------------------
// Tarneeb GameDefinition (Stage 10.2).
//
// Registers Tarneeb's pure core (Stage 10.1) as a GameDefinition. Tarneeb is
// released (`available`, Stage 10.8): playable local + server-authoritative
// online, recording its own per-`game_type` stats via the shared serverCore seam
// (reducer / redaction / bot / start action). No King/Durak/Deberc code or
// runtime behaviour changes. Mirrors durak/deberc definition.ts.
// ---------------------------------------------------------------------------

import type { RoomSnapshot } from '../../net/messages';
import { GAME_CATALOG } from '../catalog';
import { playerCountRange, type GameDefinition } from '../definition';
import { tarneebReducer } from './engine';
import { tarneebBotAction } from './ai';
import { tarneebRedactStateFor } from './redact';
import { getActingTarneebPlayerId, getActingTarneebSeat, isTarneebFinished } from './rules';
import type { TarneebAction, TarneebState } from './types';

const entry = GAME_CATALOG.tarneeb;

/**
 * START_GAME from a room snapshot. Tarneeb is always 4 fixed-partnership seats,
 * target 41, kaboot off, no No-Trump (TARNEEB_RULES.md §2, §9, §6, §10). Invoked
 * by serverCore when a host starts an online Tarneeb room.
 */
function buildTarneebStartAction(room: RoomSnapshot): TarneebAction {
  const players = room.members
    .filter((m) => m.role === 'player')
    .slice()
    .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0));
  return {
    type: 'START_GAME',
    playerNames: players.map((m) => m.name),
    playerTypes: players.map((m) => (m.type === 'ai' ? 'ai' : 'human')),
    options: { targetScore: 41, kabootMode: 'off', allowNoTrump: false },
  };
}

/** Bot move for the current actor, or null when no seat is acting (between hands). */
function tarneebDefinitionBotAction(state: TarneebState): TarneebAction | null {
  const seat = getActingTarneebSeat(state);
  return seat == null ? null : tarneebBotAction(state, seat);
}

export const tarneebGameDefinition: GameDefinition<TarneebState, TarneebAction> = {
  id: 'tarneeb',
  catalog: entry,
  rulesDoc: entry.rulesDoc,
  supportedPlayerCounts: playerCountRange(entry.minPlayers, entry.maxPlayers), // [4]
  reducer: tarneebReducer,
  getActingPlayerId: getActingTarneebPlayerId,
  buildStartAction: buildTarneebStartAction,
  botAction: tarneebDefinitionBotAction,
  redactStateFor: tarneebRedactStateFor,
  isFinished: isTarneebFinished,
  recordsStats: true, // Stage 10.8: online Tarneeb records outcome/score stats
};
