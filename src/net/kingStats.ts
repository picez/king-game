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

/** Per-mode aggregate for one player: how many rounds + their summed score. */
export interface ModeAgg {
  rounds: number;
  totalScore: number;
}

/** The seven King modes; everything except `trump` is a negative mode. */
export const KING_MODES = [
  'no_tricks', 'no_hearts', 'no_jacks', 'no_queens', 'king_of_hearts', 'last_two_tricks', 'trump',
] as const;
export const TRUMP_MODE = 'trump';

/** True for the six negative modes (anything that is not Trump). */
export function isNegativeMode(modeId: string): boolean {
  return modeId !== TRUMP_MODE;
}

/**
 * Per-player King stat contribution from ONE finished game. The repository adds
 * these into the user's cached `user_stats` row (incremental, idempotent because
 * a game is recorded at most once). `bestGameScore` is a max, `worstGameScore` a
 * min (higher total is better in King). All fields are derived from the
 * score-only roundHistory — never from cards.
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
  /** This game's final total (repo keeps the min across games). */
  worstGameScore: number;
  /** Count of Trump rounds this game (per-dealer Trump games this player saw). */
  trumpRoundsPlayed: number;
  /** Count of negative-mode rounds this game (roundsPlayed − trumpRoundsPlayed). */
  negativeRoundsPlayed: number;
  /** modeId → { rounds, totalScore } for this player. */
  modeBreakdown: Record<string, ModeAgg>;
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
    const modeBreakdown: Record<string, ModeAgg> = {};
    let trumpRoundsPlayed = 0;
    let roundsCounted = 0;
    for (const r of summary.rounds) {
      const s = r.scoreByPlayer[p.playerId];
      if (typeof s !== 'number') continue;
      roundsCounted++;
      const agg = modeBreakdown[r.modeId] ?? { rounds: 0, totalScore: 0 };
      agg.rounds += 1;
      agg.totalScore += s;
      modeBreakdown[r.modeId] = agg;
      if (r.modeId === TRUMP_MODE) trumpRoundsPlayed += 1;
    }
    return {
      playerId: p.playerId,
      roundsPlayed: summary.roundsPlayed,
      won: p.isWinner,
      finalTotal: p.finalTotal,
      totalScore: p.finalTotal,
      bestGameScore: p.finalTotal,
      worstGameScore: p.finalTotal,
      trumpRoundsPlayed,
      negativeRoundsPlayed: roundsCounted - trumpRoundsPlayed,
      modeBreakdown,
    };
  });
}
