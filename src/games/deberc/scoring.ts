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
   * VALID declared sequence melds (terz/platina) this hand — the §4 hierarchy is
   * applied here (only the strongest declared holder scores). Bluffed claims are
   * NOT here; they arrive as `penaltyByTeam` instead (v1.2).
   */
  declaredSequences: DebercMeld[];
  /** Seats that score the bella (declared it, hold trump K+Q, AND won a trick with one). */
  bellaSeats: number[];
  /** False-claim penalties per team (each bluff = −50; v1.2). */
  penaltyByTeam: number[];
}

export interface HandScoreResult {
  /** Total hand points per team (cards + last trick + melds + bella − penalties). */
  teamPoints: number[];
  /** Card points (incl. last-trick bonus) per team. */
  cardPoints: number[];
  /** Meld points (valid declared sequences + earned bella) per team. */
  meldPoints: number[];
  /** False-claim penalties per team (already subtracted from teamPoints). */
  penaltyPoints: number[];
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
  const { wonCards, trumpSuit, lastTrickWinnerSeat, teamOf, teamCount, declaredSequences, bellaSeats, penaltyByTeam } = input;

  const cardPts = Array<number>(teamCount).fill(0);
  const meldPts = Array<number>(teamCount).fill(0);

  wonCards.forEach((cards, seat) => {
    cardPts[teamOf[seat]] += sumCardPoints(cards, trumpSuit);
  });
  cardPts[teamOf[lastTrickWinnerSeat]] += LAST_TRICK_BONUS;

  // Only DECLARED sequences score, and only the strongest declared holder(s) (§4).
  for (const meld of scoringDeclaredMelds(declaredSequences)) {
    meldPts[teamOf[meld.seatIndex]] += meld.points;
  }
  for (const seat of bellaSeats) {
    meldPts[teamOf[seat]] += BELLA_POINTS;
  }

  const penaltyPts = penaltyByTeam.slice();
  // A bluffed claim (−50) reduces the team's hand total (can go negative, v1.2).
  const teamPoints = cardPts.map((c, t) => c + meldPts[t] - penaltyPts[t]);
  return { teamPoints, cardPoints: cardPts, meldPoints: meldPts, penaltyPoints: penaltyPts };
}
