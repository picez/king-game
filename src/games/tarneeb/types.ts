// ---------------------------------------------------------------------------
// Tarneeb — pure core types. Completely separate from King, Durak, and Deberc.
// See TARNEEB_RULES.md (v1.1) for the source of truth. If code disagrees with
// that document, the code is wrong.
// ---------------------------------------------------------------------------

import type { Card, PlayerType, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';

export type { Card } from '../../models/types';

/** The two fixed partnerships: A = seats 0 & 2, B = seats 1 & 3 (§2). */
export type Team = 'A' | 'B';

/**
 * Phases of a Tarneeb match (TARNEEB_RULES.md §11). An optional pre-deal
 * setup/dealing phase is fine internally, but START_GAME already produces a
 * playable first hand, so the reducer never dwells in one:
 *  - 'bidding'        → the auction is in progress (integer 3–13, pass-is-final);
 *  - 'choosing_trump' → the declarer alone names the trump suit;
 *  - 'playing'        → the 13 tricks are being played;
 *  - 'hand_complete'  → the hand is scored; START_NEXT_HAND begins the next one;
 *  - 'game_finished'  → a team reached the target score (winnerTeam set).
 */
export type TarneebPhase =
  | 'bidding'
  | 'choosing_trump'
  | 'playing'
  | 'hand_complete'
  | 'game_finished';

/** Kaboot scoring mode. MVP hard-defaults to 'off' (all-13 = plain +13, §9). */
export type TarneebKabootMode = 'off';

export interface TarneebPlayer {
  id: string;            // 'player-<seat>' (matches King/Durak/Deberc seat ids)
  name: string;
  seatIndex: number;
  type: PlayerType;
  // NOTE: hands live in `handsBySeat` (single source of truth, redaction-friendly).
}

/** One entry in the auction history: a bid amount, or null for a pass. */
export interface TarneebBid {
  seat: number;
  amount: number | null; // null = passed (final for this auction)
}

/** The current best bid in the auction. */
export interface TarneebHighBid {
  seat: number;
  amount: number;
}

/** One card played into the current trick by a seat. */
export interface TarneebPlay {
  seat: number;
  card: Card;
  playOrder: number;     // 1-based order within the trick
}

/** The trick currently being played (or the just-resolved one). */
export interface TarneebTrick {
  leadSeat: number;
  /** null until the first card of the trick sets the led suit. */
  ledSuit: Suit | null;
  plays: TarneebPlay[];
  winnerSeat: number | null;
}

export interface TarneebOptions {
  /** Match target (default 41). §10 documents 31 / 61 as future variants. */
  targetScore: number;
  /** MVP: only 'off' is wired (all-13 = plain +13, §9). */
  kabootMode: TarneebKabootMode;
  /** MVP: No-Trump is excluded (§6). Reserved future option. */
  allowNoTrump: false;
}

/** Summary of a hand once it is scored (§8) — for display / score sheets. */
export interface TarneebHandResult {
  handNumber: number;
  bid: number;
  declarerSeat: number;
  declarerTeam: Team;
  trumpSuit: Suit;
  declarerTricks: number;
  defenderTricks: number;
  /** Whether the contract was made (declarerTricks >= bid). */
  made: boolean;
  /**
   * Exact-bid double (§8): the contract was made with EXACTLY the bid, so the
   * hand score is doubled (e.g. bid 8, 8 tricks → +16). Overtricks do NOT double.
   * Optional/backward-compatible: absent (falsy) on non-exact or failed hands.
   */
  exactBidDouble?: boolean;
  /** Score change applied per team this hand. */
  deltaByTeam: Record<Team, number>;
}

export interface TarneebState {
  gameType: 'tarneeb';
  phase: TarneebPhase;

  players: TarneebPlayer[];               // exactly 4
  /** Fixed partnerships (§2): A = [0, 2], B = [1, 3]. */
  teams: Record<Team, [number, number]>;

  /** Rotates counter-clockwise (to the right) each real hand (§4). */
  dealerSeat: number;
  /** Whose turn it is to act (bid, choose trump, or play). */
  currentSeat: number;

  /** Each seat's private 13-card hand (redacted online, §13). */
  handsBySeat: Card[][];

  /** Auction history this hand (bids and passes, in order). */
  bids: TarneebBid[];
  /** Whether each seat has passed (and is out of the auction). */
  passed: boolean[];
  /** The current best bid, or null until the first bid. */
  highestBid: TarneebHighBid | null;

  /** Winner of the auction (null until decided). */
  declarerSeat: number | null;
  declarerTeam: Team | null;
  /** Chosen trump suit (null until choosing_trump resolves). */
  trumpSuit: Suit | null;

  /** The trick in progress (null outside the playing phase). */
  currentTrick: TarneebTrick | null;
  /** Resolved tricks this hand (max 13). */
  completedTricks: TarneebTrick[];
  /** Tricks won per team this hand (sums to completedTricks.length). */
  tricksByTeam: Record<Team, number>;

  /** Cumulative match score per team. */
  scoresByTeam: Record<Team, number>;

  /** 1-based hand counter (only increments on a real, played hand). */
  handNumber: number;
  /** Match target (mirrors options.targetScore). */
  targetScore: number;
  options: TarneebOptions;

  /** The most recently scored hand (for the UI), or null. */
  lastHand: TarneebHandResult | null;
  /**
   * Score-only history of every scored hand this match, oldest first. Public
   * (no cards — only bid/declarer/trump/tricks/score deltas per §8), so it stays
   * in the redacted online state and feeds outcome stats. Grows on each scored
   * hand; unchanged by a dead-auction redeal.
   */
  handHistory: TarneebHandResult[];
  /** Winning team once finished, else null. */
  winnerTeam: Team | null;
}

export type TarneebAction =
  | {
      type: 'START_GAME';
      playerNames: string[];               // 4 names
      playerTypes?: PlayerType[];          // defaults to 'human'
      options?: Partial<TarneebOptions>;
      /** Optional explicit first dealer (for tests); random via rng otherwise. */
      dealerSeat?: number;
    }
  /** A legal integer 3–13, strictly above the current high bid. Seat = currentSeat. */
  | { type: 'BID'; amount: number }
  /** Permanently drop out of the current auction. Seat = currentSeat. */
  | { type: 'PASS_BID' }
  /** The declarer names the trump suit; enter playing. Seat = currentSeat = declarer. */
  | { type: 'CHOOSE_TRUMP'; suit: Suit }
  /** Play one legal card into the current trick. Seat = currentSeat. */
  | { type: 'PLAY_CARD'; card: Card }
  /** Advance from hand_complete to the next hand (rotates dealer to the right). */
  | { type: 'START_NEXT_HAND' };

/** Reducer context — inject an rng for a deterministic, reproducible shuffle. */
export interface TarneebContext {
  rng?: Rng;
}
