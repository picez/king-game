// ---------------------------------------------------------------------------
// Durak — pure core types (Stage 9.1). Completely separate from King's
// GameState/reducer. See DURAK_RULES.md for the source of truth.
// ---------------------------------------------------------------------------

import type { Card, Suit, PlayerType } from '../../models/types';
import type { Rng } from '../../core/rng';

export type { Card } from '../../models/types';

/** Simple = no transfer; Transfer = same-rank "перевод" to the next player. */
export type DurakVariant = 'simple' | 'transfer';

/**
 * Whose move it is:
 *  - 'attack'   → the current thrower (`throwerIndex`) opens / throws in a
 *                 matching rank, or passes (DURAK_RULES.md — priority throw-in);
 *  - 'defense'  → the defender beats an unbeaten card / takes / (transfer) passes;
 *  - 'taking'   → the defender chose to TAKE; attackers may still throw in matching
 *                 ranks (priority order) before the defender collects the table;
 *  - 'finished' → game over (see foolId / isDraw).
 */
export type DurakStatus = 'attack' | 'defense' | 'taking' | 'finished';

export interface DurakPlayer {
  id: string;            // 'player-<seat>' (matches King's seat ids)
  name: string;
  seatIndex: number;
  type: PlayerType;
  hand: Card[];
}

/** One attack card and the card that beat it (null = still unbeaten). */
export interface TablePair {
  attack: Card;
  defense: Card | null;
}

export interface DurakState {
  gameType: 'durak';
  variant: DurakVariant;
  players: DurakPlayer[];
  /** Draw pile; index 0 is the next card drawn, the trump card sits at the bottom. */
  drawPile: Card[];
  trumpSuit: Suit;
  /** The face-up trump card at the bottom of the draw pile (last to be drawn). */
  trumpCard: Card;
  /** The PRIMARY attacker (the opener) — leads draws; opens each bout. */
  attackerIndex: number;
  defenderIndex: number;
  /** The attacker whose turn it is to throw or pass right now. */
  throwerIndex: number;
  /** The seat that most recently ADDED a card — throw-in priority anchors here. */
  lastThrowerIndex: number;
  /** Seats that have passed in the CURRENT throw-in cycle (reset when a card is added). */
  passedAttackers: number[];
  /** Attack/defense pairs currently in play. */
  table: TablePair[];
  /** Beaten cards, out of the game ("бито"). */
  discardPile: Card[];
  /**
   * DISPLAY-ONLY (Stage 29.2): the attack/defense pairs of the JUST-resolved bout,
   * captured the instant the table is cleared (a successful defense or a take). The
   * bout resolves in the same reducer action that places the final defence, so the
   * client never otherwise sees the fully-beaten table — the UI lingers on this for
   * ~2 s so the last beat/take is readable. Only PUBLIC table cards; no rule reads it.
   * Absent until the first bout resolves.
   */
  lastBout?: TablePair[];
  status: DurakStatus;
  /** Max attacking cards this bout = min(6, defender hand size at bout start). */
  boutLimit: number;
  /**
   * Transfer variant only (DURAK_RULES.md §3a): whether the one-time "trump-show"
   * transfer has already been used in the CURRENT bout. A defender may transfer by
   * merely SHOWING a matching-rank trump (not placing it) at most once per bout;
   * any later trump transfer must place the card. Reset to false at each new bout.
   */
  trumpShowUsed: boolean;
  /**
   * Public announcement of the most recent trump-show transfer this bout (the seat
   * that showed + the shown card), or null. The shown card is fully PUBLIC by rule
   * (it equals trumpSuit + the public attack rank, so it leaks nothing hidden), yet
   * stays in the shower's hand. Cleared at each new bout. Redaction keeps it as-is.
   */
  lastTrumpShow: { seat: number; card: Card } | null;
  /** The loser ('player-N') once finished; null while playing or on a draw. */
  foolId: string | null;
  /** Players who finished safely (everyone but the fool); all players on a draw. */
  winnerIds: string[];
  /** Finished with no fool (last players emptied simultaneously). */
  isDraw: boolean;
}

export type DurakAction =
  | { type: 'START_DURAK'; playerNames: string[]; playerTypes?: PlayerType[]; variant: DurakVariant }
  | { type: 'ATTACK_CARD'; card: Card }
  | { type: 'DEFEND_CARD'; attack: Card; card: Card }
  | { type: 'TAKE_CARDS' }
  /** The current thrower passes (gives up their throw-in). Was 'END_ATTACK'. */
  | { type: 'PASS_ATTACK' }
  | { type: 'TRANSFER_ATTACK'; card: Card }
  /**
   * Transfer variant §3a: transfer the bout by SHOWING a matching-rank trump —
   * the card is NOT placed on the table and stays in hand. Legal at most once per
   * bout. `card` must be the defender's trump of the current attack rank.
   */
  | { type: 'TRUMP_SHOW_TRANSFER'; card: Card };

/** Reducer context — inject an rng for a deterministic, reproducible shuffle. */
export interface DurakContext {
  rng?: Rng;
}
