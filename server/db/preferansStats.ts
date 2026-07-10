// ---------------------------------------------------------------------------
// Preferans stats repository (PREFERANS-STATS-2). Mirrors server/db/tarneebStats.ts.
//
// Called from the WS server when an ONLINE Preferans match reaches `game_finished`.
// It lifts the score-only result into durable rows (games → game_players → rounds)
// and increments the per-(user, game_type='preferans') `user_stats` cache. Runs in
// ONE transaction, IDEMPOTENT via `games.game_key` (reconnect/restart can't double
// count). Requires Postgres (DATABASE_URL); imported DYNAMICALLY by the server only
// on the finish path. Bots (no user_id) are skipped. NO private state — Preferans
// records only the per-seat outcome, final scores, and per-hand score deltas +
// contract labels, NEVER cards / hands / talon / discards / tricks. NO schema
// migration (reuses the shared games/game_players/rounds/user_stats JSONB pattern).
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PreferansState } from '../../src/games/preferans/types';
import {
  isFinishedPreferansGame, summarizeFinishedPreferansGame, computePreferansStatDeltas,
  type PreferansFinishedSummary, type PreferansStatDelta, type PreferansStatsView,
} from '../../src/net/preferansStats';
import { games, gamePlayers, rounds, userStats, users, userSettings } from './schema';
import { getDb } from './client';
import type { SeatUsers, RecordResult } from './stats';

const PREFERANS = 'preferans';
const PREFERANS_RULESET = 'preferans-v1';
const PREFERANS_STATS_VERSION = 1;

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('preferans stats repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.db as PostgresJsDatabase;
}

/** Deterministic per-game identity: room code + winner seat + final scores + winners. */
function gameKey(roomCode: string, summary: PreferansFinishedSummary): string {
  const outcome = `${summary.winnerSeat ?? 'none'}|${summary.finalScores.join(':')}`;
  const winners = [...summary.winners].sort().join(',');
  return createHash('sha256').update(`${PREFERANS}|${roomCode}|${outcome}|${winners}`).digest('hex');
}

interface PreferansStatsBlob {
  gamesDrawn: number;
  handsAsDeclarer: number;
  contractsMade: number;
  contractsFailed: number;
  totalScore: number;
  bestGameScore: number;   // -Infinity sentinel when no games yet
  worstGameScore: number;  // +Infinity sentinel when no games yet
}

/** Reads the Preferans stats JSONB, defaulting missing counters safely. Pure. */
export function readPreferansStats(raw: unknown): PreferansStatsBlob {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  return {
    gamesDrawn: num(o.gamesDrawn, 0),
    handsAsDeclarer: num(o.handsAsDeclarer, 0),
    contractsMade: num(o.contractsMade, 0),
    contractsFailed: num(o.contractsFailed, 0),
    totalScore: num(o.totalScore, 0),
    bestGameScore: num(o.bestGameScore, Number.NEGATIVE_INFINITY),
    worstGameScore: num(o.worstGameScore, Number.POSITIVE_INFINITY),
  };
}

function serializePreferansStats(s: PreferansStatsBlob): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: PREFERANS_STATS_VERSION,
    gamesDrawn: s.gamesDrawn,
    handsAsDeclarer: s.handsAsDeclarer,
    contractsMade: s.contractsMade,
    contractsFailed: s.contractsFailed,
    totalScore: s.totalScore,
  };
  if (Number.isFinite(s.bestGameScore)) out.bestGameScore = s.bestGameScore;
  if (Number.isFinite(s.worstGameScore)) out.worstGameScore = s.worstGameScore;
  return out;
}

/**
 * Records a finished online Preferans match and updates stats for human members
 * with a resolved userId. Returns `{ recorded: false }` when already stored
 * (idempotent) or nothing to do. Mirrors recordFinishedTarneebGame.
 */
export async function recordFinishedPreferansGame(
  roomCode: string,
  state: PreferansState,
  seatUsers: SeatUsers,
): Promise<RecordResult> {
  if (!isFinishedPreferansGame(state)) return { recorded: false };

  const summary = summarizeFinishedPreferansGame(state);
  if (summary.players.length === 0) return { recorded: false };

  const deltas = computePreferansStatDeltas(summary);
  const deltaByPlayer = new Map(deltas.map((d) => [d.playerId, d]));
  const key = gameKey(roomCode, summary);
  // The unique winner's user id for the games row (null on a draw / bot winner).
  const winnerUserId = summary.winnerSeat != null ? (seatUsers.get(summary.winnerSeat) ?? null) : null;

  const db = await database();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(games).values({
      gameKey: key,
      roomCode,
      gameType: PREFERANS,
      rulesetId: PREFERANS_RULESET,
      playerCount: summary.playerCount,
      status: 'finished',
      winnerUserId,
      result: {
        winnerSeat: summary.winnerSeat,
        winners: summary.winners,
        isDraw: summary.isDraw,
        finalScores: summary.finalScores,
        handsPlayed: summary.handsPlayed,
      },
    }).onConflictDoNothing({ target: games.gameKey }).returning({ id: games.id });

    if (inserted.length === 0) return { recorded: false };
    const gameId = inserted[0].id;

    // Seat → identity snapshot; finalTotal = the seat's final score.
    await tx.insert(gamePlayers).values(summary.players.map((p) => ({
      gameId,
      seatIndex: p.seatIndex,
      playerId: p.playerId,
      userId: seatUsers.get(p.seatIndex) ?? null,
      name: p.name,
      avatar: p.avatar ?? null,
      type: p.type,
      finalTotal: p.finalScore,
      isWinner: p.isWinner,
    })));

    // Score-only per-hand rounds (contract label + per-player score delta; no cards).
    if (summary.rounds.length > 0) {
      await tx.insert(rounds).values(summary.rounds.map((r) => ({
        gameId,
        gameType: PREFERANS,
        roundIndex: r.roundIndex,
        modeId: r.modeId,
        dealerPlayerId: null,
        trumpOccurrence: 0,
        scores: r.scoreByPlayer,
      })));
    }

    let humanPlayers = 0;
    for (const p of summary.players) {
      const userId = seatUsers.get(p.seatIndex) ?? null;
      if (!userId || p.type === 'ai') continue;
      const delta = deltaByPlayer.get(p.playerId);
      if (!delta) continue;
      humanPlayers++;
      await upsertPreferansUserStats(tx, userId, delta);
    }

    return { recorded: true, gameId, humanPlayers };
  });
}

/** Read-modify-write one user's Preferans stats cache inside the transaction. */
async function upsertPreferansUserStats(
  tx: PostgresJsDatabase,
  userId: string,
  delta: PreferansStatDelta,
): Promise<void> {
  const cur = (await tx.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, PREFERANS)))
    .limit(1))[0];
  const prev = readPreferansStats(cur?.stats);

  const nextStats = serializePreferansStats({
    gamesDrawn: prev.gamesDrawn + (delta.drawn ? 1 : 0),
    handsAsDeclarer: prev.handsAsDeclarer + delta.declarerCount,
    contractsMade: prev.contractsMade + delta.contractsMade,
    contractsFailed: prev.contractsFailed + delta.contractsFailed,
    totalScore: prev.totalScore + delta.finalScore,
    // Preferans scores can be negative; best = MAX, worst = MIN final score.
    bestGameScore: Math.max(prev.bestGameScore, delta.finalScore),
    worstGameScore: Math.min(prev.worstGameScore, delta.finalScore),
  });

  const now = new Date();
  const values = {
    userId,
    gameType: PREFERANS,
    gamesPlayed: (cur?.gamesPlayed ?? 0) + 1,
    gamesWon: (cur?.gamesWon ?? 0) + (delta.won ? 1 : 0),
    gamesLost: (cur?.gamesLost ?? 0) + (delta.lost ? 1 : 0), // draws count as neither
    roundsPlayed: (cur?.roundsPlayed ?? 0) + delta.handsPlayed,
    stats: nextStats,
    lastPlayedAt: now,
    updatedAt: now,
  };
  await tx.insert(userStats).values(values).onConflictDoUpdate({
    target: [userStats.userId, userStats.gameType],
    set: {
      gamesPlayed: values.gamesPlayed,
      gamesWon: values.gamesWon,
      gamesLost: values.gamesLost,
      roundsPlayed: values.roundsPlayed,
      stats: values.stats,
      lastPlayedAt: now,
      updatedAt: now,
    },
  });
}

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 100) : null;
}
function avg(total: number, count: number): number | null {
  return count > 0 ? Math.round(total / count) : null;
}

/** Builds the public Preferans view from raw counters + the parsed stats JSONB. */
function toPreferansStatsView(
  row: { gamesPlayed: number; gamesWon: number; gamesLost: number; roundsPlayed: number; lastPlayedAt: Date | null } | null,
  blob: PreferansStatsBlob,
): PreferansStatsView {
  const gamesPlayed = row?.gamesPlayed ?? 0;
  const decided = blob.contractsMade + blob.contractsFailed;
  return {
    gameType: 'preferans',
    gamesPlayed,
    gamesWon: row?.gamesWon ?? 0,
    gamesLost: row?.gamesLost ?? 0,
    gamesDrawn: blob.gamesDrawn,
    winRate: pct(row?.gamesWon ?? 0, gamesPlayed),
    handsPlayed: row?.roundsPlayed ?? 0,
    handsAsDeclarer: blob.handsAsDeclarer,
    contractsMade: blob.contractsMade,
    contractsFailed: blob.contractsFailed,
    contractSuccessRate: pct(blob.contractsMade, decided),
    totalScore: blob.totalScore,
    averageScore: avg(blob.totalScore, gamesPlayed),
    bestGameScore: Number.isFinite(blob.bestGameScore) ? blob.bestGameScore : null,
    worstGameScore: Number.isFinite(blob.worstGameScore) ? blob.worstGameScore : null,
    lastGameAt: row?.lastPlayedAt ? row.lastPlayedAt.toISOString() : null,
  };
}

/** Reads a user's cached Preferans stats as a full derived view. */
export async function getPreferansStats(userId: string): Promise<PreferansStatsView> {
  const db = await database();
  const row = (await db.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, PREFERANS)))
    .limit(1))[0];
  return toPreferansStatsView(row ?? null, readPreferansStats(row?.stats));
}

/** Public Preferans leaderboard row — display fields + counters (no userId). */
export interface PreferansLeaderboardEntry {
  displayName: string | null;
  avatar: string | null;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number | null;
  contractsMade: number;
  contractsFailed: number;
  contractSuccessRate: number | null;
  lastGameAt: string | null;
  /** True for the requesting user's own row (server-marked; no id exposed). */
  self: boolean;
}

/**
 * Per-game Preferans leaderboard: top players by wins (then games played). Exposes
 * ONLY public fields — display name + avatar + counters; the user id marks the
 * caller's own row (`self`) and is NEVER returned. Mirrors getTarneebLeaderboard.
 */
export async function getPreferansLeaderboard(
  limit = 20, selfUserId: string | null = null,
): Promise<PreferansLeaderboardEntry[]> {
  const db = await database();
  const rows = await db.select({
    userId: userStats.userId,
    displayName: users.displayName,
    avatar: userSettings.avatar,
    gamesPlayed: userStats.gamesPlayed,
    gamesWon: userStats.gamesWon,
    stats: userStats.stats,
    lastPlayedAt: userStats.lastPlayedAt,
  }).from(userStats)
    .innerJoin(users, eq(users.id, userStats.userId))
    .leftJoin(userSettings, eq(userSettings.userId, userStats.userId))
    .where(eq(userStats.gameType, PREFERANS))
    .orderBy(desc(userStats.gamesWon), desc(userStats.gamesPlayed))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => {
    const blob = readPreferansStats(r.stats);
    const decided = blob.contractsMade + blob.contractsFailed;
    return {
      displayName: r.displayName,
      avatar: r.avatar ?? null,
      gamesPlayed: r.gamesPlayed,
      gamesWon: r.gamesWon,
      winRate: pct(r.gamesWon, r.gamesPlayed),
      contractsMade: blob.contractsMade,
      contractsFailed: blob.contractsFailed,
      contractSuccessRate: pct(blob.contractsMade, decided),
      lastGameAt: r.lastPlayedAt ? r.lastPlayedAt.toISOString() : null,
      self: selfUserId != null && r.userId === selfUserId,
    };
  });
}
