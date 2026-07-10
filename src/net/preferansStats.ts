// ---------------------------------------------------------------------------
// Preferans stats aggregator (pure; PREFERANS-STATS-1).
//
// Mirrors tarneebStats.ts for Preferans: turns a FINISHED authoritative
// PreferansState into the game-agnostic records the stats layer persists. NO DB,
// NO React, NO engine mutation — plain data in engine-`playerId` space, unit-
// testable without a database and never touching gameplay/rules.
//
// Preferans is a 3-player, EACH-FOR-THEMSELVES game (no partnerships). A seat
// "wins" when it is the unique `winnerSeat`; a tie at/over target is a DRAW
// (winnerSeat null → no winner). Beyond win/loss/draw we record ONLY public,
// score-level facts drawn from the score-only `handHistory`: how many hands were
// played, how often this seat declared, and how those contracts fared, plus each
// seat's final cumulative score. NEVER any card / hand / talon / discard / trick
// detail (PREFERANS_RULES §13/§14).
// ---------------------------------------------------------------------------

import type { Suit } from '../models/types';
import type { Bid, PreferansState } from '../games/preferans/types';

const NUM_SEATS = 3;

/** Single-letter suit code for a compact, word-free contract label (public). */
const SUIT_CODE: Record<Suit, string> = { spades: 'S', hearts: 'H', diamonds: 'D', clubs: 'C' };

/** Compact, word-free contract label, e.g. "6S", "7NT", "10H". Public. */
export function preferansContractLabel(contract: Bid): string {
  return `${contract.level}${contract.suit === 'NT' ? 'NT' : SUIT_CODE[contract.suit]}`;
}

/** One seat's outcome in a finished Preferans game (engine-id space; no user id). */
export interface PreferansPlayerResult {
  seatIndex: number;
  playerId: string;
  name: string;
  type: 'human' | 'ai';
  avatar?: string;
  /** Unique match winner (false for the two non-winners AND for everyone on a draw). */
  isWinner: boolean;
  /** This seat's final cumulative score (may be negative). */
  finalScore: number;
  /** Hands this seat won the auction (was declarer). */
  declarerCount: number;
  /** Of those declarer hands: how many made / failed the contract. */
  contractsMade: number;
  contractsFailed: number;
}

/** A score-only per-hand record for durable `rounds` (never any cards). */
export interface PreferansRoundRecord {
  roundIndex: number;
  /** Compact contract label, e.g. "7H" / "6NT". Public. */
  modeId: string;
  /** playerId → that seat's score delta for the hand. */
  scoreByPlayer: Record<string, number>;
}

/** Everything the stats layer needs about one finished Preferans game. */
export interface PreferansFinishedSummary {
  playerCount: number;
  players: PreferansPlayerResult[];
  /** playerIds that won (exactly 1, or 0 on a draw). */
  winners: string[];
  winnerSeat: number | null;
  isDraw: boolean;
  /** Final cumulative score per seat (index = seatIndex). */
  finalScores: number[];
  handsPlayed: number;
  /** Score-only per-hand history for durable rounds. */
  rounds: PreferansRoundRecord[];
}

/** Per-player Preferans stat contribution from ONE finished game. */
export interface PreferansStatDelta {
  playerId: string;
  won: boolean;      // this seat is the unique winner
  lost: boolean;     // a DIFFERENT seat won (a real loss; false on a draw)
  drawn: boolean;    // the match was a draw (no winner)
  /** This seat's final cumulative score (best/worst/total tracking). */
  finalScore: number;
  handsPlayed: number;
  declarerCount: number;
  contractsMade: number;
  contractsFailed: number;
}

/** True only for a finished Preferans match. */
export function isFinishedPreferansGame(state: PreferansState | null): state is PreferansState {
  return !!state && state.phase === 'game_finished';
}

/** Summarises a finished Preferans game in engine-id space (public, score-only). */
export function summarizeFinishedPreferansGame(state: PreferansState): PreferansFinishedSummary {
  const winnerSeat = state.winnerSeat;
  const finalScores = state.scores.slice(0, NUM_SEATS);

  // Per-seat declarer / contract tallies from the score-only hand history.
  const declarerCount: Record<number, number> = {};
  const contractsMade: Record<number, number> = {};
  const contractsFailed: Record<number, number> = {};
  for (const h of state.handHistory) {
    declarerCount[h.declarerSeat] = (declarerCount[h.declarerSeat] ?? 0) + 1;
    if (h.made) contractsMade[h.declarerSeat] = (contractsMade[h.declarerSeat] ?? 0) + 1;
    else contractsFailed[h.declarerSeat] = (contractsFailed[h.declarerSeat] ?? 0) + 1;
  }

  const players: PreferansPlayerResult[] = state.players.map((p) => ({
    seatIndex: p.seatIndex,
    playerId: p.id,
    name: p.name,
    type: p.type === 'ai' ? 'ai' : 'human',
    avatar: (p as { avatar?: string }).avatar,
    isWinner: winnerSeat != null && p.seatIndex === winnerSeat,
    finalScore: finalScores[p.seatIndex] ?? 0,
    declarerCount: declarerCount[p.seatIndex] ?? 0,
    contractsMade: contractsMade[p.seatIndex] ?? 0,
    contractsFailed: contractsFailed[p.seatIndex] ?? 0,
  }));

  // Score-only rounds: each player gets its own per-hand score delta + the public
  // contract label (deliberately word-free so no card/suit vocabulary is durable).
  const seatToPlayerId = new Map(state.players.map((p) => [p.seatIndex, p.id]));
  const rounds: PreferansRoundRecord[] = state.handHistory.map((h, i) => {
    const scoreByPlayer: Record<string, number> = {};
    for (const p of state.players) {
      scoreByPlayer[seatToPlayerId.get(p.seatIndex)!] = h.deltaBySeat[p.seatIndex] ?? 0;
    }
    return { roundIndex: i, modeId: preferansContractLabel(h.contract), scoreByPlayer };
  });

  return {
    playerCount: state.players.length,
    players,
    winners: players.filter((p) => p.isWinner).map((p) => p.playerId),
    winnerSeat,
    isDraw: winnerSeat == null,
    finalScores,
    handsPlayed: state.handHistory.length,
    rounds,
  };
}

/** Per-player Preferans stat deltas (one per seat; the repo skips bots). */
export function computePreferansStatDeltas(summary: PreferansFinishedSummary): PreferansStatDelta[] {
  return summary.players.map((p) => ({
    playerId: p.playerId,
    won: p.isWinner,
    lost: !summary.isDraw && !p.isWinner,
    drawn: summary.isDraw,
    finalScore: p.finalScore,
    handsPlayed: summary.handsPlayed,
    declarerCount: p.declarerCount,
    contractsMade: p.contractsMade,
    contractsFailed: p.contractsFailed,
  }));
}

/**
 * Content fingerprint of a finished Preferans game (player count + winner seat +
 * final scores + winner set). Two recordings of the SAME finished game share it;
 * the server uses it to avoid double-recording on reconnect/rebroadcast (mirrors
 * tarneebFinishSignature).
 */
export function preferansFinishSignature(state: PreferansState): string {
  const summary = summarizeFinishedPreferansGame(state);
  const scores = summary.finalScores.join(':');
  const winners = [...summary.winners].sort().join(',');
  return `preferans|${state.players.length}|${state.winnerSeat ?? 'none'}|${scores}|${winners}`;
}

/** Full, public, derived Preferans stats for one user (all outcome/score-level). */
export interface PreferansStatsView {
  gameType: 'preferans';
  gamesPlayed: number;
  gamesWon: number;    // matches the user won outright
  gamesLost: number;   // matches a DIFFERENT player won
  gamesDrawn: number;  // matches that ended in a draw
  winRate: number | null;             // 0..100 integer; null when no games
  handsPlayed: number;                // total hands across all games
  handsAsDeclarer: number;            // hands the user was the declarer
  contractsMade: number;              // declarer hands made
  contractsFailed: number;            // declarer hands set
  contractSuccessRate: number | null; // 0..100 over made+failed; null when none
  totalScore: number;                 // sum of final scores (can be negative)
  averageScore: number | null;        // rounded mean over games; null when none
  bestGameScore: number | null;       // best (highest) final score
  worstGameScore: number | null;      // worst (lowest) final score
  lastGameAt: string | null;
}
