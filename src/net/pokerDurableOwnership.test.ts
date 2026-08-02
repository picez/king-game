import { describe, it, expect } from 'vitest';
import type { PokerEscrow } from './serverCore';
import { validateDurableOwnership } from '../../server/pokerDurableOwnership';
import { buyInIdempotencyKey, type MatchDurableEvidence } from '../../server/db/pokerWallet';

// Stage 37.7.15 FAIL 2 (pure): the EXACT ownership contract between a room's escrow and its durable
// evidence. Stage 37.7.14 only asked "does the durable row parse?", so a missing/mismatched record —
// or a buy-in ledger with the right COUNT but the wrong accounts/amounts/keys/room — still let a
// restored table resume as a live paid match.

const CODE = 'AB12';
const M = 'match-1';
const esc = (over: Partial<PokerEscrow> = {}): PokerEscrow => ({
  matchId: M, buyIn: 5000, status: 'funded',
  seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }],
  ...over,
});
const buyIn = (userId: string, over: Partial<{ delta: number; idempotencyKey: string; roomCode: string | null }> = {}) => ({
  userId, delta: -5000, idempotencyKey: buyInIdempotencyKey(M, userId), roomCode: CODE, ...over,
});
const evidence = (over: Partial<MatchDurableEvidence> = {}): MatchDurableEvidence => ({
  matchRowExists: true,
  match: { matchId: M, roomCode: CODE, buyIn: 5000, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] },
  matchRowCorrupt: false,
  buyIns: [buyIn('u1'), buyIn('u2')],
  settlement: null,
  ...over,
});
const check = (ev: Partial<MatchDurableEvidence> = {}, e: PokerEscrow = esc()) => validateDurableOwnership(CODE, e, evidence(ev)).structure;
const money = (ev: Partial<MatchDurableEvidence> = {}, e: PokerEscrow = esc()) => validateDurableOwnership(CODE, e, evidence(ev)).financial;

describe('validateDurableOwnership — the exact ownership proof (Stage 37.7.15)', () => {
  it('a durable row + ledger that correspond EXACTLY are the only healthy result', () => {
    expect(check()).toBe('exact');
    // Seat/row order is irrelevant — the comparison is canonical.
    expect(check({ buyIns: [buyIn('u2'), buyIn('u1')] })).toBe('exact');
  });

  it('(37.7.16 FAIL 1) the two axes are INDEPENDENT — a settlement row never excuses a bad structure', () => {
    // The financial axis reports the DB-authoritative outcome (37.7.14 precedence kept)…
    expect(money({ settlement: 'payout' })).toBe('payout');
    expect(money({ settlement: 'cancel_refund' })).toBe('cancel_refund');
    expect(money()).toBe('unresolved');
    // …and NEVER short-circuits the structural proof. Stage 37.7.15 returned early here, so a
    // settled match with missing/corrupt evidence looked healthy: `paid_finish` wrote stats
    // attributed from the room escrow alone, and a refund wiped the operator's evidence.
    expect(check({ settlement: 'payout' })).toBe('exact');
    expect(check({ settlement: 'payout', matchRowExists: false, match: null, buyIns: [] })).toBe('proven_uncommitted');
    expect(check({ settlement: 'payout', matchRowExists: false, match: null })).toBe('missing');
    expect(check({ settlement: 'cancel_refund', matchRowCorrupt: true, match: null })).toBe('corrupt');
    expect(check({ settlement: 'cancel_refund', buyIns: [buyIn('u1'), buyIn('x9')] })).toBe('ledger_mismatch');
  });

  it('no durable row AND no debits = a rolled-back transaction, not corruption', () => {
    expect(check({ matchRowExists: false, match: null, buyIns: [] })).toBe('proven_uncommitted');
  });

  it('the durable record itself must exist, parse, and describe THIS escrow', () => {
    expect(check({ matchRowExists: false, match: null })).toBe('missing');       // debits with no record
    expect(check({ matchRowCorrupt: true, match: null })).toBe('corrupt');
    expect(check({ match: { matchId: M, roomCode: 'ZZZZ', buyIn: 5000, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }] } })).toBe('metadata_mismatch');
    expect(check({ match: { matchId: M, roomCode: CODE, buyIn: 9000, seats: [{ seat: 0, userId: 'u1', amount: 9000 }, { seat: 1, userId: 'u2', amount: 9000 }] } })).toBe('metadata_mismatch');
    // A different (but parse-valid) participant set, and a seat count that does not match.
    expect(check({ match: { matchId: M, roomCode: CODE, buyIn: 5000, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'x9', amount: 5000 }] } })).toBe('metadata_mismatch');
    expect(check({ match: { matchId: M, roomCode: CODE, buyIn: 5000, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }, { seat: 2, userId: 'u3', amount: 5000 }] } })).toBe('metadata_mismatch');
  });

  it('the buy-in ledger is proven ROW BY ROW, never by a count', () => {
    // The count matches but one row belongs to another account — the old count-only check passed.
    expect(check({ buyIns: [buyIn('u1'), buyIn('x9')] })).toBe('ledger_mismatch');
    expect(check({ buyIns: [buyIn('u1'), buyIn('u2', { delta: -1 })] })).toBe('ledger_mismatch');
    expect(check({ buyIns: [buyIn('u1'), buyIn('u2', { roomCode: 'ZZZZ' })] })).toBe('ledger_mismatch');
    expect(check({ buyIns: [buyIn('u1'), buyIn('u2', { roomCode: null })] })).toBe('ledger_mismatch');
    expect(check({ buyIns: [buyIn('u1'), buyIn('u2', { idempotencyKey: 'buyin:other:u2' })] })).toBe('ledger_mismatch');
    expect(check({ buyIns: [buyIn('u1'), buyIn('u2'), buyIn('x9')] })).toBe('ledger_mismatch'); // extra row
    expect(check({ buyIns: [buyIn('u1'), buyIn('u1'), buyIn('u2')] })).toBe('ledger_mismatch'); // duplicate seat
  });

  it('a HALF-charged ledger is operator evidence, never "nothing was charged"', () => {
    expect(check({ buyIns: [buyIn('u1')] })).toBe('ledger_partial');
    // A durable row with NO backing debits is structurally impossible (both commit in one
    // transaction) → evidence, so the orphan scan can never refund money that was never taken.
    expect(check({ buyIns: [] })).toBe('ledger_partial');
  });

  it('works for a 3-seat table and for a pending escrow shape', () => {
    const three = esc({
      status: 'pending',
      seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }, { seat: 3, userId: 'u3', amount: 5000 }],
    });
    const ok = evidence({
      match: { matchId: M, roomCode: CODE, buyIn: 5000, seats: [{ seat: 0, userId: 'u1', amount: 5000 }, { seat: 1, userId: 'u2', amount: 5000 }, { seat: 3, userId: 'u3', amount: 5000 }] },
      buyIns: [buyIn('u1'), buyIn('u2'), buyIn('u3')],
    });
    expect(validateDurableOwnership(CODE, three, ok).structure).toBe('exact');
    expect(validateDurableOwnership(CODE, three, { ...ok, buyIns: [buyIn('u1'), buyIn('u2')] }).structure).toBe('ledger_partial');
  });
});
