// ---------------------------------------------------------------------------
// Tarneeb — pure reducer. Deterministic (shuffle via injected rng), no browser
// or server APIs, no side effects. Illegal actions return the SAME state
// reference. Mirrors King/Durak/Deberc's reducer contract with Tarneeb's own
// state/action. See TARNEEB_RULES.md for every rule encoded here.
//
// Trick resolution and hand scoring are folded into PLAY_CARD (the fourth card
// of a trick resolves it; the thirteenth trick scores the hand) so the public
// action vocabulary stays START_GAME / BID / PASS_BID / CHOOSE_TRUMP /
// PLAY_CARD / START_NEXT_HAND (§11).
// ---------------------------------------------------------------------------

import type { Card, PlayerType } from '../../models/types';
import type { Rng } from '../../core/rng';
import { dealTarneeb } from './deck';
import {
  activeBidders,
  canBid,
  canChooseTrump,
  canPassBid,
  canPlayCard,
  cardEquals,
  determineTrickWinner,
  HAND_TRICKS,
  isSoloTarneeb,
  nextSeatCounterClockwise,
  normalizeTargetScore,
  NUM_SEATS,
  otherTeam,
  teamOfSeat,
} from './rules';
import type {
  TarneebAction,
  TarneebContext,
  TarneebOptions,
  TarneebPlayer,
  TarneebSoloHandResult,
  TarneebState,
  TarneebVariant,
  Team,
} from './types';

const DEFAULT_TARGET = 41;

const DEFAULT_OPTIONS: TarneebOptions = {
  targetScore: DEFAULT_TARGET,
  kabootMode: 'off',
  allowNoTrump: false,
};

/**
 * Deep clone of the pure JSON state, EXCEPT `handHistory`, whose entries are
 * append-only and never mutated in place — so we share the array by reference to
 * keep every reducer action O(1) instead of re-copying a match-long history each
 * time. `scoreHand` (the only writer) replaces the array with a fresh one, so the
 * previous state's history is never mutated.
 */
function clone(state: TarneebState): TarneebState {
  const { handHistory, soloHandHistory, ...rest } = state;
  const copy = JSON.parse(JSON.stringify(rest)) as TarneebState;
  copy.handHistory = handHistory;
  // soloHandHistory is append-only like handHistory (undefined in pairs → not set,
  // so a pairs state's shape is unchanged). scoreSoloHand replaces the array.
  if (soloHandHistory !== undefined) copy.soloHandHistory = soloHandHistory;
  return copy;
}

function removeCard(hand: Card[], card: Card): void {
  const i = hand.findIndex((c) => cardEquals(c, card));
  if (i >= 0) hand.splice(i, 1);
}

function resolveRng(ctx?: TarneebContext): Rng {
  return ctx?.rng ?? Math.random;
}

// --- START_GAME -------------------------------------------------------------

function startGame(action: Extract<TarneebAction, { type: 'START_GAME' }>, rng: Rng): TarneebState {
  const names = action.playerNames;
  const players: TarneebPlayer[] = names.slice(0, NUM_SEATS).map((name, seat) => ({
    id: `player-${seat}`,
    name,
    seatIndex: seat,
    type: (action.playerTypes?.[seat] ?? 'human') as PlayerType,
  }));

  const options: TarneebOptions = {
    ...DEFAULT_OPTIONS,
    ...(action.options ?? {}),
    // Match target is configurable (Stage 29.8) but always normalised to a safe integer in range;
    // a missing/invalid value falls back to the default 41 so old callers are unchanged.
    targetScore: normalizeTargetScore(action.options?.targetScore),
    // MVP hard-defaults — no No-Trump, kaboot off (§6, §9).
    kabootMode: 'off',
    allowNoTrump: false,
  };

  const dealerSeat = action.dealerSeat ?? Math.floor(rng() * 4);
  // Variant (Stage 28.1): anything but exactly 'solo' → the released pairs game.
  const variant: TarneebVariant = action.variant === 'solo' ? 'solo' : 'pairs';

  const base: TarneebState = {
    gameType: 'tarneeb',
    phase: 'bidding',
    variant,
    players,
    teams: { A: [0, 2], B: [1, 3] },
    dealerSeat,
    currentSeat: nextSeatCounterClockwise(dealerSeat),
    handsBySeat: [[], [], [], []],
    bids: [],
    passed: [false, false, false, false],
    highestBid: null,
    declarerSeat: null,
    declarerTeam: null,
    trumpSuit: null,
    currentTrick: null,
    completedTricks: [],
    tricksByTeam: { A: 0, B: 0 },
    scoresByTeam: { A: 0, B: 0 },
    handNumber: 1,
    targetScore: options.targetScore,
    options,
    lastHand: null,
    handHistory: [],
    winnerTeam: null,
    // Solo-only per-seat ledger (undefined in pairs so the shape is unchanged).
    ...(variant === 'solo'
      ? {
          tricksBySeat: [0, 0, 0, 0],
          scoresBySeat: [0, 0, 0, 0],
          lastSoloHand: null,
          soloHandHistory: [],
          soloWinnerSeat: null,
        }
      : {}),
  };
  return dealFreshHand(base, dealerSeat, rng, false);
}

/**
 * Reset the auction and deal a new hand to `dealerSeat`. Scores, handNumber, and
 * lastHand persist (the caller decides whether to bump handNumber). Bidding
 * starts to the dealer's right (§4, §5).
 */
function dealFreshHand(
  base: TarneebState,
  dealerSeat: number,
  rng: Rng,
  incrementHandNumber: boolean,
): TarneebState {
  const s = clone(base);
  s.dealerSeat = dealerSeat;
  s.handsBySeat = dealTarneeb(dealerSeat, rng);
  s.currentSeat = nextSeatCounterClockwise(dealerSeat);
  s.phase = 'bidding';
  s.bids = [];
  s.passed = [false, false, false, false];
  s.highestBid = null;
  s.declarerSeat = null;
  s.declarerTeam = null;
  s.trumpSuit = null;
  s.currentTrick = null;
  s.completedTricks = [];
  s.tricksByTeam = { A: 0, B: 0 };
  // Solo: reset the per-seat trick tally for the new hand (scores persist).
  if (isSoloTarneeb(s)) s.tricksBySeat = [0, 0, 0, 0];
  if (incrementHandNumber) s.handNumber += 1;
  return s;
}

// --- Auction helpers --------------------------------------------------------

/** Next seat still in the auction, counter-clockwise from `from` (skips passers). */
function nextActiveBidder(s: TarneebState, from: number): number {
  let n = nextSeatCounterClockwise(from);
  while (s.passed[n]) n = nextSeatCounterClockwise(n);
  return n;
}

/** The declarer is set; move to the trump-choice phase (they lead nothing yet). */
function enterChoosingTrump(s: TarneebState, declarer: number): TarneebState {
  s.declarerSeat = declarer;
  s.declarerTeam = teamOfSeat(declarer);
  s.phase = 'choosing_trump';
  s.currentSeat = declarer;
  return s;
}

// --- Scoring (§8) -----------------------------------------------------------

/**
 * SOLO scoring (Stage 28.1; contract model corrected Stage 29.0 to match Pairs §8).
 * Per-seat, no teams:
 *  - declarer MAKES it EXACTLY (declarer tricks === bid): declarer +bid×2 (doubled);
 *  - declarer MAKES it with OVERTRICKS (declarer tricks > bid): declarer +declarer
 *    tricks (the actual tricks won, NOT the bid);
 *  - declarer FAILS (declarer tricks < bid): declarer −bid, and each of the 3
 *    defenders banks +their own tricks (defenders' tricks sum to 13 − declarerTricks,
 *    self-balancing). Failure model unchanged.
 * Defenders score 0 on a made contract. Match ends when a UNIQUE seat is at/over
 * target; a tie at/over target is not a finish (play one more hand). Negative allowed.
 */
function scoreSoloHand(s: TarneebState): TarneebState {
  const bid = (s.highestBid as { amount: number }).amount;
  const declarer = s.declarerSeat as number;
  const tricks = (s.tricksBySeat as number[]);
  const declTricks = tricks[declarer];
  const made = declTricks >= bid;
  // Exact-bid double mirrors Pairs (§8): exactly the bid → bid×2; overtricks → the
  // tricks actually won (no double). Failure is unchanged.
  const exactBidDouble = made && declTricks === bid;

  const delta = [0, 0, 0, 0];
  if (made) {
    delta[declarer] = exactBidDouble ? bid * 2 : declTricks; // defenders score 0
  } else {
    delta[declarer] = -bid;
    for (let seat = 0; seat < NUM_SEATS; seat++) {
      if (seat !== declarer) delta[seat] = tricks[seat];
    }
  }
  const scores = s.scoresBySeat as number[];
  for (let i = 0; i < NUM_SEATS; i++) scores[i] += delta[i];

  const result: TarneebSoloHandResult = {
    handNumber: s.handNumber,
    bid,
    declarerSeat: declarer,
    trumpSuit: s.trumpSuit as Card['suit'],
    tricksBySeat: tricks.slice(),
    made,
    exactBidDouble,
    deltaBySeat: delta.slice(),
  };
  s.lastSoloHand = result;
  // New array (clone shares the previous history by reference — never mutate it).
  s.soloHandHistory = [...(s.soloHandHistory ?? []), result];

  // Game end (§10, per-seat): a UNIQUE highest seat at/over target wins; a tie at
  // the top at/over target is NOT a finish (play one more hand → safe, no null winner).
  const t = s.targetScore;
  const max = Math.max(...scores);
  if (max >= t) {
    const leaders: number[] = [];
    for (let i = 0; i < NUM_SEATS; i++) if (scores[i] === max) leaders.push(i);
    if (leaders.length === 1) {
      s.soloWinnerSeat = leaders[0];
      s.phase = 'game_finished';
      return s;
    }
  }
  s.phase = 'hand_complete';
  return s;
}

/** After 13 tricks, apply §8 scoring and decide game end (§10). */
function scoreHand(s: TarneebState): TarneebState {
  if (isSoloTarneeb(s)) return scoreSoloHand(s);
  const declTeam = s.declarerTeam as Team;
  const defTeam = otherTeam(declTeam);
  const bid = (s.highestBid as { amount: number }).amount;
  const declTricks = s.tricksByTeam[declTeam];
  const defTricks = s.tricksByTeam[defTeam];
  const made = declTricks >= bid;
  // Exact-bid double (§8): making EXACTLY the bid doubles the hand score. This
  // applies even to an all-13 contract (bid 13, 13 tricks → +26) — the Kaboot
  // BONUS stays off (no extra flat bonus), but the exact-bid double is separate
  // and still applies. Overtricks (declTricks > bid) score the tricks won, no double.
  const exactBidDouble = made && declTricks === bid;

  const delta: Record<Team, number> = { A: 0, B: 0 };
  if (made) {
    // Made contract: exact bid doubles (bid×2); overtricks score the tricks won.
    delta[declTeam] = exactBidDouble ? bid * 2 : declTricks;
    delta[defTeam] = 0;
  } else {
    // Failed contract: bidding team is set by the full bid; defenders bank tricks.
    delta[declTeam] = -bid;
    delta[defTeam] = defTricks;
  }
  s.scoresByTeam.A += delta.A;
  s.scoresByTeam.B += delta.B;

  s.lastHand = {
    handNumber: s.handNumber,
    bid,
    declarerSeat: s.declarerSeat as number,
    declarerTeam: declTeam,
    trumpSuit: s.trumpSuit as Card['suit'],
    declarerTricks: declTricks,
    defenderTricks: defTricks,
    made,
    exactBidDouble,
    deltaByTeam: delta,
  };
  // Append the score-only record to the match history (public; no cards, §13).
  // A NEW array (not push) — clone shares the previous history by reference, so we
  // must not mutate it in place.
  s.handHistory = [...s.handHistory, s.lastHand];

  // Game end (§10): if a team is at/over target, the higher score wins; an exact
  // tie at/over target is NOT a finish — play one more hand.
  const a = s.scoresByTeam.A;
  const b = s.scoresByTeam.B;
  const t = s.targetScore;
  if ((a >= t || b >= t) && a !== b) {
    s.winnerTeam = a > b ? 'A' : 'B';
    s.phase = 'game_finished';
    return s;
  }
  s.phase = 'hand_complete';
  return s;
}

// --- Reducer ----------------------------------------------------------------

export function tarneebReducer(
  state: TarneebState | null,
  action: TarneebAction,
  ctx?: TarneebContext,
): TarneebState | null {
  const rng = resolveRng(ctx);

  if (action.type === 'START_GAME') {
    if (state !== null) return state; // already started → illegal
    if (action.playerNames.length !== NUM_SEATS) return state; // must be exactly 4
    return startGame(action, rng);
  }

  if (state === null) return null;
  if (state.phase === 'game_finished') return state;

  switch (action.type) {
    case 'BID': {
      const seat = state.currentSeat;
      if (!canBid(state, seat, action.amount)) return state;
      const s = clone(state);
      s.highestBid = { seat, amount: action.amount };
      s.bids.push({ seat, amount: action.amount });
      const active = activeBidders(s);
      if (active.length === 1) {
        // Everyone else has already passed → this bidder is the declarer.
        return enterChoosingTrump(s, seat);
      }
      s.currentSeat = nextActiveBidder(s, seat);
      return s;
    }

    case 'PASS_BID': {
      const seat = state.currentSeat;
      if (!canPassBid(state, seat)) return state;
      const s = clone(state);
      s.passed[seat] = true;
      s.bids.push({ seat, amount: null });
      const active = activeBidders(s);
      if (s.highestBid && active.length === 1) {
        // Three have passed and a bid stands → the lone bidder is the declarer.
        return enterChoosingTrump(s, active[0]);
      }
      if (!s.highestBid && active.length === 0) {
        // All four passed with no bid → redeal by the SAME dealer, scores and
        // handNumber unchanged (§5).
        return dealFreshHand(s, s.dealerSeat, rng, false);
      }
      s.currentSeat = nextActiveBidder(s, seat);
      return s;
    }

    case 'CHOOSE_TRUMP': {
      const seat = state.currentSeat;
      if (!canChooseTrump(state, seat, action.suit)) return state;
      const s = clone(state);
      s.trumpSuit = action.suit;
      s.phase = 'playing';
      // The declarer leads the first trick (§7, [MVP]).
      s.currentSeat = s.declarerSeat as number;
      s.currentTrick = { leadSeat: s.declarerSeat as number, ledSuit: null, plays: [], winnerSeat: null };
      return s;
    }

    case 'PLAY_CARD': {
      const seat = state.currentSeat;
      if (!canPlayCard(state, seat, action.card)) return state;
      const s = clone(state);
      removeCard(s.handsBySeat[seat], action.card);
      const trick = s.currentTrick as NonNullable<TarneebState['currentTrick']>;
      if (trick.plays.length === 0) trick.ledSuit = action.card.suit;
      trick.plays.push({ seat, card: action.card, playOrder: trick.plays.length + 1 });

      if (trick.plays.length < NUM_SEATS) {
        s.currentSeat = nextSeatCounterClockwise(seat);
        return s;
      }

      // Fourth card → resolve the trick.
      const winner = determineTrickWinner(trick.plays, trick.ledSuit as Card['suit'], s.trumpSuit);
      trick.winnerSeat = winner;
      s.completedTricks.push(trick);
      s.tricksByTeam[teamOfSeat(winner)] += 1;
      // Solo: also tally the trick to the winning SEAT (per-player scoring).
      if (isSoloTarneeb(s) && s.tricksBySeat) s.tricksBySeat[winner] += 1;

      if (s.completedTricks.length < HAND_TRICKS) {
        // Winner leads the next trick.
        s.currentTrick = { leadSeat: winner, ledSuit: null, plays: [], winnerSeat: null };
        s.currentSeat = winner;
        return s;
      }

      // Thirteenth trick → score the hand.
      s.currentTrick = null;
      return scoreHand(s);
    }

    case 'START_NEXT_HAND': {
      if (state.phase !== 'hand_complete') return state;
      // Dealer rotates counter-clockwise (to the right) for a real next hand (§4).
      const nextDealer = nextSeatCounterClockwise(state.dealerSeat);
      return dealFreshHand(state, nextDealer, rng, true);
    }

    default:
      return state;
  }
}
