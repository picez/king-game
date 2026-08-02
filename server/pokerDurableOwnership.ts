// ---------------------------------------------------------------------------
// EXACT durable ownership validation (Stage 37.7.15 FAIL 2; corrected 37.7.16 FAIL 1). PURE.
//
// Stage 37.7.14 froze a restored room only when its durable `poker_matches` row failed to PARSE.
// Parseability is not ownership: a room could be restored as a LIVE paid match while its row was
// MISSING, described a DIFFERENT match, or its buy-in ledger had the right COUNT but the wrong
// accounts/amounts/keys/room (`matchLedgerState` only ever returned a count).
//
// (37.7.16 FAIL 1) Stage 37.7.15 then checked the SETTLEMENT ROW FIRST and returned immediately, so
// a committed payout/refund SKIPPED the structural proof entirely — a settled match with a missing
// or mismatched durable record was classified `paid_finish` and its stats were written from the ROOM
// escrow alone (possibly crediting the wrong accounts), and a refunded one was `cancelled`, wiping
// the operator's evidence. A settlement row proves only WHAT HAPPENED TO THE MONEY. It proves
// nothing about WHOSE match it was. The two axes are therefore reported SEPARATELY and both must be
// satisfied before a room may be treated as a healthy terminal (or live) match.
// ---------------------------------------------------------------------------

import { buyInIdempotencyKey, parseRebuyKey, type MatchDurableEvidence } from './db/pokerWallet';

/** WHAT HAPPENED TO THE MONEY — the DB-authoritative terminal outcome (or none yet). */
export type DurableFinancial = 'unresolved' | 'payout' | 'cancel_refund';

/**
 * WHOSE MATCH IT WAS — whether the durable record + buy-in ledger prove this exact escrow.
 *   • exact              — the row and every debit correspond to the escrow;
 *   • proven_uncommitted — no durable row AND no debit: the debit transaction rolled back;
 *   • missing            — debits (or a funded claim) exist with no durable row;
 *   • corrupt            — the durable row exists but fails the strict parse;
 *   • metadata_mismatch  — the row parses but its roomCode/buyIn/seats are NOT this escrow's;
 *   • ledger_partial     — some expected buy-in rows are missing (a half-charged match);
 *   • ledger_mismatch    — rows present but wrong (account / amount / key / room / extra).
 */
export type DurableStructure =
  | 'exact' | 'proven_uncommitted' | 'missing' | 'corrupt'
  | 'metadata_mismatch' | 'ledger_partial' | 'ledger_mismatch'
  /** A `table_rebuy` row exists that this match cannot own: an unparseable/foreign key,
   *  a hand that is not this match's, a non-participant account, a wrong delta or room,
   *  or two rebuys for the same user in the same hand (§17). PERMANENT — freeze. */
  | 'rebuy_mismatch';

/** The COMBINED result — neither axis may be inferred from the other (37.7.16 FAIL 1). */
export interface DurableOwnership { financial: DurableFinancial; structure: DurableStructure }

/** The escrow-side expectation the durable evidence must prove. */
export interface ExpectedMatch {
  matchId: string;
  buyIn: number;
  seats: ReadonlyArray<{ seat: number; userId: string; amount: number }>;
}

/** Canonical, order-independent key of a seat set — the comparison used for escrow ↔ durable seats. */
function seatsKey(seats: ReadonlyArray<{ seat: number; userId: string; amount: number }>): string {
  return [...seats].map((s) => `${s.seat}:${s.userId}:${s.amount}`).sort().join('|');
}

/** ONE user's validated extra contribution: the rebuy debits this match provably owns. */
export interface RebuyContribution { userId: string; hands: number[]; total: number }

/**
 * Validate + total the `table_rebuy` evidence for a match (§17). PURE. Returns null when
 * ANY row fails, which the caller must treat as permanent corruption — never as "no
 * rebuys", because that would silently under-pay a player who really did buy back in.
 *
 * Rules (all mandatory): the key parses FULLY (`rebuy:<matchId>:<hand>:<userId>`), names
 * THIS match, a positive safe-integer hand and the SAME user as the row; the user is one
 * of the initial durable participants; the delta is exactly `-buyIn`; the room code
 * matches; and no user has two rebuys for the same hand.
 */
export function validateRebuyContributions(
  roomCode: string,
  expected: ExpectedMatch,
  evidence: MatchDurableEvidence,
): Map<string, RebuyContribution> | null {
  const participants = new Set(expected.seats.map((s) => s.userId));
  const byUser = new Map<string, RebuyContribution>();
  const seen = new Set<string>();
  for (const row of evidence.rebuys ?? []) {
    const parsed = parseRebuyKey(row.idempotencyKey);
    if (!parsed) return null;                                   // malformed / foreign key shape
    if (parsed.matchId !== expected.matchId) return null;       // another match's rebuy
    if (parsed.userId !== row.userId) return null;              // key ↔ row disagree
    if (!participants.has(row.userId)) return null;             // not an initial participant
    if (row.delta !== -expected.buyIn) return null;             // never a partial/inflated debit
    if (row.roomCode !== roomCode) return null;                 // charged against another table
    const dedupe = `${row.userId}:${parsed.handNumber}`;
    if (seen.has(dedupe)) return null;                          // two rebuys for one user in one hand
    seen.add(dedupe);
    const cur = byUser.get(row.userId) ?? { userId: row.userId, hands: [], total: 0 };
    cur.hands.push(parsed.handNumber);
    cur.total += expected.buyIn;
    byUser.set(row.userId, cur);
  }
  return byUser;
}

/**
 * The FUNDED TOTAL of a match: every initial buy-in plus every validated rebuy (§17).
 * This — not `buyIn × seats` — is what a payout must conserve once rebuys exist.
 */
export function fundedTotalFor(expected: ExpectedMatch, rebuys: Map<string, RebuyContribution>): number {
  const initial = expected.seats.reduce((sum, s) => sum + s.amount, 0);
  let extra = 0;
  for (const c of rebuys.values()) extra += c.total;
  return initial + extra;
}

/** One user's FULL contribution — their initial buy-in plus their validated rebuys. */
export function contributionForUser(
  expected: ExpectedMatch, rebuys: Map<string, RebuyContribution>, userId: string,
): number {
  const initial = expected.seats.filter((s) => s.userId === userId).reduce((sum, s) => sum + s.amount, 0);
  return initial + (rebuys.get(userId)?.total ?? 0);
}

/** TRUE only for the one structure that permits a payout, a refund, stats or a resume. */
export function isExactStructure(structure: DurableStructure): boolean {
  return structure === 'exact';
}

/**
 * Validate whether `evidence` PROVES `expected` for `roomCode`. PURE and total: the financial and
 * structural axes are INDEPENDENT, so a committed settlement can never mask a structural failure.
 */
export function validateDurableOwnership(roomCode: string, expected: ExpectedMatch, evidence: MatchDurableEvidence): DurableOwnership {
  const financial: DurableFinancial = evidence.settlement === 'payout' ? 'payout'
    : evidence.settlement === 'cancel_refund' ? 'cancel_refund' : 'unresolved';
  return { financial, structure: durableStructure(roomCode, expected, evidence) };
}

function durableStructure(roomCode: string, expected: ExpectedMatch, evidence: MatchDurableEvidence): DurableStructure {
  // Nothing charged AND no durable claim → the debit transaction rolled back.
  if (!evidence.matchRowExists && evidence.buyIns.length === 0) return 'proven_uncommitted';

  // The durable record itself.
  if (evidence.matchRowCorrupt) return 'corrupt';
  if (!evidence.match) return 'missing'; // debits exist (or are claimed) with no durable row
  const durable = evidence.match;
  if (durable.roomCode !== roomCode) return 'metadata_mismatch';
  if (durable.buyIn !== expected.buyIn) return 'metadata_mismatch';
  if (durable.seats.length !== expected.seats.length) return 'metadata_mismatch';
  if (seatsKey(durable.seats) !== seatsKey(expected.seats)) return 'metadata_mismatch';

  // EXACTLY one correct buy-in ledger row per participant — never a bare count.
  const byUser = new Map<string, MatchDurableEvidence['buyIns']>();
  for (const row of evidence.buyIns) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  if (evidence.buyIns.length > expected.seats.length) return 'ledger_mismatch'; // an extra/duplicate debit
  let missing = 0;
  for (const seat of expected.seats) {
    const rows = byUser.get(seat.userId);
    if (!rows || rows.length === 0) { missing++; continue; }
    if (rows.length > 1) return 'ledger_mismatch';                          // the same seat debited twice
    const row = rows[0];
    if (row.delta !== -seat.amount) return 'ledger_mismatch';               // wrong amount / sign
    if (row.roomCode !== roomCode) return 'ledger_mismatch';                // charged for another table
    if (row.idempotencyKey !== buyInIdempotencyKey(expected.matchId, seat.userId)) return 'ledger_mismatch';
    byUser.delete(seat.userId);
  }
  if (byUser.size > 0) return 'ledger_mismatch';                            // a debit for a non-participant
  // A durable row with NO backing debits is structurally impossible (the row and the debits commit in
  // ONE transaction), so it is operator evidence — never "nothing was charged", which would let the
  // orphan scan credit a refund for money that was never taken.
  if (missing > 0) return 'ledger_partial';                                 // half-charged → operator

  // §17 — the rebuy ledger must be just as exactly owned as the initial buy-ins.
  if (validateRebuyContributions(roomCode, expected, evidence) === null) return 'rebuy_mismatch';
  return 'exact';
}
