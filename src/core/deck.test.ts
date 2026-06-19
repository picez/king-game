import { describe, it, expect } from 'vitest';
import { createDeck, validateDeck, dealCards, shuffleDeck } from './deck';

describe('createDeck', () => {
  it('builds a 32-card deck with no duplicates', () => {
    const deck = createDeck(32);
    expect(deck).toHaveLength(32);
    expect(validateDeck(deck, 32)).toBe(true);
    const keys = new Set(deck.map((c) => `${c.suit}:${c.rank}`));
    expect(keys.size).toBe(32);
  });

  it('builds a 52-card deck with no duplicates', () => {
    const deck = createDeck(52);
    expect(deck).toHaveLength(52);
    expect(validateDeck(deck, 52)).toBe(true);
    const keys = new Set(deck.map((c) => `${c.suit}:${c.rank}`));
    expect(keys.size).toBe(52);
  });

  it('assigns ascending rank values within a suit', () => {
    const deck = createDeck(32);
    const spades = deck.filter((c) => c.suit === 'spades');
    // 32-card deck ranks: 7..A → values 1..8
    expect(spades.map((c) => c.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(spades.find((c) => c.rank === 'A')!.value).toBeGreaterThan(
      spades.find((c) => c.rank === 'K')!.value,
    );
  });
});

describe('validateDeck', () => {
  it('rejects a deck with a wrong size', () => {
    const deck = createDeck(32).slice(0, 31);
    expect(validateDeck(deck, 32)).toBe(false);
  });

  it('rejects a deck containing a duplicate card', () => {
    const deck = createDeck(32);
    deck[1] = { ...deck[0] }; // duplicate the first card
    expect(validateDeck(deck, 32)).toBe(false);
  });
});

describe('shuffleDeck', () => {
  it('keeps the same multiset of cards', () => {
    const deck = createDeck(52);
    const shuffled = shuffleDeck(deck);
    expect(shuffled).toHaveLength(52);
    expect(validateDeck(shuffled, 52)).toBe(true);
    expect(shuffled).not.toBe(deck); // returns a new array
  });
});

describe('dealCards', () => {
  it('deals 10 cards to each of 3 players plus a 2-card kitty', () => {
    const deck = createDeck(32);
    const { hands, kitty } = dealCards(deck, 3, 10, 2, 0);
    expect(hands).toHaveLength(3);
    for (const h of hands) expect(h).toHaveLength(10);
    expect(kitty).toHaveLength(2);

    // Every card is dealt exactly once (30 hands + 2 kitty = 32).
    const all = [...hands.flat(), ...kitty];
    expect(validateDeck(all, 32)).toBe(true);
  });

  it('deals 13 cards to each of 4 players with no kitty', () => {
    const deck = createDeck(52);
    const { hands, kitty } = dealCards(deck, 4, 13, 0, 0);
    expect(hands).toHaveLength(4);
    for (const h of hands) expect(h).toHaveLength(13);
    expect(kitty).toHaveLength(0);
    expect(validateDeck(hands.flat(), 52)).toBe(true);
  });

  it('starts dealing from the player to the dealer\'s left', () => {
    const deck = createDeck(32);
    const dealerIdx = 1;
    const { hands } = dealCards(deck, 3, 10, 2, dealerIdx);
    // First card of the deck goes to (dealerIdx + 1) % 3 = player 2.
    expect(hands[2][0]).toEqual(deck[0]);
  });
});
