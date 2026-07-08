// ---------------------------------------------------------------------------
// Tarneeb GameDefinition (Stage 10.2).
//
// Registers Tarneeb's pure core (Stage 10.1) as a GameDefinition so the shared
// server seam (serverCore) COULD route its reducer / redaction / bot / start
// action — but the catalog marks Tarneeb `coming_soon` with supportsLocal/
// supportsOnline = false, so nothing starts it yet: the menu shows it disabled
// and the server never creates Tarneeb rooms. No King/Durak/Deberc code or
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
 * target 41, kaboot off, no No-Trump (TARNEEB_RULES.md §2, §9, §6, §10). This is
 * never actually invoked from UI/server today (Tarneeb is coming_soon) — it
 * exists so the definition is complete and testable.
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
  recordsStats: false, // Stage 10.2: no stats yet (enabled in the release stage 10.7)
};
