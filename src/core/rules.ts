import type { Card, GameModeId, Suit, Trick } from '../models/types';

/**
 * Returns the cards the player is legally allowed to play.
 *
 * `modeId` enables the "no leading hearts" rule for No Hearts / King of Hearts:
 * a player leading a trick may not lead a heart while holding any non-heart
 * card (KING_RULES.md). Following suit is unaffected.
 *
 * `trumpSuit` enables the **Trump forced-ruff** rule: in Trump mode, a player
 * who cannot follow the led suit MUST play a trump if they hold one. (When the
 * led suit is itself the trump suit, ordinary follow-suit already covers it;
 * with No Trump, `trumpSuit` is null and any off-suit card is allowed.)
 *
 * Both `modeId` and `trumpSuit` are optional for backward compatibility.
 */
export function getValidCards(
  hand: Card[],
  ledSuit: Suit | null,
  modeId?: GameModeId,
  trumpSuit?: Suit | null,
): Card[] {
  if (!ledSuit) {
    // Leading: in heart-penalty modes you can't open with hearts unless that's
    // all you have left.
    if (modeId === 'no_hearts' || modeId === 'king_of_hearts') {
      const nonHearts = hand.filter((c) => c.suit !== 'hearts');
      if (nonHearts.length > 0) return nonHearts;
    }
    return hand;
  }
  const suited = hand.filter((c) => c.suit === ledSuit);
  if (suited.length > 0) return suited; // must follow suit
  // Cannot follow: Trump mode forces a ruff if the player holds a trump.
  if (modeId === 'trump' && trumpSuit && ledSuit !== trumpSuit) {
    const trumps = hand.filter((c) => c.suit === trumpSuit);
    if (trumps.length > 0) return trumps;
  }
  return hand; // no led suit and (no trump / not trump mode) → anything
}

export function isValidPlay(
  card: Card,
  hand: Card[],
  ledSuit: Suit | null,
  modeId?: GameModeId,
  trumpSuit?: Suit | null,
): boolean {
  return getValidCards(hand, ledSuit, modeId, trumpSuit).some((c) => cardEquals(c, card));
}

/**
 * Resolves a completed trick and returns the winner's playerId.
 * Trump cards (if any) override the led suit.
 */
export function resolveTrick(trick: Trick, trumpSuit: Suit | null): string {
  const { plays, ledSuit } = trick;

  if (trumpSuit) {
    const trumpPlays = plays.filter((p) => p.card.suit === trumpSuit);
    if (trumpPlays.length > 0) {
      return trumpPlays.reduce((best, p) =>
        p.card.value > best.card.value ? p : best,
      ).playerId;
    }
  }

  const ledPlays = plays.filter((p) => p.card.suit === ledSuit);
  // ledPlays always has at least one card (the leader's card)
  return ledPlays.reduce((best, p) =>
    p.card.value > best.card.value ? p : best,
  ).playerId;
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

/** Returns a new hand array with the given card removed (first occurrence). */
export function removeCardFromHand(hand: Card[], card: Card): Card[] {
  const idx = hand.findIndex((c) => cardEquals(c, card));
  if (idx === -1) return hand;
  return [...hand.slice(0, idx), ...hand.slice(idx + 1)];
}

/** Sorts a hand by suit (♠♥♦♣) then by rank (ascending). */
export function sortHand(hand: Card[]): Card[] {
  const suitOrder: Record<string, number> = {
    spades: 0, hearts: 1, diamonds: 2, clubs: 3,
  };
  return [...hand].sort((a, b) => {
    const sd = suitOrder[a.suit] - suitOrder[b.suit];
    return sd !== 0 ? sd : a.value - b.value;
  });
}
