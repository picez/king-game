// ---------------------------------------------------------------------------
// Preferans — pure reducer (Stage 19.1). Deterministic (shuffle via injected rng),
// no browser/server APIs, no side effects. Illegal actions return the SAME state
// reference. Mirrors King/Durak/Deberc/Tarneeb's reducer contract with Preferans's
// own state/action. See PREFERANS_RULES.md for every rule encoded here.
//
// Trick resolution + hand scoring fold into PLAY_CARD (the 3rd card of a trick
// resolves it; the 10th trick scores the hand) so the action vocabulary stays
// START_GAME / BID / PASS_BID / TAKE_TALON / DISCARD / DECLARE_CONTRACT /
// PLAY_CARD / START_NEXT_HAND (§12).
// ---------------------------------------------------------------------------

import type { Card, PlayerType } from '../../models/types';
import type { Rng } from '../../core/rng';
import { dealPreferans, nextSeat, NUM_SEATS, HAND_TRICKS } from './deck';
import {
  activeBidders, canBid, canDeclareContract, canDiscard, canPassBid,
  canPlayCard, canTakeTalon, cardEquals, determineTrickWinner, trumpSuitOf,
} from './rules';
import type {
  Bid, PreferansAction, PreferansContext, PreferansOptions, PreferansPlayer, PreferansState,
} from './types';

const DEFAULT_TARGET = 10;
const DEFAULT_OPTIONS: PreferansOptions = { targetScore: DEFAULT_TARGET };

/** Game value G(L) = L − 5, so 6→1 … 10→5 (RULES §10). */
export function gameValue(level: number): number {
  return level - 5;
}

/**
 * Deep clone of the pure JSON state, EXCEPT `handHistory` (append-only, shared by
 * reference so each action stays O(1)). The only writer, `scoreHand`, replaces the
 * array with a fresh one, so a prior state's history is never mutated.
 */
function clone(state: PreferansState): PreferansState {
  const { handHistory, ...rest } = state;
  const copy = JSON.parse(JSON.stringify(rest)) as PreferansState;
  copy.handHistory = handHistory;
  return copy;
}

function removeCard(hand: Card[], card: Card): void {
  const i = hand.findIndex((c) => cardEquals(c, card));
  if (i >= 0) hand.splice(i, 1);
}

function resolveRng(ctx?: PreferansContext): Rng {
  return ctx?.rng ?? Math.random;
}

// --- START_GAME / deal ------------------------------------------------------

function startGame(action: Extract<PreferansAction, { type: 'START_GAME' }>, rng: Rng): PreferansState {
  const players: PreferansPlayer[] = action.playerNames.slice(0, NUM_SEATS).map((name, seat) => ({
    id: `player-${seat}`,
    name,
    seatIndex: seat,
    type: (action.playerTypes?.[seat] ?? 'human') as PlayerType,
  }));
  const options: PreferansOptions = { ...DEFAULT_OPTIONS, ...(action.options ?? {}) };
  const dealerSeat = action.dealerSeat ?? Math.floor(rng() * NUM_SEATS);

  const base: PreferansState = {
    gameType: 'preferans',
    phase: 'bidding',
    players,
    dealerSeat,
    currentSeat: nextSeat(dealerSeat),
    handsBySeat: [[], [], []],
    talon: [],
    discards: [],
    bids: [],
    passed: [false, false, false],
    highBid: null,
    declarerSeat: null,
    contract: null,
    currentTrick: null,
    completedTricks: [],
    tricksBySeat: [0, 0, 0],
    scores: [0, 0, 0],
    handNumber: 1,
    targetScore: options.targetScore,
    options,
    lastHand: null,
    handHistory: [],
    winnerSeat: null,
  };
  return dealFreshHand(base, dealerSeat, rng, false);
}

/**
 * Reset the auction and deal a new hand to `dealerSeat`. Scores/handNumber/lastHand
 * persist (the caller decides whether to bump handNumber). Bidding starts to the
 * dealer's left (§2, §5). Talon dealt face-down (§4).
 */
function dealFreshHand(base: PreferansState, dealerSeat: number, rng: Rng, incrementHandNumber: boolean): PreferansState {
  const s = clone(base);
  const { hands, talon } = dealPreferans(dealerSeat, rng);
  s.dealerSeat = dealerSeat;
  s.handsBySeat = hands;
  s.talon = talon;
  s.discards = [];
  s.currentSeat = nextSeat(dealerSeat);
  s.phase = 'bidding';
  s.bids = [];
  s.passed = [false, false, false];
  s.highBid = null;
  s.declarerSeat = null;
  s.contract = null;
  s.currentTrick = null;
  s.completedTricks = [];
  s.tricksBySeat = [0, 0, 0];
  if (incrementHandNumber) s.handNumber += 1;
  return s;
}

/** Next active (non-passed) seat to the left of `from`. */
function nextActiveBidder(s: PreferansState, from: number): number {
  let n = nextSeat(from);
  while (s.passed[n]) n = nextSeat(n);
  return n;
}

/** The auction is decided: `declarer` won → the talon phase (take → discard → declare). */
function enterTalon(s: PreferansState, declarer: number): PreferansState {
  s.declarerSeat = declarer;
  s.contract = null;
  s.phase = 'talon';
  s.currentSeat = declarer;
  return s;
}

// --- Scoring (§10, §11) -----------------------------------------------------

function scoreHand(s: PreferansState): PreferansState {
  const declarer = s.declarerSeat as number;
  const contract = s.contract as Bid;
  const g = gameValue(contract.level);
  const declTricks = s.tricksBySeat[declarer];
  const made = declTricks >= contract.level;

  const delta = [0, 0, 0];
  if (made) {
    delta[declarer] = g;                                   // made → declarer +G
  } else {
    delta[declarer] = -g;                                  // set → declarer −G
    for (let seat = 0; seat < NUM_SEATS; seat++) if (seat !== declarer) delta[seat] = g; // each defender +G
  }
  for (let seat = 0; seat < NUM_SEATS; seat++) s.scores[seat] += delta[seat];

  s.lastHand = {
    handNumber: s.handNumber,
    declarerSeat: declarer,
    contract,
    declarerTricks: declTricks,
    made,
    deltaBySeat: delta,
  };
  // Append the score-only record (public; no cards, §14). NEW array — clone shares
  // the previous history by reference, so we must not mutate it in place.
  s.handHistory = [...s.handHistory, s.lastHand];

  // Game end (§11): once any score reaches the target, the highest wins; an exact
  // tie for the lead at/over target is a DRAW (winnerSeat stays null). Either way
  // the match finishes — the score SUM strictly increases each scored hand, so a
  // target is always reached in bounded hands.
  const max = Math.max(...s.scores);
  if (max >= s.targetScore) {
    const leaders = s.scores.reduce<number[]>((acc, v, i) => (v === max ? [...acc, i] : acc), []);
    s.winnerSeat = leaders.length === 1 ? leaders[0] : null; // unique leader wins; tie = draw
    s.phase = 'game_finished';
    return s;
  }
  s.phase = 'hand_complete';
  return s;
}

// --- Reducer ----------------------------------------------------------------

export function preferansReducer(
  state: PreferansState | null,
  action: PreferansAction,
  ctx?: PreferansContext,
): PreferansState | null {
  const rng = resolveRng(ctx);

  if (action.type === 'START_GAME') {
    if (state !== null) return state;                        // already started → illegal
    if (action.playerNames.length !== NUM_SEATS) return state; // must be exactly 3
    return startGame(action, rng);
  }

  if (state === null) return null;
  if (state.phase === 'game_finished') return state;

  switch (action.type) {
    case 'BID': {
      const seat = state.currentSeat;
      if (!canBid(state, seat, action.level, action.suit)) return state;
      const s = clone(state);
      const bid: Bid = { level: action.level, suit: action.suit };
      s.highBid = { ...bid, seat };
      s.bids.push({ seat, bid });
      const active = activeBidders(s);
      if (active.length === 1) return enterTalon(s, seat);   // everyone else already passed
      s.currentSeat = nextActiveBidder(s, seat);
      return s;
    }

    case 'PASS_BID': {
      const seat = state.currentSeat;
      if (!canPassBid(state, seat)) return state;
      const s = clone(state);
      s.passed[seat] = true;
      s.bids.push({ seat, bid: null });
      const active = activeBidders(s);
      if (s.highBid && active.length === 1) return enterTalon(s, active[0]); // lone bidder wins
      if (!s.highBid && active.length === 0) {
        // All passed with no bid → redeal to the NEXT dealer, scores/handNumber
        // unchanged (§5). The dealer rotation keeps the deal sequence advancing.
        return dealFreshHand(s, nextSeat(s.dealerSeat), rng, false);
      }
      s.currentSeat = nextActiveBidder(s, seat);
      return s;
    }

    case 'TAKE_TALON': {
      const seat = state.currentSeat;
      if (!canTakeTalon(state, seat)) return state;
      const s = clone(state);
      s.handsBySeat[seat] = [...s.handsBySeat[seat], ...s.talon];
      s.talon = [];
      return s; // still in 'talon' → next step is DISCARD
    }

    case 'DISCARD': {
      const seat = state.currentSeat;
      if (!canDiscard(state, seat, action.cards)) return state;
      const s = clone(state);
      removeCard(s.handsBySeat[seat], action.cards[0]);
      removeCard(s.handsBySeat[seat], action.cards[1]);
      s.discards = [action.cards[0], action.cards[1]];
      return s; // still in 'talon' → next step is DECLARE_CONTRACT
    }

    case 'DECLARE_CONTRACT': {
      const seat = state.currentSeat;
      if (!canDeclareContract(state, seat, action.level, action.suit)) return state;
      const s = clone(state);
      s.contract = { level: action.level, suit: action.suit };
      s.phase = 'playing';
      // The declarer's left-hand defender leads the first trick (§8).
      const lead = nextSeat(seat);
      s.currentSeat = lead;
      s.currentTrick = { leadSeat: lead, ledSuit: null, plays: [], winnerSeat: null };
      return s;
    }

    case 'PLAY_CARD': {
      const seat = state.currentSeat;
      if (!canPlayCard(state, seat, action.card)) return state;
      const s = clone(state);
      removeCard(s.handsBySeat[seat], action.card);
      const trick = s.currentTrick as NonNullable<PreferansState['currentTrick']>;
      if (trick.plays.length === 0) trick.ledSuit = action.card.suit;
      trick.plays.push({ seat, card: action.card, playOrder: trick.plays.length + 1 });

      if (trick.plays.length < NUM_SEATS) {
        s.currentSeat = nextSeat(seat);
        return s;
      }

      // Third card → resolve the trick.
      const winner = determineTrickWinner(trick.plays, trick.ledSuit as Card['suit'], trumpSuitOf(s.contract as Bid));
      trick.winnerSeat = winner;
      s.completedTricks.push(trick);
      s.tricksBySeat[winner] += 1;

      if (s.completedTricks.length < HAND_TRICKS) {
        s.currentTrick = { leadSeat: winner, ledSuit: null, plays: [], winnerSeat: null };
        s.currentSeat = winner; // winner leads the next trick
        return s;
      }

      // Tenth trick → score the hand.
      s.currentTrick = null;
      return scoreHand(s);
    }

    case 'START_NEXT_HAND': {
      if (state.phase !== 'hand_complete') return state;
      return dealFreshHand(state, nextSeat(state.dealerSeat), rng, true); // dealer rotates left (§2)
    }

    default:
      return state;
  }
}
