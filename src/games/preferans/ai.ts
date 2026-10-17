// ---------------------------------------------------------------------------
// Preferans — a simple, deterministic bot (PREFERANS_RULES.md §15). Correctness
// first, strength second: it always produces a LEGAL, non-crashing action, and a
// bot-only match terminates over any seed. No randomness of its own — every choice
// is a pure function of the (public + own-hand) state.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { PREFERANS_SUITS, rankValue, rankValueOf } from './deck';
import { canBidMisere, determineTrickWinner, getValidPlayableCards, handTrumpSuit } from './rules';
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
  return determineTrickWinner(hypothetical, trick.ledSuit as Suit, handTrumpSuit(state)) === seat;
}

/** The highest card (by rank) of a non-empty list. */
function highestCard(cards: Card[]): Card {
  let high = cards[0];
  for (const c of cards) if (rankValue(c) > rankValue(high)) high = c;
  return high;
}

/**
 * Ducking play for a seat that wants NO tricks — the misère declarer and everyone in
 * распасы (RULES §5a/§7a): lead low; follow with the highest card that still loses;
 * when every card would win, get rid of the highest.
 */
function duckCard(state: PreferansState, seat: number, legal: Card[]): Card {
  const trick = state.currentTrick;
  if (!trick || trick.plays.length === 0) return lowestCard(legal);
  const losers = legal.filter((c) => !wouldWin(state, seat, c));
  return highestCard(losers.length > 0 ? losers : legal);
}

/** Highest card rank a hand may hold and still bid misère (the bot is cautious). */
const MISERE_MAX_RANK = rankValueOf('10');

/** Choose a legal card: lead low; else win as cheaply as possible; else discard low. */
function chooseCard(state: PreferansState, seat: number): Card {
  const legal = getValidPlayableCards(state, seat);
  if (state.allPass || (state.contract?.misere && seat === state.declarerSeat)) return duckCard(state, seat, legal);
  // Defending a misère: play low and let the declarer be the one forced to win.
  if (state.contract?.misere) return lowestCard(legal);
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
      // With распасы on, an all-pass is a scored hand too (the sum still rises), so
      // the bot may let it happen.
      if (lastActiveNoBid && !state.options.allPass) return { type: 'BID', level, suit };

      // A hand with nothing above a ten is a misère hand (the rule allows it only
      // as this seat's first bid — canBidMisere checks that and the host option).
      if (canBidMisere(state, seat) && hand.every((c) => rankValue(c) <= MISERE_MAX_RANK)) {
        return { type: 'BID', level: 0, suit: 'NT', misere: true };
      }

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
        // A misère sheds its two most dangerous (highest) cards; a contract its weakest.
        const sorted = state.handsBySeat[seat].slice().sort((a, b) => rankValue(a) - rankValue(b));
        const [c1, c2] = state.highBid?.misere ? sorted.slice(-2) : lowestN(state.handsBySeat[seat], 2);
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
