// ---------------------------------------------------------------------------
// King stats aggregator (pure; Stage 5).
//
// Turns a FINISHED authoritative GameState into the durable, game-agnostic
// records the stats layer persists, plus King-specific per-player aggregates.
// NO DB, NO React, NO engine-mutation — just plain data in `playerId` space, so
// it is unit-testable without a database and never touches gameplay/rules.
//
// The DB layer (server/db/stats.ts) maps each `playerId`/seat to a `userId`
// (from the room members) and writes the rows; this module owns ONLY the King
// rules of "what counts": who won, per-round scores, and the per-mode breakdown.
//
// Winner rule (matches the game + GameFinishedScreen): a player's `total` is the
// sum of penalties (negative) and Trump rewards (positive), so the HIGHEST total
// wins. Ties produce co-winners (each counts as a win, none as a loss). This is
// authoritative per KING_RULES.md scoring — the architecture note that said
// "lowest score" was imprecise; the score-tracker total is what decides.
// ---------------------------------------------------------------------------

import type { GameState } from '../models/types';

/** One seat's outcome in a finished game (engine-id space; no user identity). */
export interface GamePlayerResult {
  seatIndex: number;
  /** Engine id `player-N` used throughout roundHistory/scores. */
  playerId: string;
  name: string;
  type: 'human' | 'ai';
  avatar?: string;
  finalTotal: number;
  isWinner: boolean;
}

/** One completed round, score-only (mirrors RoundRecord; never holds cards). */
export interface RoundResult {
  roundIndex: number;
  modeId: string;
  dealerPlayerId: string;
  /** 1..3 for the dealer's n-th Trump game; 0 for non-Trump modes. */
  trumpOccurrence: number;
  scoreByPlayer: Record<string, number>;
}

/** Everything the stats layer needs about a single finished game. */
export interface FinishedGameSummary {
  playerCount: 3 | 4;
  roundsPlayed: number;
  players: GamePlayerResult[];
  /** playerIds sharing the top (winning) total — 1 normally, >1 on a tie. */
  winners: string[];
  rounds: RoundResult[];
}

/**
 * Per-player King stat contribution from ONE finished game. The repository adds
 * these into the user's cached `user_stats` row (incremental, idempotent because
 * a game is recorded at most once). `bestGameScore` is a max (higher is better).
 */
export interface PlayerStatDelta {
  playerId: string;
  /** Rounds this player took part in (every completed round of the game). */
  roundsPlayed: number;
  won: boolean;
  finalTotal: number;
  /** Cumulative score contribution (== finalTotal; repo sums across games). */
  totalScore: number;
  /** This game's final total (repo keeps the max across games). */
  bestGameScore: number;
  /** modeId → sum of this player's round scores played under that mode. */
  modeBreakdown: Record<string, number>;
}

/** True only for a finished King game with a usable score table. */
export function isFinishedGame(state: GameState | null): state is GameState {
  return !!state && state.status === 'game_finished';
}

/**
 * Summarises a finished game in engine-id space. Returns null if the state is
 * not actually finished (defensive — callers should gate on `isFinishedGame`).
 */
export function summarizeFinishedGame(state: GameState): FinishedGameSummary {
  const playerCount = state.config.playerCount;
  const history = state.roundHistory ?? [];

  const totals = state.players.map((p) => state.scores[p.id]?.total ?? 0);
  const maxTotal = totals.length ? Math.max(...totals) : 0;

  const players: GamePlayerResult[] = state.players.map((p) => {
    const finalTotal = state.scores[p.id]?.total ?? 0;
    return {
      seatIndex: p.seatIndex,
      playerId: p.id,
      name: p.name,
      type: p.type === 'ai' ? 'ai' : 'human',
      avatar: p.avatar,
      finalTotal,
      isWinner: finalTotal === maxTotal,
    };
  });

  const rounds: RoundResult[] = history.map((r) => ({
    roundIndex: r.roundNumber,
    modeId: r.modeId,
    dealerPlayerId: r.dealerId,
    trumpOccurrence: r.trumpOccurrence,
    scoreByPlayer: { ...r.scoreByPlayer },
  }));

  return {
    playerCount,
    roundsPlayed: history.length,
    players,
    winners: players.filter((p) => p.isWinner).map((p) => p.playerId),
    rounds,
  };
}

/**
 * Per-player King stat deltas derived from a game summary. One entry per seat
 * (humans and bots alike — the repo simply skips bots, which have no user_id).
 */
export function computeStatDeltas(summary: FinishedGameSummary): PlayerStatDelta[] {
  return summary.players.map((p) => {
    const modeBreakdown: Record<string, number> = {};
    for (const r of summary.rounds) {
      const s = r.scoreByPlayer[p.playerId];
      if (typeof s === 'number') {
        modeBreakdown[r.modeId] = (modeBreakdown[r.modeId] ?? 0) + s;
      }
    }
    return {
      playerId: p.playerId,
      roundsPlayed: summary.roundsPlayed,
      won: p.isWinner,
      finalTotal: p.finalTotal,
      totalScore: p.finalTotal,
      bestGameScore: p.finalTotal,
      modeBreakdown,
    };
  });
}
