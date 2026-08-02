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
  // (37.7.12 FAIL 2) EXACT length — a longer stack array meant an extra, unaccounted seat could sit
  // outside the escrow while every per-seat check still passed.
  if (stacks.length !== playerCount) return { ok: false, error: 'stacks != playerCount' };

  // State player seats: safe, in range, unique, human-only (a bankroll table never seats a bot),
  // with unique non-empty player ids (37.7.12 FAIL 2 — duplicates collapse per-player attribution).
  const stateSeats = new Set<number>();
  const playerIds = new Set<string>();
  for (const p of players) {
    const seat = (p as { seatIndex?: unknown }).seatIndex;
    if (!Number.isSafeInteger(seat as number) || (seat as number) < 0 || (seat as number) >= stacks.length) return { ok: false, error: 'player seat out of range' };
    if (stateSeats.has(seat as number)) return { ok: false, error: 'duplicate player seat' };
    stateSeats.add(seat as number);
    // (37.7.12 FAIL 2) POSITIVE check: only an explicit `human` seat is allowed. The old `!== 'ai'`
    // test let `undefined` / `'bot'` / any unknown value through as if it were a human.
    if ((p as { type?: unknown }).type !== 'human') return { ok: false, error: 'non-human seat in a bankroll match' };
    const id = (p as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) return { ok: false, error: 'bad player id' };
    if (playerIds.has(id)) return { ok: false, error: 'duplicate player id' };
    playerIds.add(id);
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

/**
 * (37.7.12 FAIL 2) The STRICTER layer: everything `validatePaidMatchParticipants` checks PLUS the
 * invariants that only a FINISHED paid match can satisfy. Used by every economy finish path (payout
 * + stats); the participant layer above stays usable for state-agnostic identity checks.
 *
 * A valid finished paid match has:
 *   • `phase === 'game_finished'` — a mid-hand state is never payable/recordable;
 *   • exactly one `winnerSeat`, a participant (never null/undefined);
 *   • the winner holding the WHOLE conserved escrow (Σ buy-ins) and every other seat exactly 0
 *     (POKER_RULES §11: the match ends when a single player holds all the chips).
 */
/**
 * The chips a paid match is FUNDED with (§17): every initial buy-in PLUS one buy-in per
 * rebuy the authoritative state applied. PURE. `state.appliedRebuys` is public gameplay
 * evidence; the DURABLE ledger must agree, which the settlement guard
 * (`validateRebuyContributions`) and the recovery pipeline enforce independently — a state
 * claiming a rebuy the ledger does not have is frozen, never paid.
 */
export function fundedTotalOf(esc: PokerEscrow, state: PokerState | null | undefined): number {
  const initial = esc.seats.reduce((sum, seat) => sum + seat.amount, 0);
  const rebuys = (state as PokerState | undefined)?.appliedRebuys?.length ?? 0;
  return initial + rebuys * esc.buyIn;
}

export function validateFinishedPaidMatch(esc: PokerEscrow | undefined, state: PokerState | null | undefined): ParticipantCheck {
  const identity = validatePaidMatchParticipants(esc, state);
  if (!identity.ok) return identity;
  const s = state as PokerState;
  if ((s as { phase?: unknown }).phase !== 'game_finished') return { ok: false, error: 'state not finished' };

  const winner = (s as { winnerSeat?: unknown }).winnerSeat;
  if (typeof winner !== 'number' || !Number.isSafeInteger(winner) || !identity.participants.seatUsers.has(winner)) {
    return { ok: false, error: 'no single winner' };
  }

  const stacks = s.stacksBySeat;
  let escrowTotal = 0;
  for (const seat of esc!.seats) {
    escrowTotal += seat.amount;
    if (escrowTotal > Number.MAX_SAFE_INTEGER) return { ok: false, error: 'overflow' };
  }
  // §17 — every applied rebuy added exactly one buy-in of real chips to the table, so the
  // winner holds the FUNDED total, not just the initial escrow.
  const applied = s.appliedRebuys ?? [];
  for (const r of applied) {
    if (!Number.isSafeInteger(r?.seat) || !identity.participants.seatUsers.has(r.seat)) {
      return { ok: false, error: 'rebuy for a non-participant seat' };
    }
    if (!Number.isSafeInteger(r?.handNumber) || r.handNumber < 1) return { ok: false, error: 'invalid rebuy hand' };
  }
  const fundedTotal = fundedTotalOf(esc!, s);
  if (!Number.isSafeInteger(fundedTotal) || fundedTotal < escrowTotal) return { ok: false, error: 'overflow' };
  for (const [seat] of identity.participants.seatUsers) {
    const stack = stacks[seat];
    if (typeof stack !== 'number' || !Number.isSafeInteger(stack) || stack < 0) return { ok: false, error: 'invalid final stack' };
    if (seat === winner) {
      if (stack !== fundedTotal) return { ok: false, error: 'winner stack != funded total' };
    } else if (stack !== 0) {
      return { ok: false, error: 'loser stack not zero' };
    }
  }
  return identity;
}
