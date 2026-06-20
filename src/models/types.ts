export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

export type PlayerType = 'human' | 'ai';

export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A';

export type GameModeId =
  | 'no_tricks'
  | 'no_hearts'
  | 'no_queens'
  | 'no_jacks'
  | 'king_of_hearts'
  | 'last_two_tricks'
  | 'trump';

export type ModeType = 'negative' | 'positive';

export type GameStatus =
  | 'playing'
  | 'trick_complete'
  | 'round_scoring'
  | 'select_trump'
  | 'kitty_exchange'
  | 'mode_selection'
  | 'game_finished';

export interface Card {
  suit: Suit;
  rank: Rank;
  /** Numeric rank order for comparison within the same suit. */
  value: number;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  seatIndex: number;
  isDealer: boolean;
  type: PlayerType;
}

export interface GameMode {
  id: GameModeId;
  name: string;
  type: ModeType;
  /** Set after dealer selects trump suit. Null for non-trump modes or No Trump variant. */
  trumpSuit: Suit | null;
}

export interface ScoringConfig {
  perTrick: number;
  perHeart: number;
  perQueen: number;
  perJack: number;
  kingOfHearts: number;
  perLastTrick: number;
  trumpRewardPerTrick: number;
}

export interface GameConfig {
  playerCount: 3 | 4;
  deckSize: 32 | 52;
  cardsPerPlayer: number;
  kittySize: number;
  tricksPerRound: number;
  scoring: ScoringConfig;
  /** Ordered list of all 7 game modes (PRD §8). */
  modes: GameMode[];
  /** Whether the dealer picks the mode each round or follows a fixed queue. */
  modeSelectionType: 'fixed' | 'dealer_choice';
}

export interface TrickPlay {
  playerId: string;
  card: Card;
  playOrder: number;
}

export interface Trick {
  trickNumber: number;
  leadPlayerId: string;
  ledSuit: Suit;
  plays: TrickPlay[];
  winnerId: string | null;
}

export interface Round {
  roundNumber: number;
  mode: GameMode;
  dealerId: string;
  /** Cards set aside (3-player negative modes). Empty for 4-player or trump mode. */
  kitty: Card[];
  /**
   * Cards the dealer discarded after taking the kitty. They leave the game
   * (not scored, not playable) but are kept so the dealer can privately review
   * them. Private to the dealer in sanitized state (see redactStateFor).
   */
  discard: Card[];
  tricks: Trick[];
  collectedCards: Record<string, Card[]>;
  scores: Record<string, number>;
  status: 'playing' | 'complete';
  /** Set to the player id who conceded, if the round ended by surrender. */
  surrenderedBy?: string;
}

export interface Score {
  playerId: string;
  roundScores: number[];
  total: number;
}

export interface ModeQueueEntry {
  modeId: GameModeId;
  dealerIdx: number;
}

/**
 * Remaining count of each mode a single dealer may still choose. Each dealer
 * owns a personal set of 9 games: 6 negative modes (×1) plus Trump (×3).
 */
export type ModeCounts = Record<GameModeId, number>;

/**
 * One completed round, kept for the score-tracker table. Holds ONLY scores
 * (never hands/cards), so it is safe to send to every client and to persist.
 */
export interface RoundRecord {
  roundNumber: number;
  dealerId: string;
  modeId: GameModeId;
  /** 1..3 for the dealer's n-th Trump game this game; 0 for non-Trump modes. */
  trumpOccurrence: number;
  /** Each player's score for this round (playerId → points). */
  scoreByPlayer: Record<string, number>;
}

export interface GameState {
  config: GameConfig;
  players: Player[];
  scores: Record<string, Score>;
  modeQueue: ModeQueueEntry[];
  currentRoundIdx: number;
  currentRound: Round;
  currentTrick: Trick | null;
  /** Index of the player who leads the current (or next) trick. */
  currentLeaderIdx: number;
  dealerIndex: number;
  status: GameStatus;
  trumpSuit: Suit | null;
  /** Dealer's expanded hand during kitty_exchange (10 + 2 kitty cards). */
  kittyForExchange: Card[];
  /**
   * Per-dealer remaining mode counts, keyed by playerId. Each dealer chooses
   * only from their own set; one dealer's choice never affects another's.
   */
  dealerModes: Record<string, ModeCounts>;
  /**
   * Append-only history of completed rounds (scores only) powering the
   * score-tracker table. Survives serialize/restore. Older persisted states may
   * lack this field — read it as `?? []`.
   */
  roundHistory: RoundRecord[];
}
