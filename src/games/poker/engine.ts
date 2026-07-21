// ---------------------------------------------------------------------------
// Poker (No-Limit Texas Hold'em) — pure reducer. Deterministic (shuffle/deal via
// the injected rng), no browser or server APIs, no side effects. Illegal actions
// return the SAME state reference. Mirrors the reducer contract of the other six
// games. See POKER_RULES.md for every rule encoded here.
// ---------------------------------------------------------------------------

import type { Rng } from '../../core/rng';
import type { PlayerType } from '../../models/types';
import { dealPoker } from './deck';
import { evaluateSeat, compareHands, type HandScore } from './handEval';
import { computeSidePots, distributeChips, oddChipOrder } from './pots';
import {
  DEFAULT_OPTIONS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  actableSeats,
  activeSeats,
  bigBlindSeat,
  firstToActPostflop,
  firstToActPreflop,
  inHandSeats,
  isPokerAction,
  isValidWagerAmount,
  legalActions,
  nextActiveSeat,
  normalizeOptions,
  normalizePlayerCount,
  smallBlindSeat,
} from './rules';
import type {
  HandCategory,
  PokerAction,
  PokerActionEntry,
  PokerCard,
  PokerContext,
  PokerHandResult,
  PokerPlayer,
  PokerPotAward,
  PokerState,
  PokerTelemetry,
} from './types';

function clone(state: PokerState): PokerState {
  return JSON.parse(JSON.stringify(state)) as PokerState;
}

function resolveRng(ctx?: PokerContext): Rng {
  return ctx?.rng ?? Math.random;
}

function freshTelemetry(playerCount: number): PokerTelemetry {
  const zeros = () => Array.from({ length: playerCount }, () => 0);
  return {
    handsPlayedBySeat: zeros(),
    handsWonBySeat: zeros(),
    showdownsWonBySeat: zeros(),
    potsWonBySeat: zeros(),
    biggestPotBySeat: zeros(),
    allInsWonBySeat: zeros(),
    royalFlushBySeat: zeros(),
  };
}

// --- START_GAME -------------------------------------------------------------

function startGame(action: Extract<PokerAction, { type: 'START_GAME' }>, rng: Rng): PokerState | null {
  const playerCount = normalizePlayerCount(action.playerCount, action.playerNames.length);
  if (action.playerNames.length !== playerCount) return null;
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) return null;

  const options = normalizeOptions(action.options ?? DEFAULT_OPTIONS);
  const players: PokerPlayer[] = action.playerNames.map((name, seat) => ({
    id: `player-${seat}`,
    name,
    seatIndex: seat,
    type: (action.playerTypes?.[seat] ?? 'human') as PlayerType,
  }));

  const buttonSeat = normalizeSeat(action.buttonSeat, playerCount, 0);
  const zeros = () => Array.from({ length: playerCount }, () => 0);
  const falses = () => Array.from({ length: playerCount }, () => false);

  const base: PokerState = {
    gameType: 'poker',
    phase: 'betting',
    playerCount,
    players,
    options,
    buttonSeat,
    handNumber: 0,
    street: 'preflop',
    stacksBySeat: Array.from({ length: playerCount }, () => options.startingStack),
    holeCardsBySeat: Array.from({ length: playerCount }, () => []),
    board: [],
    deck: [],
    burned: [],
    committedBySeat: zeros(),
    contributedBySeat: zeros(),
    foldedBySeat: falses(),
    allInBySeat: falses(),
    wasAllInBySeat: falses(),
    actedBySeat: falses(),
    raiseOpenBySeat: falses(),
    eliminatedBySeat: falses(),
    currentBet: 0,
    minRaise: options.bigBlind,
    toActSeat: buttonSeat,
    revealedBySeat: falses(),
    lastHand: null,
    winnerSeat: null,
    actionLog: [],
    telemetry: freshTelemetry(playerCount),
  };

  dealHand(base, base.buttonSeat, rng);
  return base;
}

function normalizeSeat(seat: number | undefined, playerCount: number, fallback: number): number {
  if (typeof seat !== 'number' || !Number.isFinite(seat)) return fallback;
  const s = Math.floor(seat);
  return s >= 0 && s < playerCount ? s : fallback;
}

// --- Dealing a hand ---------------------------------------------------------

/** Reset per-hand state, deal hole cards, post blinds and open the pre-flop round. */
function dealHand(s: PokerState, buttonSeat: number, rng: Rng): void {
  s.buttonSeat = buttonSeat;
  s.handNumber += 1;
  s.street = 'preflop';
  s.phase = 'betting';
  s.board = [];
  s.burned = [];
  s.committedBySeat = s.committedBySeat.map(() => 0);
  s.contributedBySeat = s.contributedBySeat.map(() => 0);
  s.foldedBySeat = s.foldedBySeat.map(() => false);
  s.allInBySeat = s.allInBySeat.map(() => false);
  s.wasAllInBySeat = s.wasAllInBySeat.map(() => false);
  s.actedBySeat = s.actedBySeat.map(() => false);
  s.revealedBySeat = s.revealedBySeat.map(() => false);
  s.currentBet = 0;
  s.minRaise = s.options.bigBlind;
  s.lastHand = null;
  s.actionLog = [];

  const seats = activeSeats(s);
  const sb = smallBlindSeat(s);
  const deal = dealPoker(s.playerCount, seats, sb, rng);
  s.holeCardsBySeat = deal.holeCardsBySeat;
  s.deck = deal.deck;

  for (const seat of seats) s.telemetry.handsPlayedBySeat[seat] += 1;

  // Post the blinds (forced — they do NOT count as "acted", so the BB keeps its
  // option to act when the round returns to it). Logged as public 'blind' entries.
  const sbPaid = Math.min(s.options.smallBlind, s.stacksBySeat[sb]);
  commit(s, sb, sbPaid);
  logAction(s, sb, 'blind', sbPaid);
  const bb = bigBlindSeat(s);
  const bbPaid = Math.min(s.options.bigBlind, s.stacksBySeat[bb]);
  commit(s, bb, bbPaid);
  logAction(s, bb, 'blind', bbPaid);
  // The nominal pre-flop bring-in is the FULL big blind even if the BB posted a
  // short all-in for less (§ short-BB): others must still complete to the big blind,
  // while side pots cap the short BB to its actual contribution (§8).
  s.currentBet = s.options.bigBlind;
  s.minRaise = s.options.bigBlind;
  openRaiseRights(s);
  s.toActSeat = firstToActPreflop(s);

  // Degenerate: if fewer than 2 seats can act (blinds put someone all-in), the
  // hand may already be a runout / showdown.
  settleIfNoActionPossible(s, rng);
}

/** Move `amount` chips stack→committed for `seat` (updates all-in flags + currentBet). */
function commit(s: PokerState, seat: number, amount: number): void {
  const pay = Math.max(0, Math.min(amount, s.stacksBySeat[seat]));
  s.stacksBySeat[seat] -= pay;
  s.committedBySeat[seat] += pay;
  s.contributedBySeat[seat] += pay;
  if (s.stacksBySeat[seat] === 0 && (s.committedBySeat[seat] > 0 || pay > 0)) {
    s.allInBySeat[seat] = true;
    s.wasAllInBySeat[seat] = true;
  }
  if (s.committedBySeat[seat] > s.currentBet) s.currentBet = s.committedBySeat[seat];
}

/** Open the raise right for every seat at the start of a betting round (§5/§6). */
function openRaiseRights(s: PokerState): void {
  s.raiseOpenBySeat = Array.from({ length: s.playerCount }, () => true);
}

/** Append one public entry to the current hand's action history (no card data). */
function logAction(s: PokerState, seat: number, kind: PokerActionEntry['kind'], amount: number): void {
  s.actionLog.push({ seat, street: s.street, kind, amount });
}

// --- Betting actions --------------------------------------------------------

function applyBettingAction(s: PokerState, action: PokerAction, rng: Rng): boolean {
  // Backward-safe: a state persisted by an older build (mid-hand reconnect) may lack
  // the newer public betting fields — normalise before any mutation. Missing raise
  // rights default to OPEN (the permissive, never-illegally-restrictive choice).
  if (!Array.isArray(s.actionLog)) s.actionLog = [];
  if (!Array.isArray(s.raiseOpenBySeat) || s.raiseOpenBySeat.length !== s.playerCount) {
    s.raiseOpenBySeat = Array.from({ length: s.playerCount }, () => true);
  }
  const seat = s.toActSeat;
  const la = legalActions(s, seat);
  if (!la.canFold && !la.canCheck && !la.canCall) return false; // seat cannot act
  const before = s.committedBySeat[seat];

  switch (action.type) {
    case 'FOLD':
      if (!la.canFold) return false;
      s.foldedBySeat[seat] = true;
      s.actedBySeat[seat] = true;
      logAction(s, seat, 'fold', 0);
      break;
    case 'CHECK':
      if (!la.canCheck) return false;
      s.actedBySeat[seat] = true;
      logAction(s, seat, 'check', 0);
      break;
    case 'CALL': {
      if (!la.canCall) return false;
      commit(s, seat, la.callAmount);
      s.actedBySeat[seat] = true;
      logAction(s, seat, 'call', s.committedBySeat[seat] - before);
      break;
    }
    case 'BET': {
      if (!la.canBet) return false;
      // Untrusted runtime input: reject a non-positive / non-finite / non-safe-integer
      // / fractional amount before it can enter chip math (§5).
      if (!isValidWagerAmount(action.amount)) return false;
      const target = action.amount;
      const allInTo = la.maxTo;
      const isAllIn = target >= allInTo;
      if (!isAllIn && (target < la.minBet || target > allInTo)) return false;
      applyRaiseTo(s, seat, Math.min(target, allInTo));
      logAction(s, seat, 'bet', s.committedBySeat[seat] - before);
      break;
    }
    case 'RAISE': {
      if (!la.canRaise) return false;
      if (!isValidWagerAmount(action.amount)) return false;
      const target = action.amount;
      const allInTo = la.maxTo;
      if (target <= s.currentBet) return false;      // a raise must exceed the current bet
      const isAllIn = target >= allInTo;
      if (!isAllIn && (target < la.minRaiseTo || target > allInTo)) return false;
      applyRaiseTo(s, seat, Math.min(target, allInTo));
      logAction(s, seat, 'raise', s.committedBySeat[seat] - before);
      break;
    }
    case 'ALL_IN': {
      if (!la.canAllIn) return false;
      const allInTo = la.maxTo;
      if (allInTo > s.currentBet) applyRaiseTo(s, seat, allInTo); // functions as bet/raise
      else { commit(s, seat, s.stacksBySeat[seat]); s.actedBySeat[seat] = true; } // all-in call for less
      logAction(s, seat, 'allin', s.committedBySeat[seat] - before);
      break;
    }
    default:
      return false;
  }

  afterAction(s, rng);
  return true;
}

/** Apply a bet/raise to a total-of `target`, reopening action only for a FULL raise. */
function applyRaiseTo(s: PokerState, seat: number, target: number): void {
  const prevBet = s.currentBet;
  const increment = target - prevBet;
  const pay = target - s.committedBySeat[seat];
  commit(s, seat, pay);
  const fullRaise = increment >= s.minRaise;
  if (fullRaise) {
    s.minRaise = increment;
    // A full bet/raise RE-OPENS both action and raise rights for everyone else who
    // can act; they must act again and regain the right to re-raise (§6).
    for (const other of actableSeats(s)) {
      if (other !== seat) { s.actedBySeat[other] = false; s.raiseOpenBySeat[other] = true; }
    }
  }
  // An incomplete (below-min) all-in raise does NOT re-open: seats that already acted
  // keep their (closed) raise right and may only call the extra or fold; seats that
  // have not yet acted since the last full raise keep their still-open right (§5/§6).
  // The aggressor cannot re-raise itself until someone re-opens the action.
  s.actedBySeat[seat] = true;
  s.raiseOpenBySeat[seat] = false;
}

/** Advance to the next actor, or close the street when the round is complete. */
function afterAction(s: PokerState, rng: Rng): void {
  // Only one seat left in the hand → immediate win by fold-out (§7).
  if (inHandSeats(s).length <= 1) {
    resolveFoldWin(s);
    return;
  }
  const next = nextToAct(s);
  if (next != null) {
    s.toActSeat = next;
    return;
  }
  closeStreet(s, rng);
}

/** The next seat clockwise that still needs to act, or null when the round closes. */
function nextToAct(s: PokerState): number | null {
  const n = s.playerCount;
  for (let i = 1; i <= n; i++) {
    const seat = (s.toActSeat + i) % n;
    if (needsToAct(s, seat)) return seat;
  }
  return null;
}

function needsToAct(s: PokerState, seat: number): boolean {
  if (s.eliminatedBySeat[seat] || s.foldedBySeat[seat] || s.allInBySeat[seat]) return false;
  if (s.stacksBySeat[seat] <= 0) return false;
  return !s.actedBySeat[seat] || s.committedBySeat[seat] < s.currentBet;
}

/** Close the current betting round: fold the committed chips in and open the next street. */
function closeStreet(s: PokerState, rng: Rng): void {
  // committedBySeat is already folded into contributedBySeat by commit(); reset it.
  s.committedBySeat = s.committedBySeat.map(() => 0);
  s.currentBet = 0;
  s.minRaise = s.options.bigBlind;

  if (inHandSeats(s).length <= 1) { resolveFoldWin(s); return; }

  // No further betting possible (≤1 can act) → run out the board, then showdown.
  if (actableSeats(s).length <= 1) { runOutAndShowdown(s, rng); return; }

  if (s.street === 'river') { resolveShowdown(s); return; }
  dealNextStreet(s, rng);
  s.actedBySeat = s.actedBySeat.map(() => false);
  openRaiseRights(s); // every actable seat regains the right to bet/raise this street
  s.toActSeat = firstActingPostflop(s);
}

/** First seat to act post-flop that can actually act (skips all-in/folded). */
function firstActingPostflop(s: PokerState): number {
  const start = firstToActPostflop(s);
  if (needsToAct(s, start)) return start;
  // find next that needs to act
  const n = s.playerCount;
  for (let i = 1; i <= n; i++) {
    const seat = (start + i) % n;
    if (needsToAct(s, seat)) return seat;
  }
  return start;
}

/** Burn one card and deal this street's community card(s). */
function dealNextStreet(s: PokerState, _rng: Rng): void {
  const draw = (k: number): PokerCard[] => {
    const out = s.deck.slice(0, k);
    s.deck = s.deck.slice(k);
    return out;
  };
  const burn = () => { s.burned.push(...draw(1)); };
  if (s.street === 'preflop') { burn(); s.board.push(...draw(3)); s.street = 'flop'; }
  else if (s.street === 'flop') { burn(); s.board.push(...draw(1)); s.street = 'turn'; }
  else if (s.street === 'turn') { burn(); s.board.push(...draw(1)); s.street = 'river'; }
}

/** Deal every remaining street (no betting) then resolve the showdown. */
function runOutAndShowdown(s: PokerState, rng: Rng): void {
  while (s.street !== 'river' && s.board.length < 5) dealNextStreet(s, rng);
  resolveShowdown(s);
}

/** Nothing more to bet on this street's open (e.g. blinds put everyone all-in). */
function settleIfNoActionPossible(s: PokerState, rng: Rng): void {
  if (s.phase !== 'betting') return;
  if (inHandSeats(s).length <= 1) { resolveFoldWin(s); return; }
  if (actableSeats(s).length === 0) { runOutAndShowdown(s, rng); return; }
  // If exactly one seat can act but it already covers the bet with nothing to
  // call and everyone else is all-in, run it out too.
  if (actableSeats(s).length === 1) {
    const seat = actableSeats(s)[0];
    if (s.committedBySeat[seat] >= s.currentBet) { runOutAndShowdown(s, rng); return; }
  }
  if (!needsToAct(s, s.toActSeat)) {
    const next = nextToAct(s);
    if (next != null) s.toActSeat = next;
  }
}

// --- Resolution -------------------------------------------------------------

/** The lone remaining (non-folded) player wins the pot; no showdown (§7). Uncalled
 *  excess is RETURNED (not a won pot) via the same side-pot layering as a showdown,
 *  so `biggestPot` is never inflated by chips that were never at risk (§8). */
function resolveFoldWin(s: PokerState): void {
  const winner = inHandSeats(s)[0];
  const pots = computeSidePots(s.contributedBySeat, s.foldedBySeat);
  const wonBySeat = Array.from({ length: s.playerCount }, () => 0);
  for (const pot of pots) {
    if (pot.returned) {
      // Uncalled chips return to their sole contributor (usually the winner).
      s.stacksBySeat[pot.winners[0]] += pot.amount;
      continue;
    }
    // Every contested layer is uncontested here (all other contributors folded) → the
    // lone remaining player wins it.
    pot.winners = [winner];
    s.stacksBySeat[winner] += pot.amount;
    wonBySeat[winner] += pot.amount;
  }
  recordHandTelemetry(s, pots, false, []);
  finishHand(s, { showdown: false, revealedSeats: [], categoryBySeat: {}, pots, wonBySeat });
}

/** Showdown: build side pots, evaluate eligible hands, award, reveal (§8/§9/§10). */
function resolveShowdown(s: PokerState): void {
  const pots = computeSidePots(s.contributedBySeat, s.foldedBySeat);
  const order = oddChipOrder(s.playerCount, s.buttonSeat);
  const wonBySeat = Array.from({ length: s.playerCount }, () => 0);

  // Evaluate every seat still in the hand.
  const scores: Record<number, HandScore> = {};
  const revealed = inHandSeats(s);
  for (const seat of revealed) scores[seat] = evaluateSeat(s.holeCardsBySeat[seat], s.board);

  for (const pot of pots) {
    if (pot.returned) { s.stacksBySeat[pot.winners[0]] += pot.amount; wonBySeat[pot.winners[0]] += pot.amount; continue; }
    const contenders = pot.eligibleSeats.filter((seat) => scores[seat] != null);
    let best: HandScore | null = null;
    let winners: number[] = [];
    for (const seat of contenders) {
      const sc = scores[seat];
      if (best === null || compareHands(sc, best) > 0) { best = sc; winners = [seat]; }
      else if (compareHands(sc, best) === 0) winners.push(seat);
    }
    pot.winners = winners;
    const shares = distributeChips(pot.amount, winners, order);
    for (const seat of winners) { s.stacksBySeat[seat] += shares[seat]; wonBySeat[seat] += shares[seat]; }
  }

  const revealedSeats = revealed.slice();
  for (const seat of revealedSeats) s.revealedBySeat[seat] = true;
  const categoryBySeat: Record<number, HandCategory> = {};
  for (const seat of revealedSeats) categoryBySeat[seat] = scores[seat].category;

  recordHandTelemetry(s, pots, true, revealedSeats.map((seat) => ({ seat, score: scores[seat] })));
  finishHand(s, { showdown: true, revealedSeats, categoryBySeat, pots, wonBySeat });
}

/** Fold per-seat telemetry for a completed hand. */
function recordHandTelemetry(
  s: PokerState,
  pots: PokerPotAward[],
  showdown: boolean,
  evaluated: { seat: number; score: HandScore }[],
): void {
  const winnersThisHand = new Set<number>();
  for (const pot of pots) {
    if (pot.returned) continue; // returned = not a won pot
    for (const seat of pot.winners) {
      winnersThisHand.add(seat);
      s.telemetry.potsWonBySeat[seat] += 1;
      if (pot.amount > s.telemetry.biggestPotBySeat[seat]) s.telemetry.biggestPotBySeat[seat] = pot.amount;
    }
  }
  for (const seat of winnersThisHand) {
    s.telemetry.handsWonBySeat[seat] += 1;
    if (showdown) s.telemetry.showdownsWonBySeat[seat] += 1;
    if (s.wasAllInBySeat[seat]) s.telemetry.allInsWonBySeat[seat] += 1;
  }
  for (const { seat, score } of evaluated) {
    if (score.category === 'royal_flush') s.telemetry.royalFlushBySeat[seat] += 1;
  }
}

/** Store the hand result, eliminate busted seats, and end the hand or the match. */
function finishHand(s: PokerState, result: Omit<PokerHandResult, 'handNumber' | 'newlyEliminated'>): void {
  const newlyEliminated: number[] = [];
  for (let seat = 0; seat < s.playerCount; seat++) {
    if (!s.eliminatedBySeat[seat] && s.stacksBySeat[seat] <= 0) {
      s.eliminatedBySeat[seat] = true;
      newlyEliminated.push(seat);
    }
  }
  s.lastHand = { ...result, handNumber: s.handNumber, newlyEliminated };

  const remaining = activeSeats(s);
  if (remaining.length <= 1) {
    s.phase = 'game_finished';
    s.winnerSeat = remaining[0] ?? null;
  } else {
    s.phase = 'hand_complete';
  }
}

// --- Between hands ----------------------------------------------------------

function startNextHand(s: PokerState, rng: Rng): PokerState | null {
  if (s.phase !== 'hand_complete') return null;
  const remaining = activeSeats(s);
  if (remaining.length <= 1) { s.phase = 'game_finished'; s.winnerSeat = remaining[0] ?? null; return s; }
  const nextButton = nextActiveSeat(s, s.buttonSeat, 1);
  dealHand(s, nextButton, rng);
  return s;
}

// --- The reducer ------------------------------------------------------------

export function pokerReducer(
  state: PokerState | null,
  action: PokerAction,
  ctx?: PokerContext,
): PokerState | null {
  const rng = resolveRng(ctx);
  // Defensive against a runtime-invalid direct call (untrusted input): never throw —
  // reject a malformed action by returning the current state reference (or null).
  if (!isPokerAction(action)) return state;
  if (action.type === 'START_GAME') {
    // START_GAME is a lifecycle action that CREATES a match: it is honoured only from
    // the empty (null) state. Never let it replace a live authoritative PokerState —
    // an acting online client must not be able to reset the room via ACTION_REQUEST.
    return state === null ? startGame(action, rng) : state;
  }
  if (state === null) return null;

  if (action.type === 'START_NEXT_HAND') {
    // Lifecycle advance between hands (server auto-advance / local public control).
    // Only valid at the hand_complete pause; a no-op (same ref) otherwise.
    const next = clone(state);
    return startNextHand(next, rng) ? next : state;
  }

  // Betting actions require an active betting phase and the acting seat.
  if (state.phase !== 'betting') return state;
  const next = clone(state);
  const ok = applyBettingAction(next, action, rng);
  return ok ? next : state;
}
