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

/**
 * Aggregate-only combination counts for ONE seat/user (Stage 13.8). Only the melds
 * that actually SCORED are counted, by their existing Deberc kind — NEVER any card.
 * `deberc` (the jackpot run) ends the match instantly, so it is tracked separately
 * as `jackpotCount`, not here.
 */
export interface DebercMeldCounts {
  terz: number;      // терц — a 3-card sequence (20)
  platina: number;   // платіна — a longer sequence (50)
  bella: number;     // белла — trump K+Q earned in play (20)
  total: number;     // terz + platina + bella
  /** Hands in which this seat scored at least one meld. */
  handsWithMeld: number;
}

export function emptyDebercMeldCounts(): DebercMeldCounts {
  return { terz: 0, platina: 0, bella: 0, total: 0, handsWithMeld: 0 };
}

/**
 * Tallies the scoring melds per seat across all scored hands of a match, reading
 * ONLY the score-only `handHistory[].meldTally` (seat + kind). Legacy results with
 * no `meldTally` simply contribute nothing (graceful).
 */
function tallyMeldsBySeat(state: DebercState): Map<number, DebercMeldCounts> {
  const bySeat = new Map<number, DebercMeldCounts>();
  const at = (seat: number): DebercMeldCounts => {
    let c = bySeat.get(seat);
    if (!c) { c = emptyDebercMeldCounts(); bySeat.set(seat, c); }
    return c;
  };
  for (const hand of state.handHistory) {
    const seatsThisHand = new Set<number>();
    for (const m of hand.meldTally ?? []) {
      const c = at(m.seat);
      if (m.kind === 'terz') c.terz++;
      else if (m.kind === 'platina') c.platina++;
      else if (m.kind === 'bella') c.bella++;
      else continue; // 'deberc' jackpot → counted as jackpotCount, not a meld here
      c.total++;
      seatsThisHand.add(m.seat);
    }
    for (const seat of seatsThisHand) at(seat).handsWithMeld++;
  }
  return bySeat;
}

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
  /** This seat's scoring-meld counts this match (aggregate-only, no cards). */
  melds: DebercMeldCounts;
  /** This seat's team FINAL cumulative match score (matchScore; can be negative). */
  finalTeamScore: number;
  /**
   * Stage 37.3: did this seat's team ever take a «Бейт» (об'яз under-score) mark in
   * ANY hand this match? «Бейт» is the DISPLAY label for the об'яз-underperform mark,
   * recorded on `DebercHandResult.hvTeam` (internal field names are swapped vs the
   * labels — see DEBERC_RULES §7). Used for the "win without a Бейт" badge.
   */
  teamHadBeyt: boolean;
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
  /** Scored hands this match (same denominator for every seat). */
  handsPlayed: number;
}

/** Per-player Deberc stat contribution from ONE finished game. */
export interface DebercStatDelta {
  playerId: string;
  won: boolean;
  /** Won specifically via a деберц jackpot (credited to winners only). */
  isJackpot: boolean;
  /** This seat's scoring-meld counts this game (added to the user's cache). */
  melds: DebercMeldCounts;
  /** Scored hands this game (added to the user's handsPlayed denominator). */
  handsPlayed: number;
  /** This seat's team final match score this game (best/worst tracking; Stage 37.3). */
  finalTeamScore: number;
  /** True when this seat scored NO meld at all this game (comedy badge). */
  noMeldGame: boolean;
  /** True when this seat WON and its team never took a «Бейт» mark this game. */
  wonNoBeyt: boolean;
}

/** True only for a finished Deberc match. */
export function isFinishedDebercGame(state: DebercState | null): state is DebercState {
  return !!state && state.phase === 'finished';
}

/** Summarises a finished Deberc game in engine-id space. */
export function summarizeFinishedDebercGame(state: DebercState): DebercFinishedSummary {
  const winnerTeam = state.winnerTeam;
  const meldsBySeat = tallyMeldsBySeat(state);
  const matchScore = state.matchScore ?? [];
  // Teams that took a «Бейт» (об'яз under-score = internal hvTeam) in ANY hand.
  const beytTeams = new Set<number>();
  for (const h of state.handHistory) {
    if (typeof h.hvTeam === 'number') beytTeams.add(h.hvTeam);
  }
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
      melds: meldsBySeat.get(p.seatIndex) ?? emptyDebercMeldCounts(),
      finalTeamScore: matchScore[team] ?? 0,
      teamHadBeyt: beytTeams.has(team),
    };
  });
  return {
    playerCount: state.players.length,
    players,
    winners: players.filter((p) => p.isWinner).map((p) => p.playerId),
    winnerTeam,
    isJackpot: state.jackpot === true,
    handsPlayed: state.handHistory.length,
  };
}

/** Per-player Deberc stat deltas (one per seat; the repo skips bots). */
export function computeDebercStatDeltas(summary: DebercFinishedSummary): DebercStatDelta[] {
  return summary.players.map((p) => ({
    playerId: p.playerId,
    won: p.isWinner,
    isJackpot: summary.isJackpot && p.isWinner,
    melds: p.melds,
    handsPlayed: summary.handsPlayed,
    finalTeamScore: p.finalTeamScore,
    noMeldGame: p.melds.total === 0,
    wonNoBeyt: p.isWinner && !p.teamHadBeyt,
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

/**
 * Aggregate combination stats surfaced to the user (Stage 13.8). Counts + a meld
 * frequency; per-type percentages are derived on the client from count/handsPlayed.
 */
export interface DebercCombinationStats {
  terz: number;
  platina: number;
  bella: number;
  total: number;             // terz + platina + bella across all games
  handsPlayed: number;       // scored hands across all games (the denominator)
  handsWithMeld: number;     // hands where the user scored ≥1 meld
  /** handsWithMeld / handsPlayed as a 0..100 integer, or null when no hands. */
  meldRate: number | null;
}

/** Full, public, derived Deberc stats for one user (all outcome/aggregate-level). */
export interface DebercStatsView {
  gameType: 'deberc';
  gamesPlayed: number;
  gamesWon: number;    // matches the user's team won
  gamesLost: number;   // matches the user's team lost
  winRate: number | null;      // 0..100 integer; null when no games
  jackpotCount: number;        // matches won via a деберц jackpot
  jackpotRate: number | null;  // 0..100 integer over games played; null when none
  /** Meld/combination breakdown (aggregate-only; no cards). */
  combinations: DebercCombinationStats;
  /** Best/worst final team match score across games (Stage 37.3); null when none. */
  bestGameScore: number | null;
  worstGameScore: number | null;
  /** Games finished with NO scoring meld at all (comedy badge). */
  gamesWithNoMeld: number;
  /** Games won without the team ever taking a «Бейт» mark. */
  gamesWonNoBeyt: number;
  lastGameAt: string | null;
}
