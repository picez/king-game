// ---------------------------------------------------------------------------
// Tarneeb — a simple, deterministic bot (TARNEEB_RULES.md §14). Correctness
// first, strength second: it always produces a LEGAL, non-crashing action, and a
// bot-only match terminates over any seed. No randomness of its own — every
// choice is a pure function of the (public + own-hand) state.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { rankValueOf, TARNEEB_SUITS } from './deck';
import {
  activeBidders,
  determineTrickWinner,
  getValidBids,
  getValidPlayableCards,
  isSoloTarneeb,
  MAX_BID,
  MIN_BID,
  partnerOfSeat,
} from './rules';
import type { TarneebAction, TarneebState } from './types';

/** The lowest contract a bot will open (Stage 27.0): humans may bid down to MIN_BID (3), but a
 *  bot only bids when it can plausibly make the traditional floor, to avoid over-committing. */
const BOT_BID_FLOOR = 7;

/** Solo (Stage 28.1): a lone declarer faces 3 opponents, so a bot opens only on a
 *  strong OWN hand (no partner contribution). Termination is still guaranteed by the
 *  `mustOpen` fallback below, so a raised floor never dead-locks the auction. */
const SOLO_BID_FLOOR = 6;

/** Assumed trick contribution from the unseen partner when estimating a bid (§14). */
const PARTNER_TRICKS = 3;

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
 * A conservative trick estimate for a hand if `trumpSuit` were trump, modelled
 * directly in TRICKS (not raw honour points) so the bid tracks plausible strength
 * and never runs away (§14: no reckless bids). Two sources of tricks:
 *  - long trumps: each trump past the third tends to make a trick (5-card trump
 *    ≈ 2 extra tricks), since spare trumps ruff side suits;
 *  - high cards: an ace ≈ 1 trick, a king ≈ ½, a queen ≈ ¼ — a little more when
 *    the honour is itself a trump (protected by the suit's length).
 * Deterministic and intentionally on the cautious side.
 */
function estimateTricks(hand: Card[], trumpSuit: Suit): number {
  const trumpLen = ofSuit(hand, trumpSuit).length;
  let tricks = Math.max(0, trumpLen - 3);
  for (const c of hand) {
    const trump = c.suit === trumpSuit;
    if (c.rank === 'A') tricks += 1;
    else if (c.rank === 'K') tricks += trump ? 0.75 : 0.5;
    else if (c.rank === 'Q') tricks += trump ? 0.5 : 0.25;
  }
  return tricks;
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

/** Cards of `list` that are NOT the trump suit (used to preserve trumps, §14). */
function nonTrumps(list: Card[], trumpSuit: Suit | null): Card[] {
  return list.filter((c) => c.suit !== trumpSuit);
}

/**
 * Choose a legal card to play (correctness first, light strategy, §14):
 *  - lead low from a side suit, keeping trumps back;
 *  - if the partner already holds the trick, throw the lowest card, sparing trumps;
 *  - else win as cheaply as possible, preferring a NON-trump winner so trumps are
 *    only spent when they actually gain the trick;
 *  - if we cannot win, discard the lowest card, again keeping trumps for later.
 */
function chooseCard(state: TarneebState, seat: number): Card {
  const legal = getValidPlayableCards(state, seat);
  const trick = state.currentTrick;
  const trump = state.trumpSuit;

  // Leading: lead a low card from a long side suit to conserve high cards / trumps.
  if (!trick || trick.plays.length === 0) {
    const side = nonTrumps(legal, trump);
    return lowestCard(side.length > 0 ? side : legal);
  }

  // Partner already winning → do not waste a high card, and spare a trump if a
  // plain discard is available. (Solo has no partner — everyone is an opponent —
  // so this branch is skipped and the bot tries to win / discards low below.)
  if (!isSoloTarneeb(state) && partnerWinning(state, seat)) {
    const side = nonTrumps(legal, trump);
    return lowestCard(side.length > 0 ? side : legal);
  }

  // Otherwise try to win as cheaply as possible; prefer to win WITHOUT a trump so
  // trumps are conserved for when nothing else takes the trick.
  const winners = legal.filter((c) => wouldWin(state, seat, c));
  if (winners.length > 0) {
    const sideWinners = nonTrumps(winners, trump);
    return lowestCard(sideWinners.length > 0 ? sideWinners : winners);
  }

  // Cannot win → discard the lowest card, keeping a trump back if we can.
  const side = nonTrumps(legal, trump);
  return lowestCard(side.length > 0 ? side : legal);
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

      // Solo (Stage 28.1): no partner, so estimate from the OWN hand only. Open on a
      // strong hand; otherwise pass — EXCEPT when we're the last bidder in and no one
      // has bid (`mustOpen`), where we must open (at ≥ MIN_BID) so the auction always
      // resolves to a declarer and a bot-only match terminates (no infinite redeal).
      if (isSoloTarneeb(state)) {
        if (valid.length === 0) return { type: 'PASS_BID' };
        const soloEstimate = Math.floor(estimateTricks(hand, bestSuit(hand)));
        const mustOpen = !state.highestBid && activeBidders(state).length === 1;
        if (soloEstimate >= SOLO_BID_FLOOR || mustOpen) {
          const cap = Math.max(MIN_BID, Math.min(MAX_BID, soloEstimate));
          const affordable = valid.filter((b) => b <= cap);
          if (affordable.length > 0) return { type: 'BID', amount: Math.max(...affordable) };
          if (mustOpen) return { type: 'BID', amount: Math.min(...valid) };
        }
        return { type: 'PASS_BID' };
      }
      // Estimate the TEAM's tricks: this hand's own strength in its best suit plus
      // a modest, fixed contribution from the (unseen) partner — a bid of 7 needs
      // more than half the tricks, so counting on the partner for a share is how a
      // sane opener reaches the floor (§14). We only enter the auction when the
      // team can plausibly make the minimum bid, and never bid above that estimate,
      // so weak hands pass instead of being forced up to 7.
      const suit = bestSuit(hand);
      const teamEstimate = Math.floor(estimateTricks(hand, suit) + PARTNER_TRICKS);
      // Bots stay conservative: even though HUMANS may now open at 3 (Stage 27.0), a bot only
      // enters the auction when it plausibly makes the traditional floor of 7 — bidding a low
      // contract just to win the auction over-commits the team. Never bids above its estimate.
      if (teamEstimate < BOT_BID_FLOOR) return { type: 'PASS_BID' };
      const cap = Math.min(MAX_BID, teamEstimate);
      const affordable = valid.filter((b) => b <= cap);
      if (affordable.length === 0) return { type: 'PASS_BID' };
      return { type: 'BID', amount: Math.max(...affordable) };
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
