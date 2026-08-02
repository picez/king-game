/**
 * Frozen ONLINE match identity + starting roster (Stage 38.0.5).
 *
 * Created ONCE, at `START_GAME`, for every ONLINE non-Poker room. It is the
 * IMMUTABLE answer to "who actually started this match, and was it a pure
 * human table or a table with bots?" — a question the live membership can no
 * longer answer once a permanent leave replaces a human seat with an AI.
 *
 * PURITY / PRIVACY
 *  - This module is framework-free and imports nothing from `serverCore`
 *    (serverCore imports IT), so it stays unit-testable and cycle-free.
 *  - The metadata is SERVER-ONLY: it holds account ids and a match id, so it
 *    must never appear in a `RoomSnapshot` / `RoomSummary` / any wire message,
 *    and its private values are never logged. It IS persisted in the room JSON
 *    (which already carries reconnect-token hashes and user ids).
 *  - The only mutable part is `forfeits` — permanent departures, appended once
 *    per seat. `category` and `roster` are NEVER recomputed after START_GAME.
 */

import type { GameType } from '../games/catalog';
import { isGameType } from '../games/catalog';

/**
 * How the match STARTED. Frozen at `START_GAME` and never recomputed:
 *  - `human_only` — every seat was a human;
 *  - `with_bots`  — at least one seat was a server-side AI.
 * A later AI takeover of a departed human does NOT move a `human_only` match to
 * `with_bots` (and a `with_bots` match never becomes `human_only`).
 */
export type OnlineMatchCategory = 'human_only' | 'with_bots';

/** One seat as it existed at START_GAME. `userId` is null for bots/guests. */
export interface OnlineMatchSeat {
  seat: number;
  type: 'human' | 'ai';
  userId: string | null;
}

/** A permanent (irreversible) departure from a seat during the active match. */
export interface OnlineMatchForfeit {
  seat: number;
  /** Epoch ms of the accepted forfeit (server clock). */
  at: number;
}

/** The immutable per-match record kept on the room (server-only, persisted). */
export interface OnlineMatchMeta {
  /** Stable id for THIS match (a fresh uuid per START_GAME). Never sent to clients. */
  matchId: string;
  gameType: GameType;
  roomCode: string;
  category: OnlineMatchCategory;
  playerCount: number;
  /** Epoch ms the match started. */
  startedAt: number;
  /** Seat → starting type/account. Sorted by seat; one entry per seated player. */
  roster: OnlineMatchSeat[];
  /** Seats whose human permanently forfeited. Append-only, at most one per seat. */
  forfeits: OnlineMatchForfeit[];
  /**
   * True once the match + participants are known to exist durably in Postgres
   * (`online_matches` / `online_match_participants`). False/undefined on a
   * DB-disabled deployment, or while the START-time write has not yet been
   * confirmed — in which case an AUTHENTICATED permanent leave must fail closed
   * (retryable) rather than take a seat over without a durable forfeit.
   */
  durable?: boolean;
}

/** Max characters accepted for a persisted id (matches the escrow restore rule). */
const MAX_ID_LEN = 200;
const MAX_SEATS = 6;

/**
 * Build the frozen metadata from the seats as they exist at START_GAME. Pure:
 * the caller supplies the id, the clock and the already-resolved seats, so this
 * is fully deterministic. Seats are sorted and de-duplicated by seat index; a
 * seat with no index is not a player and is ignored by the caller.
 */
export function buildOnlineMatchMeta(input: {
  matchId: string;
  gameType: GameType;
  roomCode: string;
  startedAt: number;
  seats: OnlineMatchSeat[];
}): OnlineMatchMeta {
  const roster = [...input.seats].sort((a, b) => a.seat - b.seat);
  return {
    matchId: input.matchId,
    gameType: input.gameType,
    roomCode: input.roomCode,
    // The ONE place the category is ever decided.
    category: roster.some((s) => s.type === 'ai') ? 'with_bots' : 'human_only',
    playerCount: roster.length,
    startedAt: input.startedAt,
    roster,
    forfeits: [],
  };
}

/** The starting HUMAN seats (bots excluded), in seat order. */
export function startingHumanSeats(meta: OnlineMatchMeta): OnlineMatchSeat[] {
  return meta.roster.filter((s) => s.type === 'human');
}

/** True when this seat's starting human permanently forfeited the match. */
export function isSeatForfeited(meta: OnlineMatchMeta, seat: number): boolean {
  return meta.forfeits.some((f) => f.seat === seat);
}

/**
 * Record a permanent departure for `seat`. IDEMPOTENT: a second call for the
 * same seat leaves the metadata byte-identical (so a duplicate delivery, a
 * retry, or a restore-then-repeat can never double-count a forfeit). Returns
 * true only when this call actually appended the record.
 */
export function markSeatForfeited(meta: OnlineMatchMeta, seat: number, at: number): boolean {
  if (isSeatForfeited(meta, seat)) return false;
  meta.forfeits = [...meta.forfeits, { seat, at }].sort((a, b) => a.seat - b.seat);
  return true;
}

/** The starting seat record for `seat`, or null when that seat never started. */
export function seatOf(meta: OnlineMatchMeta, seat: number): OnlineMatchSeat | null {
  return meta.roster.find((s) => s.seat === seat) ?? null;
}

/**
 * Seat → account for the FINISH attribution (Stage 38.0.5 B6). Built from the
 * IMMUTABLE starting roster, NOT from live membership:
 *  - bots (starting or replacement) are absent → never attributed;
 *  - a FORFEITED seat is absent → the leaver already owns exactly one durable
 *    technical loss and must never receive a second result for this match;
 *  - `liveUserId` fills in a starting human whose account resolved only AFTER
 *    the match started (a late session resolution / a cross-device reclaim).
 */
export function finishSeatUsers(
  meta: OnlineMatchMeta,
  liveUserId: (seat: number) => string | null | undefined = () => null,
): Map<number, string> {
  const out = new Map<number, string>();
  for (const s of meta.roster) {
    if (s.type !== 'human') continue;
    if (isSeatForfeited(meta, s.seat)) continue;
    const uid = s.userId ?? liveUserId(s.seat) ?? null;
    if (uid) out.set(s.seat, uid);
  }
  return out;
}

/**
 * The FROZEN stats policy for a finished online match (Stage 38.0.5 B6). It
 * replaces the old blanket "the room currently contains a bot → skip the whole
 * match", which after an AI takeover would silently erase a legitimate
 * human-only result.
 *
 *  - `with_bots` stays `with_bots` forever → never rated (the owner's
 *    no-bot-farming rule, unchanged);
 *  - `human_only` stays `human_only` forever → rated, using the starting roster
 *    minus the forfeited seats.
 */
export function ratedByFrozenCategory(meta: OnlineMatchMeta): boolean {
  if (meta.category !== 'human_only') return false;
  return startingHumanSeats(meta).length >= 2;
}

/** Strict JSON restore of the persisted metadata; anything malformed → null. */
export function deserializeOnlineMatch(v: unknown): OnlineMatchMeta | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.matchId !== 'string' || !o.matchId || o.matchId.length > MAX_ID_LEN) return null;
  if (!isGameType(o.gameType)) return null;
  if (typeof o.roomCode !== 'string' || !o.roomCode || o.roomCode.length > MAX_ID_LEN) return null;
  if (o.category !== 'human_only' && o.category !== 'with_bots') return null;
  if (typeof o.startedAt !== 'number' || !Number.isFinite(o.startedAt) || o.startedAt < 0) return null;
  if (!Array.isArray(o.roster) || o.roster.length < 2 || o.roster.length > MAX_SEATS) return null;

  const roster: OnlineMatchSeat[] = [];
  const seen = new Set<number>();
  for (const raw of o.roster) {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw as Record<string, unknown>;
    if (typeof s.seat !== 'number' || !Number.isSafeInteger(s.seat) || s.seat < 0 || s.seat >= MAX_SEATS) return null;
    if (s.type !== 'human' && s.type !== 'ai') return null;
    if (seen.has(s.seat)) return null;
    seen.add(s.seat);
    const userId = typeof s.userId === 'string' && s.userId && s.userId.length <= MAX_ID_LEN ? s.userId : null;
    // A bot NEVER carries an account — a save claiming otherwise is malformed.
    if (s.type === 'ai' && userId) return null;
    roster.push({ seat: s.seat, type: s.type, userId });
  }
  roster.sort((a, b) => a.seat - b.seat);

  // The category is NOT recomputed on restore — it must match what was frozen.
  const expected: OnlineMatchCategory = roster.some((s) => s.type === 'ai') ? 'with_bots' : 'human_only';
  if (o.category !== expected) return null;

  const playerCount = typeof o.playerCount === 'number' ? o.playerCount : roster.length;
  if (playerCount !== roster.length) return null;

  const forfeits: OnlineMatchForfeit[] = [];
  const forfeited = new Set<number>();
  if (o.forfeits !== undefined) {
    if (!Array.isArray(o.forfeits)) return null;
    for (const raw of o.forfeits) {
      if (!raw || typeof raw !== 'object') return null;
      const f = raw as Record<string, unknown>;
      if (typeof f.seat !== 'number' || !Number.isSafeInteger(f.seat)) return null;
      if (typeof f.at !== 'number' || !Number.isFinite(f.at) || f.at < 0) return null;
      if (forfeited.has(f.seat)) return null;              // at most one per seat
      const seat = roster.find((s) => s.seat === f.seat);
      if (!seat || seat.type !== 'human') return null;      // only a starting human forfeits
      forfeited.add(f.seat);
      forfeits.push({ seat: f.seat, at: f.at });
    }
    forfeits.sort((a, b) => a.seat - b.seat);
  }

  return {
    matchId: o.matchId,
    gameType: o.gameType,
    roomCode: o.roomCode,
    category: o.category,
    playerCount,
    startedAt: o.startedAt,
    roster,
    forfeits,
    durable: o.durable === true ? true : undefined,
  };
}

/** JSON-safe copy for persistence (a deep clone — no shared arrays). */
export function serializeOnlineMatch(meta: OnlineMatchMeta): OnlineMatchMeta {
  return {
    matchId: meta.matchId,
    gameType: meta.gameType,
    roomCode: meta.roomCode,
    category: meta.category,
    playerCount: meta.playerCount,
    startedAt: meta.startedAt,
    roster: meta.roster.map((s) => ({ ...s })),
    forfeits: meta.forfeits.map((f) => ({ ...f })),
    durable: meta.durable === true ? true : undefined,
  };
}
