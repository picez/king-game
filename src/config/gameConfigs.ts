import type { GameConfig } from '../models/types';
import { ALL_MODES } from './gameModes';

// 3-player configuration: 32-card deck, 10 cards/player, 2-card kitty
const BASE_3P: Omit<GameConfig, 'modeSelectionType'> = {
  playerCount: 3,
  deckSize: 32,
  cardsPerPlayer: 10,
  kittySize: 2,
  tricksPerRound: 10,
  modes: ALL_MODES,
  scoring: {
    perTrick:            -4,
    perHeart:            -5,
    perQueen:            -10,
    perJack:             -10,
    kingOfHearts:        -40,
    perLastTrick:        -20,
    trumpRewardPerTrick:  8,
  },
};

// 4-player configuration: 52-card deck, 13 cards/player, no kitty
const BASE_4P: Omit<GameConfig, 'modeSelectionType'> = {
  playerCount: 4,
  deckSize: 52,
  cardsPerPlayer: 13,
  kittySize: 0,
  tricksPerRound: 13,
  modes: ALL_MODES,
  scoring: {
    perTrick:            -4,
    perHeart:            -4,
    perQueen:            -13,
    perJack:             -13,
    kingOfHearts:        -52,
    perLastTrick:        -26,
    trumpRewardPerTrick:  4,
  },
};

export function getConfig(
  playerCount: 3 | 4,
  modeSelectionType: 'fixed' | 'dealer_choice' = 'fixed',
): GameConfig {
  const base = playerCount === 3 ? BASE_3P : BASE_4P;
  return { ...base, modeSelectionType };
}
