// ---------------------------------------------------------------------------
// Tarneeb stats aggregator (pure; TARNEEB-STATS-1).
//
// Mirrors debercStats.ts / durakStats.ts for Tarneeb: turns a FINISHED
// authoritative TarneebState into the game-agnostic records the stats layer
// persists. NO DB, NO React, NO engine mutation — plain data in engine-`playerId`
// space, unit-testable without a database and never touching gameplay/rules.
//
// Tarneeb is a 2v2 fixed-partnership game (Team A = seats 0&2, Team B = 1&3). A
// seat "wins" when its team is `winnerTeam`. Beyond win/loss we record ONLY
// public, score-level facts drawn from the score-only `handHistory`: how many
// hands were played, how often this seat declared, and how those contracts fared,
// plus the team's final cumulative score. NEVER any card/hand/trick detail (§13).
// ---------------------------------------------------------------------------

import type { Suit } from '../models/types';
import type { TarneebState, Team } from '../games/tarneeb/types';
import { teamOfSeat } from '../games/tarneeb/rules';

/** Single-letter suit code for a compact, word-free contract label (public). */
const SUIT_CODE: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };

/** One seat's outcome in a finished Tarneeb game (engine-id space; no user id). */
export interface TarneebPlayerResult {
  seatIndex: number;
  playerId: string;
  name: string;
  type: 'human' | 'ai';
  avatar?: string;
  team: Team;
  isWinner: boolean;
  /** This seat's team final cumulative score (both partners share it). */
  teamFinalScore: number;
  /** Hands this seat won the auction (was declarer). */
  declarerCount: number;
  /** Of those declarer hands: how many made / failed the contract. */
  contractsMade: number;
  contractsFailed: number;
}

/** A score-only per-hand record for durable `rounds` (never any cards). */
export interface TarneebRoundRecord {
  roundIndex: number;
  /** Compact bid+trump label, e.g. "9:spades". Public. */
  modeId: string;
  /** playerId → that player's TEAM score delta for the hand (both partners equal). */
  scoreByPlayer: Record<string, number>;
}

/** Everything the stats layer needs about one finished Tarneeb game. */
export interface TarneebFinishedSummary {
  playerCount: number;
  players: TarneebPlayerResult[];
  /** playerIds on the winning team (always 2 — a fixed pair). */
  winners: string[];
  winnerTeam: Team | null;
  finalScoresByTeam: Record<Team, number>;
  handsPlayed: number;
  /** Score-only per-hand history for durable rounds. */
  rounds: TarneebRoundRecord[];
}

/** Per-player Tarneeb stat contribution from ONE finished game. */
export interface TarneebStatDelta {
  playerId: string;
  won: boolean;
  /** This seat's team final cumulative score (best/worst/total tracking). */
  teamFinalScore: number;
  handsPlayed: number;
  declarerCount: number;
  contractsMade: number;
  contractsFailed: number;
}

/** True only for a finished Tarneeb match. */
export function isFinishedTarneebGame(state: TarneebState | null): state is TarneebState {
  return !!state && state.phase === 'game_finished';
}

/** Summarises a finished Tarneeb game in engine-id space (public, score-only). */
export function summarizeFinishedTarneebGame(state: TarneebState): TarneebFinishedSummary {
  const winnerTeam = state.winnerTeam;
  const finalScoresByTeam: Record<Team, number> = {
    A: state.scoresByTeam.A,
    B: state.scoresByTeam.B,
  };

  // Per-seat declarer / contract tallies from the score-only hand history.
  const declarerCount: Record<number, number> = {};
  const contractsMade: Record<number, number> = {};
  const contractsFailed: Record<number, number> = {};
  for (const h of state.handHistory) {
    declarerCount[h.declarerSeat] = (declarerCount[h.declarerSeat] ?? 0) + 1;
    if (h.made) contractsMade[h.declarerSeat] = (contractsMade[h.declarerSeat] ?? 0) + 1;
    else contractsFailed[h.declarerSeat] = (contractsFailed[h.declarerSeat] ?? 0) + 1;
  }

  const players: TarneebPlayerResult[] = state.players.map((p) => {
    const team = teamOfSeat(p.seatIndex);
    return {
      seatIndex: p.seatIndex,
      playerId: p.id,
      name: p.name,
      type: p.type === 'ai' ? 'ai' : 'human',
      avatar: (p as { avatar?: string }).avatar,
      team,
      isWinner: winnerTeam != null && team === winnerTeam,
      teamFinalScore: finalScoresByTeam[team],
      declarerCount: declarerCount[p.seatIndex] ?? 0,
      contractsMade: contractsMade[p.seatIndex] ?? 0,
      contractsFailed: contractsFailed[p.seatIndex] ?? 0,
    };
  });

  // Score-only rounds: each player gets its TEAM's delta for the hand.
  const seatToPlayerId = new Map(state.players.map((p) => [p.seatIndex, p.id]));
  const rounds: TarneebRoundRecord[] = state.handHistory.map((h, i) => {
    const scoreByPlayer: Record<string, number> = {};
    for (const p of state.players) {
      const pid = seatToPlayerId.get(p.seatIndex)!;
      scoreByPlayer[pid] = h.deltaByTeam[teamOfSeat(p.seatIndex)];
    }
    // Contract label = bid + a single-letter trump code (e.g. "9S"). Public, and
    // deliberately word-free so no card/suit vocabulary lands in durable rows.
    return { roundIndex: i, modeId: `${h.bid}${SUIT_CODE[h.trumpSuit]}`, scoreByPlayer };
  });

  return {
    playerCount: state.players.length,
    players,
    winners: players.filter((p) => p.isWinner).map((p) => p.playerId),
    winnerTeam,
    finalScoresByTeam,
    handsPlayed: state.handHistory.length,
    rounds,
  };
}

/** Per-player Tarneeb stat deltas (one per seat; the repo skips bots). */
export function computeTarneebStatDeltas(summary: TarneebFinishedSummary): TarneebStatDelta[] {
  return summary.players.map((p) => ({
    playerId: p.playerId,
    won: p.isWinner,
    teamFinalScore: p.teamFinalScore,
    handsPlayed: summary.handsPlayed,
    declarerCount: p.declarerCount,
    contractsMade: p.contractsMade,
    contractsFailed: p.contractsFailed,
  }));
}

/**
 * Content fingerprint of a finished Tarneeb game (player count + winning team +
 * final scores + winner set). Two recordings of the SAME finished game share it;
 * the server uses it to avoid double-recording on reconnect/rebroadcast (mirrors
 * debercFinishSignature).
 */
export function tarneebFinishSignature(state: TarneebState): string {
  const winners = summarizeFinishedTarneebGame(state).winners.slice().sort().join(',');
  const scores = `${state.scoresByTeam.A}:${state.scoresByTeam.B}`;
  return `tarneeb|${state.players.length}|${state.winnerTeam ?? 'none'}|${scores}|${winners}`;
}

/** Full, public, derived Tarneeb stats for one user (all outcome/score-level). */
export interface TarneebStatsView {
  gameType: 'tarneeb';
  gamesPlayed: number;
  gamesWon: number;    // matches the user's team won
  gamesLost: number;   // matches the user's team lost
  winRate: number | null;          // 0..100 integer; null when no games
  handsPlayed: number;             // total hands across all games
  handsAsDeclarer: number;         // hands the user was the declarer
  contractsMade: number;           // declarer hands made
  contractsFailed: number;         // declarer hands set
  contractSuccessRate: number | null; // 0..100 over made+failed; null when none
  totalTeamScore: number;          // sum of team final scores (can be negative)
  averageTeamScore: number | null; // rounded mean over games; null when none
  bestGameScore: number | null;    // best (highest) team final score
  worstGameScore: number | null;   // worst (lowest) team final score
  lastGameAt: string | null;
}
