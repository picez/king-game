// ---------------------------------------------------------------------------
// Poker stats repository (POKER-STATS-2). Mirrors server/db/fiftyOneStats.ts.
//
// Called from the WS server when an ONLINE poker match reaches `game_finished`. It
// lifts the score-only result into durable rows (games → game_players) and
// increments the per-(user, game_type='poker') `user_stats` cache. Runs in ONE
// transaction, IDEMPOTENT via `games.game_key` (reconnect/restart can't double
// count). Requires Postgres (DATABASE_URL); imported DYNAMICALLY by the server only
// on the finish path. Bots (no user_id) are skipped. NO private state — poker records
// only the per-seat match outcome + telemetry counters (hands/showdowns/pots won,
// biggest pot, all-in wins, royal flushes), NEVER hole cards / deck / burns. NO schema
// migration (reuses the shared games/game_players/user_stats JSONB pattern; the
// free-text `game_type` column already accepts 'poker'). Poker is a fully released
// `available` game (Stage 37.4) — favoritable + achievement-eligible.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { eq, and, desc, asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PokerState } from '../../src/games/poker/types';
import {
  isFinishedPokerGame, summarizeFinishedPokerGame, computePokerStatDeltas,
  type PokerFinishedSummary, type PokerStatDelta, type PokerStatsView,
} from '../../src/net/pokerStats';
import { games, gamePlayers, userStats, users, userSettings } from './schema';
import { getDb } from './client';
import type { SeatUsers, RecordResult } from './stats';

const POKER = 'poker';
const POKER_RULESET = 'poker-nlhe-v1';
const POKER_STATS_VERSION = 1;

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('Poker stats repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.db as PostgresJsDatabase;
}

/** Deterministic per-game identity: room code + winner seat + hands + winners. */
function gameKey(roomCode: string, summary: PokerFinishedSummary): string {
  const outcome = `${summary.winnerSeat ?? 'none'}|${summary.handsPlayed}`;
  const winners = [...summary.winners].sort().join(',');
  return createHash('sha256').update(`${POKER}|${roomCode}|${outcome}|${winners}`).digest('hex');
}

interface PokerStatsBlob {
  handsWon: number;
  showdownsWon: number;
  potsWon: number;
  biggestPot: number;
  allInsWon: number;
  royalFlushCount: number;
}

/** Reads the poker stats JSONB, defaulting missing counters safely. Pure. */
export function readPokerStats(raw: unknown): PokerStatsBlob {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  return {
    handsWon: num(o.handsWon, 0),
    showdownsWon: num(o.showdownsWon, 0),
    potsWon: num(o.potsWon, 0),
    biggestPot: num(o.biggestPot, 0),
    allInsWon: num(o.allInsWon, 0),
    royalFlushCount: num(o.royalFlushCount, 0),
  };
}

function serializePokerStats(s: PokerStatsBlob): Record<string, unknown> {
  return {
    v: POKER_STATS_VERSION,
    handsWon: s.handsWon,
    showdownsWon: s.showdownsWon,
    potsWon: s.potsWon,
    biggestPot: s.biggestPot,
    allInsWon: s.allInsWon,
    royalFlushCount: s.royalFlushCount,
  };
}

/**
 * Records a finished online poker match and updates stats for human members with a
 * resolved userId. Returns `{ recorded: false }` when already stored (idempotent)
 * or nothing to do. Mirrors recordFinishedFiftyOneGame.
 */
export async function recordFinishedPokerGame(
  roomCode: string,
  state: PokerState,
  seatUsers: SeatUsers,
): Promise<RecordResult> {
  if (!isFinishedPokerGame(state)) return { recorded: false };

  const summary = summarizeFinishedPokerGame(state);
  if (summary.players.length === 0) return { recorded: false };

  const deltas = computePokerStatDeltas(summary);
  const deltaByPlayer = new Map(deltas.map((d) => [d.playerId, d]));
  const key = gameKey(roomCode, summary);
  const winnerUserId = summary.winnerSeat != null ? (seatUsers.get(summary.winnerSeat) ?? null) : null;

  const db = await database();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(games).values({
      gameKey: key,
      roomCode,
      gameType: POKER,
      rulesetId: POKER_RULESET,
      playerCount: summary.playerCount,
      status: 'finished',
      winnerUserId,
      result: {
        winnerSeat: summary.winnerSeat,
        winners: summary.winners,
        handsPlayed: summary.handsPlayed,
      },
    }).onConflictDoNothing({ target: games.gameKey }).returning({ id: games.id });

    if (inserted.length === 0) return { recorded: false };
    const gameId = inserted[0].id;

    // Seat → identity snapshot; finalTotal = the seat's hands-won (a public counter).
    await tx.insert(gamePlayers).values(summary.players.map((p) => ({
      gameId,
      seatIndex: p.seatIndex,
      playerId: p.playerId,
      userId: seatUsers.get(p.seatIndex) ?? null,
      name: p.name,
      avatar: p.avatar ?? null,
      type: p.type,
      finalTotal: p.handsWon,
      isWinner: p.isWinner,
    })));

    let humanPlayers = 0;
    for (const p of summary.players) {
      const userId = seatUsers.get(p.seatIndex) ?? null;
      if (!userId || p.type === 'ai') continue;
      const delta = deltaByPlayer.get(p.playerId);
      if (!delta) continue;
      humanPlayers++;
      await upsertPokerUserStats(tx, userId, delta);
    }

    return { recorded: true, gameId, humanPlayers };
  });
}

/** Read-modify-write one user's poker stats cache inside the transaction. */
async function upsertPokerUserStats(
  tx: PostgresJsDatabase,
  userId: string,
  delta: PokerStatDelta,
): Promise<void> {
  const cur = (await tx.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, POKER)))
    .limit(1))[0];
  const prev = readPokerStats(cur?.stats);

  const nextStats = serializePokerStats({
    handsWon: prev.handsWon + delta.handsWon,
    showdownsWon: prev.showdownsWon + delta.showdownsWon,
    potsWon: prev.potsWon + delta.potsWon,
    biggestPot: Math.max(prev.biggestPot, delta.biggestPot),
    allInsWon: prev.allInsWon + delta.allInsWon,
    royalFlushCount: prev.royalFlushCount + delta.royalFlushes,
  });

  const now = new Date();
  const values = {
    userId,
    gameType: POKER,
    gamesPlayed: (cur?.gamesPlayed ?? 0) + 1,
    gamesWon: (cur?.gamesWon ?? 0) + (delta.won ? 1 : 0),
    gamesLost: (cur?.gamesLost ?? 0) + (delta.lost ? 1 : 0),
    // The generic `roundsPlayed` column stores total HANDS played for poker.
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

/** Builds the public poker view from raw counters + the parsed stats JSONB. */
function toPokerStatsView(
  row: { gamesPlayed: number; gamesWon: number; gamesLost: number; roundsPlayed: number; lastPlayedAt: Date | null } | null,
  blob: PokerStatsBlob,
): PokerStatsView {
  const gamesPlayed = row?.gamesPlayed ?? 0;
  return {
    gameType: 'poker',
    gamesPlayed,
    gamesWon: row?.gamesWon ?? 0,
    gamesLost: row?.gamesLost ?? 0,
    winRate: pct(row?.gamesWon ?? 0, gamesPlayed),
    handsPlayed: row?.roundsPlayed ?? 0,
    handsWon: blob.handsWon,
    showdownsWon: blob.showdownsWon,
    potsWon: blob.potsWon,
    biggestPot: blob.biggestPot,
    allInsWon: blob.allInsWon,
    royalFlushCount: blob.royalFlushCount,
    lastGameAt: row?.lastPlayedAt ? row.lastPlayedAt.toISOString() : null,
  };
}

/** Reads a user's cached poker stats as a full derived view. */
export async function getPokerStats(userId: string): Promise<PokerStatsView> {
  const db = await database();
  const row = (await db.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, POKER)))
    .limit(1))[0];
  return toPokerStatsView(row ?? null, readPokerStats(row?.stats));
}

/** Public poker leaderboard row — display fields + counters (no userId). */
export interface PokerLeaderboardEntry {
  displayName: string | null;
  avatar: string | null;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number | null;
  biggestPot: number;
  royalFlushCount: number;
  lastGameAt: string | null;
  /** True for the requesting user's own row (server-marked; no id exposed). */
  self: boolean;
}

/**
 * Per-game poker leaderboard: top players by wins (then games played). Exposes ONLY
 * public fields — display name + avatar + counters; the user id marks the caller's
 * own row (`self`) and is NEVER returned. Mirrors getFiftyOneLeaderboard.
 */
export async function getPokerLeaderboard(
  limit = 20, selfUserId: string | null = null,
): Promise<PokerLeaderboardEntry[]> {
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
    .where(eq(userStats.gameType, POKER))
    .orderBy(desc(userStats.gamesWon), desc(userStats.gamesPlayed), asc(userStats.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => {
    const blob = readPokerStats(r.stats);
    return {
      displayName: r.displayName,
      avatar: r.avatar ?? null,
      gamesPlayed: r.gamesPlayed,
      gamesWon: r.gamesWon,
      winRate: pct(r.gamesWon, r.gamesPlayed),
      biggestPot: blob.biggestPot,
      royalFlushCount: blob.royalFlushCount,
      lastGameAt: r.lastPlayedAt ? r.lastPlayedAt.toISOString() : null,
      self: selfUserId != null && r.userId === selfUserId,
    };
  });
}
