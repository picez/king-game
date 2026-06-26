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
 *  - 'finished' → game over (see foolId / isDraw).
 */
export type DurakStatus = 'attack' | 'defense' | 'finished';

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
  /** The PRIMARY attacker (the opener) — has throw-in priority and leads draws. */
  attackerIndex: number;
  defenderIndex: number;
  /** The attacker whose turn it is to throw or pass right now (priority throw-in). */
  throwerIndex: number;
  /** Seats that have passed this bout (cannot throw again until the next bout). */
  passedAttackers: number[];
  /** Attack/defense pairs currently in play. */
  table: TablePair[];
  /** Beaten cards, out of the game ("бито"). */
  discardPile: Card[];
  status: DurakStatus;
  /** Max attacking cards this bout = min(6, defender hand size at bout start). */
  boutLimit: number;
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
  | { type: 'TRANSFER_ATTACK'; card: Card };

/** Reducer context — inject an rng for a deterministic, reproducible shuffle. */
export interface DurakContext {
  rng?: Rng;
}
