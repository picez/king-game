// ---------------------------------------------------------------------------
// Deberc — pure core types. Completely separate from King and Durak.
// See DEBERC_RULES.md for the source of truth.
// ---------------------------------------------------------------------------

import type { Card, Rank, Suit, PlayerType } from '../../models/types';
import type { Rng } from '../../core/rng';

export type { Card } from '../../models/types';

/** Match target: small = 510, big = 1020 (DEBERC_RULES.md header). */
export type DebercMatchSize = 'small' | 'big';

/**
 * Phase of a hand:
 *  - 'bidding'        → choosing trump on the 6-card hands (table round, then free);
 *  - 'declaring'      → after прикуп is taken (→9 cards), each seat declares its
 *                       terz/platina/deberc melds (or passes) before the first card;
 *  - 'playing'        → the 9-trick play is under way;
 *  - 'trick_complete' → a trick just resolved, awaiting acknowledgement;
 *  - 'hand_scoring'   → the hand ended; scores/ХВ/бейт applied, awaiting next deal;
 *  - 'finished'       → the match is over (target reached or a деберц jackpot).
 */
export type DebercPhase =
  | 'bidding'
  | 'declaring'
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
  /** Top card (nominal) of the sequence — ranks equal-band melds (§4). */
  topValue: number;
  /** Whether the meld is in the trump suit (breaks ties in favour of trump). */
  isTrump: boolean;
  /**
   * v1.3: whether this DECLARED meld is shown to everyone. A player announces
   * kind + nominal without showing cards; when the declaring phase resolves, only
   * the winning holder(s) per kind reveal their cards (redaction strips the cards
   * of unrevealed melds from other viewers). Losers announced but do not reveal.
   */
  revealed: boolean;
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

  /**
   * The face-up trump card on the table (shows the round-1 table-trump suit).
   * 4 players: it is a card inside the dealer's `prykup` (picked up with it when
   * trumps are taken). 3 players: it is the top of the undealt `stock` and is
   * never taken. Never counted as a separate card (see deberc-card-accounting).
   */
  tableTrumpCard: Card;
  /** Cards left on the table after the deal (undealt stock; 9 for 3p, 0 for 4p). */
  stock: Card[];
  /**
   * Each seat's face-down 3-card прикуп (talon) packet, dealt alongside the 6-card
   * hand. Bidding happens on the 6-card hands; on trump commit every seat merges
   * its packet into its hand (→9 cards) and the packet is emptied. Hidden from all
   * viewers until taken (redaction). Counted toward the 36-card total while unmerged.
   */
  prykup: Card[][];
  /** Chosen trump suit; null until bidding commits one. */
  trumpSuit: Suit | null;
  /** Trump exchange (Stage 27.2): true once the low trump has been swapped for the table trump
   *  this hand (once per hand); `trumpExchangedBy` names the seat for the public note. */
  trumpExchanged: boolean;
  trumpExchangedBy: number | null;

  /** The current об'яз seat (obligated maker; judged for ХВ). Updated on bid interception. */
  objazSeat: number;
  /**
   * The initial об'яз for the hand = the "dealer" position (rotates to the winner
   * of the previous hand). Anchors the bidding order (dealer speaks last). The
   * final об'яз (`objazSeat`) leads the first trick.
   */
  dealerSeat: number;
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
  /** Melds that scored this hand (populated at hand_scoring; for display). */
  melds: DebercMeld[];

  /** Declaring phase: whose turn it is to declare melds (starts at the об'яз). */
  meldTurnSeat: number;
  /**
   * Every meld ANNOUNCED this hand (v1.3 — truthful, no bluff). Each is validated
   * against the seat's real hand at declaration, so it always exists. During the
   * declaring phase all announcements are public (seat + kind + nominal), but the
   * cards of an unrevealed meld are stripped for other viewers (redaction). When
   * declaring resolves, the winning holder(s) per kind get `revealed: true`.
   */
  declaredMelds: DebercMeld[];
  /** Which seats have finished declaring (or passing) this hand. */
  meldsDone: boolean[];

  /**
   * Snapshot of each seat's full 9-card hand at the moment play began. Melds are
   * evaluated from these (the live `players[].hand` empties as cards are played).
   */
  dealtHands: Card[][];
  /** Seats holding the bella (trump K+Q) at play start — eligible to earn it. */
  bellaEligible: number[];
  /** Seats that actually earned the bella (won a trick with a trump K or Q). */
  bellaEarned: number[];

  /** Running match score per team. */
  matchScore: number[];
  /**
   * ХВ / бейт cumulative counts per team (§7). The first mark of a kind is free;
   * each subsequent mark of the same kind already had its −100 deducted from
   * `matchScore`. NOTE (owner naming fix 2026-07-08): the label shown to players
   * is SWAPPED — the об'яз-underperform mark stored in `hvMarks` displays as
   * "Бейт", and the zero-tricks mark in `beitMarks` displays as "ХВ" (see the
   * swapped `deberc.hv` / `deberc.beit` i18n values). The internal field names
   * and mechanics (point redirect + role transfer stay with об'яз-underperform)
   * are unchanged.
   */
  hvMarks: number[];
  beitMarks: number[];

  /** Summary of the most recently scored hand (for the score table / UI). */
  lastHand: DebercHandResult | null;
  /**
   * Every scored hand of the match, in order (for the per-hand score sheet).
   * Accumulates across the whole match — a new deal does NOT reset it. Holds
   * copies of scored results (no cards), so it is NOT part of the card count.
   */
  handHistory: DebercHandResult[];

  /**
   * How the FIRST об'яз was chosen (§3, hand 1 only, for display/immersion): each
   * seat was assigned a suit (`suitOf[seat]`) and one was drawn at random
   * (`drawnSuit`) — the seat holding it deals first. Set once at match start and
   * left in place (it only describes hand 1). Public (no cards).
   */
  firstDealerDraw?: { suitOf: Suit[]; drawnSuit: Suit };

  /** Once finished: winning team index, or null while playing. */
  winnerTeam: number | null;
  /** True when the match ended via a деберц jackpot rather than the target. */
  jackpot: boolean;
}

/** Per-hand result summary produced when a hand is scored (§6, §7). */
export interface DebercHandResult {
  /** Final hand points per team (after any ХВ redirection). */
  teamPoints: number[];
  /** Card points (incl. last-trick bonus) per team, before ХВ redirection. */
  cardPoints: number[];
  /** Meld points (winning declared sequences + earned bella) per team. */
  meldPoints: number[];
  /** Team that received an ХВ this hand, or null. */
  hvTeam: number | null;
  /** Teams that took zero tricks (бейт). */
  beitTeams: number[];
  /** Winner of the hand — becomes the next об'яз's team. */
  topScorerTeam: number;
  /** The об'яз (obligated maker) seat for this hand — for the score sheet. */
  objazSeat: number;
  /** The dealer (роздаючий) seat for this hand — for the score sheet. */
  dealerSeat: number;
  /**
   * Aggregate-only tally of the melds that SCORED this hand (seat + kind, NO cards)
   * — feeds combination statistics (Stage 13.8). Optional/back-compat: absent on
   * legacy results, treated as an empty list. Never any card/rank/suit data.
   */
  meldTally?: { seat: number; kind: DebercMeldKind }[];
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
  /**
   * The acting seat's meld announcements for the hand (v1.3 — truthful, no bluff).
   * Each names a `kind` and, for a sequence, its top `topRank` (nominal, e.g. a
   * "терц до K") plus optionally the `suit` of the run (so a hand may announce TWO
   * sequences of the same kind in different suits); `bella` carries no rank. The
   * engine VALIDATES every announcement against the seat's real hand — an unheld
   * meld is illegal (rejected). An empty list = pass. The §4 contest is between
   * SIDES: an OPPOSING team's stronger declared sequence shuts out a weaker one,
   * but a seat's own multiple sequences all score. A truthful `deberc` (run ≥ 8)
   * ends the match immediately.
   */
  | { type: 'DECLARE_MELD'; melds: { kind: DebercMeldKind; topRank?: Rank; suit?: Suit }[] }
  /**
   * Trump exchange (Stage 27.2, §6a): the acting seat swaps its LOWEST trump (7 for 3p, 6 for
   * 4p) for the face-up table trump, before it declares. Turn-gated to the current declarer (so
   * only the lone holder of the low trump can do it, on their declaring turn). Once per hand.
   */
  | { type: 'EXCHANGE_TRUMP' }
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
