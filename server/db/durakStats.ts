// ---------------------------------------------------------------------------
// Durak stats repository (DURAK-1). Mirrors server/db/stats.ts for Durak.
//
// Called from the WS server when an ONLINE Durak game reaches `finished`. It
// lifts the outcome-only result into durable rows (games → game_players) and
// increments the per-(user, game_type='durak') `user_stats` cache. Runs in ONE
// transaction, IDEMPOTENT via `games.game_key` (reconnect/restart can't double
// count). Requires Postgres (DATABASE_URL); imported DYNAMICALLY by the server
// only on the finish path. Bots (no user_id) are skipped. NO private state —
// Durak has no scores/rounds, only the fool/draw outcome.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { DurakState } from '../../src/games/durak/types';
import {
  isFinishedDurakGame, summarizeFinishedDurakGame, computeDurakStatDeltas,
  type DurakFinishedSummary,
} from '../../src/net/durakStats';
import { games, gamePlayers, userStats } from './schema';
import { getDb } from './client';
import type { SeatUsers, RecordResult } from './stats';
import type { DurakStatsView } from '../../src/net/durakStats';

const DURAK = 'durak';
const DURAK_RULESET = 'durak-v1';
const DURAK_STATS_VERSION = 1;

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('durak stats repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.db as PostgresJsDatabase;
}

/** Deterministic per-game identity: room code + the fool/draw + winner set. */
function gameKey(roomCode: string, summary: DurakFinishedSummary): string {
  const outcome = summary.isDraw ? 'draw' : (summary.foolId ?? 'none');
  const winners = [...summary.winners].sort().join(',');
  return createHash('sha256').update(`${DURAK}|${roomCode}|${outcome}|${winners}`).digest('hex');
}

interface DurakStatsBlob { foolCount: number; drawCount: number; }

/** Reads the Durak stats JSONB, defaulting missing counters to 0. Pure. */
export function readDurakStats(raw: unknown): DurakStatsBlob {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  return {
    foolCount: typeof o.foolCount === 'number' ? o.foolCount : 0,
    drawCount: typeof o.drawCount === 'number' ? o.drawCount : 0,
  };
}

function serializeDurakStats(s: DurakStatsBlob): Record<string, unknown> {
  return { v: DURAK_STATS_VERSION, foolCount: s.foolCount, drawCount: s.drawCount };
}

/**
 * Records a finished online Durak game and updates stats for human members with
 * a resolved userId. Returns `{ recorded: false }` when already stored
 * (idempotent) or nothing to do. Mirrors recordFinishedGame (King).
 */
export async function recordFinishedDurakGame(
  roomCode: string,
  state: DurakState,
  seatUsers: SeatUsers,
): Promise<RecordResult> {
  if (!isFinishedDurakGame(state)) return { recorded: false };

  const summary = summarizeFinishedDurakGame(state);
  if (summary.players.length === 0) return { recorded: false };

  const deltas = computeDurakStatDeltas(summary);
  const deltaByPlayer = new Map(deltas.map((d) => [d.playerId, d]));
  const key = gameKey(roomCode, summary);

  // A sole winner is rare in Durak (usually several) — resolve one only then.
  const soleWinnerSeat = summary.winners.length === 1
    ? summary.players.find((p) => p.playerId === summary.winners[0])?.seatIndex ?? null
    : null;
  const winnerUserId = soleWinnerSeat != null ? (seatUsers.get(soleWinnerSeat) ?? null) : null;

  const db = await database();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(games).values({
      gameKey: key,
      roomCode,
      gameType: DURAK,
      rulesetId: DURAK_RULESET,
      playerCount: summary.playerCount,
      status: 'finished',
      winnerUserId,
      result: { winners: summary.winners, foolId: summary.foolId, isDraw: summary.isDraw },
    }).onConflictDoNothing({ target: games.gameKey }).returning({ id: games.id });

    if (inserted.length === 0) return { recorded: false };
    const gameId = inserted[0].id;

    // Durak has no score → finalTotal is a neutral 0; isWinner carries the result.
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
      await upsertDurakUserStats(tx, userId, delta);
    }

    return { recorded: true, gameId, humanPlayers };
  });
}

/** Read-modify-write one user's Durak stats cache inside the transaction. */
async function upsertDurakUserStats(
  tx: PostgresJsDatabase,
  userId: string,
  delta: ReturnType<typeof computeDurakStatDeltas>[number],
): Promise<void> {
  const cur = (await tx.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, DURAK)))
    .limit(1))[0];
  const prev = readDurakStats(cur?.stats);

  const nextStats = serializeDurakStats({
    foolCount: prev.foolCount + (delta.isFool ? 1 : 0),
    drawCount: prev.drawCount + (delta.isDraw ? 1 : 0),
  });

  const now = new Date();
  const values = {
    userId,
    gameType: DURAK,
    gamesPlayed: (cur?.gamesPlayed ?? 0) + 1,
    gamesWon: (cur?.gamesWon ?? 0) + (delta.won ? 1 : 0),
    gamesLost: (cur?.gamesLost ?? 0) + (delta.won ? 0 : 1),
    roundsPlayed: cur?.roundsPlayed ?? 0, // Durak has no rounds
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

/** Builds the public Durak view from raw counters + the parsed stats JSONB. */
function toDurakStatsView(
  row: { gamesPlayed: number; gamesWon: number; gamesLost: number; lastPlayedAt: Date | null } | null,
  blob: DurakStatsBlob,
): DurakStatsView {
  const gamesPlayed = row?.gamesPlayed ?? 0;
  return {
    gameType: 'durak',
    gamesPlayed,
    gamesWon: row?.gamesWon ?? 0,
    gamesLost: row?.gamesLost ?? 0,
    winRate: pct(row?.gamesWon ?? 0, gamesPlayed),
    foolCount: blob.foolCount,
    drawCount: blob.drawCount,
    foolRate: pct(blob.foolCount, gamesPlayed),
    lastGameAt: row?.lastPlayedAt ? row.lastPlayedAt.toISOString() : null,
  };
}

/** Reads a user's cached Durak stats as a full derived view. */
export async function getDurakStats(userId: string): Promise<DurakStatsView> {
  const db = await database();
  const row = (await db.select().from(userStats)
    .where(and(eq(userStats.userId, userId), eq(userStats.gameType, DURAK)))
    .limit(1))[0];
  return toDurakStatsView(row ?? null, readDurakStats(row?.stats));
}
