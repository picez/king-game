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
  /**
   * Stage 37.3 telemetry — set only when the game FINISHED on an all-sixes attack:
   * the just-resolved final bout (`lastBout`) had every attack card a six AND the
   * fool actually TOOK it (fool == defender of that bout). `winnerId` is the seat
   * that attacked (delivered the six humiliation); `loserId` is the fool. Derived
   * from the PUBLIC final table cards only — no counter here ever exposes a card.
   */
  sixAttack: { winnerId: string; loserId: string } | null;
}

/** Per-player Durak stat contribution from ONE finished game. */
export interface DurakStatDelta {
  playerId: string;
  won: boolean;
  isFool: boolean;
  isDraw: boolean;
  /** This seat won by finishing the fool with an all-sixes attack (Stage 37.3). */
  wonBySixes: boolean;
  /** This seat was the fool who took an all-sixes finishing attack. */
  lostBySixes: boolean;
}

/**
 * Detects an all-sixes finishing attack from the FINAL public state (Stage 37.3):
 * the game ended (non-draw, a fool exists), the just-resolved `lastBout` had EVERY
 * attack card a six, and the fool is the defender who TOOK that bout. Returns the
 * attacker (winner) + fool (loser) ids, or null. Pure; reads only the public
 * last-bout cards + seat roles the finished state already carries.
 */
function detectSixAttack(state: DurakState): { winnerId: string; loserId: string } | null {
  if (state.isDraw || !state.foolId) return null;
  const lb = state.lastBout;
  if (!lb || lb.length === 0) return null;
  if (!lb.every((pair) => pair.attack.rank === '6')) return null;
  const defender = state.players[state.defenderIndex];
  if (!defender || defender.id !== state.foolId) return null; // fool must have TAKEN it
  const attacker = state.players[state.attackerIndex];
  if (!attacker || attacker.id === state.foolId) return null;
  return { winnerId: attacker.id, loserId: state.foolId };
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
    sixAttack: detectSixAttack(state),
  };
}

/** Per-player Durak stat deltas (one per seat; the repo skips bots). */
export function computeDurakStatDeltas(summary: DurakFinishedSummary): DurakStatDelta[] {
  return summary.players.map((p) => ({
    playerId: p.playerId,
    won: p.isWinner,
    isFool: p.isFool,
    isDraw: summary.isDraw,
    wonBySixes: summary.sixAttack?.winnerId === p.playerId,
    lostBySixes: summary.sixAttack?.loserId === p.playerId,
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
  wonBySixes: number;  // games won by an all-sixes finishing attack (Stage 37.3)
  lostBySixes: number; // games lost as the fool who took an all-sixes attack
  lastGameAt: string | null;
}
