// ---------------------------------------------------------------------------
// Deberc — melds: sequences (терц / платіна / деберц) and the bella.
// See DEBERC_RULES.md §4. Pure detection + ranking; the engine decides which
// declared melds actually score using the hierarchy helpers here.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { seqValue, DEBERC_SUITS } from './deck';
import type { DebercMeld, DebercMeldKind } from './types';

/** Points for a sequence of the given length (деберц is a jackpot → 0 points). */
function sequencePoints(length: number): number {
  if (length >= 8) return 0;   // деберц — instant match win, no points
  if (length >= 4) return 50;  // платіна / п'ятдесят (4–7)
  return 20;                   // терц (3)
}

function sequenceKind(length: number): DebercMeldKind {
  if (length >= 8) return 'deberc';
  if (length >= 4) return 'platina';
  return 'terz';
}

/** The longest same-suit consecutive run (≥3) in `cards`, or null. */
function longestRunInSuit(cards: Card[]): Card[] | null {
  const sorted = cards.slice().sort((a, b) => seqValue(a.rank) - seqValue(b.rank));
  let best: Card[] = [];
  let run: Card[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (run.length === 0 || seqValue(sorted[i].rank) === seqValue(run[run.length - 1].rank) + 1) {
      run.push(sorted[i]);
    } else {
      run = [sorted[i]];
    }
    if (run.length > best.length) best = run.slice();
  }
  return best.length >= 3 ? best : null;
}

function toMeld(seatIndex: number, run: Card[], suit: Suit, trumpSuit: Suit | null): DebercMeld {
  return {
    seatIndex,
    kind: sequenceKind(run.length),
    points: sequencePoints(run.length),
    cards: run,
    topValue: seqValue(run[run.length - 1].rank),
    isTrump: trumpSuit != null && suit === trumpSuit,
  };
}

/**
 * The best sequence meld a hand holds (terz/platina/deberc), or null. When runs
 * tie on length, the higher top card wins, then trump breaks the tie.
 */
export function detectBestSequence(
  hand: Card[],
  seatIndex: number,
  trumpSuit: Suit | null,
): DebercMeld | null {
  let best: DebercMeld | null = null;
  for (const suit of DEBERC_SUITS) {
    const run = longestRunInSuit(hand.filter((c) => c.suit === suit));
    if (!run) continue;
    const meld = toMeld(seatIndex, run, suit, trumpSuit);
    if (best == null || compareSequences(meld, best) > 0) best = meld;
  }
  return best;
}

/**
 * Compare two sequence melds by the hierarchy (DEBERC_RULES.md §4):
 * longer wins; then higher top card; then trump beats non-trump. Returns
 * >0 if `a` is stronger, <0 if `b` is, 0 if they are equal (equal length + top,
 * both non-trump) — in which case both score.
 */
export function compareSequences(a: DebercMeld, b: DebercMeld): number {
  if (a.cards.length !== b.cards.length) return a.cards.length - b.cards.length;
  if (a.topValue !== b.topValue) return a.topValue - b.topValue;
  if (a.isTrump !== b.isTrump) return a.isTrump ? 1 : -1;
  return 0;
}

/** Whether a hand holds the bella (K + Q of the trump suit). */
export function hasBella(hand: Card[], trumpSuit: Suit | null): boolean {
  if (trumpSuit == null) return false;
  const hasK = hand.some((c) => c.suit === trumpSuit && c.rank === 'K');
  const hasQ = hand.some((c) => c.suit === trumpSuit && c.rank === 'Q');
  return hasK && hasQ;
}

/**
 * Given every seat's best sequence, return which seats' sequences actually score.
 * Only the strongest sequence-holder(s) score: a seat scores if no other seat has
 * a strictly stronger sequence. Equal, both-non-trump sequences (compare === 0)
 * all score; a strictly stronger sequence (longer/higher/trump) shuts the rest
 * out — which is why a lone платіна/деберц cancels everyone's терці.
 */
export function scoringSequenceSeats(best: (DebercMeld | null)[]): number[] {
  const present = best
    .map((m, seat) => ({ m, seat }))
    .filter((x): x is { m: DebercMeld; seat: number } => x.m != null);
  if (present.length === 0) return [];

  return present
    .filter(({ m }) => !present.some((o) => compareSequences(o.m, m) > 0))
    .map(({ seat }) => seat);
}
