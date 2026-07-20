// ---------------------------------------------------------------------------
// Deberc — melds: sequences (терц / платіна / деберц) and the bella.
// See DEBERC_RULES.md §4. Pure detection + ranking; the engine decides which
// declared melds actually score using the hierarchy helpers here.
// ---------------------------------------------------------------------------

import type { Card, Rank, Suit } from '../../models/types';
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
    revealed: false,
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

/** Band strength: деберц > платіна > терц (DEBERC_RULES.md §4). Bella is separate. */
const BAND_RANK: Record<DebercMeldKind, number> = { bella: 0, terz: 1, platina: 2, deberc: 3 };

/**
 * Compare two sequence melds by the hierarchy (DEBERC_RULES.md §4, v1.6):
 * higher BAND wins (деберц > платіна > терц); then, WITHIN a band, the LONGER run
 * wins (owner rule Stage 30.16 — a 5-card палтіна beats any 4-card палтіна); then
 * higher top card; then trump beats non-trump. Терці are always length 3, so
 * терц-vs-терц still reduces to top card. Returns >0 if `a` is stronger, <0 if
 * `b`, 0 if equal (same band + length + top, both non-trump) — both then score.
 */
export function compareSequences(a: DebercMeld, b: DebercMeld): number {
  if (BAND_RANK[a.kind] !== BAND_RANK[b.kind]) return BAND_RANK[a.kind] - BAND_RANK[b.kind];
  if (a.cards.length !== b.cards.length) return a.cards.length - b.cards.length; // longer run wins (v1.6)
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
 * The §4 contest is between DIFFERENT SIDES: a seat scores unless an OPPOSING
 * team holds a strictly stronger sequence. A player's own melds never cancel each
 * other. Equal, both-non-trump sequences (compare === 0) all score; a strictly
 * stronger opposing sequence shuts the rest out — a lone платіна/деберц cancels
 * opponents' терці. `teamOf` maps seat → team; omit it and each seat is its own
 * team (the 3-player case).
 */
export function scoringSequenceSeats(best: (DebercMeld | null)[], teamOf?: number[]): number[] {
  const present = best
    .map((m, seat) => ({ m, seat }))
    .filter((x): x is { m: DebercMeld; seat: number } => x.m != null);
  if (present.length === 0) return [];
  const team = (seat: number) => (teamOf ? teamOf[seat] : seat);

  return present
    .filter(({ m, seat }) => !present.some((o) => team(o.seat) !== team(seat) && compareSequences(o.m, m) > 0))
    .map(({ seat }) => seat);
}

// --- Declared melds (v1.3 — truthful: announce kind + nominal) ---------------

/**
 * Every same-suit run (≥3) a hand holds — one per suit (its longest run). The UI
 * shows these as the melds the human can TRUTHFULLY announce (each with its
 * nominal = top card). Bots pick their best from here (`detectBestSequence`).
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
 * Validate and reconstruct a declared SEQUENCE meld from `kind` + `topRank`
 * against the seat's real hand (v1.3, no bluff). Returns the meld (its real
 * cards) if the seat holds a same-suit run whose natural band is `kind` and whose
 * top card rank is `topRank`; otherwise null (an illegal, unheld announcement).
 * Bella is handled by `hasBella` — this only builds sequences.
 */
export function announcedMeld(
  hand: Card[],
  seatIndex: number,
  kind: DebercMeldKind,
  topRank: Rank,
  trumpSuit: Suit | null,
  suit?: Suit,
): DebercMeld | null {
  if (kind === 'bella') return null;
  // When a suit is given (the UI knows which run it announced), validate only that
  // suit — this lets a hand announce TWO sequences of the same kind in different
  // suits (e.g. two терці), which a kind+nominal alone could not disambiguate.
  const suits = suit ? [suit] : DEBERC_SUITS;
  for (const s of suits) {
    const run = longestRunInSuit(hand.filter((c) => c.suit === s));
    if (!run) continue;
    if (sequenceKind(run.length) === kind && run[run.length - 1].rank === topRank) {
      return toMeld(seatIndex, run, s, trumpSuit);
    }
  }
  return null;
}

/**
 * Which of the valid DECLARED sequence melds actually score: a meld scores unless
 * an OPPOSING team's declared meld is strictly stronger (higher band / top /
 * trump). A player's own melds never cancel each other — so a single seat holding
 * two терці, or a платіна and a терц, scores BOTH (owner rule 2026-07-08). Equal
 * cross-team melds both score. `teamOf` maps seat → team; omit it and each seat is
 * its own team (the 3-player case), so any strictly stronger meld shuts out a
 * weaker one — the plain §4 hierarchy.
 */
export function scoringDeclaredMelds(melds: DebercMeld[], teamOf?: number[]): DebercMeld[] {
  const team = (m: DebercMeld) => (teamOf ? teamOf[m.seatIndex] : m.seatIndex);
  return melds.filter((m) => !melds.some((o) => team(o) !== team(m) && compareSequences(o, m) > 0));
}
