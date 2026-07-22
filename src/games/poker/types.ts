// ---------------------------------------------------------------------------
// Poker (No-Limit Texas Hold'em) — pure core types. Completely separate from the
// other six games. See POKER_RULES.md for the source of truth; if the code
// disagrees with that document, the code is wrong (fix the code, not the spec).
//
// Stage 37.4: pure core. Internal id `poker`, game_type `'poker'`.
// ---------------------------------------------------------------------------

import type { PlayerType, Rank, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';

export type { PlayerType, Rank, Suit } from '../../models/types';

/**
 * A single poker card. A real card carries a concrete `suit` + `rank`; a
 * face-down PLACEHOLDER (produced only by redaction, never by the engine) carries
 * `suit: null, rank: null` with the sentinel `id: 'hidden'`. `id` is unique across
 * the single 52-card deck (e.g. `spades-A`). No jokers.
 */
export interface PokerCard {
  id: string;
  suit: Suit | null;
  rank: Rank | null;
}

/**
 * Blind + stack configuration (§1, §16). `smallBlind`/`bigBlind` are the BASE blinds
 * — the level-0 amounts a hand starts from. When `blindGrowthEveryHands > 0` the
 * blinds actually POSTED grow every N hands (§16 D); the per-hand CURRENT blinds are
 * derived by `currentBlinds()` and stored on the state (`smallBlindCurrent` /
 * `bigBlindCurrent`). Local free-play uses a configurable `startingStack` (default
 * 1000) with fixed 10/20 base blinds; online bankroll uses `startingStack = buyIn`
 * (100 big blinds) with a host-chosen stakes preset. The pure core never reads a DB.
 */
export interface PokerOptions {
  startingStack: number;
  /** Base (level-0) small blind. */
  smallBlind: number;
  /** Base (level-0) big blind. */
  bigBlind: number;
  /** Grow blinds every N COMPLETED hands (0 = never). Off-by-one: hands 1..N base,
   *  hand N+1 → ×2, hand 2N+1 → ×4 (§16 D). */
  blindGrowthEveryHands: number;
  /** Informational only — the pure core behaves identically either way (no DB). */
  mode?: 'local_free' | 'online_bankroll';
}

/** The streets of one hand (§4). */
export type PokerStreet = 'preflop' | 'flop' | 'turn' | 'river';

/**
 * Phases of a poker match:
 *  - 'betting'       → a betting round is in progress on the current street;
 *  - 'hand_complete' → the hand was resolved (pot(s) awarded); START_NEXT_HAND
 *                      deals the next hand. `lastHand` holds the public result;
 *  - 'game_finished' → a single player holds all the chips (winnerSeat set).
 */
export type PokerPhase = 'betting' | 'hand_complete' | 'game_finished';

/** The five best-hand categories, weakest→strongest (§9). Used by the evaluator. */
export type HandCategory =
  | 'high_card'
  | 'one_pair'
  | 'two_pair'
  | 'three_of_a_kind'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'four_of_a_kind'
  | 'straight_flush'
  | 'royal_flush';

export interface PokerPlayer {
  id: string; // 'player-<seat>' (matches the other games' seat ids)
  name: string;
  seatIndex: number;
  type: PlayerType;
  // Hole cards live in `holeCardsBySeat` (single source of truth, redaction-friendly).
}

/** One pot (main or side) and who is eligible to win it (§8). */
export interface PokerPotAward {
  /** Chip amount in this pot layer. */
  amount: number;
  /** Seats eligible to contest this pot (non-folded contributors at this level). */
  eligibleSeats: number[];
  /** Seats that actually won a share of this pot (set at showdown). */
  winners: number[];
  /** true when this layer was an uncalled bet returned to a single player. */
  returned: boolean;
}

/** The public result of one finished hand (no private cards except revealed ones). */
export interface PokerHandResult {
  handNumber: number;
  /** Chips awarded to each seat this hand (length playerCount; net of contributions). */
  wonBySeat: number[];
  /** Whether the hand went to a showdown (false = won by everyone folding, §7). */
  showdown: boolean;
  /** Seats whose hole cards were revealed at showdown (empty on a fold-win). */
  revealedSeats: number[];
  /** The best-hand category label per revealed seat (for the UI); keyed by seat. */
  categoryBySeat: Record<number, HandCategory>;
  /**
   * The EXACT five card ids forming each revealed seat's best hand (§16 I), keyed by
   * seat. Determined by the evaluator (never the UI); used to highlight the winning
   * five at showdown. Suits never affect strength/ties, but the id list is
   * deterministic. Empty on a fold-win (no reveal).
   */
  winningFiveBySeat: Record<number, string[]>;
  /** The pot layers and their winners. */
  pots: PokerPotAward[];
  /** Seats eliminated (stack hit 0) by this hand. */
  newlyEliminated: number[];
}

/** The kinds of action recorded in the public per-hand action history (§13). */
export type PokerActionKind = 'blind' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

/**
 * One entry in the current hand's PUBLIC action history (§13). Carries NO card /
 * deck / burn data — only the seat, the street, the action kind and the chip amount
 * actually committed by that action (0 for fold/check). Reset at each deal.
 */
export interface PokerActionEntry {
  seat: number;
  street: PokerStreet;
  kind: PokerActionKind;
  /** Chips this action committed (blind/call/bet/raise/all-in); 0 for fold/check. */
  amount: number;
}

/**
 * Per-seat, per-MATCH telemetry accumulators (persist across hands; only reset at
 * START_GAME). PUBLIC counters, never any card. Read by the finish summarizer;
 * each maps to a poker stat counter (§ stats):
 *  - `handsPlayedBySeat`  — hands this seat was dealt into.
 *  - `handsWonBySeat`     — hands where this seat won ≥1 chip.
 *  - `showdownsWonBySeat` — hands won at showdown (not by fold-out).
 *  - `potsWonBySeat`      — number of pot layers this seat won.
 *  - `biggestPotBySeat`   — largest single pot (chips) this seat won.
 *  - `allInsWonBySeat`    — hands this seat won after being all-in at some point.
 *  - `royalFlushBySeat`   — royal flushes this seat showed down.
 */
export interface PokerTelemetry {
  handsPlayedBySeat: number[];
  handsWonBySeat: number[];
  showdownsWonBySeat: number[];
  potsWonBySeat: number[];
  biggestPotBySeat: number[];
  allInsWonBySeat: number[];
  royalFlushBySeat: number[];
}

export interface PokerState {
  gameType: 'poker';
  phase: PokerPhase;

  /** 2–6 (§1). Decides seat count. */
  playerCount: number;
  players: PokerPlayer[];
  options: PokerOptions;

  /** The dealer button seat; moves one occupied seat clockwise per hand (§2). */
  buttonSeat: number;
  /** 1-based hand counter (increments each deal). */
  handNumber: number;
  /** The current street of the hand in progress (§4). */
  street: PokerStreet;

  /** CURRENT small blind posted this hand (base × growth level; §16 D). Authoritative. */
  smallBlindCurrent: number;
  /** CURRENT big blind posted this hand (base × growth level; §16 D). Authoritative. */
  bigBlindCurrent: number;

  /** Running chip stack per seat — the match currency (persists across hands). */
  stacksBySeat: number[];
  /** Each seat's 2 private hole cards (redacted online, §13). Length 0 once out. */
  holeCardsBySeat: PokerCard[][];
  /** The community board: 0 / 3 / 4 / 5 cards (§3). */
  board: PokerCard[];

  /** SERVER-PRIVATE undealt deck (order hidden; never sent to a client, §13). */
  deck: PokerCard[];
  /** SERVER-PRIVATE burned cards (never sent to a client, §3/§13). */
  burned: PokerCard[];

  /** Chips committed by each seat on the CURRENT street (reset each street). */
  committedBySeat: number[];
  /** Total chips committed by each seat THIS hand across all streets (side pots). */
  contributedBySeat: number[];
  /** Whether each seat has folded this hand. */
  foldedBySeat: boolean[];
  /** Whether each seat is all-in (0 chips behind, still eligible). */
  allInBySeat: boolean[];
  /** Whether each seat has been all-in at any point THIS hand (telemetry). */
  wasAllInBySeat: boolean[];
  /** Whether each seat has acted since the last bet/raise on this street. */
  actedBySeat: boolean[];
  /**
   * Whether each seat currently has the RIGHT to raise (§5/§6). All actable seats
   * start a street with the right; a full bet/raise re-opens it for everyone else; a
   * below-minimum (incomplete) all-in does NOT re-open it for players who already
   * acted — they may only call the extra or fold. Public betting state.
   */
  raiseOpenBySeat: boolean[];
  /** Seats eliminated from the match (stack 0 between hands). */
  eliminatedBySeat: boolean[];

  /** Highest committed-this-street amount (the bet to match). */
  currentBet: number;
  /** Minimum legal raise INCREMENT on this street (starts at the big blind). */
  minRaise: number;
  /** Whose turn it is to act (valid only in phase 'betting'). */
  toActSeat: number;

  /** Seats revealed at the last/ current showdown (hole cards public). */
  revealedBySeat: boolean[];
  /** The most recent finished hand's public result, or null. */
  lastHand: PokerHandResult | null;
  /** The match winner (last player with chips), or null until finished. */
  winnerSeat: number | null;

  /** PUBLIC per-hand action history (§13); reset each deal. Never any card data. */
  actionLog: PokerActionEntry[];

  /** Per-match telemetry (see PokerTelemetry). */
  telemetry: PokerTelemetry;
}

export type PokerAction =
  | {
      type: 'START_GAME';
      playerNames: string[];
      playerTypes?: PlayerType[];
      playerCount?: number;
      buttonSeat?: number;
      options?: Partial<PokerOptions>;
    }
  | { type: 'FOLD' }
  | { type: 'CHECK' }
  | { type: 'CALL' }
  /** Fresh wager when there is no outstanding bet. `amount` = total-to for this street. */
  | { type: 'BET'; amount: number }
  /** Increase an outstanding bet. `amount` = the new total the seat commits to this street. */
  | { type: 'RAISE'; amount: number }
  /** Commit the entire remaining stack (call/bet/raise depending on amount). */
  | { type: 'ALL_IN' }
  | { type: 'START_NEXT_HAND' };

export interface PokerContext {
  rng?: Rng;
}
