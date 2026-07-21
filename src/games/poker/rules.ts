// ---------------------------------------------------------------------------
// Poker — pure predicates and single-source helpers shared by the reducer, AI,
// redaction, and invariants. No state mutation, no I/O. The reducer and the UI
// both derive legality from `legalActions` here, so the rules live in one place.
// See POKER_RULES.md §2/§5/§6.
// ---------------------------------------------------------------------------

import type { PokerAction, PokerOptions, PokerState } from './types';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

/**
 * Runtime guard for a client-supplied wager amount (§5). WebSocket JSON is untrusted
 * input, so `amount` may be a string / object / null / NaN / Infinity / fraction /
 * negative / unsafe integer despite the TS type. A legal wager is a positive, finite,
 * SAFE integer (no fractional chips). The reducer AND the server boundary both call
 * this so a malformed payload can never enter authoritative chip math.
 */
export function isValidWagerAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isFinite(amount)
    && Number.isSafeInteger(amount) && amount > 0;
}

/**
 * Lifecycle actions that a CLIENT `ACTION_REQUEST` must never trigger — they belong to
 * game creation / the server (or local) public-screen advance, not to a seated player
 * mid-hand. The server boundary rejects these before the reducer runs.
 */
export function isPokerLifecycleAction(action: { type: string }): boolean {
  return action.type === 'START_GAME' || action.type === 'START_NEXT_HAND';
}

/** A finite, safe integer (no NaN / Infinity / fraction / string). */
function isFiniteSafeInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && Number.isSafeInteger(v);
}

/** Optional START_GAME options must be a plain object with finite numeric fields. */
function isValidStartOptions(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const k of ['startingStack', 'smallBlind', 'bigBlind']) {
    if (o[k] !== undefined && !(typeof o[k] === 'number' && Number.isFinite(o[k] as number))) return false;
  }
  return true;
}

/**
 * Narrow an UNTRUSTED value to a well-formed PokerAction the reducer will accept
 * without throwing (WebSocket JSON is arbitrary). Rejects null / strings / arrays /
 * empty objects / unknown types / malformed BET-RAISE amounts. START_GAME is
 * validated structurally (playerNames array, optional playerTypes array, optional
 * playerCount/buttonSeat finite safe integers, optional options object) so the pure
 * reducer never dereferences a missing field — even though the client boundary
 * additionally blocks lifecycle actions.
 */
export function isPokerAction(value: unknown): value is PokerAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as { type?: unknown; amount?: unknown };
  switch (a.type) {
    case 'FOLD': case 'CHECK': case 'CALL': case 'ALL_IN': case 'START_NEXT_HAND':
      return true;
    case 'BET': case 'RAISE':
      return isValidWagerAmount(a.amount);
    case 'START_GAME': {
      const b = value as { playerNames?: unknown; playerTypes?: unknown; playerCount?: unknown; buttonSeat?: unknown; options?: unknown };
      if (!Array.isArray(b.playerNames)) return false;
      if (b.playerTypes !== undefined && !Array.isArray(b.playerTypes)) return false;
      if (b.playerCount !== undefined && !isFiniteSafeInt(b.playerCount)) return false;
      if (b.buttonSeat !== undefined && !isFiniteSafeInt(b.buttonSeat)) return false;
      if (b.options !== undefined && !isValidStartOptions(b.options)) return false;
      return true;
    }
    default:
      return false;
  }
}

/** Fixed MVP configuration (§1). */
export const DEFAULT_OPTIONS: PokerOptions = { startingStack: 1000, smallBlind: 10, bigBlind: 20 };

/** Clamp/validate a requested player count into the legal 2–6 range. */
export function normalizePlayerCount(n: number | undefined, fallback: number): number {
  const base = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : fallback;
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, base));
}

/** Merge partial options over the fixed defaults (keeps positive, finite values). */
export function normalizeOptions(opts: Partial<PokerOptions> | undefined): PokerOptions {
  const pick = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : d);
  return {
    startingStack: pick(opts?.startingStack, DEFAULT_OPTIONS.startingStack),
    smallBlind: pick(opts?.smallBlind, DEFAULT_OPTIONS.smallBlind),
    bigBlind: pick(opts?.bigBlind, DEFAULT_OPTIONS.bigBlind),
  };
}

/** Seats still in the match (chips remaining / not eliminated), ascending. */
export function activeSeats(state: PokerState): number[] {
  const seats: number[] = [];
  for (let s = 0; s < state.playerCount; s++) if (!state.eliminatedBySeat[s]) seats.push(s);
  return seats;
}

/** Seats still contesting the current hand (not folded, not eliminated). */
export function inHandSeats(state: PokerState): number[] {
  return activeSeats(state).filter((s) => !state.foldedBySeat[s]);
}

/** Seats that can still take a betting action (in the hand and not all-in). */
export function actableSeats(state: PokerState): number[] {
  return inHandSeats(state).filter((s) => !state.allInBySeat[s]);
}

/** The next active (non-eliminated) seat `steps` clockwise from `seat`. */
export function nextActiveSeat(state: PokerState, seat: number, steps = 1): number {
  const n = state.playerCount;
  let found = seat;
  let remaining = steps;
  for (let i = 1; i <= n && remaining > 0; i++) {
    const cand = (seat + i) % n;
    if (!state.eliminatedBySeat[cand]) {
      found = cand;
      remaining--;
    }
  }
  return found;
}

/** The small-blind seat for the current button (§2, heads-up aware). */
export function smallBlindSeat(state: PokerState): number {
  const active = activeSeats(state);
  if (active.length === 2) return state.buttonSeat; // heads-up: button posts SB
  return nextActiveSeat(state, state.buttonSeat, 1);
}

/** The big-blind seat for the current button (§2, heads-up aware). */
export function bigBlindSeat(state: PokerState): number {
  const active = activeSeats(state);
  if (active.length === 2) return nextActiveSeat(state, state.buttonSeat, 1); // the non-button
  return nextActiveSeat(state, state.buttonSeat, 2);
}

/** First seat to act pre-flop (§2). Heads-up: the button (SB). Else: left of BB. */
export function firstToActPreflop(state: PokerState): number {
  const active = activeSeats(state);
  if (active.length === 2) return state.buttonSeat;
  return nextActiveSeat(state, bigBlindSeat(state), 1);
}

/** First seat to act on any post-flop street (§2): first active seat left of button. */
export function firstToActPostflop(state: PokerState): number {
  return nextActiveSeat(state, state.buttonSeat, 1);
}

/** Whether the match is over (a single player holds all chips). */
export function isPokerFinished(state: PokerState): boolean {
  return state.phase === 'game_finished';
}

/** The seat that must act now, or null on a public / between-hands screen. */
export function getActingPokerSeat(state: PokerState): number | null {
  return state.phase === 'betting' ? state.toActSeat : null;
}

/** The player id that must act now, or null. */
export function getActingPokerPlayerId(state: PokerState): string | null {
  const seat = getActingPokerSeat(state);
  return seat == null ? null : state.players[seat].id;
}

// --- Legal actions (single source for reducer validation, UI and bots) -------

export interface LegalActions {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  /** Chips required to call (0 when checking is available). */
  callAmount: number;
  /** A fresh bet is allowed (no outstanding bet on this street). */
  canBet: boolean;
  /** Total-to (committed target) for a minimum bet. */
  minBet: number;
  /** A raise is allowed (there is an outstanding bet). */
  canRaise: boolean;
  /** Total-to for a minimum legal raise. */
  minRaiseTo: number;
  /** Total-to for going all-in (this seat's committed + remaining stack). */
  maxTo: number;
  canAllIn: boolean;
}

/**
 * The legal actions for `seat` in the current betting state. The reducer, the UI
 * bet controls and the bot all consume this so nobody re-derives the rules.
 */
export function legalActions(state: PokerState, seat: number): LegalActions {
  const committed = state.committedBySeat[seat];
  const stack = state.stacksBySeat[seat];
  const toCall = Math.max(0, state.currentBet - committed);
  const maxTo = committed + stack;

  const canAct = state.phase === 'betting' && state.toActSeat === seat
    && !state.foldedBySeat[seat] && !state.allInBySeat[seat] && stack > 0;

  const canCheck = canAct && toCall === 0;
  const canCall = canAct && toCall > 0;
  const callAmount = Math.min(toCall, stack);

  // A "bet" needs no outstanding wager; a "raise" faces one.
  const canBet = canAct && state.currentBet === 0;
  const minBet = Math.min(committed + state.options.bigBlind, maxTo);
  // Raise faces a bet, needs more chips than a pure call, AND the seat must still
  // hold its raise RIGHT — an incomplete (below-min) all-in does not re-open it for a
  // seat that already acted, so they may only call the extra or fold (§5/§6).
  const raiseOpen = state.raiseOpenBySeat?.[seat] !== false; // legacy states (no field) → open
  const canRaise = canAct && state.currentBet > 0 && stack > toCall && raiseOpen;
  const minRaiseTo = Math.min(state.currentBet + state.minRaise, maxTo);

  // An all-in that would RAISE the current bet must also respect the raise right — a
  // seat whose right is closed (after an incomplete all-in) cannot re-raise by shoving.
  // An all-in that only CALLS (≤ current bet) is always allowed (§5/§6).
  const allInWouldRaise = maxTo > state.currentBet;
  const canAllIn = canAct && stack > 0 && (!allInWouldRaise || raiseOpen);

  return {
    seat,
    canFold: canAct,
    canCheck,
    canCall,
    callAmount,
    canBet,
    minBet,
    canRaise,
    minRaiseTo,
    maxTo,
    canAllIn,
  };
}
