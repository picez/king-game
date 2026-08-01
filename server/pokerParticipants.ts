// ---------------------------------------------------------------------------
// SHARED strict participant/identity validation for a PAID bankroll poker match (Stage 37.7.11
// FAIL 2). ONE validator — used by BOTH `validatePayoutConservation` (before any wallet mutation)
// and `recordConfirmedPokerStats` (before any durable stats row), so the payout path and the stats
// path can never disagree about who played a paid match.
//
// Before this, `payoutStacks` short-circuited a `settled` escrow to `already_paid` WITHOUT any
// structural check, and the stats recorder only checked "escrow exists / ≥2 seats / matchId /
// non-empty userIds". A restored-but-malformed settled escrow could therefore reach the recorder,
// collapse duplicate seats in a Map, and write a partial/incorrect attribution — then clear the
// owed-stats flag as if resolved.
//
// This validator is PURE and fails CLOSED: any structural incoherence between the immutable escrow
// (matchId + seat → authenticated userId + amount) and the finished PokerState (player seats, seat
// types, stacks, winner) is a PERMANENT operator condition, not a retryable transient error.
// ---------------------------------------------------------------------------

import type { PokerEscrow, ServerRoom } from '../src/net/serverCore';
import type { PokerState } from '../src/games/poker/types';

/**
 * PURE shape test for "this room is a bankroll (paid) poker table" — the same rule as
 * `isBankrollRoom` in server/pokerEscrow.ts, without that module's DB-client import, so the
 * pure recovery/finish helpers stay dependency-free (and unit-testable with no Postgres).
 */
export function isBankrollRoomShape(room: ServerRoom): boolean {
  return room.gameType === 'poker' && typeof room.pokerBuyIn === 'number' && room.pokerBuyIn > 0;
}

/** The immutable participant snapshot of a paid match, once validated. */
export interface PaidParticipants {
  /** The stable economy match id (stats identity; never exposed publicly — only its hash). */
  matchId: string;
  /** seat → authenticated userId, exactly one entry per player seat. */
  seatUsers: Map<number, string>;
  /** Player seat count (== escrow seats == state player seats). */
  seatCount: number;
}

export type ParticipantCheck =
  | { ok: true; participants: PaidParticipants }
  | { ok: false; error: string };

/** Hard cap on seats for any poker room (shared room cap `MAX_PLAYERS`). */
const MAX_SEATS = 6;

/**
 * Validate the escrow ↔ finished-state participant identity of a bankroll match.
 *
 * Escrow side: a non-empty `matchId`; a safe-integer `buyIn > 0`; 2…6 seats; every seat a safe
 * integer in range; every `amount === buyIn`; no duplicate seat; no duplicate userId; every
 * userId a non-empty string.
 *
 * State side: `players` present and consistent with `playerCount` and `stacksBySeat`; NO `ai`
 * seat (a bankroll table is authenticated-humans-only); a `winnerSeat`, when present, inside the
 * participant set.
 *
 * Correspondence: the escrow seat set must EXACTLY equal the state's player seat set — no extra,
 * missing, or shifted seat. Pure; never throws.
 */
export function validatePaidMatchParticipants(esc: PokerEscrow | undefined, state: PokerState | null | undefined): ParticipantCheck {
  if (!esc || typeof esc !== 'object') return { ok: false, error: 'no escrow' };
  if (typeof esc.matchId !== 'string' || !esc.matchId) return { ok: false, error: 'bad matchId' };
  if (!Number.isSafeInteger(esc.buyIn) || esc.buyIn <= 0) return { ok: false, error: 'bad buyIn' };
  if (!Array.isArray(esc.seats) || esc.seats.length < 2 || esc.seats.length > MAX_SEATS) return { ok: false, error: 'bad seat count' };
  if (!state || typeof state !== 'object') return { ok: false, error: 'no state' };

  const players = Array.isArray(state.players) ? state.players : null;
  if (!players || players.length < 2 || players.length > MAX_SEATS) return { ok: false, error: 'bad player count' };
  const stacks = Array.isArray(state.stacksBySeat) ? state.stacksBySeat : null;
  if (!stacks) return { ok: false, error: 'no stacks' };
  // `playerCount` is authoritative when present and must agree with the actual player list.
  const playerCount = typeof state.playerCount === 'number' ? state.playerCount : players.length;
  if (!Number.isSafeInteger(playerCount) || playerCount !== players.length) return { ok: false, error: 'playerCount != players' };
  if (stacks.length < playerCount) return { ok: false, error: 'stacks != playerCount' };

  // State player seats: safe, in range, unique, human-only (a bankroll table never seats a bot).
  const stateSeats = new Set<number>();
  for (const p of players) {
    const seat = (p as { seatIndex?: unknown }).seatIndex;
    if (!Number.isSafeInteger(seat as number) || (seat as number) < 0 || (seat as number) >= stacks.length) return { ok: false, error: 'player seat out of range' };
    if (stateSeats.has(seat as number)) return { ok: false, error: 'duplicate player seat' };
    stateSeats.add(seat as number);
    if ((p as { type?: unknown }).type === 'ai') return { ok: false, error: 'bot seat in a bankroll match' };
  }
  if (stateSeats.size !== playerCount) return { ok: false, error: 'player seats != playerCount' };

  // Escrow seats: safe, in range, unique, one account each, exact buy-in.
  const seatUsers = new Map<number, string>();
  const users = new Set<string>();
  for (const s of esc.seats) {
    if (!s || typeof s !== 'object') return { ok: false, error: 'bad seat entry' };
    if (!Number.isSafeInteger(s.seat) || s.seat < 0 || s.seat >= stacks.length || s.seat >= playerCount) return { ok: false, error: 'seat out of range' };
    if (seatUsers.has(s.seat)) return { ok: false, error: 'duplicate seat' };
    if (typeof s.userId !== 'string' || !s.userId) return { ok: false, error: 'bad userId' };
    if (users.has(s.userId)) return { ok: false, error: 'duplicate user' };
    if (!Number.isSafeInteger(s.amount) || s.amount <= 0 || s.amount !== esc.buyIn) return { ok: false, error: 'bad seat amount' };
    users.add(s.userId);
    seatUsers.set(s.seat, s.userId);
  }
  // EXACT correspondence — every paid seat played, every player seat was paid.
  if (seatUsers.size !== stateSeats.size) return { ok: false, error: 'escrow seats != player seats' };
  for (const seat of stateSeats) if (!seatUsers.has(seat)) return { ok: false, error: 'escrow seats != player seats' };

  // A declared winner must be one of the participants.
  const winner = (state as { winnerSeat?: unknown }).winnerSeat;
  if (winner != null && !seatUsers.has(winner as number)) return { ok: false, error: 'winner not a participant' };

  return { ok: true, participants: { matchId: esc.matchId, seatUsers, seatCount: seatUsers.size } };
}
