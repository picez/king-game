// ---------------------------------------------------------------------------
// Durak stats aggregator (pure; DURAK-1).
//
// Mirrors kingStats.ts for Durak: turns a FINISHED authoritative DurakState into
// the game-agnostic records the stats layer persists. NO DB, NO React, NO
// engine mutation — plain data in engine-`playerId` space, unit-testable without
// a database and never touching gameplay/rules.
//
// Durak has no per-round score: the outcome is simply who is the FOOL (the sole
// loser) or a DRAW (no fool). So "win" = not the fool (everyone wins on a draw),
// and the only Durak-specific counters are foolCount / drawCount.
// ---------------------------------------------------------------------------

import type { DurakState } from '../games/durak/types';

/** One seat's outcome in a finished Durak game (engine-id space; no user id). */
export interface DurakPlayerResult {
  seatIndex: number;
  playerId: string;
  name: string;
  type: 'human' | 'ai';
  avatar?: string;
  isFool: boolean;
  isWinner: boolean;
}

/** Everything the stats layer needs about one finished Durak game. */
export interface DurakFinishedSummary {
  playerCount: number;
  players: DurakPlayerResult[];
  /** playerIds that did NOT lose (everyone but the fool; all on a draw). */
  winners: string[];
  foolId: string | null;
  isDraw: boolean;
}

/** Per-player Durak stat contribution from ONE finished game. */
export interface DurakStatDelta {
  playerId: string;
  won: boolean;
  isFool: boolean;
  isDraw: boolean;
}

/** True only for a finished Durak game. */
export function isFinishedDurakGame(state: DurakState | null): state is DurakState {
  return !!state && state.status === 'finished';
}

/** Summarises a finished Durak game in engine-id space. */
export function summarizeFinishedDurakGame(state: DurakState): DurakFinishedSummary {
  const winners = new Set(state.winnerIds);
  const players: DurakPlayerResult[] = state.players.map((p) => ({
    seatIndex: p.seatIndex,
    playerId: p.id,
    name: p.name,
    type: p.type === 'ai' ? 'ai' : 'human',
    avatar: (p as { avatar?: string }).avatar,
    isFool: p.id === state.foolId,
    isWinner: winners.has(p.id),
  }));
  return {
    playerCount: state.players.length,
    players,
    winners: [...state.winnerIds],
    foolId: state.foolId,
    isDraw: state.isDraw,
  };
}

/** Per-player Durak stat deltas (one per seat; the repo skips bots). */
export function computeDurakStatDeltas(summary: DurakFinishedSummary): DurakStatDelta[] {
  return summary.players.map((p) => ({
    playerId: p.playerId,
    won: p.isWinner,
    isFool: p.isFool,
    isDraw: summary.isDraw,
  }));
}

/**
 * Content fingerprint of a finished Durak game (fool/draw + winner set + player
 * count). Two recordings of the SAME finished game share it; the server uses it
 * to avoid double-recording on reconnect/rebroadcast (mirrors finishSignature).
 */
export function durakFinishSignature(state: DurakState): string {
  const outcome = state.isDraw ? 'draw' : (state.foolId ?? 'none');
  const winners = [...state.winnerIds].sort().join(',');
  return `durak|${state.players.length}|${outcome}|${winners}`;
}

/** Full, public, derived Durak stats for one user (all outcome-level). */
export interface DurakStatsView {
  gameType: 'durak';
  gamesPlayed: number;
  gamesWon: number;    // games where the user was not the fool
  gamesLost: number;   // games where the user was the fool
  winRate: number | null;   // 0..100 integer; null when no games
  foolCount: number;   // times the user was the fool (== gamesLost)
  drawCount: number;   // games that ended in a draw
  foolRate: number | null;  // 0..100 integer; null when no games
  lastGameAt: string | null;
}
