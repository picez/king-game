// ---------------------------------------------------------------------------
// 51 (Syrian 51) stats aggregator (pure; FIFTYONE-STATS-1).
//
// Mirrors preferansStats.ts / tarneebStats.ts: turns a FINISHED authoritative
// FiftyOneState into the game-agnostic records the stats layer persists. NO DB,
// NO React, NO engine mutation — plain data in engine-`playerId` space, unit-
// testable without a database and never touching gameplay/rules.
//
// 51 is a 2–4 player, EACH-FOR-THEMSELVES cutthroat rummy (no partnerships). The
// match runs until one player remains un-eliminated — that seat is the unique
// `winnerSeat`; every other seat has been eliminated (running penalty ≥ 510,
// 51_RULES §12). Beyond win/loss we record ONLY public, score-level facts: each
// seat's FINAL running penalty (lower is better), whether it was eliminated, and
// how many rounds the match lasted. NEVER any card / hand / draw-pile / meld /
// discard detail (51_RULES §14).
// ---------------------------------------------------------------------------

import type { FiftyOneState } from '../games/fiftyOne/types';

/** One seat's outcome in a finished 51 game (engine-id space; no user id). */
export interface FiftyOnePlayerResult {
  seatIndex: number;
  playerId: string;
  name: string;
  type: 'human' | 'ai';
  avatar?: string;
  /** Unique match winner (last seat standing). False for every other seat. */
  isWinner: boolean;
  /** This seat's FINAL running penalty (lower is better; §12). */
  finalPenalty: number;
  /** Whether this seat was eliminated (penalty ≥ target). True for all losers. */
  eliminated: boolean;
  // Stage 37.3 telemetry (from state.telemetry; all false on legacy states).
  /** Won ≥1 round on the very first move this game. */
  instantRoundWin: boolean;
  /** Never opened (≥51) a single round this whole game (comedy). */
  neverOpenedGame: boolean;
  /** Was dealt ≥2 jokers in one round's hand this game. */
  twoJokerDeal: boolean;
  /** Never took the flat-100 (never-opened) penalty this whole game. */
  noHundredGame: boolean;
}

/** Everything the stats layer needs about one finished 51 game. */
export interface FiftyOneFinishedSummary {
  playerCount: number;
  players: FiftyOnePlayerResult[];
  /** playerIds that won (exactly 1 — 51 always has a single last-seat-standing). */
  winners: string[];
  winnerSeat: number | null;
  /** Final running penalty per seat (index = seatIndex). */
  finalPenalties: number[];
  /** Rounds played in the match (state.roundNumber at finish). */
  roundsPlayed: number;
}

/** Per-player 51 stat contribution from ONE finished game. */
export interface FiftyOneStatDelta {
  playerId: string;
  won: boolean;         // this seat is the unique winner (last standing)
  lost: boolean;        // a DIFFERENT seat won
  /** This seat's final running penalty (total/best tracking; lower is better). */
  finalPenalty: number;
  eliminated: boolean;  // this seat crossed the elimination target
  roundsPlayed: number; // rounds in this match (same for every seat)
  // Stage 37.3 per-game telemetry booleans (→ 0/1 stat counters).
  instantRoundWin: boolean;
  neverOpenedGame: boolean;
  twoJokerDeal: boolean;
  noHundredGame: boolean;
}

/** True only for a finished 51 match. */
export function isFinishedFiftyOneGame(state: FiftyOneState | null): state is FiftyOneState {
  return !!state && state.phase === 'game_finished';
}

/** Summarises a finished 51 game in engine-id space (public, score-level only). */
export function summarizeFinishedFiftyOneGame(state: FiftyOneState): FiftyOneFinishedSummary {
  const winnerSeat = state.winnerSeat;
  const finalPenalties = state.scoresBySeat.slice(0, state.playerCount);
  const tel = state.telemetry; // may be undefined on a legacy finished state

  const players: FiftyOnePlayerResult[] = state.players.map((p) => {
    const seat = p.seatIndex;
    return {
      seatIndex: seat,
      playerId: p.id,
      name: p.name,
      type: p.type === 'ai' ? 'ai' : 'human',
      avatar: (p as { avatar?: string }).avatar,
      isWinner: winnerSeat != null && seat === winnerSeat,
      finalPenalty: finalPenalties[seat] ?? 0,
      eliminated: state.eliminatedSeats[seat] === true,
      instantRoundWin: tel?.instantRoundWinBySeat[seat] === true,
      neverOpenedGame: tel?.neverOpenedGameBySeat[seat] === true,
      twoJokerDeal: tel?.twoJokerDealBySeat[seat] === true,
      // "No hundred all game" — the seat NEVER took the flat-100 penalty.
      noHundredGame: tel != null && tel.tookHundredBySeat[seat] !== true,
    };
  });

  return {
    playerCount: state.playerCount,
    players,
    winners: players.filter((p) => p.isWinner).map((p) => p.playerId),
    winnerSeat,
    finalPenalties,
    roundsPlayed: state.roundNumber,
  };
}

/** Per-player 51 stat deltas (one per seat; the repo skips bots). */
export function computeFiftyOneStatDeltas(summary: FiftyOneFinishedSummary): FiftyOneStatDelta[] {
  return summary.players.map((p) => ({
    playerId: p.playerId,
    won: p.isWinner,
    lost: !p.isWinner,
    finalPenalty: p.finalPenalty,
    eliminated: p.eliminated,
    roundsPlayed: summary.roundsPlayed,
    instantRoundWin: p.instantRoundWin,
    neverOpenedGame: p.neverOpenedGame,
    twoJokerDeal: p.twoJokerDeal,
    noHundredGame: p.noHundredGame,
  }));
}

/**
 * Content fingerprint of a finished 51 game (player count + winner seat + final
 * penalties + winner set). Two recordings of the SAME finished game share it; the
 * server uses it to avoid double-recording on reconnect/rebroadcast (mirrors
 * preferansFinishSignature). Contains NO private card data.
 */
export function fiftyOneFinishSignature(state: FiftyOneState): string {
  const summary = summarizeFinishedFiftyOneGame(state);
  const penalties = summary.finalPenalties.join(':');
  const winners = [...summary.winners].sort().join(',');
  return `fifty-one|${state.playerCount}|${state.winnerSeat ?? 'none'}|${penalties}|${winners}`;
}

/** Full, public, derived 51 stats for one user (all outcome/score-level). */
export interface FiftyOneStatsView {
  gameType: 'fifty-one';
  gamesPlayed: number;
  gamesWon: number;    // matches the user won (last seat standing)
  gamesLost: number;   // matches a different player won
  winRate: number | null;          // 0..100 integer; null when no games
  roundsPlayed: number;            // total rounds across all games
  timesEliminated: number;         // games in which the user was eliminated
  totalPenalty: number;            // cumulative final penalty (lower is better)
  averagePenalty: number | null;   // rounded mean final penalty; null when none
  bestPenalty: number | null;      // lowest (best) final penalty across games
  // Stage 37.3 telemetry counters (games where the thing happened at least once).
  gamesWithInstantRoundWin: number;
  gamesNeverOpened: number;
  gamesWithTwoJokerDeal: number;
  gamesWithNoHundred: number;
  lastGameAt: string | null;
}
