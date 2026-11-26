import { deckCountFor, totalDeckSize } from '../../games/fiftyOne/deck';

/** The deck line for a 51 table size (§3): 1 / 2 / 3 decks + jokers = N cards. */
export function fiftyOneDeckNote(t: (key: string) => string, playerCount: number): string {
  const decks = deckCountFor(playerCount);
  const key = decks === 1 ? 'fiftyOne.deckNote2' : decks === 2 ? 'fiftyOne.deckNote34' : 'fiftyOne.deckNote56';
  return t(key).replace('{total}', String(totalDeckSize(playerCount)));
}
