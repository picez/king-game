// ---------------------------------------------------------------------------
// EXACT durable ownership validation (Stage 37.7.15 FAIL 2). PURE — no DB, no I/O.
//
// Stage 37.7.14 froze a restored room only when its durable `poker_matches` row failed to PARSE.
// Parseability is not ownership: a room could be restored as a LIVE paid match while
//   • its `poker_matches` row was MISSING entirely;
//   • the row parsed fine but described a DIFFERENT match (other roomCode / buyIn / seat set);
//   • the buy-in ledger had the right COUNT but the wrong accounts, amounts, keys or room —
//     `matchLedgerState` only ever returned a count, so swapping one seat's debit for another
//     account's row left recovery convinced the debit was complete.
//
// A restored bankroll room may therefore only become `live` / `payout_pending` / `paid_finish`
// once the durable record AND the buy-in ledger match the room's escrow EXACTLY. Everything else
// is permanent, fail-closed operator evidence — never an auto refund/payout/stats/purge.
// ---------------------------------------------------------------------------

import type { PokerEscrow } from '../src/net/serverCore';
import { buyInIdempotencyKey, type MatchDurableEvidence } from './db/pokerWallet';

/**
 * The exact relationship between a room's CURRENT escrow and the durable evidence for its matchId.
 *   • settled_payout / settled_refund — a committed settlement row: the authoritative TERMINAL
 *     outcome, which outranks whatever transient status the room JSON carries (§16, 37.7.14);
 *   • exact_funded        — durable row + ledger correspond to the escrow EXACTLY;
 *   • proven_uncommitted  — no durable row and no buy-in row: nothing was ever charged;
 *   • missing_durable     — buy-ins and/or a funded claim exist, but no durable match row;
 *   • corrupt_durable     — the durable row exists but fails the strict parse;
 *   • metadata_mismatch   — the row parses but its roomCode/buyIn/seats are NOT this escrow's;
 *   • ledger_partial      — some expected buy-in rows are missing (a half-charged match);
 *   • ledger_mismatch     — the rows are present but wrong (account / amount / key / room / extra).
 */
export type DurableOwnership =
  | 'settled_payout' | 'settled_refund' | 'exact_funded' | 'proven_uncommitted'
  | 'missing_durable' | 'corrupt_durable' | 'metadata_mismatch' | 'ledger_partial' | 'ledger_mismatch';

/** Canonical, order-independent key of a seat set — the comparison used for escrow ↔ durable seats. */
function seatsKey(seats: ReadonlyArray<{ seat: number; userId: string; amount: number }>): string {
  return [...seats].map((s) => `${s.seat}:${s.userId}:${s.amount}`).sort().join('|');
}

/**
 * Validate that `evidence` PROVES the room's escrow. PURE and total — every failure mode has its own
 * value so no caller has to infer anything from a count.
 *
 * @param roomCode the CURRENT room's code (the durable row must name this room).
 * @param esc      the room's current escrow (its matchId selected the evidence).
 */
export function validateDurableOwnership(roomCode: string, esc: PokerEscrow, evidence: MatchDurableEvidence): DurableOwnership {
  // 1. A committed settlement row is the authoritative terminal outcome, checked FIRST (37.7.14).
  if (evidence.settlement === 'payout') return 'settled_payout';
  if (evidence.settlement === 'cancel_refund') return 'settled_refund';

  // 2. Nothing charged AND no durable claim → the debit transaction rolled back.
  if (!evidence.matchRowExists && evidence.buyIns.length === 0) return 'proven_uncommitted';

  // 3. The durable record itself.
  if (evidence.matchRowCorrupt) return 'corrupt_durable';
  if (!evidence.match) return 'missing_durable'; // buy-ins exist (or are claimed) with no durable row
  const durable = evidence.match;
  if (durable.roomCode !== roomCode) return 'metadata_mismatch';
  if (durable.buyIn !== esc.buyIn) return 'metadata_mismatch';
  if (durable.seats.length !== esc.seats.length) return 'metadata_mismatch';
  if (seatsKey(durable.seats) !== seatsKey(esc.seats)) return 'metadata_mismatch';

  // 4. EXACTLY one correct buy-in ledger row per escrow participant — never a bare count.
  const byUser = new Map<string, typeof evidence.buyIns>();
  for (const row of evidence.buyIns) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  if (evidence.buyIns.length > esc.seats.length) return 'ledger_mismatch'; // an extra/duplicate debit
  let missing = 0;
  for (const seat of esc.seats) {
    const rows = byUser.get(seat.userId);
    if (!rows || rows.length === 0) { missing++; continue; }
    if (rows.length > 1) return 'ledger_mismatch';                          // the same seat debited twice
    const row = rows[0];
    if (row.delta !== -seat.amount) return 'ledger_mismatch';               // wrong amount / sign
    if (row.roomCode !== roomCode) return 'ledger_mismatch';                // charged for another table
    if (row.idempotencyKey !== buyInIdempotencyKey(esc.matchId, seat.userId)) return 'ledger_mismatch';
    byUser.delete(seat.userId);
  }
  if (byUser.size > 0) return 'ledger_mismatch';                            // a debit for a non-participant
  // A durable row with NO backing debits is structurally impossible (the row and the debits commit in
  // ONE transaction), so it is operator evidence — never "nothing was charged", which would let the
  // orphan scan credit a refund for money that was never taken.
  if (missing > 0) return 'ledger_partial';                                 // half-charged → operator, never settled
  return 'exact_funded';
}
