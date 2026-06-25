// ---------------------------------------------------------------------------
// Stats repository — record finished games & recompute user_stats (Stage 5).
//
// Called from the WS server when an ONLINE game reaches `game_finished`. It
// lifts the score-only history into durable rows (games → game_players → rounds)
// and increments the per-(user, game_type) `user_stats` cache. Everything runs
// in ONE transaction and is IDEMPOTENT via `games.game_key`: a reconnect,
// rebroadcast, or server restart that re-triggers the finish recording no-ops
// instead of double-counting.
//
// Requires Postgres (DATABASE_URL); imported DYNAMICALLY by the server only on
// the finish path, so a no-DB server never loads the driver. Bots (no user_id)
// are skipped for stats. NO private state is ever written — rounds are
// score-only, exactly as KING_RULES.md mandates. See ARCHITECTURE_DB_AUTH.md §5.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameState } from '../../src/models/types';
import {
  summarizeFinishedGame, computeStatDeltas, isFinishedGame,
} from '../../src/net/kingStats';
import { games, gamePlayers, rounds, userStats, users } from './schema';
import { getDb } from './client';

const KING = 'king';
const KING_RULESET = 'king-v1';

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('stats repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.db as PostgresJsDatabase;
}

/** Seat → user mapping for the humans at the table (bots are absent/null). */
export type SeatUsers = Map<number, string | null>;

/**
 * Deterministic per-game identity: room code + the final per-seat totals. A
 * finished King game has a fixed score table, so the same game always produces
 * the same key — that is what makes recording idempotent across restarts.
 */
function gameKey(roomCode: string, totalsBySeat: Array<{ seatIndex: number; finalTotal: number }>): string {
  const fingerprint = totalsBySeat
    .slice()
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map((t) => `${t.seatIndex}:${t.finalTotal}`)
    .join(',');
  return createHash('sha256').update(`${KING}|${roomCode}|${fingerprint}`).digest('hex');
}

interface ExistingStats {
  totalScore: number;
  bestGameScore: number;
  modeBreakdown: Record<string, number>;
}

function readStats(raw: unknown): ExistingStats {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const mb = (o.modeBreakdown && typeof o.modeBreakdown === 'object')
    ? o.modeBreakdown as Record<string, number> : {};
  return {
    totalScore: typeof o.totalScore === 'number' ? o.totalScore : 0,
    bestGameScore: typeof o.bestGameScore === 'number' ? o.bestGameScore : Number.NEGATIVE_INFINITY,
    modeBreakdown: { ...mb },
  };
}

export interface RecordResult {
  recorded: boolean;   // false when the game was already recorded (idempotent no-op)
  gameId?: string;
  humanPlayers?: number;
}

/**
 * Records a finished online game and updates stats for human members that have a
 * resolved `userId`. Returns `{ recorded: false }` if this game was already
 * stored (idempotent). Never throws to the caller for a "nothing to do" case;
 * a real DB error propagates so the caller can log it.
 */
export async function recordFinishedGame(
  roomCode: string,
  state: GameState,
  seatUsers: SeatUsers,
): Promise<RecordResult> {
  if (!isFinishedGame(state)) return { recorded: false };

  const summary = summarizeFinishedGame(state);
  if (summary.players.length === 0) return { recorded: false };

  const deltas = computeStatDeltas(summary);
  const deltaByPlayer = new Map(deltas.map((d) => [d.playerId, d]));
  const key = gameKey(roomCode, summary.players.map((p) => ({ seatIndex: p.seatIndex, finalTotal: p.finalTotal })));

  // Sole winner → resolve to a user (null on a tie or if the winner is a bot).
  const soleWinnerSeat = summary.winners.length === 1
    ? summary.players.find((p) => p.playerId === summary.winners[0])?.seatIndex ?? null
    : null;
  const winnerUserId = soleWinnerSeat != null ? (seatUsers.get(soleWinnerSeat) ?? null) : null;

  const db = await database();
  return db.transaction(async (tx) => {
    // Idempotent insert: if the game_key already exists, do not double-count.
    const inserted = await tx.insert(games).values({
      gameKey: key,
      roomCode,
      gameType: KING,
      rulesetId: KING_RULESET,
      playerCount: summary.playerCount,
      status: 'finished',
      winnerUserId,
      result: {
        winners: summary.winners,
        totals: summary.players.map((p) => ({ seatIndex: p.seatIndex, playerId: p.playerId, finalTotal: p.finalTotal })),
        roundsPlayed: summary.roundsPlayed,
      },
    }).onConflictDoNothing({ target: games.gameKey }).returning({ id: games.id });

    if (inserted.length === 0) return { recorded: false };
    const gameId = inserted[0].id;

    // Seat → identity snapshot (humans and bots; user_id null for bots/unknown).
    await tx.insert(gamePlayers).values(summary.players.map((p) => ({
      gameId,
      seatIndex: p.seatIndex,
      playerId: p.playerId,
      userId: seatUsers.get(p.seatIndex) ?? null,
      name: p.name,
      avatar: p.avatar ?? null,
      type: p.type,
      finalTotal: p.finalTotal,
      isWinner: p.isWinner,
    })));

    if (summary.rounds.length > 0) {
      await tx.insert(rounds).values(summary.rounds.map((r) => ({
        gameId,
        gameType: KING,
        roundIndex: r.roundIndex,
        modeId: r.modeId,
        dealerPlayerId: r.dealerPlayerId,
        trumpOccurrence: r.trumpOccurrence,
        scores: r.scoreByPlayer,
      })));
    }

    // Increment the cached user_stats for each human seat with a resolved user.
    let humanPlayers = 0;
    for (const p of summary.players) {
      const userId = seatUsers.get(p.seatIndex) ?? null;
      if (!userId || p.type === 'ai') continue;
      const delta = deltaByPlayer.get(p.playerId);
      if (!delta) continue;
      humanPlayers++;
      await upsertUserStats(tx, userId, delta);
    }

    return { recorded: true, gameId, humanPlayers };
  });
}

/** Read-modify-write a single user's King stats cache inside the transaction. */
async function upsertUserStats(
  tx: PostgresJsDatabase,
  userId: string,
  delta: ReturnType<typeof computeStatDeltas>[number],
): Promise<void> {
  const cur = (await tx.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, KING)))
    .limit(1))[0];
  const prev = readStats(cur?.stats);

  const modeBreakdown = { ...prev.modeBreakdown };
  for (const [mode, score] of Object.entries(delta.modeBreakdown)) {
    modeBreakdown[mode] = (modeBreakdown[mode] ?? 0) + score;
  }
  const nextStats = {
    totalScore: prev.totalScore + delta.totalScore,
    // Higher total is better in King, so the best game is the MAX final total.
    bestGameScore: Math.max(prev.bestGameScore, delta.bestGameScore),
    modeBreakdown,
  };

  const now = new Date();
  const values = {
    userId,
    gameType: KING,
    gamesPlayed: (cur?.gamesPlayed ?? 0) + 1,
    gamesWon: (cur?.gamesWon ?? 0) + (delta.won ? 1 : 0),
    gamesLost: (cur?.gamesLost ?? 0) + (delta.won ? 0 : 1),
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

export interface UserStatsView {
  gameType: string;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  roundsPlayed: number;
  stats: Record<string, unknown>;
  lastPlayedAt: string | null;
}

/** Reads a user's cached stats for a game type (public profile/leaderboard read). */
export async function getUserStats(userId: string, gameType = KING): Promise<UserStatsView> {
  const db = await database();
  const row = (await db.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, gameType)))
    .limit(1))[0];
  if (!row) {
    return { gameType, gamesPlayed: 0, gamesWon: 0, gamesLost: 0, roundsPlayed: 0, stats: {}, lastPlayedAt: null };
  }
  return {
    gameType: row.gameType,
    gamesPlayed: row.gamesPlayed,
    gamesWon: row.gamesWon,
    gamesLost: row.gamesLost,
    roundsPlayed: row.roundsPlayed,
    stats: row.stats ?? {},
    lastPlayedAt: row.lastPlayedAt ? row.lastPlayedAt.toISOString() : null,
  };
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string | null;
  gamesPlayed: number;
  gamesWon: number;
}

/**
 * Per-game leaderboard: top players by wins (then games played). Exposes only
 * public fields (display name + counters) — no email/stats internals. Guests are
 * included (they are real users); excluded only if they have no display name AND
 * the join surfaces nothing useful — kept simple here: all ranked users.
 */
export async function getLeaderboard(gameType = KING, limit = 20): Promise<LeaderboardEntry[]> {
  const db = await database();
  const rows = await db.select({
    userId: userStats.userId,
    displayName: users.displayName,
    gamesPlayed: userStats.gamesPlayed,
    gamesWon: userStats.gamesWon,
  }).from(userStats)
    .innerJoin(users, eq(users.id, userStats.userId))
    .where(eq(userStats.gameType, gameType))
    .orderBy(desc(userStats.gamesWon), desc(userStats.gamesPlayed))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    gamesPlayed: r.gamesPlayed,
    gamesWon: r.gamesWon,
  }));
}
