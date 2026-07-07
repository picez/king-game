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

/** Band strength: деберц > платіна > терц (DEBERC_RULES.md §4). Bella is separate. */
const BAND_RANK: Record<DebercMeldKind, number> = { bella: 0, terz: 1, platina: 2, deberc: 3 };

/**
 * Compare two sequence melds by the hierarchy (DEBERC_RULES.md §4, v1.2):
 * higher BAND wins (деберц > платіна > терц); then higher top card; then trump
 * beats non-trump. Comparison is by band, NOT raw run length — so two платіни of
 * different lengths (both worth 50) are ranked by top card, per §8.2. Returns
 * >0 if `a` is stronger, <0 if `b`, 0 if equal (same band + top, both non-trump)
 * — in which case both score.
 */
export function compareSequences(a: DebercMeld, b: DebercMeld): number {
  if (BAND_RANK[a.kind] !== BAND_RANK[b.kind]) return BAND_RANK[a.kind] - BAND_RANK[b.kind];
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

// --- Declared melds (v1.2 — bluff: announce a KIND, held or not) -------------

/** The minimum run length for each sequence band. */
const BAND_MIN_LEN: Record<'terz' | 'platina' | 'deberc', number> = { terz: 3, platina: 4, deberc: 8 };

/**
 * Every same-suit run (≥3) a hand holds — one per suit (its longest run). Used by
 * the UI to show the human which sequences it can truthfully declare.
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

/** Points a VALID declared claim of `kind` scores (деберц is a jackpot → 0 here). */
export function kindPoints(kind: DebercMeldKind): number {
  return kind === 'platina' ? 50 : kind === 'deberc' ? 0 : 20; // terz & bella = 20
}

/**
 * The best same-suit run of length ≥ `minLen` a hand holds (highest top card,
 * trump breaking ties), or null. Used to validate a band claim and rank it.
 */
export function bestRunOfBand(
  hand: Card[],
  minLen: number,
  trumpSuit: Suit | null,
): { cards: Card[]; top: number; isTrump: boolean } | null {
  let best: { cards: Card[]; top: number; isTrump: boolean } | null = null;
  for (const suit of DEBERC_SUITS) {
    const run = longestRunInSuit(hand.filter((c) => c.suit === suit));
    if (!run || run.length < minLen) continue;
    const isTrump = trumpSuit != null && suit === trumpSuit;
    const top = seqValue(run[run.length - 1].rank);
    if (best == null || top > best.top || (top === best.top && isTrump && !best.isTrump)) {
      best = { cards: run, top, isTrump };
    }
  }
  return best;
}

/** Whether a hand truthfully holds a claim of `kind` (§4). */
export function holdsClaim(hand: Card[], kind: DebercMeldKind, trumpSuit: Suit | null): boolean {
  if (kind === 'bella') return hasBella(hand, trumpSuit);
  return bestRunOfBand(hand, BAND_MIN_LEN[kind], trumpSuit) != null;
}

/**
 * The claims a hand can TRUTHFULLY make (§4): the single best sequence band it
 * holds (deberc > platina > terz), plus 'bella' when it holds trump K+Q. Bots
 * declare exactly these, so a bot never bluffs (never incurs the −50 penalty).
 */
export function detectHeldKinds(hand: Card[], trumpSuit: Suit | null): DebercMeldKind[] {
  const claims: DebercMeldKind[] = [];
  if (bestRunOfBand(hand, BAND_MIN_LEN.deberc, trumpSuit)) claims.push('deberc');
  else if (bestRunOfBand(hand, BAND_MIN_LEN.platina, trumpSuit)) claims.push('platina');
  else if (bestRunOfBand(hand, BAND_MIN_LEN.terz, trumpSuit)) claims.push('terz');
  if (hasBella(hand, trumpSuit)) claims.push('bella');
  return claims;
}

/** A valid declared sequence claim, built at its claimed band (not the run length). */
function claimMeld(seatIndex: number, kind: DebercMeldKind, run: { cards: Card[]; top: number; isTrump: boolean }): DebercMeld {
  return { seatIndex, kind, points: kindPoints(kind), cards: run.cards, topValue: run.top, isTrump: run.isTrump };
}

export interface ResolvedDeclarations {
  /** Valid declared terz/platina melds (pre-hierarchy), for scoring/display. */
  seqMelds: DebercMeld[];
  /** Seats whose 'bella' claim is truthful (hold trump K+Q). */
  bellaSeats: number[];
  /** Count of FALSE (bluffed) claims per seat — each costs −50 at scoring. */
  falseBySeat: number[];
}

/**
 * Resolve every seat's raw claims against its actual dealt hand (v1.2). Truthful
 * terz/platina claims become scoring melds (at their claimed band); a truthful
 * bella claim marks the seat; every claim the seat does NOT hold is a bluff
 * counted in `falseBySeat` (−50 each at scoring). A truthful `deberc` is handled
 * at declaration (instant win), so here it scores nothing; a bluffed `deberc` is
 * a false claim. Claims are de-duplicated per seat (one button per kind).
 */
export function resolveDeclarations(
  dealtHands: Card[][],
  claims: DebercMeldKind[][],
  trumpSuit: Suit | null,
): ResolvedDeclarations {
  const seqMelds: DebercMeld[] = [];
  const bellaSeats: number[] = [];
  const falseBySeat = dealtHands.map(() => 0);
  dealtHands.forEach((hand, seat) => {
    const seen = new Set<DebercMeldKind>();
    for (const kind of claims[seat] ?? []) {
      if (seen.has(kind)) continue;
      seen.add(kind);
      if (kind === 'bella') {
        if (hasBella(hand, trumpSuit)) bellaSeats.push(seat);
        else falseBySeat[seat] += 1;
        continue;
      }
      const run = bestRunOfBand(hand, BAND_MIN_LEN[kind], trumpSuit);
      if (!run) { falseBySeat[seat] += 1; continue; } // bluff
      if (kind !== 'deberc') seqMelds.push(claimMeld(seat, kind, run)); // valid deberc → instant win, no score
    }
  });
  return { seqMelds, bellaSeats, falseBySeat };
}

/**
 * Which of the valid DECLARED sequence melds actually score: a meld scores unless
 * another declared meld is strictly stronger (higher band / top / trump). Equal
 * melds both score. A stronger declared meld (a платіна) shuts out weaker declared
 * ones (терці) — the §4 hierarchy, restricted to what was truthfully announced.
 */
export function scoringDeclaredMelds(melds: DebercMeld[]): DebercMeld[] {
  return melds.filter((m) => !melds.some((o) => o !== m && compareSequences(o, m) > 0));
}
