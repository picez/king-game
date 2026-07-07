// ---------------------------------------------------------------------------
// Deberc — pure core types. Completely separate from King and Durak.
// See DEBERC_RULES.md for the source of truth.
// ---------------------------------------------------------------------------

import type { Card, Suit, PlayerType } from '../../models/types';
import type { Rng } from '../../core/rng';

export type { Card } from '../../models/types';

/** Match target: small = 510, big = 1020 (DEBERC_RULES.md header). */
export type DebercMatchSize = 'small' | 'big';

/**
 * Phase of a hand:
 *  - 'bidding'        → choosing trump (table trump round, then free round);
 *  - 'playing'        → the 9-trick play is under way;
 *  - 'trick_complete' → a trick just resolved, awaiting acknowledgement;
 *  - 'hand_scoring'   → the hand ended; scores/ХВ/бейт applied, awaiting next deal;
 *  - 'finished'       → the match is over (target reached or a деберц jackpot).
 */
export type DebercPhase =
  | 'bidding'
  | 'playing'
  | 'trick_complete'
  | 'hand_scoring'
  | 'finished';

export interface DebercPlayer {
  id: string;            // 'player-<seat>' (matches King/Durak seat ids)
  name: string;
  seatIndex: number;
  type: PlayerType;
  hand: Card[];
}

/** One card played into the current trick by a seat. */
export interface DebercPlay {
  seatIndex: number;
  card: Card;
  playOrder: number;     // 1-based order within the trick
}

/** The trick currently being played (or the just-resolved one). */
export interface DebercTrick {
  leadSeat: number;
  ledSuit: Suit;
  plays: DebercPlay[];
  winnerSeat: number | null;
}

/** A declared meld (sequence or bella) belonging to one seat. */
export type DebercMeldKind = 'terz' | 'platina' | 'deberc' | 'bella';

export interface DebercMeld {
  seatIndex: number;
  kind: DebercMeldKind;
  /** Points the meld is worth (bella 20, terz 20, platina 50; deberc = jackpot). */
  points: number;
  /** Sequence cards (for terz/platina/deberc); the bella's K+Q for 'bella'. */
  cards: Card[];
  /** Top card of the sequence — used to rank equal-length melds. */
  topValue: number;
  /** Whether the meld is in the trump suit (breaks ties in favour of trump). */
  isTrump: boolean;
}

/** A single bid during the trump-choosing phase. */
export interface DebercBid {
  seatIndex: number;
  /** null = passed; otherwise the suit this player committed to as trump. */
  suit: Suit | null;
  /** Whether this was the table-trump round (1) or the free round (2). */
  round: 1 | 2;
}

export interface DebercState {
  gameType: 'deberc';
  matchSize: DebercMatchSize;
  players: DebercPlayer[];
  /**
   * Team of each seat: 3 players → each its own team ([0,1,2]); 4 players →
   * partners opposite ([0,1,0,1] so seats 0&2 vs 1&3). Indexed by seatIndex.
   */
  teamOf: number[];
  /** Number of distinct teams (3 for 3p, 2 for 4p). */
  teamCount: number;

  phase: DebercPhase;

  /** The face-up trump card on the table (the об'яз's talon top). */
  tableTrumpCard: Card;
  /** Cards left on the table after the deal (unused stock). */
  stock: Card[];
  /** Chosen trump suit; null until bidding commits one. */
  trumpSuit: Suit | null;

  /** The current об'яз seat (obligated maker; judged for ХВ). */
  objazSeat: number;
  /** Bidding: whose turn to bid; bids collected so far this hand. */
  bidderSeat: number;
  bids: DebercBid[];
  bidRound: 1 | 2;

  /** Play: the current/last trick and whose turn it is to play. */
  currentTrick: DebercTrick | null;
  turnSeat: number;
  /** Cards each seat has won in tricks this hand (for card-point scoring). */
  wonCards: Card[][];
  /** Tricks completed this hand (max 9). */
  tricksPlayed: number;
  /** Seats that have taken at least one trick this hand (for бейт detection). */
  seatsWithTricks: number[];
  /** Melds declared this hand. */
  melds: DebercMeld[];

  /** Running match score per team. */
  matchScore: number[];
  /** ХВ / бейт tallies per team (uncompleted marks; pairs already deducted). */
  hvMarks: number[];
  beitMarks: number[];

  /** Once finished: winning team index, or null while playing. */
  winnerTeam: number | null;
  /** True when the match ended via a деберц jackpot rather than the target. */
  jackpot: boolean;
}

export type DebercAction =
  | {
      type: 'START_DEBERC';
      playerNames: string[];
      playerTypes?: PlayerType[];
      matchSize: DebercMatchSize;
    }
  /** A bid during the bidding phase: commit to `suit`, or pass with suit=null. */
  | { type: 'BID'; suit: Suit | null }
  /** Declare a meld the player holds (before/at first play — see engine). */
  | { type: 'DECLARE_MELD'; kind: DebercMeldKind; cards: Card[] }
  /** Play a card into the current trick. */
  | { type: 'PLAY_CARD'; card: Card }
  /** Acknowledge a resolved trick (advance from 'trick_complete'). */
  | { type: 'NEXT_TRICK' }
  /** Advance from 'hand_scoring' to the next deal. */
  | { type: 'NEXT_HAND' };

/** Reducer context — inject an rng for a deterministic, reproducible shuffle. */
export interface DebercContext {
  rng?: Rng;
}
