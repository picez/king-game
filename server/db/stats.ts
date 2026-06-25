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
import { eq, and, desc, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameState } from '../../src/models/types';
import {
  summarizeFinishedGame, computeStatDeltas, isFinishedGame, TRUMP_MODE,
} from '../../src/net/kingStats';
import { games, gamePlayers, rounds, userStats, users, userSettings } from './schema';
import { getDb } from './client';

const KING = 'king';
const KING_RULESET = 'king-v1';

/**
 * Schema version of the King `user_stats.stats` JSONB (Stage 5.2). v1 stored
 * `modeBreakdown` as `{ modeId: number }` (summed score only). v2 stores
 * `{ modeId: { rounds, totalScore } }` plus best/worst/trump/negative counters.
 * `readStats` upgrades v1 on read (round counts default 0 for legacy data; a
 * `rebuildUserStats` recomputes them exactly from `rounds`). Bumping this is the
 * compatibility marker the UI/tests key off.
 */
const STATS_VERSION = 2;

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

interface ModeAggInternal { rounds: number; totalScore: number; }

interface ExistingStats {
  totalScore: number;
  bestGameScore: number;   // -Infinity sentinel when no games yet
  worstGameScore: number;  // +Infinity sentinel when no games yet
  trumpRoundsPlayed: number;
  negativeRoundsPlayed: number;
  surrenderedCount: number;
  modeBreakdown: Record<string, ModeAggInternal>;
}

/**
 * Reads the stats JSONB, tolerating BOTH the legacy v1 shape (modeBreakdown =
 * `{ modeId: number }`, no best/worst/trump/negative) and the current v2 shape.
 * Missing fields default safely (counters → 0, best → -Inf, worst → +Inf) so an
 * old row never crashes; the round counts for legacy modeBreakdown are unknown
 * (0) until a `rebuildUserStats` recomputes them. Pure (no I/O).
 */
function readStats(raw: unknown): ExistingStats {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const mbRaw = (o.modeBreakdown && typeof o.modeBreakdown === 'object')
    ? o.modeBreakdown as Record<string, unknown> : {};
  const modeBreakdown: Record<string, ModeAggInternal> = {};
  for (const [mode, v] of Object.entries(mbRaw)) {
    if (typeof v === 'number') {
      modeBreakdown[mode] = { rounds: 0, totalScore: v }; // legacy v1: score only
    } else if (v && typeof v === 'object') {
      const ov = v as Record<string, unknown>;
      modeBreakdown[mode] = {
        rounds: typeof ov.rounds === 'number' ? ov.rounds : 0,
        totalScore: typeof ov.totalScore === 'number' ? ov.totalScore : 0,
      };
    }
  }
  return {
    totalScore: typeof o.totalScore === 'number' ? o.totalScore : 0,
    bestGameScore: typeof o.bestGameScore === 'number' ? o.bestGameScore : Number.NEGATIVE_INFINITY,
    worstGameScore: typeof o.worstGameScore === 'number' ? o.worstGameScore : Number.POSITIVE_INFINITY,
    trumpRoundsPlayed: typeof o.trumpRoundsPlayed === 'number' ? o.trumpRoundsPlayed : 0,
    negativeRoundsPlayed: typeof o.negativeRoundsPlayed === 'number' ? o.negativeRoundsPlayed : 0,
    surrenderedCount: typeof o.surrenderedCount === 'number' ? o.surrenderedCount : 0,
    modeBreakdown,
  };
}

/** Serialises ExistingStats back to the v2 JSONB (omits non-finite sentinels). */
function serializeStats(s: ExistingStats): Record<string, unknown> {
  const out: Record<string, unknown> = {
    v: STATS_VERSION,
    totalScore: s.totalScore,
    trumpRoundsPlayed: s.trumpRoundsPlayed,
    negativeRoundsPlayed: s.negativeRoundsPlayed,
    surrenderedCount: s.surrenderedCount,
    modeBreakdown: s.modeBreakdown,
  };
  if (Number.isFinite(s.bestGameScore)) out.bestGameScore = s.bestGameScore;
  if (Number.isFinite(s.worstGameScore)) out.worstGameScore = s.worstGameScore;
  return out;
}

/** Combines two parsed stat blobs (used by the guest→account merge). */
function combineStats(a: ExistingStats, b: ExistingStats): ExistingStats {
  const modeBreakdown: Record<string, ModeAggInternal> = { ...a.modeBreakdown };
  for (const [mode, agg] of Object.entries(b.modeBreakdown)) {
    const m = modeBreakdown[mode] ?? { rounds: 0, totalScore: 0 };
    modeBreakdown[mode] = { rounds: m.rounds + agg.rounds, totalScore: m.totalScore + agg.totalScore };
  }
  return {
    totalScore: a.totalScore + b.totalScore,
    bestGameScore: Math.max(a.bestGameScore, b.bestGameScore),
    worstGameScore: Math.min(a.worstGameScore, b.worstGameScore),
    trumpRoundsPlayed: a.trumpRoundsPlayed + b.trumpRoundsPlayed,
    negativeRoundsPlayed: a.negativeRoundsPlayed + b.negativeRoundsPlayed,
    surrenderedCount: a.surrenderedCount + b.surrenderedCount,
    modeBreakdown,
  };
}

/**
 * Merges every `(from)` user_stats row into `(to)` per game_type, inside a
 * transaction (Stage 6 guest→account merge). Where `to` has no row for a game
 * type the `from` row is repointed (no data loss); where both exist the counters
 * and JSONB are combined and the `from` row deleted. Idempotent: after merge the
 * `from` user owns no stats rows, so a re-run is a no-op. King scoring stays
 * inside the JSONB per game_type — never mixed across games.
 */
export async function mergeUserStatsInto(
  tx: PostgresJsDatabase, fromUserId: string, toUserId: string,
): Promise<void> {
  const fromRows = await tx.select().from(userStats).where(eq(userStats.userId, fromUserId));
  for (const fr of fromRows) {
    const gt = fr.gameType;
    const toRow = (await tx.select().from(userStats)
      .where(and(eq(userStats.userId, toUserId), eq(userStats.gameType, gt))).limit(1))[0];
    if (!toRow) {
      await tx.update(userStats).set({ userId: toUserId })
        .where(and(eq(userStats.userId, fromUserId), eq(userStats.gameType, gt)));
      continue;
    }
    const combined = combineStats(readStats(toRow.stats), readStats(fr.stats));
    const lastPlayedAt = (toRow.lastPlayedAt && fr.lastPlayedAt)
      ? (toRow.lastPlayedAt > fr.lastPlayedAt ? toRow.lastPlayedAt : fr.lastPlayedAt)
      : (toRow.lastPlayedAt ?? fr.lastPlayedAt);
    await tx.update(userStats).set({
      gamesPlayed: toRow.gamesPlayed + fr.gamesPlayed,
      gamesWon: toRow.gamesWon + fr.gamesWon,
      gamesLost: toRow.gamesLost + fr.gamesLost,
      roundsPlayed: toRow.roundsPlayed + fr.roundsPlayed,
      stats: serializeStats(combined),
      lastPlayedAt,
      updatedAt: new Date(),
    }).where(and(eq(userStats.userId, toUserId), eq(userStats.gameType, gt)));
    await tx.delete(userStats).where(and(eq(userStats.userId, fromUserId), eq(userStats.gameType, gt)));
  }
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
  for (const [mode, agg] of Object.entries(delta.modeBreakdown)) {
    const m = modeBreakdown[mode] ?? { rounds: 0, totalScore: 0 };
    modeBreakdown[mode] = { rounds: m.rounds + agg.rounds, totalScore: m.totalScore + agg.totalScore };
  }
  const nextStats = serializeStats({
    totalScore: prev.totalScore + delta.totalScore,
    // Higher total is better in King, so best = MAX and worst = MIN final total.
    bestGameScore: Math.max(prev.bestGameScore, delta.bestGameScore),
    worstGameScore: Math.min(prev.worstGameScore, delta.worstGameScore),
    trumpRoundsPlayed: prev.trumpRoundsPlayed + delta.trumpRoundsPlayed,
    negativeRoundsPlayed: prev.negativeRoundsPlayed + delta.negativeRoundsPlayed,
    // Surrenders are not yet in RoundRecord (no rules change) → stays 0.
    surrenderedCount: prev.surrenderedCount,
    modeBreakdown,
  });

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

/** Public per-mode aggregate exposed by the API (rounds + score + average). */
export interface ModeStatView { rounds: number; totalScore: number; averageScore: number | null; }

/** Full, public, derived King stats for one user. All score-level (no cards). */
export interface UserStatsView {
  gameType: string;
  statsVersion: number;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  winRate: number | null;     // 0..100 integer; null when no games
  roundsPlayed: number;
  totalScore: number;
  averageScore: number | null;
  bestScore: number | null;
  worstScore: number | null;
  trumpRoundsPlayed: number;
  negativeRoundsPlayed: number;
  surrenderedCount: number;
  /** False: RoundRecord has no `surrenderedBy` yet (no rules change) → always 0. */
  surrenderedSupported: boolean;
  modeBreakdown: Record<string, ModeStatView>;
  lastGameAt: string | null;
}

function pct(n: number, d: number): number | null {
  return d > 0 ? Math.round((n / d) * 100) : null;
}
function avg(total: number, count: number): number | null {
  return count > 0 ? Math.round(total / count) : null;
}

/** Builds the public view from raw counters + the parsed stats JSONB. */
function toStatsView(
  gameType: string,
  row: { gamesPlayed: number; gamesWon: number; gamesLost: number; roundsPlayed: number; lastPlayedAt: Date | null } | null,
  s: ExistingStats,
): UserStatsView {
  const gamesPlayed = row?.gamesPlayed ?? 0;
  const modeBreakdown: Record<string, ModeStatView> = {};
  for (const [mode, agg] of Object.entries(s.modeBreakdown)) {
    modeBreakdown[mode] = { rounds: agg.rounds, totalScore: agg.totalScore, averageScore: avg(agg.totalScore, agg.rounds) };
  }
  return {
    gameType,
    statsVersion: STATS_VERSION,
    gamesPlayed,
    gamesWon: row?.gamesWon ?? 0,
    gamesLost: row?.gamesLost ?? 0,
    winRate: pct(row?.gamesWon ?? 0, gamesPlayed),
    roundsPlayed: row?.roundsPlayed ?? 0,
    totalScore: s.totalScore,
    averageScore: avg(s.totalScore, gamesPlayed),
    bestScore: Number.isFinite(s.bestGameScore) ? s.bestGameScore : null,
    worstScore: Number.isFinite(s.worstGameScore) ? s.worstGameScore : null,
    trumpRoundsPlayed: s.trumpRoundsPlayed,
    negativeRoundsPlayed: s.negativeRoundsPlayed,
    surrenderedCount: s.surrenderedCount,
    surrenderedSupported: false,
    modeBreakdown,
    lastGameAt: row?.lastPlayedAt ? row.lastPlayedAt.toISOString() : null,
  };
}

/** Reads a user's cached stats for a game type as a full derived view. */
export async function getUserStats(userId: string, gameType = KING): Promise<UserStatsView> {
  const db = await database();
  const row = (await db.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, gameType)))
    .limit(1))[0];
  return toStatsView(gameType, row ?? null, readStats(row?.stats));
}

/** Public leaderboard row — display fields + derived counters only (no userId). */
export interface LeaderboardEntry {
  displayName: string | null;
  avatar: string | null;
  gamesPlayed: number;
  gamesWon: number;
  winRate: number | null;
  averageScore: number | null;
  bestScore: number | null;
  totalScore: number;
  lastGameAt: string | null;
  /** True for the requesting user's own row (server-marked; no id exposed). */
  self: boolean;
}

/**
 * Per-game leaderboard: top players by wins (then games played). Exposes ONLY
 * public, score-level fields — display name + avatar (from global settings) +
 * derived counters. The user id is used internally to mark the caller's own row
 * (`self`) and is NEVER returned, so the client can highlight without a private
 * id. Guests are included (they are real users).
 */
export async function getLeaderboard(
  gameType = KING, limit = 20, selfUserId: string | null = null,
): Promise<LeaderboardEntry[]> {
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
    .where(eq(userStats.gameType, gameType))
    .orderBy(desc(userStats.gamesWon), desc(userStats.gamesPlayed))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((r) => {
    const s = readStats(r.stats);
    return {
      displayName: r.displayName,
      avatar: r.avatar ?? null,
      gamesPlayed: r.gamesPlayed,
      gamesWon: r.gamesWon,
      winRate: pct(r.gamesWon, r.gamesPlayed),
      averageScore: avg(s.totalScore, r.gamesPlayed),
      bestScore: Number.isFinite(s.bestGameScore) ? s.bestGameScore : null,
      totalScore: s.totalScore,
      lastGameAt: r.lastPlayedAt ? r.lastPlayedAt.toISOString() : null,
      self: selfUserId != null && r.userId === selfUserId,
    };
  });
}

/**
 * Recomputes a user's `user_stats` row for a game type FROM the durable
 * `games`/`game_players`/`rounds` (the architecture's rebuildable cache). Useful
 * to backfill v2 fields (per-mode round counts, worst score) onto rows written
 * under v1. Pure read of score-only data — never touches cards. Returns the
 * recomputed view. Safe to run repeatedly (idempotent overwrite).
 */
export async function rebuildUserStats(userId: string, gameType = KING): Promise<UserStatsView> {
  const db = await database();
  // Every finished-game seat this user occupied (final total + win flag + when).
  const seats = await db.select({
    gameId: gamePlayers.gameId,
    playerId: gamePlayers.playerId,
    finalTotal: gamePlayers.finalTotal,
    isWinner: gamePlayers.isWinner,
    finishedAt: games.finishedAt,
  }).from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(and(eq(gamePlayers.userId, userId), eq(games.gameType, gameType)));

  let gamesPlayed = 0, gamesWon = 0, gamesLost = 0;
  let totalScore = 0, best = Number.NEGATIVE_INFINITY, worst = Number.POSITIVE_INFINITY;
  let lastPlayed: Date | null = null;
  const playerByGame = new Map<string, string>();
  for (const s of seats) {
    gamesPlayed++;
    if (s.isWinner) gamesWon++; else gamesLost++;
    totalScore += s.finalTotal;
    best = Math.max(best, s.finalTotal);
    worst = Math.min(worst, s.finalTotal);
    if (s.finishedAt && (!lastPlayed || s.finishedAt > lastPlayed)) lastPlayed = s.finishedAt;
    playerByGame.set(s.gameId, s.playerId);
  }

  let roundsPlayed = 0, trumpRoundsPlayed = 0, negativeRoundsPlayed = 0;
  const modeBreakdown: Record<string, ModeAggInternal> = {};
  const gameIds = [...playerByGame.keys()];
  if (gameIds.length > 0) {
    const rr = await db.select({ gameId: rounds.gameId, modeId: rounds.modeId, scores: rounds.scores })
      .from(rounds).where(inArray(rounds.gameId, gameIds));
    for (const r of rr) {
      const pid = playerByGame.get(r.gameId);
      if (!pid) continue;
      const sc = (r.scores as Record<string, number> | null)?.[pid];
      if (typeof sc !== 'number') continue;
      roundsPlayed++;
      const mode = r.modeId ?? 'unknown';
      const m = modeBreakdown[mode] ?? { rounds: 0, totalScore: 0 };
      modeBreakdown[mode] = { rounds: m.rounds + 1, totalScore: m.totalScore + sc };
      if (mode === TRUMP_MODE) trumpRoundsPlayed++; else negativeRoundsPlayed++;
    }
  }

  const stats: ExistingStats = {
    totalScore, bestGameScore: best, worstGameScore: worst,
    trumpRoundsPlayed, negativeRoundsPlayed, surrenderedCount: 0, modeBreakdown,
  };
  const now = new Date();
  const values = {
    userId, gameType, gamesPlayed, gamesWon, gamesLost, roundsPlayed,
    stats: serializeStats(stats), lastPlayedAt: lastPlayed ?? now, updatedAt: now,
  };
  await db.insert(userStats).values(values).onConflictDoUpdate({
    target: [userStats.userId, userStats.gameType],
    set: {
      gamesPlayed, gamesWon, gamesLost, roundsPlayed,
      stats: values.stats, lastPlayedAt: values.lastPlayedAt, updatedAt: now,
    },
  });
  return toStatsView(gameType, { gamesPlayed, gamesWon, gamesLost, roundsPlayed, lastPlayedAt: values.lastPlayedAt }, stats);
}
