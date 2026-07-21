// ---------------------------------------------------------------------------
// 51 (Syrian 51) stats repository (FIFTYONE-STATS-2). Mirrors server/db/preferansStats.ts.
//
// Called from the WS server when an ONLINE 51 match reaches `game_finished`. It
// lifts the score-only result into durable rows (games → game_players) and
// increments the per-(user, game_type='fifty-one') `user_stats` cache. Runs in ONE
// transaction, IDEMPOTENT via `games.game_key` (reconnect/restart can't double
// count). Requires Postgres (DATABASE_URL); imported DYNAMICALLY by the server only
// on the finish path. Bots (no user_id) are skipped. NO private state — 51 records
// only the per-seat outcome (final running penalty + eliminated), the match winner
// and the round count, NEVER cards / hands / draw pile / melds / discards. NO schema
// migration (reuses the shared games/game_players/user_stats JSONB pattern; the
// free-text `game_type` column already accepts 'fifty-one'). 51 is a fully released
// `available` game (Stage 30.7) — favoritable + achievement-eligible.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { eq, and, desc, asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { FiftyOneState } from '../../src/games/fiftyOne/types';
import {
  isFinishedFiftyOneGame, summarizeFinishedFiftyOneGame, computeFiftyOneStatDeltas,
  type FiftyOneFinishedSummary, type FiftyOneStatDelta, type FiftyOneStatsView,
} from '../../src/net/fiftyOneStats';
import { games, gamePlayers, userStats, users, userSettings } from './schema';
import { getDb } from './client';
import type { SeatUsers, RecordResult } from './stats';

const FIFTY_ONE = 'fifty-one';
const FIFTY_ONE_RULESET = 'fifty-one-v1';
const FIFTY_ONE_STATS_VERSION = 2; // v2: +instant-win / never-opened / two-joker / no-100 (Stage 37.3)

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('51 stats repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.db as PostgresJsDatabase;
}

/** Deterministic per-game identity: room code + winner seat + final penalties + winners. */
function gameKey(roomCode: string, summary: FiftyOneFinishedSummary): string {
  const outcome = `${summary.winnerSeat ?? 'none'}|${summary.finalPenalties.join(':')}`;
  const winners = [...summary.winners].sort().join(',');
  return createHash('sha256').update(`${FIFTY_ONE}|${roomCode}|${outcome}|${winners}`).digest('hex');
}

interface FiftyOneStatsBlob {
  timesEliminated: number;
  totalPenalty: number;
  bestPenalty: number; // +Infinity sentinel when no games yet (lower is better)
  // Stage 37.3 telemetry counters.
  gamesWithInstantRoundWin: number;
  gamesNeverOpened: number;
  gamesWithTwoJokerDeal: number;
  gamesWithNoHundred: number;
}

/** Reads the 51 stats JSONB, defaulting missing counters safely. Pure. */
export function readFiftyOneStats(raw: unknown): FiftyOneStatsBlob {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  return {
    timesEliminated: num(o.timesEliminated, 0),
    totalPenalty: num(o.totalPenalty, 0),
    bestPenalty: num(o.bestPenalty, Number.POSITIVE_INFINITY),
    gamesWithInstantRoundWin: num(o.gamesWithInstantRoundWin, 0),
    gamesNeverOpened: num(o.gamesNeverOpened, 0),
    gamesWithTwoJokerDeal: num(o.gamesWithTwoJokerDeal, 0),
    gamesWithNoHundred: num(o.gamesWithNoHundred, 0),
  };
}

function serializeFiftyOneStats(s: FiftyOneStatsBlob): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: FIFTY_ONE_STATS_VERSION,
    timesEliminated: s.timesEliminated,
    totalPenalty: s.totalPenalty,
    gamesWithInstantRoundWin: s.gamesWithInstantRoundWin,
    gamesNeverOpened: s.gamesNeverOpened,
    gamesWithTwoJokerDeal: s.gamesWithTwoJokerDeal,
    gamesWithNoHundred: s.gamesWithNoHundred,
  };
  if (Number.isFinite(s.bestPenalty)) out.bestPenalty = s.bestPenalty;
  return out;
}

/**
 * Records a finished online 51 match and updates stats for human members with a
 * resolved userId. Returns `{ recorded: false }` when already stored (idempotent)
 * or nothing to do. Mirrors recordFinishedPreferansGame.
 */
export async function recordFinishedFiftyOneGame(
  roomCode: string,
  state: FiftyOneState,
  seatUsers: SeatUsers,
): Promise<RecordResult> {
  if (!isFinishedFiftyOneGame(state)) return { recorded: false };

  const summary = summarizeFinishedFiftyOneGame(state);
  if (summary.players.length === 0) return { recorded: false };

  const deltas = computeFiftyOneStatDeltas(summary);
  const deltaByPlayer = new Map(deltas.map((d) => [d.playerId, d]));
  const key = gameKey(roomCode, summary);
  // The unique winner's user id for the games row (null on a bot winner).
  const winnerUserId = summary.winnerSeat != null ? (seatUsers.get(summary.winnerSeat) ?? null) : null;

  const db = await database();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(games).values({
      gameKey: key,
      roomCode,
      gameType: FIFTY_ONE,
      rulesetId: FIFTY_ONE_RULESET,
      playerCount: summary.playerCount,
      status: 'finished',
      winnerUserId,
      result: {
        winnerSeat: summary.winnerSeat,
        winners: summary.winners,
        finalPenalties: summary.finalPenalties,
        roundsPlayed: summary.roundsPlayed,
      },
    }).onConflictDoNothing({ target: games.gameKey }).returning({ id: games.id });

    if (inserted.length === 0) return { recorded: false };
    const gameId = inserted[0].id;

    // Seat → identity snapshot; finalTotal = the seat's final running penalty.
    await tx.insert(gamePlayers).values(summary.players.map((p) => ({
      gameId,
      seatIndex: p.seatIndex,
      playerId: p.playerId,
      userId: seatUsers.get(p.seatIndex) ?? null,
      name: p.name,
      avatar: p.avatar ?? null,
      type: p.type,
      finalTotal: p.finalPenalty,
      isWinner: p.isWinner,
    })));

    // 51 keeps no per-round score history in the final state, so no `rounds` rows
    // are written (unlike Preferans) — only the per-seat outcome + match totals.

    let humanPlayers = 0;
    for (const p of summary.players) {
      const userId = seatUsers.get(p.seatIndex) ?? null;
      if (!userId || p.type === 'ai') continue;
      const delta = deltaByPlayer.get(p.playerId);
      if (!delta) continue;
      humanPlayers++;
      await upsertFiftyOneUserStats(tx, userId, delta);
    }

    return { recorded: true, gameId, humanPlayers };
  });
}

/** Read-modify-write one user's 51 stats cache inside the transaction. */
async function upsertFiftyOneUserStats(
  tx: PostgresJsDatabase,
  userId: string,
  delta: FiftyOneStatDelta,
): Promise<void> {
  const cur = (await tx.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, FIFTY_ONE)))
    .limit(1))[0];
  const prev = readFiftyOneStats(cur?.stats);

  const nextStats = serializeFiftyOneStats({
    timesEliminated: prev.timesEliminated + (delta.eliminated ? 1 : 0),
    totalPenalty: prev.totalPenalty + delta.finalPenalty,
    // Lower is better → best = the MIN final penalty seen.
    bestPenalty: Math.min(prev.bestPenalty, delta.finalPenalty),
    gamesWithInstantRoundWin: prev.gamesWithInstantRoundWin + (delta.instantRoundWin ? 1 : 0),
    gamesNeverOpened: prev.gamesNeverOpened + (delta.neverOpenedGame ? 1 : 0),
    gamesWithTwoJokerDeal: prev.gamesWithTwoJokerDeal + (delta.twoJokerDeal ? 1 : 0),
    gamesWithNoHundred: prev.gamesWithNoHundred + (delta.noHundredGame ? 1 : 0),
  });

  const now = new Date();
  const values = {
    userId,
    gameType: FIFTY_ONE,
    gamesPlayed: (cur?.gamesPlayed ?? 0) + 1,
    gamesWon: (cur?.gamesWon ?? 0) + (delta.won ? 1 : 0),
    gamesLost: (cur?.gamesLost ?? 0) + (delta.lost ? 1 : 0),
    roundsPlayed: (cur?.roundsPlayed ?? 0) + delta.roundsPlayed,
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

/** Builds the public 51 view from raw counters + the parsed stats JSONB. */
function toFiftyOneStatsView(
  row: { gamesPlayed: number; gamesWon: number; gamesLost: number; roundsPlayed: number; lastPlayedAt: Date | null } | null,
  blob: FiftyOneStatsBlob,
): FiftyOneStatsView {
  const gamesPlayed = row?.gamesPlayed ?? 0;
  return {
    gameType: 'fifty-one',
    gamesPlayed,
    gamesWon: row?.gamesWon ?? 0,
    gamesLost: row?.gamesLost ?? 0,
    winRate: pct(row?.gamesWon ?? 0, gamesPlayed),
    roundsPlayed: row?.roundsPlayed ?? 0,
    timesEliminated: blob.timesEliminated,
    totalPenalty: blob.totalPenalty,
    averagePenalty: avg(blob.totalPenalty, gamesPlayed),
    bestPenalty: Number.isFinite(blob.bestPenalty) ? blob.bestPenalty : null,
    gamesWithInstantRoundWin: blob.gamesWithInstantRoundWin,
    gamesNeverOpened: blob.gamesNeverOpened,
    gamesWithTwoJokerDeal: blob.gamesWithTwoJokerDeal,
    gamesWithNoHundred: blob.gamesWithNoHundred,
    lastGameAt: row?.lastPlayedAt ? row.lastPlayedAt.toISOString() : null,
  };
}

/** Reads a user's cached 51 stats as a full derived view. */
export async function getFiftyOneStats(userId: string): Promise<FiftyOneStatsView> {
  const db = await database();
  const row = (await db.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, FIFTY_ONE)))
    .limit(1))[0];
  return toFiftyOneStatsView(row ?? null, readFiftyOneStats(row?.stats));
}

/** Public 51 leaderboard row — display fields + counters (no userId). */
export interface FiftyOneLeaderboardEntry {
  displayName: string | null;
  avatar: string | null;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number | null;
  averagePenalty: number | null;
  bestPenalty: number | null;
  lastGameAt: string | null;
  /** True for the requesting user's own row (server-marked; no id exposed). */
  self: boolean;
}

/**
 * Per-game 51 leaderboard: top players by wins (then games played). Exposes ONLY
 * public fields — display name + avatar + counters; the user id marks the caller's
 * own row (`self`) and is NEVER returned. Mirrors getPreferansLeaderboard.
 */
export async function getFiftyOneLeaderboard(
  limit = 20, selfUserId: string | null = null,
): Promise<FiftyOneLeaderboardEntry[]> {
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
    .where(eq(userStats.gameType, FIFTY_ONE))
    .orderBy(desc(userStats.gamesWon), desc(userStats.gamesPlayed), asc(userStats.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => {
    const blob = readFiftyOneStats(r.stats);
    return {
      displayName: r.displayName,
      avatar: r.avatar ?? null,
      gamesPlayed: r.gamesPlayed,
      gamesWon: r.gamesWon,
      winRate: pct(r.gamesWon, r.gamesPlayed),
      averagePenalty: avg(blob.totalPenalty, r.gamesPlayed),
      bestPenalty: Number.isFinite(blob.bestPenalty) ? blob.bestPenalty : null,
      lastGameAt: r.lastPlayedAt ? r.lastPlayedAt.toISOString() : null,
      self: selfUserId != null && r.userId === selfUserId,
    };
  });
}
