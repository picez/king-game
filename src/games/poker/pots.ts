// ---------------------------------------------------------------------------
// Poker — pot / side-pot / split-pot / odd-chip math. Pure. See POKER_RULES.md
// §8 (side pots) and §10 (awarding, odd chips). Works purely from each seat's
// total contribution this hand + who folded; it never looks at cards.
// ---------------------------------------------------------------------------

import type { PokerPotAward } from './types';

/**
 * Split a hand's total contributions into pot layers (main + side pots). Each
 * distinct all-in level forms a layer contested by every non-folded seat that
 * contributed at least that level. A layer reached by only ONE contributor is an
 * uncalled amount and is RETURNED to that seat (winner pre-filled, `returned`).
 *
 * Returns layers in increasing all-in order (main pot first). `winners` is empty
 * for contested layers (filled at showdown); returned layers carry their single
 * winner already.
 */
export function computeSidePots(contributedBySeat: number[], foldedBySeat: boolean[]): PokerPotAward[] {
  const n = contributedBySeat.length;
  const levels = Array.from(new Set(contributedBySeat.filter((c) => c > 0))).sort((a, b) => a - b);
  const pots: PokerPotAward[] = [];
  let prev = 0;
  for (const level of levels) {
    const contributors: number[] = [];
    for (let s = 0; s < n; s++) if (contributedBySeat[s] >= level) contributors.push(s);
    const amount = (level - prev) * contributors.length;
    prev = level;
    if (amount <= 0) continue;
    const eligible = contributors.filter((s) => !foldedBySeat[s]);
    if (contributors.length === 1) {
      // Uncalled excess — returned to the sole contributor (never at risk).
      pots.push({ amount, eligibleSeats: contributors.slice(), winners: contributors.slice(), returned: true });
    } else {
      pots.push({ amount, eligibleSeats: eligible, winners: [], returned: false });
    }
  }
  return mergeAdjacent(pots);
}

/** Merge consecutive contested layers that share the same eligible-seat set. */
function mergeAdjacent(pots: PokerPotAward[]): PokerPotAward[] {
  const out: PokerPotAward[] = [];
  for (const p of pots) {
    const last = out[out.length - 1];
    if (last && !last.returned && !p.returned && sameSet(last.eligibleSeats, p.eligibleSeats)) {
      last.amount += p.amount;
    } else {
      out.push({ ...p, eligibleSeats: p.eligibleSeats.slice(), winners: p.winners.slice() });
    }
  }
  return out;
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

/**
 * Distribute `amount` chips among `winners` (already tied for best). Even split;
 * any leftover odd chips go one-at-a-time to the winners in `oddChipOrder`
 * (clockwise from the seat left of the button, §10). Returns chips-per-seat.
 */
export function distributeChips(
  amount: number,
  winners: number[],
  oddChipOrder: number[],
): Record<number, number> {
  const out: Record<number, number> = {};
  if (winners.length === 0) return out;
  const base = Math.floor(amount / winners.length);
  let remainder = amount - base * winners.length;
  for (const s of winners) out[s] = base;
  // Odd chips: walk the clockwise order, giving one chip to each tied winner.
  for (const seat of oddChipOrder) {
    if (remainder <= 0) break;
    if (winners.includes(seat)) {
      out[seat] += 1;
      remainder -= 1;
    }
  }
  return out;
}

/** Seats ordered clockwise starting from the first seat left of the button (§10). */
export function oddChipOrder(playerCount: number, buttonSeat: number): number[] {
  const order: number[] = [];
  for (let step = 1; step <= playerCount; step++) order.push((buttonSeat + step) % playerCount);
  return order;
}
