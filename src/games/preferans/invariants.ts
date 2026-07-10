// ---------------------------------------------------------------------------
// Preferans — invariant checks (test helper, pure). Returns a list of violation
// messages (empty = healthy). Used by unit tests + the future bot soak to prove
// the reducer never corrupts the 32-card deck or the trick/score bookkeeping.
// ---------------------------------------------------------------------------

import type { PreferansState } from './types';
import { NUM_SEATS } from './deck';

/** Total cards currently in play across every zone (should always be 32). */
function totalCards(s: PreferansState): number {
  const inHands = s.handsBySeat.reduce((n, h) => n + h.length, 0);
  const played = s.completedTricks.reduce((n, t) => n + t.plays.length, 0)
    + (s.currentTrick ? s.currentTrick.plays.length : 0);
  return inHands + s.talon.length + s.discards.length + played;
}

/** Returns human-readable invariant violations; an empty array means all hold. */
export function checkPreferansInvariants(s: PreferansState): string[] {
  const errs: string[] = [];

  // 32 cards conserved across all zones (hands + talon + discards + played).
  if (totalCards(s) !== 32) errs.push(`card count ${totalCards(s)} != 32`);

  // Trick counts sum to the number of completed tricks.
  const trickSum = s.tricksBySeat.reduce((a, b) => a + b, 0);
  if (trickSum !== s.completedTricks.length) {
    errs.push(`tricksBySeat sum ${trickSum} != completedTricks ${s.completedTricks.length}`);
  }

  // No seat exceeds 10 tricks; at most 10 tricks per hand.
  if (s.completedTricks.length > 10) errs.push(`>10 completed tricks (${s.completedTricks.length})`);

  // Scores are integers.
  if (!s.scores.every((v) => Number.isInteger(v))) errs.push('non-integer score');

  // currentSeat is a valid seat.
  if (s.currentSeat < 0 || s.currentSeat >= NUM_SEATS) errs.push(`currentSeat ${s.currentSeat} out of range`);

  // No duplicate cards anywhere (suit+rank unique across every real card).
  const seen = new Set<string>();
  let dup = false;
  const note = (c: { suit: string; rank: string }) => {
    if (c.rank === '?') return; // redacted placeholders are exempt
    const k = `${c.suit}:${c.rank}`;
    if (seen.has(k)) dup = true;
    seen.add(k);
  };
  s.handsBySeat.forEach((h) => h.forEach(note));
  s.talon.forEach(note);
  s.discards.forEach(note);
  s.completedTricks.forEach((t) => t.plays.forEach((p) => note(p.card)));
  if (s.currentTrick) s.currentTrick.plays.forEach((p) => note(p.card));
  if (dup) errs.push('duplicate card in play');

  return errs;
}
