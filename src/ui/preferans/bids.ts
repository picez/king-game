// ---------------------------------------------------------------------------
// Preferans local UI — pure bid/contract option builders (Stage 19.3).
//
// The screen renders only LEGAL choices, so it derives its option lists straight
// from the pure-core predicates (`canBid` / `canDeclareContract`). Keeping these
// as pure functions (no React) means the "only legal options" behaviour is unit
// testable without a DOM. See PREFERANS_RULES.md §5 (auction) / §6 (contract).
// ---------------------------------------------------------------------------

import {
  canBid,
  canDeclareContract,
  CONTRACT_SUIT_ORDER,
  MAX_LEVEL,
  MIN_LEVEL,
} from '../../games/preferans/rules';
import type { Bid, PreferansState } from '../../games/preferans/types';

/** Every (level, suit) shape in ascending auction order (5 levels × 5 suits). */
export function allBidShapes(): Bid[] {
  const out: Bid[] = [];
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    for (const suit of CONTRACT_SUIT_ORDER) out.push({ level, suit });
  }
  return out;
}

/** The legal bids `seat` may make right now (strictly above the current high bid). */
export function validBids(state: PreferansState, seat: number): Bid[] {
  return allBidShapes().filter((b) => canBid(state, seat, b.level, b.suit));
}

/** The legal final contracts the declarer may declare (≥ the winning bid). */
export function validDeclareContracts(state: PreferansState, seat: number): Bid[] {
  return allBidShapes().filter((b) => canDeclareContract(state, seat, b.level, b.suit));
}

/** A stable dedup key for a bid shape. */
export function bidKey(b: Bid): string {
  return `${b.level}${b.suit}`;
}
