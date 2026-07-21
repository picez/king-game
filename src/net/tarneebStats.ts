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
import { isSoloTarneeb, teamOfSeat } from '../games/tarneeb/rules';

/** Storage game_type for a finished game — solo is a SEPARATE key so it never
 *  merges into (or corrupts) the released pairs aggregates (Stage 28.4). */
export function tarneebStatsGameType(state: TarneebState): 'tarneeb' | 'tarneeb-solo' {
  return isSoloTarneeb(state) ? 'tarneeb-solo' : 'tarneeb';
}

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
  /** Stage 37.3: this seat declared ≥1 contract this game and FAILED none. */
  cleanContractGame: boolean;
  /** Highest bid this seat MADE as declarer this game (0 when none). */
  maxWinningBid: number;
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
  /** This game counted as a clean-contract game for this seat (Stage 37.3). */
  cleanContractGame: boolean;
  /** Highest bid this seat made as declarer this game (running max across games). */
  maxWinningBid: number;
}

/** True only for a finished Tarneeb match. */
export function isFinishedTarneebGame(state: TarneebState | null): state is TarneebState {
  return !!state && state.phase === 'game_finished';
}

/**
 * Solo summary (per-seat, no teams; Stage 28.4). Every seat is its own side:
 * winner = `soloWinnerSeat`, "teamFinalScore" carries the SEAT's own final score,
 * declarer/contract tallies come from the per-seat `soloHandHistory`. `winnerTeam`
 * stays null and `finalScoresByTeam` is a placeholder (unused for solo — the
 * per-seat totals live on each player). Reuses the same record shape so the DB /
 * delta / view code is variant-agnostic.
 */
function summarizeFinishedSoloTarneebGame(state: TarneebState): TarneebFinishedSummary {
  const scores = state.scoresBySeat ?? [0, 0, 0, 0];
  const history = state.soloHandHistory ?? [];
  const winnerSeat = state.soloWinnerSeat ?? -1;

  const declarerCount: Record<number, number> = {};
  const contractsMade: Record<number, number> = {};
  const contractsFailed: Record<number, number> = {};
  const maxWinningBid: Record<number, number> = {};
  for (const h of history) {
    declarerCount[h.declarerSeat] = (declarerCount[h.declarerSeat] ?? 0) + 1;
    if (h.made) {
      contractsMade[h.declarerSeat] = (contractsMade[h.declarerSeat] ?? 0) + 1;
      maxWinningBid[h.declarerSeat] = Math.max(maxWinningBid[h.declarerSeat] ?? 0, h.bid);
    } else contractsFailed[h.declarerSeat] = (contractsFailed[h.declarerSeat] ?? 0) + 1;
  }

  const players: TarneebPlayerResult[] = state.players.map((p) => ({
    seatIndex: p.seatIndex,
    playerId: p.id,
    name: p.name,
    type: p.type === 'ai' ? 'ai' : 'human',
    avatar: (p as { avatar?: string }).avatar,
    team: teamOfSeat(p.seatIndex), // filler — solo has no real team dimension
    isWinner: p.seatIndex === winnerSeat,
    teamFinalScore: scores[p.seatIndex], // the SEAT's own final score in solo
    declarerCount: declarerCount[p.seatIndex] ?? 0,
    contractsMade: contractsMade[p.seatIndex] ?? 0,
    contractsFailed: contractsFailed[p.seatIndex] ?? 0,
    cleanContractGame: (declarerCount[p.seatIndex] ?? 0) >= 1 && (contractsFailed[p.seatIndex] ?? 0) === 0,
    maxWinningBid: maxWinningBid[p.seatIndex] ?? 0,
  }));

  const seatToPlayerId = new Map(state.players.map((p) => [p.seatIndex, p.id]));
  const rounds: TarneebRoundRecord[] = history.map((h, i) => {
    const scoreByPlayer: Record<string, number> = {};
    for (const p of state.players) {
      scoreByPlayer[seatToPlayerId.get(p.seatIndex)!] = h.deltaBySeat[p.seatIndex];
    }
    return { roundIndex: i, modeId: `${h.bid}${SUIT_CODE[h.trumpSuit]}`, scoreByPlayer };
  });

  return {
    playerCount: state.players.length,
    players,
    winners: players.filter((p) => p.isWinner).map((p) => p.playerId), // exactly 1
    winnerTeam: null,
    finalScoresByTeam: { A: 0, B: 0 }, // placeholder; per-seat totals are on players
    handsPlayed: history.length,
    rounds,
  };
}

/** Summarises a finished Tarneeb game in engine-id space (public, score-only). */
export function summarizeFinishedTarneebGame(state: TarneebState): TarneebFinishedSummary {
  if (isSoloTarneeb(state)) return summarizeFinishedSoloTarneebGame(state);
  const winnerTeam = state.winnerTeam;
  const finalScoresByTeam: Record<Team, number> = {
    A: state.scoresByTeam.A,
    B: state.scoresByTeam.B,
  };

  // Per-seat declarer / contract tallies from the score-only hand history.
  const declarerCount: Record<number, number> = {};
  const contractsMade: Record<number, number> = {};
  const contractsFailed: Record<number, number> = {};
  const maxWinningBid: Record<number, number> = {};
  for (const h of state.handHistory) {
    declarerCount[h.declarerSeat] = (declarerCount[h.declarerSeat] ?? 0) + 1;
    if (h.made) {
      contractsMade[h.declarerSeat] = (contractsMade[h.declarerSeat] ?? 0) + 1;
      maxWinningBid[h.declarerSeat] = Math.max(maxWinningBid[h.declarerSeat] ?? 0, h.bid);
    } else contractsFailed[h.declarerSeat] = (contractsFailed[h.declarerSeat] ?? 0) + 1;
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
      cleanContractGame: (declarerCount[p.seatIndex] ?? 0) >= 1 && (contractsFailed[p.seatIndex] ?? 0) === 0,
      maxWinningBid: maxWinningBid[p.seatIndex] ?? 0,
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
    cleanContractGame: p.cleanContractGame,
    maxWinningBid: p.maxWinningBid,
  }));
}

/**
 * Content fingerprint of a finished Tarneeb game (player count + winning team +
 * final scores + winner set). Two recordings of the SAME finished game share it;
 * the server uses it to avoid double-recording on reconnect/rebroadcast (mirrors
 * debercFinishSignature).
 */
export function tarneebFinishSignature(state: TarneebState): string {
  const gt = tarneebStatsGameType(state); // 'tarneeb' | 'tarneeb-solo' → keys never collide
  const summary = summarizeFinishedTarneebGame(state);
  const winners = summary.winners.slice().sort().join(',');
  // Per-seat totals cover both variants (team scores are 0 in solo).
  const scores = summary.players.map((p) => p.teamFinalScore).join(':');
  const winMarker = state.winnerTeam ?? (state.soloWinnerSeat ?? 'none');
  return `${gt}|${state.players.length}|${winMarker}|${scores}|${winners}`;
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
  cleanContractGames: number;      // games with ≥1 declared + 0 failed (Stage 37.3)
  maxWinningBid: number;           // highest bid ever made as declarer (0 when none)
  lastGameAt: string | null;
}
