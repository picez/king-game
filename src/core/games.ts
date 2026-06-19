import type { GameState, GameModeId } from '../models/types';
import { ALL_MODES, DEALER_MODE_COUNTS } from '../config/gameModes';

/** All game modes in their canonical order (No Tricks … Trump). */
export const MATRIX_MODE_IDS: GameModeId[] = ALL_MODES.map((m) => m.id);

export interface MatrixCell {
  modeId: GameModeId;
  /** How many of this mode the dealer plays in total (Trump 3, others 1). */
  total: number;
  /** How many are still left to play for this player. */
  remaining: number;
  /** How many have already been played (total − remaining). */
  played: number;
  done: boolean;
}

export interface MatrixRow {
  playerId: string;
  name: string;
  isDealer: boolean;
  cells: MatrixCell[];
  /** True once every one of this player's 9 games has been played. */
  allDone: boolean;
}

/**
 * Per-player progress through their personal set of dealer games, derived from
 * `state.dealerModes`. Public, privacy-safe: it uses only the per-dealer mode
 * counts (never any hand or collected cards). Works for 3- and 4-player games.
 */
export function gamesMatrix(state: GameState, opts: { dealerId?: string } = {}): MatrixRow[] {
  const dealerId = opts.dealerId ?? state.players[state.dealerIndex]?.id ?? null;
  return state.players.map((p) => {
    const counts = state.dealerModes[p.id] ?? ({} as Record<GameModeId, number>);
    const cells: MatrixCell[] = MATRIX_MODE_IDS.map((modeId) => {
      const total = DEALER_MODE_COUNTS[modeId];
      const remaining = counts[modeId] ?? 0;
      const played = total - remaining;
      return { modeId, total, remaining, played, done: remaining === 0 };
    });
    return {
      playerId: p.id,
      name: p.name,
      isDealer: p.id === dealerId,
      cells,
      allDone: cells.every((c) => c.done),
    };
  });
}
