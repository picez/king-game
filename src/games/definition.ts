// ---------------------------------------------------------------------------
// GameDefinition — the compile-time central wrapper for one game (Stage 8.4).
//
// A GameDefinition REFERENCES a game's existing modules (reducer, AI, start
// action, …) without moving any logic. It is the seam that lets a second game
// plug in its own implementation later, instead of scattering `gameType` checks
// across serverCore / the UI / stats. Today only King implements it, and nothing
// in the runtime hot path depends on it yet — it is scaffolding, exercised by
// tests, that the next stage (a second game) builds on. No runtime behaviour
// changes by introducing this type.
//
// This module is pure + client-safe: it only imports TYPES from core/net, so a
// definition can be referenced from either the server or the client bundle.
// ---------------------------------------------------------------------------

import type { GameAction, ReducerContext } from '../core/gameEngine';
import type { GameState } from '../models/types';
import type { RoomSnapshot } from '../net/messages';
import type { GameType, GameCatalogEntry } from './catalog';

/**
 * Placeholder for future per-game UI registration (screens/routes). Empty today:
 * King renders through the shared GameRouter/screens, so no game registers UI.
 * A second game can populate this without touching the shared UI shell.
 */
export type GameUiRoutes = Record<string, never>;

export interface GameDefinition {
  id: GameType;
  /** The full (internal) catalog entry — includes rulesDoc etc. */
  catalog: GameCatalogEntry;
  /** Markdown rules doc filename (mirrors catalog.rulesDoc). */
  rulesDoc: string;
  /** Player counts this game supports at the table (derived from the catalog). */
  supportedPlayerCounts: number[];

  /** Pure reducer: (state, action, ctx?) → next state. The same fn the app uses. */
  reducer: (state: GameState | null, action: GameAction, ctx?: ReducerContext) => GameState | null;
  /** The id of the player who must act now, or null on a public screen. */
  getActingPlayerId: (state: GameState) => string | null;
  /** Build the START_GAME action from a room snapshot (online start seam). */
  buildStartAction: (room: RoomSnapshot) => GameAction;
  /** The AI move for the current actor, or null on screens AI does not drive. */
  botAction: (state: GameState) => GameAction | null;

  /**
   * Whether finished online games record (score-only) stats for this game. The
   * recorder itself is server-side + DB-gated (server/db/stats.ts) and is
   * intentionally NOT imported here — that keeps this a pure, client-safe wrapper.
   */
  recordsStats: boolean;

  /** Future per-game UI registration (empty placeholder today — see GameUiRoutes). */
  uiRoutes?: GameUiRoutes;
}

/** Inclusive integer range [min..max] → supportedPlayerCounts (e.g. 3,4 → [3,4]). */
export function playerCountRange(min: number, max: number): number[] {
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
}
