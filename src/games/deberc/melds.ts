// ---------------------------------------------------------------------------
// Deberc — melds: sequences (терц / платіна / деберц) and the bella.
// See DEBERC_RULES.md §4. Pure detection + ranking; the engine decides which
// declared melds actually score using the hierarchy helpers here.
// ---------------------------------------------------------------------------

import type { Card, Suit } from '../../models/types';
import { seqValue, DEBERC_SUITS } from './deck';
import type { DebercMeld, DebercMeldKind } from './types';

/** Same-card test (suit + rank), local to avoid a rules.ts import cycle. */
function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

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

// --- Declared melds (v1.1 — sequences must be announced) --------------------

/**
 * Every same-suit run (≥3) a hand holds — one per suit (its longest run). Used by
 * the bot to declare all of its sequences during the declaring phase.
 */
export function detectAllSequences(
  hand: Card[],
  seatIndex: number,
  trumpSuit: Suit | null,
): DebercMeld[] {
  const melds: DebercMeld[] = [];
  for (const suit of DEBERC_SUITS) {
    const run = longestRunInSuit(hand.filter((c) => c.suit === suit));
    if (run) melds.push(toMeld(seatIndex, run, suit, trumpSuit));
  }
  return melds;
}

/**
 * Validate a seat's claimed meld against its actual hand and build the scored
 * DebercMeld, or return null if the claim is invalid. A valid claim is a
 * same-suit, contiguous run of length ≥3 whose every card the hand holds.
 * The kind/points are derived from the actual run length (the claimed `kind` is
 * advisory — the cards are the source of truth).
 */
export function buildDeclaredMeld(
  hand: Card[],
  seatIndex: number,
  cards: Card[],
  trumpSuit: Suit | null,
): DebercMeld | null {
  if (cards.length < 3) return null;
  const suit = cards[0].suit;
  if (!cards.every((c) => c.suit === suit)) return null;            // one suit only
  if (!cards.every((c) => hand.some((h) => sameCard(h, c)))) return null; // actually held
  const sorted = cards.slice().sort((a, b) => seqValue(a.rank) - seqValue(b.rank));
  for (let i = 1; i < sorted.length; i++) {
    if (seqValue(sorted[i].rank) !== seqValue(sorted[i - 1].rank) + 1) return null; // gap
  }
  if (new Set(sorted.map((c) => c.rank)).size !== sorted.length) return null; // no dup ranks
  return toMeld(seatIndex, sorted, suit, trumpSuit);
}

/**
 * Which of the DECLARED sequence melds actually score: a meld scores unless
 * another declared meld is strictly stronger (longer / higher top / trump). Equal
 * melds do not cancel each other (both score). A stronger declared meld (e.g. a
 * платіна) shuts out weaker declared ones (терці) — the §4 hierarchy, restricted
 * to what was announced. (деберц never reaches scoring — it ends the match.)
 */
export function scoringDeclaredMelds(melds: DebercMeld[]): DebercMeld[] {
  return melds.filter((m) => !melds.some((o) => o !== m && compareSequences(o, m) > 0));
}
