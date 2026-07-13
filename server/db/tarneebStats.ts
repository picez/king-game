// ---------------------------------------------------------------------------
// Tarneeb stats repository (TARNEEB-STATS-2). Mirrors server/db/debercStats.ts.
//
// Called from the WS server when an ONLINE Tarneeb match reaches `game_finished`.
// It lifts the score-only result into durable rows (games → game_players →
// rounds) and increments the per-(user, game_type='tarneeb') `user_stats` cache.
// Runs in ONE transaction, IDEMPOTENT via `games.game_key` (reconnect/restart
// can't double count). Requires Postgres (DATABASE_URL); imported DYNAMICALLY by
// the server only on the finish path. Bots (no user_id) are skipped. NO private
// state — Tarneeb records only the team outcome, final scores, and per-hand score
// deltas + bid/trump labels, NEVER cards/hands/tricks.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TarneebState } from '../../src/games/tarneeb/types';
import {
  isFinishedTarneebGame, summarizeFinishedTarneebGame, computeTarneebStatDeltas, tarneebStatsGameType,
  type TarneebFinishedSummary, type TarneebStatDelta, type TarneebStatsView,
} from '../../src/net/tarneebStats';
import { games, gamePlayers, rounds, userStats, users, userSettings } from './schema';
import { getDb } from './client';
import type { SeatUsers, RecordResult } from './stats';

const TARNEEB = 'tarneeb';
/** Solo cutthroat is stored under a SEPARATE game_type so it never merges into the
 *  released pairs aggregates (Stage 28.4). No migration — game_type is free text. */
const TARNEEB_SOLO = 'tarneeb-solo';
const TARNEEB_RULESET = 'tarneeb-v1';
const TARNEEB_STATS_VERSION = 1;

/** The two Tarneeb stat variants and their storage game_type. */
export type TarneebStatsVariant = 'pairs' | 'solo';
function gameTypeForVariant(variant: TarneebStatsVariant): string {
  return variant === 'solo' ? TARNEEB_SOLO : TARNEEB;
}

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('tarneeb stats repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.db as PostgresJsDatabase;
}

/** Deterministic per-game identity: game_type + room + per-seat totals + winners.
 *  Includes the game_type so a solo and a pairs game in the same room never share a key. */
function gameKey(roomCode: string, summary: TarneebFinishedSummary, gameType: string): string {
  const scores = summary.players.map((p) => p.teamFinalScore).join(':');
  const outcome = `${summary.winnerTeam ?? (summary.winners.join('+') || 'none')}|${scores}`;
  const winners = [...summary.winners].sort().join(',');
  return createHash('sha256').update(`${gameType}|${roomCode}|${outcome}|${winners}`).digest('hex');
}

interface TarneebStatsBlob {
  handsAsDeclarer: number;
  contractsMade: number;
  contractsFailed: number;
  totalTeamScore: number;
  bestGameScore: number;   // -Infinity sentinel when no games yet
  worstGameScore: number;  // +Infinity sentinel when no games yet
}

/** Reads the Tarneeb stats JSONB, defaulting missing counters safely. Pure. */
export function readTarneebStats(raw: unknown): TarneebStatsBlob {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  return {
    handsAsDeclarer: num(o.handsAsDeclarer, 0),
    contractsMade: num(o.contractsMade, 0),
    contractsFailed: num(o.contractsFailed, 0),
    totalTeamScore: num(o.totalTeamScore, 0),
    bestGameScore: num(o.bestGameScore, Number.NEGATIVE_INFINITY),
    worstGameScore: num(o.worstGameScore, Number.POSITIVE_INFINITY),
  };
}

function serializeTarneebStats(s: TarneebStatsBlob): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: TARNEEB_STATS_VERSION,
    handsAsDeclarer: s.handsAsDeclarer,
    contractsMade: s.contractsMade,
    contractsFailed: s.contractsFailed,
    totalTeamScore: s.totalTeamScore,
  };
  if (Number.isFinite(s.bestGameScore)) out.bestGameScore = s.bestGameScore;
  if (Number.isFinite(s.worstGameScore)) out.worstGameScore = s.worstGameScore;
  return out;
}

/**
 * Records a finished online Tarneeb match and updates stats for human members
 * with a resolved userId. Returns `{ recorded: false }` when already stored
 * (idempotent) or nothing to do. Mirrors recordFinishedDebercGame.
 */
export async function recordFinishedTarneebGame(
  roomCode: string,
  state: TarneebState,
  seatUsers: SeatUsers,
): Promise<RecordResult> {
  if (!isFinishedTarneebGame(state)) return { recorded: false };

  const summary = summarizeFinishedTarneebGame(state);
  if (summary.players.length === 0) return { recorded: false };

  // Solo records under game_type='tarneeb-solo'; pairs stays 'tarneeb' (Stage 28.4).
  const gameType = tarneebStatsGameType(state);
  const deltas = computeTarneebStatDeltas(summary);
  const deltaByPlayer = new Map(deltas.map((d) => [d.playerId, d]));
  const key = gameKey(roomCode, summary, gameType);

  // The winning "seat" for the games row is ambiguous for a pair → leave the
  // sole-winner user null (both partners are marked winners on game_players).
  const db = await database();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(games).values({
      gameKey: key,
      roomCode,
      gameType,
      rulesetId: TARNEEB_RULESET,
      playerCount: summary.playerCount,
      status: 'finished',
      winnerUserId: null,
      result: {
        winnerTeam: summary.winnerTeam,
        winners: summary.winners,
        finalScoresByTeam: summary.finalScoresByTeam,
        handsPlayed: summary.handsPlayed,
      },
    }).onConflictDoNothing({ target: games.gameKey }).returning({ id: games.id });

    if (inserted.length === 0) return { recorded: false };
    const gameId = inserted[0].id;

    // Seat → identity snapshot; finalTotal = the seat's team final score.
    await tx.insert(gamePlayers).values(summary.players.map((p) => ({
      gameId,
      seatIndex: p.seatIndex,
      playerId: p.playerId,
      userId: seatUsers.get(p.seatIndex) ?? null,
      name: p.name,
      avatar: p.avatar ?? null,
      type: p.type,
      finalTotal: p.teamFinalScore,
      isWinner: p.isWinner,
    })));

    // Score-only per-hand rounds (bid/trump label + per-player team score delta).
    if (summary.rounds.length > 0) {
      await tx.insert(rounds).values(summary.rounds.map((r) => ({
        gameId,
        gameType,
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
      await upsertTarneebUserStats(tx, userId, delta, gameType);
    }

    return { recorded: true, gameId, humanPlayers };
  });
}

/** Read-modify-write one user's Tarneeb stats cache inside the transaction. */
async function upsertTarneebUserStats(
  tx: PostgresJsDatabase,
  userId: string,
  delta: TarneebStatDelta,
  gameType: string,
): Promise<void> {
  const cur = (await tx.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, gameType)))
    .limit(1))[0];
  const prev = readTarneebStats(cur?.stats);

  const nextStats = serializeTarneebStats({
    handsAsDeclarer: prev.handsAsDeclarer + delta.declarerCount,
    contractsMade: prev.contractsMade + delta.contractsMade,
    contractsFailed: prev.contractsFailed + delta.contractsFailed,
    totalTeamScore: prev.totalTeamScore + delta.teamFinalScore,
    // Tarneeb team scores can be negative; best = MAX, worst = MIN final score.
    bestGameScore: Math.max(prev.bestGameScore, delta.teamFinalScore),
    worstGameScore: Math.min(prev.worstGameScore, delta.teamFinalScore),
  });

  const now = new Date();
  const values = {
    userId,
    gameType,
    gamesPlayed: (cur?.gamesPlayed ?? 0) + 1,
    gamesWon: (cur?.gamesWon ?? 0) + (delta.won ? 1 : 0),
    gamesLost: (cur?.gamesLost ?? 0) + (delta.won ? 0 : 1),
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

/** Builds the public Tarneeb view from raw counters + the parsed stats JSONB. */
function toTarneebStatsView(
  row: { gamesPlayed: number; gamesWon: number; gamesLost: number; roundsPlayed: number; lastPlayedAt: Date | null } | null,
  blob: TarneebStatsBlob,
): TarneebStatsView {
  const gamesPlayed = row?.gamesPlayed ?? 0;
  const decided = blob.contractsMade + blob.contractsFailed;
  return {
    gameType: 'tarneeb', // view shape is shared across variants (the caller knows the mode)
    gamesPlayed,
    gamesWon: row?.gamesWon ?? 0,
    gamesLost: row?.gamesLost ?? 0,
    winRate: pct(row?.gamesWon ?? 0, gamesPlayed),
    handsPlayed: row?.roundsPlayed ?? 0,
    handsAsDeclarer: blob.handsAsDeclarer,
    contractsMade: blob.contractsMade,
    contractsFailed: blob.contractsFailed,
    contractSuccessRate: pct(blob.contractsMade, decided),
    totalTeamScore: blob.totalTeamScore,
    averageTeamScore: avg(blob.totalTeamScore, gamesPlayed),
    bestGameScore: Number.isFinite(blob.bestGameScore) ? blob.bestGameScore : null,
    worstGameScore: Number.isFinite(blob.worstGameScore) ? blob.worstGameScore : null,
    lastGameAt: row?.lastPlayedAt ? row.lastPlayedAt.toISOString() : null,
  };
}

/** Reads a user's cached Tarneeb stats as a full derived view (pairs by default). */
export async function getTarneebStats(userId: string, variant: TarneebStatsVariant = 'pairs'): Promise<TarneebStatsView> {
  const db = await database();
  const gameType = gameTypeForVariant(variant);
  const row = (await db.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, gameType)))
    .limit(1))[0];
  return toTarneebStatsView(row ?? null, readTarneebStats(row?.stats));
}

/** Public Tarneeb leaderboard row — display fields + counters (no userId). */
export interface TarneebLeaderboardEntry {
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
 * Per-game Tarneeb leaderboard: top players by wins (then games played). Exposes
 * ONLY public fields — display name + avatar + counters; the user id marks the
 * caller's own row (`self`) and is NEVER returned. Mirrors getDebercLeaderboard.
 */
export async function getTarneebLeaderboard(
  limit = 20, selfUserId: string | null = null, variant: TarneebStatsVariant = 'pairs',
): Promise<TarneebLeaderboardEntry[]> {
  const db = await database();
  const gameType = gameTypeForVariant(variant);
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
    .where(eq(userStats.gameType, gameType))
    .orderBy(desc(userStats.gamesWon), desc(userStats.gamesPlayed))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => {
    const blob = readTarneebStats(r.stats);
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
