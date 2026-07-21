// ---------------------------------------------------------------------------
// Poker stats aggregator (pure; POKER-STATS-1).
//
// Mirrors fiftyOneStats.ts: turns a FINISHED authoritative PokerState into the
// game-agnostic records the stats layer persists. NO DB, NO React, NO engine
// mutation — plain data in engine-`playerId` space, unit-testable without a
// database and never touching gameplay/rules.
//
// Poker is a 2–6 player, EACH-FOR-THEMSELVES No-Limit Texas Hold'em match that
// runs until one seat holds every chip — that seat is the unique `winnerSeat`.
// Beyond win/loss we record ONLY public, score-level facts drawn from the match
// telemetry (hands/showdowns/pots won, biggest pot, all-in wins, royal flushes).
// NEVER any hole card / deck / burn detail (POKER_RULES §13).
// ---------------------------------------------------------------------------

import type { PokerState } from '../games/poker/types';

/** One seat's outcome in a finished poker match (engine-id space; no user id). */
export interface PokerPlayerResult {
  seatIndex: number;
  playerId: string;
  name: string;
  type: 'human' | 'ai';
  avatar?: string;
  /** Unique match winner (holds all chips). False for every other seat. */
  isWinner: boolean;
  /** Match telemetry counters for this seat. */
  handsPlayed: number;
  handsWon: number;
  showdownsWon: number;
  potsWon: number;
  biggestPot: number;
  allInsWon: number;
  royalFlushes: number;
}

/** Everything the stats layer needs about one finished poker match. */
export interface PokerFinishedSummary {
  playerCount: number;
  players: PokerPlayerResult[];
  /** playerIds that won (exactly 1 — poker always has a single chip leader). */
  winners: string[];
  winnerSeat: number | null;
  /** Hands played in the match (state.handNumber at finish). */
  handsPlayed: number;
}

/** Per-player poker stat contribution from ONE finished match. */
export interface PokerStatDelta {
  playerId: string;
  won: boolean;   // this seat is the unique winner
  lost: boolean;  // a DIFFERENT seat won
  handsPlayed: number;
  handsWon: number;
  showdownsWon: number;
  potsWon: number;
  biggestPot: number;   // largest single pot this seat won in the match
  allInsWon: number;
  royalFlushes: number;
}

/** True only for a finished poker match. */
export function isFinishedPokerGame(state: PokerState | null): state is PokerState {
  return !!state && state.phase === 'game_finished';
}

/** Summarises a finished poker match in engine-id space (public, score-level only). */
export function summarizeFinishedPokerGame(state: PokerState): PokerFinishedSummary {
  const winnerSeat = state.winnerSeat;
  const tel = state.telemetry;
  const players: PokerPlayerResult[] = state.players.map((p) => {
    const seat = p.seatIndex;
    return {
      seatIndex: seat,
      playerId: p.id,
      name: p.name,
      type: p.type === 'ai' ? 'ai' : 'human',
      avatar: (p as { avatar?: string }).avatar,
      isWinner: winnerSeat != null && seat === winnerSeat,
      handsPlayed: tel.handsPlayedBySeat[seat] ?? 0,
      handsWon: tel.handsWonBySeat[seat] ?? 0,
      showdownsWon: tel.showdownsWonBySeat[seat] ?? 0,
      potsWon: tel.potsWonBySeat[seat] ?? 0,
      biggestPot: tel.biggestPotBySeat[seat] ?? 0,
      allInsWon: tel.allInsWonBySeat[seat] ?? 0,
      royalFlushes: tel.royalFlushBySeat[seat] ?? 0,
    };
  });
  return {
    playerCount: state.playerCount,
    players,
    winners: players.filter((p) => p.isWinner).map((p) => p.playerId),
    winnerSeat,
    handsPlayed: state.handNumber,
  };
}

/** Per-player poker stat deltas (one per seat; the repo skips bots). */
export function computePokerStatDeltas(summary: PokerFinishedSummary): PokerStatDelta[] {
  return summary.players.map((p) => ({
    playerId: p.playerId,
    won: p.isWinner,
    lost: !p.isWinner,
    handsPlayed: p.handsPlayed,
    handsWon: p.handsWon,
    showdownsWon: p.showdownsWon,
    potsWon: p.potsWon,
    biggestPot: p.biggestPot,
    allInsWon: p.allInsWon,
    royalFlushes: p.royalFlushes,
  }));
}

/**
 * Content fingerprint of a finished poker match (player count + winner seat +
 * hands played + winner set). Two recordings of the SAME finished match share it;
 * the server uses it to avoid double-recording on reconnect/rebroadcast (mirrors
 * fiftyOneFinishSignature). Contains NO private card data.
 */
export function pokerFinishSignature(state: PokerState): string {
  const summary = summarizeFinishedPokerGame(state);
  const winners = [...summary.winners].sort().join(',');
  return `poker|${state.playerCount}|${state.winnerSeat ?? 'none'}|${state.handNumber}|${winners}`;
}

/** Full, public, derived poker stats for one user (all outcome/score-level). */
export interface PokerStatsView {
  gameType: 'poker';
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  winRate: number | null;   // 0..100 integer; null when no games
  handsPlayed: number;
  handsWon: number;
  showdownsWon: number;
  potsWon: number;
  biggestPot: number;       // largest single pot ever won
  allInsWon: number;
  royalFlushCount: number;
  lastGameAt: string | null;
}
