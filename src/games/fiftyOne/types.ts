// ---------------------------------------------------------------------------
// 51 (Syrian 51) — pure core types. Completely separate from King, Durak,
// Deberc, Tarneeb, and Preferans. See 51_RULES.md for the source of truth. If
// the code disagrees with that document, the code is wrong (or the spec is
// updated first, deliberately).
//
// Stage 30.1: pure core ONLY — no catalog/registry, no UI, no server/ws, no
// stats. Internal id `fiftyOne`, future `game_type='fifty-one'`.
// ---------------------------------------------------------------------------

import type { PlayerType, Rank, Suit } from '../../models/types';
import type { Rng } from '../../core/rng';

export type { PlayerType, Rank, Suit } from '../../models/types';

/**
 * A single 51 card. Two kinds:
 *  - a normal card carries `joker: false` with a concrete `suit` + `rank`;
 *  - a joker carries `joker: true` with `suit: null`, `rank: null`.
 *
 * `id` is unique across the WHOLE deck so that with two decks the two physical
 * copies of (say) 9♥ stay distinguishable — normal ids look like `0-hearts-9`
 * / `1-hearts-9` (deck index prefix), jokers are `joker-0` / `joker-1`.
 */
export interface FiftyOneCard {
  id: string;
  joker: boolean;
  suit: Suit | null;
  rank: Rank | null;
}

export type FiftyOneMeldType = 'run' | 'set';

/**
 * What a joker at a given index inside a laid meld represents — the concrete
 * card it stands in for (§8). Kept explicit so redaction can reveal it and
 * scoring can value it (a joker in a meld = the value of the card it
 * represents, NOT 25). Keyed by the joker's index within `meld.cards`.
 */
export interface JokerRepresentation {
  suit: Suit;
  rank: Rank;
}

export interface FiftyOneMeld {
  id: string;
  ownerSeat: number;
  type: FiftyOneMeldType;
  /** The physical cards in the meld. Runs are stored low→high. */
  cards: FiftyOneCard[];
  /** index-in-`cards` → the card that joker represents (only for joker slots). */
  jokerRepresents: Record<number, JokerRepresentation>;
  /** Current meld point value (§10) — sum of represented card values. */
  value: number;
}

/**
 * Phases of a 51 match:
 *  - 'playing'         → a round is in progress (draw → meld → discard turns);
 *  - 'round_complete'  → the round was scored; START_NEXT_ROUND deals the next;
 *  - 'game_finished'   → only one player remains un-eliminated (winnerSeat set).
 */
export type FiftyOnePhase = 'playing' | 'round_complete' | 'game_finished';

/**
 * The two steps of a normal turn (§5), enforced by the reducer:
 *  - 'draw'         → the player MUST draw (deck, or discard-top if opened)
 *                     before doing anything else;
 *  - 'meld_discard' → the player MAY open/add to melds, then MUST discard
 *                     exactly one card to end the turn.
 * The starter's very first turn begins directly at 'meld_discard' (they hold 14
 * cards and open the round by discarding, without drawing — §4).
 */
export type FiftyOneTurnStep = 'draw' | 'meld_discard';

export interface FiftyOnePlayer {
  id: string;            // 'player-<seat>' (matches the other games' seat ids)
  name: string;
  seatIndex: number;
  type: PlayerType;
  // Hands live in `handsBySeat` (single source of truth, redaction-friendly).
}

export interface FiftyOneOptions {
  /** Running-penalty elimination threshold (§12). MVP fixed default 510. */
  targetPenalty: number;
}

/** Per-seat penalty applied for one round (public; no cards) — for the UI. */
export interface FiftyOneRoundResult {
  roundNumber: number;
  winnerSeat: number;
  /** Penalty added to each seat this round (length playerCount). Winner = 0. */
  penaltyBySeat: number[];
  /** Whether each seat was "never opened" and so took the flat 100 (§11). */
  neverOpenedBySeat: boolean[];
  /** Seats newly eliminated by this round's scoring (crossed the target). */
  newlyEliminated: number[];
}

export interface FiftyOneState {
  gameType: 'fifty-one';
  phase: FiftyOnePhase;

  /** 2–4 (§2). Decides the deck size (§3) and seat count. */
  playerCount: number;
  players: FiftyOnePlayer[];

  /** The dealer this round; rotates one active seat clockwise per round (§4). */
  dealerSeat: number;
  /** The seat dealt 14 cards, who opens the round by discarding first (§4). */
  starterSeat: number;
  /** Whose turn it is to act. */
  currentSeat: number;
  /** Which step of the current turn we are in (§5). */
  turnStep: FiftyOneTurnStep;

  /** Each seat's private hand (redacted online, §14). Eliminated seats = []. */
  handsBySeat: FiftyOneCard[][];
  /** Face-down draw pile; the top (next drawn) is the LAST element. */
  drawPile: FiftyOneCard[];
  /** Discard pile; the top (takeable / most recent) is the LAST element. */
  discardPile: FiftyOneCard[];

  /** Whether each seat has opened (laid its first ≥51 melds) this round (§7). */
  openedBySeat: boolean[];
  /** All melds currently on the table (public), with joker representations. */
  publicMelds: FiftyOneMeld[];

  /** Cumulative running penalty per seat (lower is better, §12). */
  scoresBySeat: number[];
  /** Whether each seat has been eliminated (running penalty ≥ target, §12). */
  eliminatedSeats: boolean[];

  /** 1-based round counter (increments on START_NEXT_ROUND). */
  roundNumber: number;
  /** The seat that emptied its hand this round, or null. */
  roundWinnerSeat: number | null;
  /** The match winner (last seat standing), or null until finished. */
  winnerSeat: number | null;
  /** The most recently scored round (public; no cards), or null. */
  lastRound: FiftyOneRoundResult | null;

  options: FiftyOneOptions;
}

export type FiftyOneAction =
  | {
      type: 'START_GAME';
      playerNames: string[];              // length must equal playerCount
      playerTypes?: PlayerType[];         // defaults to 'human'
      playerCount?: number;               // 2–4, defaults to playerNames.length
      options?: Partial<FiftyOneOptions>;
      /** Optional explicit first dealer (for tests); random via rng otherwise. */
      dealerSeat?: number;
    }
  /** Draw the top of the draw pile (reshuffles from discard if empty). Turn step must be 'draw'. */
  | { type: 'DRAW_FROM_DECK' }
  /** Take the top discard card into hand — only AFTER opening (§5). Turn step 'draw'. */
  | { type: 'TAKE_DISCARD' }
  /**
   * Take the top discard card AND open with it in one atomic action (§5/§7, owner
   * rule 30.13). Legal only for an UNOPENED seat at the 'draw' step: the top discard
   * card MUST appear in `melds`, the melds must total ≥ 51 and leave ≥ 1 card to
   * discard. This is the ONLY way an unopened seat may take the discard — you may
   * never take it "just into hand" before opening. Advances to 'meld_discard'.
   */
  | { type: 'TAKE_DISCARD_AND_OPEN'; melds: FiftyOneCard[][] }
  /**
   * Lay one or more valid melds from hand. Each inner array is one meld,
   * referenced by card id; must leave ≥ 1 card in hand for the discard. BEFORE
   * opening, the combined value must total ≥ 51 (the §7 opening rule) and this
   * flips the seat to "opened". AFTER opening (once per round), the SAME action
   * lays any valid meld with no 51 minimum (§7/§9, owner rule 30.9).
   */
  | { type: 'OPEN_MELDS'; melds: FiftyOneCard[][] }
  /** Lay off card(s) onto an existing public meld — only after opening (§9). */
  | { type: 'ADD_TO_MELD'; meldId: string; cards: FiftyOneCard[] }
  /** Discard exactly one card to end the turn; empties hand ⇒ round win (§5). */
  | { type: 'DISCARD'; card: FiftyOneCard }
  /** Advance from round_complete to the next round (skips eliminated seats). */
  | { type: 'START_NEXT_ROUND' };

/** Reducer context — inject an rng for a deterministic shuffle / reshuffle. */
export interface FiftyOneContext {
  rng?: Rng;
}
