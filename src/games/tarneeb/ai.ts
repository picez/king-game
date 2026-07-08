// ---------------------------------------------------------------------------
// Tarneeb — a simple, deterministic bot (TARNEEB_RULES.md §14). Correctness
// first, strength second: it always produces a LEGAL, non-crashing action, and a
// bot-only match terminates over any seed. No randomness of its own — every
// choice is a pure function of the (public + own-hand) state.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { rankValueOf, TARNEEB_SUITS } from './deck';
import {
  determineTrickWinner,
  getValidBids,
  getValidPlayableCards,
  MAX_BID,
  MIN_BID,
  partnerOfSeat,
} from './rules';
import type { TarneebAction, TarneebState } from './types';

/** High-card weight of a rank for hand-strength estimates (A=4, K=3, Q=2, J=1). */
function honourWeight(rank: string): number {
  switch (rank) {
    case 'A':
      return 4;
    case 'K':
      return 3;
    case 'Q':
      return 2;
    case 'J':
      return 1;
    default:
      return 0;
  }
}

/** Cards of a suit held in a hand. */
function ofSuit(hand: Card[], suit: Suit): Card[] {
  return hand.filter((c) => c.suit === suit);
}

/**
 * A rough trick estimate for a hand if `trumpSuit` were trump: honour weight
 * across the hand plus a length bonus for long suits (extra trumps and long
 * side-suits pull tricks). Deterministic and intentionally conservative.
 */
function estimateTricks(hand: Card[], trumpSuit: Suit): number {
  let score = 0;
  for (const c of hand) {
    score += honourWeight(c.rank);
    if (c.suit === trumpSuit) score += 0.5; // every trump has value
  }
  // Length bonus: each card past the 4th in a suit is likely a trick with trump help.
  for (const suit of TARNEEB_SUITS) {
    const len = ofSuit(hand, suit).length;
    if (len > 4) score += (len - 4) * 1.2;
  }
  // Calibrate honour points (~3 per expected trick) into a trick count.
  return score / 3;
}

/** The suit this hand is strongest in (length first, high cards break ties). */
function bestSuit(hand: Card[]): Suit {
  let best: Suit = TARNEEB_SUITS[0];
  let bestScore = -1;
  for (const suit of TARNEEB_SUITS) {
    const cards = ofSuit(hand, suit);
    const score = cards.length * 2 + cards.reduce((sum, c) => sum + honourWeight(c.rank), 0);
    if (score > bestScore) {
      bestScore = score;
      best = suit;
    }
  }
  return best;
}

/** The lowest card (by rank) of a list — deterministic (ties impossible in a hand). */
function lowestCard(cards: Card[]): Card {
  let low = cards[0];
  for (const c of cards) {
    if (rankValueOf(c.rank) < rankValueOf(low.rank)) low = c;
  }
  return low;
}

/**
 * Whether playing `card` would take the current trick, given the cards already
 * on the table this trick. Used to find the cheapest winning card.
 */
function wouldWin(
  state: TarneebState,
  seat: number,
  card: Card,
): boolean {
  const trick = state.currentTrick;
  if (!trick || trick.plays.length === 0) return true; // leading always "wins" so far
  const ledSuit = trick.ledSuit as Suit;
  const hypothetical = [
    ...trick.plays,
    { seat, card, playOrder: trick.plays.length + 1 },
  ];
  return determineTrickWinner(hypothetical, ledSuit, state.trumpSuit) === seat;
}

/** Whether the current trick is presently being won by this seat's partner. */
function partnerWinning(state: TarneebState, seat: number): boolean {
  const trick = state.currentTrick;
  if (!trick || trick.plays.length === 0) return false;
  const ledSuit = trick.ledSuit as Suit;
  const leader = determineTrickWinner(trick.plays, ledSuit, state.trumpSuit);
  return leader === partnerOfSeat(seat);
}

/** Choose a legal card to play (correctness first, light strategy). */
function chooseCard(state: TarneebState, seat: number): Card {
  const legal = getValidPlayableCards(state, seat);
  const trick = state.currentTrick;

  // Leading: lead a low card from a long side suit to conserve high cards / trumps.
  if (!trick || trick.plays.length === 0) {
    const nonTrump = legal.filter((c) => c.suit !== state.trumpSuit);
    const pool = nonTrump.length > 0 ? nonTrump : legal;
    return lowestCard(pool);
  }

  // Partner already winning → do not waste a high card; play the lowest legal card.
  if (partnerWinning(state, seat)) return lowestCard(legal);

  // Otherwise try to win as cheaply as possible; if we cannot, discard low.
  const winners = legal.filter((c) => wouldWin(state, seat, c));
  if (winners.length > 0) return lowestCard(winners);
  return lowestCard(legal);
}

/**
 * The bot's action for the current state. `seat` must be the acting seat
 * (state.currentSeat); callers should only invoke this on the bot's turn.
 */
export function tarneebBotAction(state: TarneebState, seat: number): TarneebAction {
  switch (state.phase) {
    case 'bidding': {
      const valid = getValidBids(state, seat);
      const hand = state.handsBySeat[seat];
      // Estimate tricks in the bot's strongest suit and bid up to that, but never
      // above what the hand can plausibly take (avoid guaranteed sets, §14).
      const suit = bestSuit(hand);
      const estimate = Math.floor(estimateTricks(hand, suit));
      const target = Math.max(MIN_BID, Math.min(MAX_BID, estimate));
      // Bid the highest legal amount we can justify; pass if we cannot reach it.
      const affordable = valid.filter((b) => b <= target);
      if (affordable.length > 0) {
        return { type: 'BID', amount: Math.max(...affordable) };
      }
      return { type: 'PASS_BID' };
    }

    case 'choosing_trump': {
      return { type: 'CHOOSE_TRUMP', suit: bestSuit(state.handsBySeat[seat]) };
    }

    case 'playing': {
      return { type: 'PLAY_CARD', card: chooseCard(state, seat) };
    }

    case 'hand_complete':
      return { type: 'START_NEXT_HAND' };

    default:
      // game_finished — no action; caller should not reach here.
      return { type: 'START_NEXT_HAND' };
  }
}
