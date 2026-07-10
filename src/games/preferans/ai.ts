// ---------------------------------------------------------------------------
// Preferans — a simple, deterministic bot (PREFERANS_RULES.md §15). Correctness
// first, strength second: it always produces a LEGAL, non-crashing action, and a
// bot-only match terminates over any seed. No randomness of its own — every choice
// is a pure function of the (public + own-hand) state.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { PREFERANS_SUITS, rankValue } from './deck';
import { determineTrickWinner, getValidPlayableCards, trumpSuitOf } from './rules';
import type { Bid, PreferansAction, PreferansState } from './types';

/** The suit the hand is longest in (length first; suit order breaks ties — §5). */
function longestSuit(hand: Card[]): { suit: Suit; length: number } {
  let best: Suit = PREFERANS_SUITS[0];
  let bestLen = -1;
  for (const suit of PREFERANS_SUITS) {
    const len = hand.filter((c) => c.suit === suit).length;
    if (len > bestLen) { bestLen = len; best = suit; }
  }
  return { suit: best, length: bestLen };
}

/** The lowest card (by rank) of a non-empty list — deterministic within a hand. */
function lowestCard(cards: Card[]): Card {
  let low = cards[0];
  for (const c of cards) if (rankValue(c) < rankValue(low)) low = c;
  return low;
}

/** The `n` lowest cards of a hand (by rank), deterministic. */
function lowestN(hand: Card[], n: number): Card[] {
  return hand.slice().sort((a, b) => rankValue(a) - rankValue(b)).slice(0, n);
}

/** Whether playing `card` would currently take the trick (cheapest-winner search). */
function wouldWin(state: PreferansState, seat: number, card: Card): boolean {
  const trick = state.currentTrick;
  if (!trick || trick.plays.length === 0) return true; // leading "wins" so far
  const hypothetical = [...trick.plays, { seat, card, playOrder: trick.plays.length + 1 }];
  return determineTrickWinner(hypothetical, trick.ledSuit as Suit, trumpSuitOf(state.contract as Bid)) === seat;
}

/** Choose a legal card: lead low; else win as cheaply as possible; else discard low. */
function chooseCard(state: PreferansState, seat: number): Card {
  const legal = getValidPlayableCards(state, seat);
  const trick = state.currentTrick;
  if (!trick || trick.plays.length === 0) return lowestCard(legal); // lead low
  const winners = legal.filter((c) => wouldWin(state, seat, c));
  if (winners.length > 0) return lowestCard(winners); // cheapest winning card
  return lowestCard(legal); // cannot win → discard low
}

/**
 * The bot's action for the current state. `seat` must be the acting seat
 * (state.currentSeat); callers should only invoke this on the bot's turn.
 */
export function preferansBotAction(state: PreferansState, seat: number): PreferansAction {
  switch (state.phase) {
    case 'bidding': {
      // Open the MINIMUM contract (level 6) in the longest suit when it is at least
      // 4 long AND that bid outranks the current high bid; otherwise pass. Conservative
      // — it never escalates a suit-6 auction, so most hands get exactly one bidder
      // (the declarer) and the auction resolves quickly.
      const hand = state.handsBySeat[seat];
      const { suit, length } = longestSuit(hand);
      const level = 6;

      // Termination guard: if THIS seat passing would trigger an all-pass redeal
      // (no bid yet AND every other seat has already passed), open the minimum
      // contract in the longest suit instead. With no high bid a level-6 bid is
      // always legal, so a bot-only auction ALWAYS produces a declarer — the score
      // sum then strictly rises each hand and the match is guaranteed to terminate
      // in bounded hands (never an endless redeal loop).
      const lastActiveNoBid = state.highBid == null && state.passed.every((p, i) => i === seat || p);
      if (lastActiveNoBid) return { type: 'BID', level, suit };

      if (length < 4) return { type: 'PASS_BID' };
      if (state.highBid) {
        // Only bid if a level-6 in our longest suit is strictly above the high bid.
        const order = ['spades', 'clubs', 'diamonds', 'hearts', 'NT'];
        const rankOf = (b: { level: number; suit: string }) => (b.level - 6) * 5 + order.indexOf(b.suit);
        if (rankOf({ level, suit }) <= rankOf(state.highBid)) return { type: 'PASS_BID' };
      }
      return { type: 'BID', level, suit };
    }

    case 'talon': {
      if (state.talon.length > 0) return { type: 'TAKE_TALON' };
      if (state.discards.length === 0) {
        const [c1, c2] = lowestN(state.handsBySeat[seat], 2);
        return { type: 'DISCARD', cards: [c1, c2] };
      }
      // Declare the minimum: exactly the winning bid (§6).
      const min = state.highBid as Bid;
      return { type: 'DECLARE_CONTRACT', level: min.level, suit: min.suit };
    }

    case 'playing':
      return { type: 'PLAY_CARD', card: chooseCard(state, seat) };

    case 'hand_complete':
      return { type: 'START_NEXT_HAND' };

    default:
      // game_finished — no action; caller should not reach here.
      return { type: 'START_NEXT_HAND' };
  }
}
