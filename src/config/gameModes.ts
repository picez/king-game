import type { GameMode, GameModeId, ModeCounts } from '../models/types';

export const ALL_MODES: GameMode[] = [
  { id: 'no_tricks',       name: 'No Tricks',       type: 'negative', trumpSuit: null },
  { id: 'no_hearts',       name: 'No Hearts',       type: 'negative', trumpSuit: null },
  { id: 'no_queens',       name: 'No Queens',       type: 'negative', trumpSuit: null },
  { id: 'no_jacks',        name: 'No Jacks',        type: 'negative', trumpSuit: null },
  { id: 'king_of_hearts',  name: 'King of Hearts',  type: 'negative', trumpSuit: null },
  { id: 'last_two_tricks', name: 'Last Two Tricks', type: 'negative', trumpSuit: null },
  { id: 'trump',           name: 'Trump',           type: 'positive', trumpSuit: null },
];

/**
 * Each dealer's personal set of games (KING_RULES.md): 6 negative modes once
 * each plus Trump three times = 9 games per dealer.
 */
export const DEALER_MODE_COUNTS: ModeCounts = {
  no_tricks: 1,
  no_hearts: 1,
  no_queens: 1,
  no_jacks: 1,
  king_of_hearts: 1,
  last_two_tricks: 1,
  trump: 3,
};

/** Fixed-order expansion of a dealer's personal set (9 entries). */
export const DEALER_MODE_ORDER: GameModeId[] = [
  'no_tricks',
  'no_hearts',
  'no_queens',
  'no_jacks',
  'king_of_hearts',
  'last_two_tricks',
  'trump',
  'trump',
  'trump',
];

/** Total games each dealer plays (= sum of DEALER_MODE_COUNTS). */
export const GAMES_PER_DEALER = DEALER_MODE_ORDER.length;

/** Returns a fresh copy of one dealer's starting mode counts. */
export function freshDealerModeCounts(): ModeCounts {
  return { ...DEALER_MODE_COUNTS };
}
