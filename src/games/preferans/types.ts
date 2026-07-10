// ---------------------------------------------------------------------------
// Preferans — pure core types (Stage 19.1). Completely separate from King, Durak,
// Deberc, and Tarneeb. See PREFERANS_RULES.md (v0.1 MVP) for the source of truth.
// If code disagrees with that document, the code is wrong.
//
// MVP: 3 players, 32-card deck, 10 each + a 2-card talon (прикуп), an ascending
// contract auction (levels 6–10 × suits ♠<♣<♦<♥<NT), compulsory whist, all-pass →
// redeal, simplified single-score scoring (RULES §10). No misère / распасы / whist
// phase in the MVP.
// ---------------------------------------------------------------------------

import type { Card, PlayerType, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';

export type { Card } from '../../models/types';

/** A contract's trump: a real suit, or 'NT' for No-Trump. */
export type ContractSuit = Suit | 'NT';

/**
 * Match phases (RULES §13):
 *  - 'bidding'       → the ascending auction is in progress;
 *  - 'talon'         → the declarer takes the talon → discards 2 → declares a contract;
 *  - 'playing'       → the 10 tricks are being played;
 *  - 'hand_complete' → the hand is scored; START_NEXT_HAND begins the next one;
 *  - 'game_finished' → a player reached the target score (winnerSeat set, or null on a draw).
 */
export type PreferansPhase = 'bidding' | 'talon' | 'playing' | 'hand_complete' | 'game_finished';

/** A contract bid: level (6–10 = tricks) × suit/NT. */
export interface Bid {
  level: number;
  suit: ContractSuit;
}

export interface PreferansPlayer {
  id: string;            // 'player-<seat>' (matches the other games' seat ids)
  name: string;
  seatIndex: number;     // 0..2
  type: PlayerType;
  // Hands live in `handsBySeat` (single source of truth, redaction-friendly).
}

/** One card played into the current trick by a seat. */
export interface PreferansPlay {
  seat: number;
  card: Card;
  playOrder: number;     // 1-based order within the trick
}

/** The trick in progress (or the just-resolved one). */
export interface PreferansTrick {
  leadSeat: number;
  ledSuit: Suit | null;  // null until the first card sets it
  plays: PreferansPlay[];
  winnerSeat: number | null;
}

export interface PreferansOptions {
  /** Score a player must reach to end the match (RULES §11). Default 10. */
  targetScore: number;
}

/** Summary of a scored hand (RULES §13) — PUBLIC, score-only (no cards). */
export interface PreferansHandResult {
  handNumber: number;
  declarerSeat: number;
  contract: Bid;
  declarerTricks: number;
  /** Whether the contract was made (declarerTricks >= contract.level). */
  made: boolean;
  /** Score change applied per seat this hand (length 3). */
  deltaBySeat: number[];
}

export interface PreferansState {
  gameType: 'preferans';
  phase: PreferansPhase;

  players: PreferansPlayer[];             // exactly 3
  dealerSeat: number;
  /** Whose turn it is to act (bid / talon step / play). */
  currentSeat: number;

  /** Each seat's private hand (redacted online, §14). 10 cards; the declarer holds
   *  12 briefly between TAKE_TALON and DISCARD. */
  handsBySeat: Card[][];
  /** The 2-card talon (прикуп) — hidden from everyone; emptied on TAKE_TALON. */
  talon: Card[];
  /** The declarer's 2 face-down discards — hidden from everyone (MVP). */
  discards: Card[];

  // ── auction ──
  /** Auction history this hand (bids and passes, in order). */
  bids: { seat: number; bid: Bid | null }[]; // bid null = passed (final)
  /** Whether each seat has passed (and is out of the auction). */
  passed: boolean[];
  /** The current best bid + its seat, or null until the first bid. */
  highBid: (Bid & { seat: number }) | null;

  // ── contract ──
  declarerSeat: number | null;
  /** The final contract (trump = suit, or NT); null until DECLARE_CONTRACT. */
  contract: Bid | null;

  // ── play ──
  currentTrick: PreferansTrick | null;
  completedTricks: PreferansTrick[];
  /** Tricks won per seat this hand (sums to completedTricks.length). */
  tricksBySeat: number[];

  // ── scoring ──
  scores: number[];                       // cumulative per-seat score (may be negative)
  handNumber: number;
  targetScore: number;
  options: PreferansOptions;
  lastHand: PreferansHandResult | null;
  /** Score-only history of every scored hand (public; feeds future stats). */
  handHistory: PreferansHandResult[];
  /** Winning seat once finished; null while playing OR on a draw at/over target. */
  winnerSeat: number | null;
}

export type PreferansAction =
  | {
      type: 'START_GAME';
      playerNames: string[];              // 3 names
      playerTypes?: PlayerType[];         // defaults to 'human'
      options?: Partial<PreferansOptions>;
      dealerSeat?: number;                // optional explicit first dealer (tests)
    }
  /** A legal bid strictly above the current high bid. Seat = currentSeat. */
  | { type: 'BID'; level: number; suit: ContractSuit }
  /** Permanently drop out of the current auction. Seat = currentSeat. */
  | { type: 'PASS_BID' }
  /** Declarer takes the 2 talon cards into hand (→ 12). Seat = currentSeat = declarer. */
  | { type: 'TAKE_TALON' }
  /** Declarer discards exactly 2 cards (→ 10). Seat = currentSeat = declarer. */
  | { type: 'DISCARD'; cards: [Card, Card] }
  /** Declarer names the final contract (≥ the winning bid); enter playing. */
  | { type: 'DECLARE_CONTRACT'; level: number; suit: ContractSuit }
  /** Play one legal card into the current trick. Seat = currentSeat. */
  | { type: 'PLAY_CARD'; card: Card }
  /** Advance from hand_complete to the next hand (rotates dealer left). */
  | { type: 'START_NEXT_HAND' };

/** Reducer context — inject an rng for a deterministic, reproducible shuffle. */
export interface PreferansContext {
  rng?: Rng;
}
