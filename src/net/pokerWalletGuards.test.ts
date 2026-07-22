import { describe, it, expect } from 'vitest';
import {
  validateChipDelta, computeNextBalance, ensureSameLogicalOp,
  InvalidChipDeltaError, InsufficientChipsError, ChipOverflowError, LedgerKeyReuseError,
} from '../../server/db/pokerWallet';

// Deterministic (no-DB) coverage of the adjustWalletTx guards — the branches that make
// the ledger mutation safe: delta validation, negative/overflow rejection BEFORE any
// write, and idempotency-key reuse detection. The concurrent balance-mutated-once
// behavior itself is covered by the optional Postgres integration test.

describe('validateChipDelta', () => {
  it('accepts non-zero safe integers (positive and negative)', () => {
    for (const v of [1, -1, 5000, -5000, 1_000_000, -1_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(() => validateChipDelta(v)).not.toThrow();
    }
  });
  it('rejects zero / fractional / NaN / Infinity / unsafe / non-number', () => {
    for (const v of [0, 0.5, -0.5, 10.0001, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '100' as unknown as number, null as unknown as number]) {
      expect(() => validateChipDelta(v as number), String(v)).toThrow(InvalidChipDeltaError);
    }
  });
});

describe('computeNextBalance', () => {
  it('returns cur+delta for a valid credit/debit', () => {
    expect(computeNextBalance('u', 1000, 500)).toBe(1500);
    expect(computeNextBalance('u', 1000, -400)).toBe(600);
    expect(computeNextBalance('u', 1000, -1000)).toBe(0); // exact-to-zero is allowed
  });
  it('throws InsufficientChipsError when the debit would go negative (before any write)', () => {
    expect(() => computeNextBalance('u', 1000, -1001)).toThrow(InsufficientChipsError);
    try { computeNextBalance('u', 1000, -1001); } catch (e) {
      expect((e as InsufficientChipsError).needed).toBe(1001);
      expect((e as InsufficientChipsError).balance).toBe(1000);
    }
  });
  it('throws ChipOverflowError when the credit would exceed MAX_SAFE_INTEGER', () => {
    expect(() => computeNextBalance('u', Number.MAX_SAFE_INTEGER - 10, 100)).toThrow(ChipOverflowError);
  });
});

describe('ensureSameLogicalOp', () => {
  const req = { userId: 'u1', reason: 'table_buy_in', delta: -5000, idempotencyKey: 'buyin:m1:u1' };
  it('no-ops when there is no prior row (fresh key)', () => {
    expect(() => ensureSameLogicalOp(undefined, req)).not.toThrow();
  });
  it('no-ops when the prior row is the SAME logical op (a true idempotent replay)', () => {
    expect(() => ensureSameLogicalOp({ userId: 'u1', reason: 'table_buy_in', delta: -5000 }, req)).not.toThrow();
  });
  it('throws LedgerKeyReuseError when the key was used for a different user/reason/delta', () => {
    expect(() => ensureSameLogicalOp({ userId: 'u2', reason: 'table_buy_in', delta: -5000 }, req)).toThrow(LedgerKeyReuseError);
    expect(() => ensureSameLogicalOp({ userId: 'u1', reason: 'table_payout', delta: -5000 }, req)).toThrow(LedgerKeyReuseError);
    expect(() => ensureSameLogicalOp({ userId: 'u1', reason: 'table_buy_in', delta: -6000 }, req)).toThrow(LedgerKeyReuseError);
  });
});
