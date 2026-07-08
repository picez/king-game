// ---------------------------------------------------------------------------
// GameDefinition — the compile-time central wrapper for one game (Stage 8.4).
//
// A GameDefinition REFERENCES a game's existing modules (reducer, AI, start
// action, …) without moving any logic. It is the active runtime seam that plugs
// each game into serverCore / the UI / stats instead of scattering `gameType`
// checks around. King, Durak, Deberc, and Tarneeb all implement it and run
// through it online. A future game plugs in the same way.
//
// This module is pure + client-safe: it only imports TYPES from core/net, so a
// definition can be referenced from either the server or the client bundle.
// ---------------------------------------------------------------------------

import type { ReducerContext } from '../core/gameEngine';
import type { RoomSnapshot } from '../net/messages';
import type { GameType, GameCatalogEntry } from './catalog';

/**
 * Placeholder for future per-game UI registration (screens/routes). Empty today:
 * each game renders through its own screens (King via GameRouter; Durak/Deberc/
 * Tarneeb via their own local/online components), so none registers UI here.
 * A future game can populate this without touching the shared UI shell.
 */
export type GameUiRoutes = Record<string, never>;

/**
 * Generic over the game's own state/action (Stage 9.2): King is
 * `GameDefinition<GameState, GameAction>`, Durak is
 * `GameDefinition<DurakState, DurakAction>`. The registry stores them
 * heterogeneously as `AnyGameDefinition`. `ctx` is `{ rng? }`-shaped for every
 * game (ReducerContext), so each game's own context type structurally matches.
 */
export interface GameDefinition<TState = unknown, TAction = unknown> {
  id: GameType;
  /** The full (internal) catalog entry — includes rulesDoc etc. */
  catalog: GameCatalogEntry;
  /** Markdown rules doc filename (mirrors catalog.rulesDoc). */
  rulesDoc: string;
  /** Player counts this game supports at the table (derived from the catalog). */
  supportedPlayerCounts: number[];

  /** Pure reducer: (state, action, ctx?) → next state. The same fn the app uses. */
  reducer: (state: TState | null, action: TAction, ctx?: ReducerContext) => TState | null;
  /** The id of the player who must act now, or null on a public screen. */
  getActingPlayerId: (state: TState) => string | null;
  /** Build the start action from a room snapshot (online start seam). */
  buildStartAction: (room: RoomSnapshot) => TAction;
  /** The AI move for the current actor, or null on screens AI does not drive. */
  botAction: (state: TState) => TAction | null;
  /**
   * The state a viewer at `viewerSeat` is allowed to see — own hand only, every
   * opponent hand (and the face-down draw pile) replaced with hidden cards. Pure;
   * must never leak a private hand. `viewerSeat` null = a spectator view.
   */
  redactStateFor: (state: TState, viewerSeat: number | null) => TState;
  /** Whether the game is over (used by the server to record/stop). */
  isFinished: (state: TState) => boolean;

  /**
   * Whether finished online games record (score-only) stats for this game. The
   * recorder itself is server-side + DB-gated (server/db/stats.ts) and is
   * intentionally NOT imported here — that keeps this a pure, client-safe wrapper.
   */
  recordsStats: boolean;

  /** Future per-game UI registration (empty placeholder today — see GameUiRoutes). */
  uiRoutes?: GameUiRoutes;
}

/**
 * The registry's value type: a definition for some game whose concrete
 * state/action are erased at the boundary. Callers narrow by `id`/`gameType`.
 */
export type AnyGameDefinition = GameDefinition<any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Inclusive integer range [min..max] → supportedPlayerCounts (e.g. 3,4 → [3,4]). */
export function playerCountRange(min: number, max: number): number[] {
  return Array.from({ length: Math.max(0, max - min + 1) }, (_, i) => min + i);
}
