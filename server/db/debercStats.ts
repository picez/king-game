// ---------------------------------------------------------------------------
// Deberc stats repository (DEBERC-STATS-2). Mirrors server/db/durakStats.ts.
//
// Called from the WS server when an ONLINE Deberc match reaches `finished`. It
// lifts the outcome-only result into durable rows (games → game_players) and
// increments the per-(user, game_type='deberc') `user_stats` cache. Runs in ONE
// transaction, IDEMPOTENT via `games.game_key` (reconnect/restart can't double
// count). Requires Postgres (DATABASE_URL); imported DYNAMICALLY by the server
// only on the finish path. Bots (no user_id) are skipped. NO private state —
// Deberc records only the team outcome + the jackpot flag, never cards/scores.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DebercState } from '../../src/games/deberc/types';
import {
  isFinishedDebercGame, summarizeFinishedDebercGame, computeDebercStatDeltas,
  type DebercFinishedSummary, type DebercStatsView,
} from '../../src/net/debercStats';
import { games, gamePlayers, userStats, users, userSettings } from './schema';
import { getDb } from './client';
import type { SeatUsers, RecordResult } from './stats';

const DEBERC = 'deberc';
const DEBERC_RULESET = 'deberc-v1';
const DEBERC_STATS_VERSION = 1;

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('deberc stats repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.db as PostgresJsDatabase;
}

/** Deterministic per-game identity: room code + winning team + jackpot + winners. */
function gameKey(roomCode: string, summary: DebercFinishedSummary): string {
  const outcome = `${summary.winnerTeam ?? 'none'}|${summary.isJackpot ? 'jackpot' : 'target'}`;
  const winners = [...summary.winners].sort().join(',');
  return createHash('sha256').update(`${DEBERC}|${roomCode}|${outcome}|${winners}`).digest('hex');
}

interface DebercStatsBlob { jackpotCount: number; }

/** Reads the Deberc stats JSONB, defaulting missing counters to 0. Pure. */
export function readDebercStats(raw: unknown): DebercStatsBlob {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  return { jackpotCount: typeof o.jackpotCount === 'number' ? o.jackpotCount : 0 };
}

function serializeDebercStats(s: DebercStatsBlob): Record<string, unknown> {
  return { v: DEBERC_STATS_VERSION, jackpotCount: s.jackpotCount };
}

/**
 * Records a finished online Deberc match and updates stats for human members
 * with a resolved userId. Returns `{ recorded: false }` when already stored
 * (idempotent) or nothing to do. Mirrors recordFinishedDurakGame.
 */
export async function recordFinishedDebercGame(
  roomCode: string,
  state: DebercState,
  seatUsers: SeatUsers,
): Promise<RecordResult> {
  if (!isFinishedDebercGame(state)) return { recorded: false };

  const summary = summarizeFinishedDebercGame(state);
  if (summary.players.length === 0) return { recorded: false };

  const deltas = computeDebercStatDeltas(summary);
  const deltaByPlayer = new Map(deltas.map((d) => [d.playerId, d]));
  const key = gameKey(roomCode, summary);

  // A sole winner exists only in 3p (solo teams); 4p wins are a pair.
  const soleWinnerSeat = summary.winners.length === 1
    ? summary.players.find((p) => p.playerId === summary.winners[0])?.seatIndex ?? null
    : null;
  const winnerUserId = soleWinnerSeat != null ? (seatUsers.get(soleWinnerSeat) ?? null) : null;

  const db = await database();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(games).values({
      gameKey: key,
      roomCode,
      gameType: DEBERC,
      rulesetId: DEBERC_RULESET,
      playerCount: summary.playerCount,
      status: 'finished',
      winnerUserId,
      result: { winnerTeam: summary.winnerTeam, winners: summary.winners, isJackpot: summary.isJackpot },
    }).onConflictDoNothing({ target: games.gameKey }).returning({ id: games.id });

    if (inserted.length === 0) return { recorded: false };
    const gameId = inserted[0].id;

    // Deberc records outcome only → finalTotal is a neutral 0; isWinner carries it.
    await tx.insert(gamePlayers).values(summary.players.map((p) => ({
      gameId,
      seatIndex: p.seatIndex,
      playerId: p.playerId,
      userId: seatUsers.get(p.seatIndex) ?? null,
      name: p.name,
      avatar: p.avatar ?? null,
      type: p.type,
      finalTotal: 0,
      isWinner: p.isWinner,
    })));

    let humanPlayers = 0;
    for (const p of summary.players) {
      const userId = seatUsers.get(p.seatIndex) ?? null;
      if (!userId || p.type === 'ai') continue;
      const delta = deltaByPlayer.get(p.playerId);
      if (!delta) continue;
      humanPlayers++;
      await upsertDebercUserStats(tx, userId, delta);
    }

    return { recorded: true, gameId, humanPlayers };
  });
}

/** Read-modify-write one user's Deberc stats cache inside the transaction. */
async function upsertDebercUserStats(
  tx: PostgresJsDatabase,
  userId: string,
  delta: ReturnType<typeof computeDebercStatDeltas>[number],
): Promise<void> {
  const cur = (await tx.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, DEBERC)))
    .limit(1))[0];
  const prev = readDebercStats(cur?.stats);

  const nextStats = serializeDebercStats({
    jackpotCount: prev.jackpotCount + (delta.isJackpot ? 1 : 0),
  });

  const now = new Date();
  const values = {
    userId,
    gameType: DEBERC,
    gamesPlayed: (cur?.gamesPlayed ?? 0) + 1,
    gamesWon: (cur?.gamesWon ?? 0) + (delta.won ? 1 : 0),
    gamesLost: (cur?.gamesLost ?? 0) + (delta.won ? 0 : 1),
    roundsPlayed: cur?.roundsPlayed ?? 0, // Deberc records outcome only, no rounds
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
      stats: values.stats,
      lastPlayedAt: now,
      updatedAt: now,
    },
  });
}

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 100) : null;
}

/** Builds the public Deberc view from raw counters + the parsed stats JSONB. */
function toDebercStatsView(
  row: { gamesPlayed: number; gamesWon: number; gamesLost: number; lastPlayedAt: Date | null } | null,
  blob: DebercStatsBlob,
): DebercStatsView {
  const gamesPlayed = row?.gamesPlayed ?? 0;
  return {
    gameType: 'deberc',
    gamesPlayed,
    gamesWon: row?.gamesWon ?? 0,
    gamesLost: row?.gamesLost ?? 0,
    winRate: pct(row?.gamesWon ?? 0, gamesPlayed),
    jackpotCount: blob.jackpotCount,
    jackpotRate: pct(blob.jackpotCount, gamesPlayed),
    lastGameAt: row?.lastPlayedAt ? row.lastPlayedAt.toISOString() : null,
  };
}

/** Reads a user's cached Deberc stats as a full derived view. */
export async function getDebercStats(userId: string): Promise<DebercStatsView> {
  const db = await database();
  const row = (await db.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, DEBERC)))
    .limit(1))[0];
  return toDebercStatsView(row ?? null, readDebercStats(row?.stats));
}

/** Public Deberc leaderboard row — display fields + jackpot counter (no userId). */
export interface DebercLeaderboardEntry {
  displayName: string | null;
  avatar: string | null;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number | null;
  jackpotCount: number;
  lastGameAt: string | null;
  /** True for the requesting user's own row (server-marked; no id exposed). */
  self: boolean;
}

/**
 * Per-game Deberc leaderboard: top players by wins (then games played). Exposes
 * ONLY public fields — display name + avatar + counters; the user id marks the
 * caller's own row (`self`) and is NEVER returned. Mirrors getDurakLeaderboard.
 */
export async function getDebercLeaderboard(
  limit = 20, selfUserId: string | null = null,
): Promise<DebercLeaderboardEntry[]> {
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
    .where(eq(userStats.gameType, DEBERC))
    .orderBy(desc(userStats.gamesWon), desc(userStats.gamesPlayed))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({
    displayName: r.displayName,
    avatar: r.avatar ?? null,
    gamesPlayed: r.gamesPlayed,
    gamesWon: r.gamesWon,
    winRate: pct(r.gamesWon, r.gamesPlayed),
    jackpotCount: readDebercStats(r.stats).jackpotCount,
    lastGameAt: r.lastPlayedAt ? r.lastPlayedAt.toISOString() : null,
    self: selfUserId != null && r.userId === selfUserId,
  }));
}
