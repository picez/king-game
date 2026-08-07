// ---------------------------------------------------------------------------
// ONLINE match + participant repository (Stage 38.0.5).
//
// The durable half of the permanent-leave feature. It owns exactly one thing: the
// CANONICAL per-participant outcome of an ONLINE non-Poker match.
//
//   START_GAME  → `recordOnlineMatchStart`   (match + one row per starting seat)
//   permanent   → `applyPermanentForfeitTx`  (pending → loss+forfeited, ONE transition)
//   finish      → `recordOnlineMatchFinish`  (pending → win/loss/draw for the rest)
//
// EXACTLY-ONCE is enforced by the DATABASE, not by a process flag:
//   • `online_matches.match_id` is the PK — a duplicate/restarted START can never
//     create a second match for the same id;
//   • `(match_id, seat_index)` is the participants PK;
//   • a partial UNIQUE index on `(match_id, user_id)` means one account holds at
//     most one seat per match;
//   • the forfeit UPDATE is GATED on `outcome = 'pending' AND forfeited = false`, so
//     the transition itself is the mutex — a duplicate delivery, a retry after a lost
//     ACK, or a restart replay all report `already_applied` and change nothing.
//
// FAIL CLOSED: `recordOnlineMatchStart` verifies that an EXISTING row describes the
// SAME match (room/game/category/player count/roster). A mismatch is never "fixed" by
// overwriting — it returns `conflict`, and the caller refuses the permanent leave, so
// a forfeit can never be attributed to a different match.
//
// PRIVACY: no cards, no game state, no email, no reconnect token, no chip amount. A
// failure is logged (by the caller) without any account id or match id.
//
// Requires Postgres; imported DYNAMICALLY so a no-DB server never loads the driver.
// ---------------------------------------------------------------------------

import { eq, and, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { onlineMatches, onlineMatchParticipants } from './schema';
import { getDb } from './client';
import type { OnlineMatchMeta } from '../../src/net/onlineMatch';
import { TRACKED_ONLINE_GAMES } from '../../src/net/onlineTracker';

async function database(): Promise<PostgresJsDatabase> {
  const conn = await getDb();
  if (!conn) throw new Error('online match repository requires DATABASE_URL (Postgres). It is opt-in.');
  return conn.db as PostgresJsDatabase;
}

/** Terminal outcomes a FINISH may assign (never `pending`, never a forfeit). */
export type OnlineMatchOutcome = 'win' | 'loss' | 'draw';

export type StartRecordResult = 'recorded' | 'already_exists' | 'conflict';
export type ForfeitResult = 'applied' | 'already_applied' | 'conflict';

/**
 * Persist the frozen match + its starting roster. IDEMPOTENT by `match_id`.
 *
 *  - `recorded`       — this call inserted the match and its participants;
 *  - `already_exists` — the SAME match (identical room/game/category/count and an
 *                       identical roster) is already durable → nothing to do;
 *  - `conflict`       — a row exists that describes a DIFFERENT match. Never
 *                       overwritten; the caller fails closed.
 *
 * Nothing here comes from a client: the caller derives every value from the room's
 * server-only frozen metadata.
 */
export async function recordOnlineMatchStart(meta: OnlineMatchMeta): Promise<StartRecordResult> {
  const db = await database();
  return db.transaction(async (tx) => {
    const inserted = await tx.insert(onlineMatches).values({
      matchId: meta.matchId,
      roomCode: meta.roomCode,
      gameType: meta.gameType,
      category: meta.category,
      playerCount: meta.playerCount,
      status: 'active',
      startedAt: new Date(meta.startedAt),
    }).onConflictDoNothing({ target: onlineMatches.matchId }).returning({ matchId: onlineMatches.matchId });

    if (inserted.length > 0) {
      await tx.insert(onlineMatchParticipants).values(meta.roster.map((s) => ({
        matchId: meta.matchId,
        seatIndex: s.seat,
        userId: s.type === 'human' ? s.userId : null,
        memberType: s.type,
        outcome: 'pending' as const,
        forfeited: false,
      })));
      return 'recorded';
    }

    // A row already exists — prove it is THE SAME match before trusting it.
    const existing = (await tx.select().from(onlineMatches)
      .where(eq(onlineMatches.matchId, meta.matchId)).limit(1))[0];
    if (!existing) return 'conflict'; // vanished mid-transaction → fail closed
    if (existing.roomCode !== meta.roomCode
      || existing.gameType !== meta.gameType
      || existing.category !== meta.category
      || existing.playerCount !== meta.playerCount) return 'conflict';

    const rows = await tx.select().from(onlineMatchParticipants)
      .where(eq(onlineMatchParticipants.matchId, meta.matchId));
    if (rows.length !== meta.roster.length) return 'conflict';
    for (const seat of meta.roster) {
      const row = rows.find((r) => r.seatIndex === seat.seat);
      if (!row) return 'conflict';
      if (row.memberType !== seat.type) return 'conflict';
      const expectedUser = seat.type === 'human' ? seat.userId : null;
      if ((row.userId ?? null) !== (expectedUser ?? null)) return 'conflict';
    }
    return 'already_exists';
  });
}

/**
 * The ONE durable transition of a permanent leave: this participant's `pending`
 * outcome becomes a FORFEITED LOSS. Runs in a single transaction; the caller must
 * only take the seat over AFTER this commits.
 *
 * The identity is verified INSIDE the transaction (seat exists, is a starting HUMAN,
 * and its account matches the caller's authoritative `userId`) — a mismatch is
 * `conflict`, never a silent write to the wrong row. A row already `forfeited`
 * returns `already_applied` (the duplicate-delivery and lost-ACK cases); a row that
 * already carries a NON-forfeit terminal outcome (the match finished first) returns
 * `conflict`, so a finished result can never be rewritten into a loss.
 *
 * A real DB error propagates — the caller maps it to a RETRYABLE refusal and leaves
 * the room, the seat and the client's session completely untouched.
 */
export async function applyPermanentForfeitTx(input: {
  matchId: string;
  seatIndex: number;
  /** The authoritative account id, or null for a guest (no account attribution). */
  userId: string | null;
  at: Date;
}): Promise<ForfeitResult> {
  const db = await database();
  return db.transaction(async (tx) => {
    // Lock the exact participant row for the duration of the transaction, so two
    // concurrent forfeits for the same seat serialize instead of racing.
    const locked = await tx.select().from(onlineMatchParticipants)
      .where(and(
        eq(onlineMatchParticipants.matchId, input.matchId),
        eq(onlineMatchParticipants.seatIndex, input.seatIndex),
      ))
      .for('update')
      .limit(1);
    const row = locked[0];
    if (!row) return 'conflict';                              // no such durable seat
    if (row.memberType !== 'human') return 'conflict';        // a bot can never forfeit
    if ((row.userId ?? null) !== (input.userId ?? null)) return 'conflict'; // wrong account
    if (row.forfeited) return 'already_applied';              // idempotent repeat
    if (row.outcome !== 'pending') return 'conflict';         // already finished — never rewrite

    const updated = await tx.update(onlineMatchParticipants).set({
      outcome: 'loss',
      forfeited: true,
      forfeitedAt: input.at,
    }).where(and(
      eq(onlineMatchParticipants.matchId, input.matchId),
      eq(onlineMatchParticipants.seatIndex, input.seatIndex),
      // The GATE: only a still-pending, not-yet-forfeited row may transition.
      eq(onlineMatchParticipants.outcome, 'pending'),
      eq(onlineMatchParticipants.forfeited, false),
    )).returning({ seatIndex: onlineMatchParticipants.seatIndex });

    return updated.length === 1 ? 'applied' : 'already_applied';
  });
}

/**
 * Assign the FINAL outcomes of a finished match. Writes ONLY rows that are still
 * `pending` and NOT `forfeited`, so:
 *  - a forfeited leaver keeps its single technical loss (never a second result, and
 *    never upgraded to a win because the replacement bot went on to win);
 *  - a replay / rebroadcast / restart records nothing new.
 * Idempotent; safe to call repeatedly. Returns how many participants it settled.
 */
export async function recordOnlineMatchFinish(
  matchId: string,
  outcomes: Map<number, OnlineMatchOutcome>,
  finishedAt: Date,
): Promise<{ settled: number }> {
  const db = await database();
  return db.transaction(async (tx) => {
    let settled = 0;
    for (const [seatIndex, outcome] of outcomes) {
      const updated = await tx.update(onlineMatchParticipants).set({ outcome })
        .where(and(
          eq(onlineMatchParticipants.matchId, matchId),
          eq(onlineMatchParticipants.seatIndex, seatIndex),
          eq(onlineMatchParticipants.outcome, 'pending'),
          eq(onlineMatchParticipants.forfeited, false),
        )).returning({ seatIndex: onlineMatchParticipants.seatIndex });
      settled += updated.length;
    }
    await tx.update(onlineMatches)
      .set({ status: 'finished', finishedAt })
      .where(and(eq(onlineMatches.matchId, matchId), eq(onlineMatches.status, 'active')));
    return { settled };
  });
}

/** One participant row as stored (read-only helper for tests + the 38.0.6 tracker). */
export interface OnlineParticipantRow {
  seatIndex: number;
  userId: string | null;
  memberType: string;
  outcome: string;
  forfeited: boolean;
}

/** Read a match's participants (seat order). Returns [] when the match is unknown. */
export async function listOnlineMatchParticipants(matchId: string): Promise<OnlineParticipantRow[]> {
  const db = await database();
  const rows = await db.select().from(onlineMatchParticipants)
    .where(eq(onlineMatchParticipants.matchId, matchId))
    .orderBy(onlineMatchParticipants.seatIndex);
  return rows.map((r) => ({
    seatIndex: r.seatIndex,
    userId: r.userId ?? null,
    memberType: r.memberType,
    outcome: r.outcome,
    forfeited: r.forfeited,
  }));
}

/** Read one match header. Null when unknown. */
export async function getOnlineMatch(matchId: string): Promise<{
  roomCode: string; gameType: string; category: string; playerCount: number; status: string;
} | null> {
  const db = await database();
  const row = (await db.select().from(onlineMatches)
    .where(eq(onlineMatches.matchId, matchId)).limit(1))[0];
  return row
    ? { roomCode: row.roomCode, gameType: row.gameType, category: row.category, playerCount: row.playerCount, status: row.status }
    : null;
}

/**
 * Per-account ONLINE participation counters, split by the FROZEN category. This is the
 * read the Stage 38.0.6 profile tracker is built on — ONLINE only (local games never
 * create a match row, so they are excluded by construction), and it never touches
 * `user_stats` / `games` / `game_players`.
 *
 * ONLY TERMINAL OUTCOMES COUNT (Stage 38.0.6 fix). The Stage 38.0.5 version used a bare
 * `count(*)` for `matches`, so a participant of a match that was still being played —
 * outcome `pending` — was already reported as a played match (RED: one active match with
 * no result gave `{matches: 1, wins: 0, losses: 0}`), and there was no `draws` column at
 * all, so `matches` could never equal `wins + losses + draws`. The `WHERE` now keeps only
 * `win | loss | draw` rows, and a game/category with nothing but pending rows simply does
 * not appear (the pure `buildOnlineTracker` zero-fills it).
 *
 * A permanent leave is the one result that is terminal while the match is still running:
 * it writes `loss` + `forfeited = true` immediately, so it is counted straight away — and
 * exactly once, because `(match_id, seat_index)` is the PK and a partial UNIQUE index on
 * `(match_id, user_id)` means one account holds at most one seat per match. A retry, a
 * reconnect or a restart replay therefore cannot inflate any counter.
 *
 * Poker is excluded twice over: 0014 never records it, AND the game-type filter below
 * only admits the six tracked games. Bot seats carry no account, and the explicit
 * `member_type = 'human'` filter keeps that true even if a future seat type appears.
 * Scoped to ONE account — the caller passes the id resolved from the server session,
 * never anything client-supplied.
 */
export async function getOnlineParticipationCounters(userId: string): Promise<Array<{
  gameType: string; category: string; matches: number; wins: number; losses: number; draws: number; forfeits: number;
}>> {
  const db = await database();
  const rows = await db.select({
    gameType: onlineMatches.gameType,
    category: onlineMatches.category,
    matches: sql<number>`count(*)::int`,
    wins: sql<number>`count(*) filter (where ${onlineMatchParticipants.outcome} = 'win')::int`,
    losses: sql<number>`count(*) filter (where ${onlineMatchParticipants.outcome} = 'loss')::int`,
    draws: sql<number>`count(*) filter (where ${onlineMatchParticipants.outcome} = 'draw')::int`,
    forfeits: sql<number>`count(*) filter (where ${onlineMatchParticipants.forfeited})::int`,
  }).from(onlineMatchParticipants)
    .innerJoin(onlineMatches, eq(onlineMatches.matchId, onlineMatchParticipants.matchId))
    .where(and(
      eq(onlineMatchParticipants.userId, userId),
      eq(onlineMatchParticipants.memberType, 'human'),
      // A still-running (or abandoned-without-a-result) seat is NOT a played match.
      inArray(onlineMatchParticipants.outcome, ['win', 'loss', 'draw']),
      inArray(onlineMatches.gameType, [...TRACKED_ONLINE_GAMES]),
    ))
    .groupBy(onlineMatches.gameType, onlineMatches.category);
  return rows;
}
