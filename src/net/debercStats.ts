// ---------------------------------------------------------------------------
// Deberc stats aggregator (pure; DEBERC-STATS-1).
//
// Mirrors durakStats.ts for Deberc: turns a FINISHED authoritative DebercState
// into the game-agnostic records the stats layer persists. NO DB, NO React, NO
// engine mutation — plain data in engine-`playerId` space, unit-testable without
// a database and never touching gameplay/rules.
//
// Deberc is a TEAM game (3p = three solo teams, 4p = two pairs). The match ends
// when a team reaches the target, or instantly on a truthful деберц (jackpot).
// A seat "wins" when its team is the `winnerTeam`; the only Deberc-specific
// counter is `jackpotCount` (matches won via the деберц jackpot). There is no
// draw — a finished match always has exactly one winning team.
// ---------------------------------------------------------------------------

import type { DebercState } from '../games/deberc/types';

/** One seat's outcome in a finished Deberc game (engine-id space; no user id). */
export interface DebercPlayerResult {
  seatIndex: number;
  playerId: string;
  name: string;
  type: 'human' | 'ai';
  avatar?: string;
  /** Team index (`teamOf[seatIndex]`): 3p → own team, 4p → the seat's pair. */
  team: number;
  isWinner: boolean;
}

/** Everything the stats layer needs about one finished Deberc game. */
export interface DebercFinishedSummary {
  playerCount: number;
  players: DebercPlayerResult[];
  /** playerIds on the winning team (2 in 4p, 1 in 3p). */
  winners: string[];
  winnerTeam: number | null;
  /** True when the match ended via a деберц jackpot rather than the target. */
  isJackpot: boolean;
}

/** Per-player Deberc stat contribution from ONE finished game. */
export interface DebercStatDelta {
  playerId: string;
  won: boolean;
  /** Won specifically via a деберц jackpot (credited to winners only). */
  isJackpot: boolean;
}

/** True only for a finished Deberc match. */
export function isFinishedDebercGame(state: DebercState | null): state is DebercState {
  return !!state && state.phase === 'finished';
}

/** Summarises a finished Deberc game in engine-id space. */
export function summarizeFinishedDebercGame(state: DebercState): DebercFinishedSummary {
  const winnerTeam = state.winnerTeam;
  const players: DebercPlayerResult[] = state.players.map((p) => {
    const team = state.teamOf[p.seatIndex] ?? p.seatIndex;
    return {
      seatIndex: p.seatIndex,
      playerId: p.id,
      name: p.name,
      type: p.type === 'ai' ? 'ai' : 'human',
      avatar: (p as { avatar?: string }).avatar,
      team,
      isWinner: winnerTeam != null && team === winnerTeam,
    };
  });
  return {
    playerCount: state.players.length,
    players,
    winners: players.filter((p) => p.isWinner).map((p) => p.playerId),
    winnerTeam,
    isJackpot: state.jackpot === true,
  };
}

/** Per-player Deberc stat deltas (one per seat; the repo skips bots). */
export function computeDebercStatDeltas(summary: DebercFinishedSummary): DebercStatDelta[] {
  return summary.players.map((p) => ({
    playerId: p.playerId,
    won: p.isWinner,
    isJackpot: summary.isJackpot && p.isWinner,
  }));
}

/**
 * Content fingerprint of a finished Deberc game (player count + winning team +
 * jackpot flag + winner set). Two recordings of the SAME finished game share it;
 * the server uses it to avoid double-recording on reconnect/rebroadcast (mirrors
 * durakFinishSignature).
 */
export function debercFinishSignature(state: DebercState): string {
  const winners = summarizeFinishedDebercGame(state).winners.slice().sort().join(',');
  return `deberc|${state.players.length}|${state.winnerTeam ?? 'none'}|${state.jackpot ? 'jackpot' : 'target'}|${winners}`;
}

/** Full, public, derived Deberc stats for one user (all outcome-level). */
export interface DebercStatsView {
  gameType: 'deberc';
  gamesPlayed: number;
  gamesWon: number;    // matches the user's team won
  gamesLost: number;   // matches the user's team lost
  winRate: number | null;      // 0..100 integer; null when no games
  jackpotCount: number;        // matches won via a деберц jackpot
  jackpotRate: number | null;  // 0..100 integer over games played; null when none
  lastGameAt: string | null;
}
