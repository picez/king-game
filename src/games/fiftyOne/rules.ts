// ---------------------------------------------------------------------------
// 51 — pure predicates and helpers shared by the reducer, AI, redaction, and
// invariants. No state mutation, no I/O. See 51_RULES.md.
// ---------------------------------------------------------------------------

import type { FiftyOneCard, FiftyOneState } from './types';
import { rankValue } from './melds';

/** MVP opening threshold (§7). */
export const OPENING_MINIMUM = 51;
/**
 * Host-selectable elimination thresholds (§12, Stage 30.15). A seat is out once
 * its running penalty reaches the chosen score; 510 is the default and the only
 * value legacy rooms/states ever used, so behaviour is unchanged unless the host
 * lowers it. Ordered low→high for the setup selectors.
 */
export const ELIMINATION_SCORE_PRESETS = [210, 310, 410, 510] as const;
/** MVP / default elimination threshold (§12). */
export const DEFAULT_TARGET_PENALTY = 510;
/** MVP flat penalty for a loser who never opened (§11). */
export const NEVER_OPENED_PENALTY = 100;
/** Joker penalty when left in hand at round end (§11). */
export const JOKER_HAND_PENALTY = 25;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Two cards are the same physical card iff they share the unique deck id. */
export function cardEquals(a: FiftyOneCard, b: FiftyOneCard): boolean {
  return a.id === b.id;
}

/** Clamp/validate a requested player count into the legal 2–4 range. */
export function normalizePlayerCount(n: number | undefined, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return clampPlayers(fallback);
  return clampPlayers(Math.floor(n));
}

function clampPlayers(n: number): number {
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n));
}

/**
 * Normalise a host-selected elimination score to one of the allowed presets
 * (§12, Stage 30.15). Anything missing / invalid / legacy / off-preset → the
 * default 510, so old rooms and states are unchanged and no bad value can reach
 * the reducer or the scoring threshold.
 */
export function normalizeEliminationScore(n: number | undefined): number {
  return (ELIMINATION_SCORE_PRESETS as readonly number[]).includes(n as number)
    ? (n as number)
    : DEFAULT_TARGET_PENALTY;
}

/** @deprecated Back-compat alias — use {@link normalizeEliminationScore}. */
export const normalizeTargetPenalty = normalizeEliminationScore;

/** Seats still in the match (not eliminated), ascending. */
export function activeSeats(state: FiftyOneState): number[] {
  const seats: number[] = [];
  for (let s = 0; s < state.playerCount; s++) {
    if (!state.eliminatedSeats[s]) seats.push(s);
  }
  return seats;
}

/**
 * The next seat clockwise from `seat`, skipping eliminated seats (§13). With no
 * other active seat it returns `seat` itself (a degenerate 1-player situation
 * the reducer treats as game over).
 */
export function nextActiveSeat(state: FiftyOneState, seat: number): number {
  const n = state.playerCount;
  for (let step = 1; step <= n; step++) {
    const cand = (seat + step) % n;
    if (!state.eliminatedSeats[cand]) return cand;
  }
  return seat;
}

/** The top (takeable) discard card, or null if the pile is empty. */
export function topDiscard(state: FiftyOneState): FiftyOneCard | null {
  return state.discardPile.length > 0 ? state.discardPile[state.discardPile.length - 1] : null;
}

/**
 * The end-of-round hand penalty for a losing seat (§10, §11):
 *  - a seat that NEVER opened this round scores a flat 100 (owner override);
 *  - otherwise it counts its hand: normal cards by §10 value, each held joker 25.
 */
export function handPenalty(hand: FiftyOneCard[], opened: boolean): number {
  if (!opened) return NEVER_OPENED_PENALTY;
  let sum = 0;
  for (const c of hand) sum += c.joker ? JOKER_HAND_PENALTY : rankValue(c.rank as NonNullable<FiftyOneCard['rank']>);
  return sum;
}

/** Whether the match is over (winner decided). */
export function isFiftyOneFinished(state: FiftyOneState): boolean {
  return state.phase === 'game_finished';
}

/**
 * The seat that must act now, or null when the match is over / awaiting an
 * explicit round advance. Mirrors the other games' `getActing…Seat` helpers.
 */
export function getActingFiftyOneSeat(state: FiftyOneState): number | null {
  if (state.phase === 'playing') return state.currentSeat;
  return null;
}

/** The player id that must act now, or null (mirrors getActingTarneebPlayerId). */
export function getActingFiftyOnePlayerId(state: FiftyOneState): string | null {
  const seat = getActingFiftyOneSeat(state);
  return seat == null ? null : state.players[seat].id;
}
