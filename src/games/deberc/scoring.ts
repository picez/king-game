// ---------------------------------------------------------------------------
// Deberc — hand scoring: card points (+ last-trick bonus) and meld points,
// aggregated per team. See DEBERC_RULES.md §2, §4, §6. Pure.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { cardPoints } from './deck';
import { scoringDeclaredMelds } from './melds';
import type { DebercMeld } from './types';

/** Extra points for winning the last trick (останній хабар). */
export const LAST_TRICK_BONUS = 10;
/** Bella (trump K+Q) value. */
export const BELLA_POINTS = 20;

export interface HandScoreInput {
  /** Cards each seat won in tricks this hand. */
  wonCards: Card[][];
  trumpSuit: Suit;
  /** Seat that won the final (9th) trick. */
  lastTrickWinnerSeat: number;
  /** Team index of each seat, and the number of teams. */
  teamOf: number[];
  teamCount: number;
  /**
   * The WINNING declared sequence melds (terz/platina) this hand — the §4
   * hierarchy has already been applied (only the highest-nominal declared
   * holder(s) per kind reveal and reach here). Losing announcements score 0.
   */
  declaredSequences: DebercMeld[];
  /** Seats that score the bella (declared it, hold trump K+Q, AND won a trick with one). */
  bellaSeats: number[];
}

export interface HandScoreResult {
  /** Total hand points per team (cards + last trick + melds + bella). */
  teamPoints: number[];
  /** Card points (incl. last-trick bonus) per team. */
  cardPoints: number[];
  /** Meld points (winning declared sequences + earned bella) per team. */
  meldPoints: number[];
}

/** Sum of card points for a set of cards, given the trump suit. */
export function sumCardPoints(cards: Card[], trumpSuit: Suit): number {
  return cards.reduce((acc, c) => acc + cardPoints(c, trumpSuit), 0);
}

/**
 * Score one hand into per-team totals: each seat's won-card points (plus the
 * +10 last-trick bonus) go to its team, then scoring sequences (by the §4
 * hierarchy) and any earned bella are added.
 */
export function scoreHand(input: HandScoreInput): HandScoreResult {
  const { wonCards, trumpSuit, lastTrickWinnerSeat, teamOf, teamCount, declaredSequences, bellaSeats } = input;

  const cardPts = Array<number>(teamCount).fill(0);
  const meldPts = Array<number>(teamCount).fill(0);

  wonCards.forEach((cards, seat) => {
    cardPts[teamOf[seat]] += sumCardPoints(cards, trumpSuit);
  });
  cardPts[teamOf[lastTrickWinnerSeat]] += LAST_TRICK_BONUS;

  // Only the WINNING declared sequences reach here (§4 hierarchy already applied).
  for (const meld of scoringDeclaredMelds(declaredSequences)) {
    meldPts[teamOf[meld.seatIndex]] += meld.points;
  }
  for (const seat of bellaSeats) {
    meldPts[teamOf[seat]] += BELLA_POINTS;
  }

  const teamPoints = cardPts.map((c, t) => c + meldPts[t]);
  return { teamPoints, cardPoints: cardPts, meldPoints: meldPts };
}
