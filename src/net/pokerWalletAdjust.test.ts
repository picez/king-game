import { describe, it, expect } from 'vitest';
import { adjustWalletTx } from '../../server/db/pokerWallet';

// Deterministic control-flow proof of the Stage 37.7 idempotency-race FIX, without a
// real Postgres. A minimal fake transaction records the ordered DB calls and lets the
// test program the ledger-insert result. The invariant proven here is the crux of the
// fix: the wallet balance UPDATE runs ONLY when THIS transaction wins the ledger
// idempotency key (the insert `.returning()` yields a row); when the insert conflicts
// (returns []), NO update is issued — so a concurrent same-key call cannot double-apply.
//
// The actual concurrent DB behavior (two real transactions, one balance mutation) is
// covered by the optional Postgres integration test (src/net/pokerWallet.integration.test.ts),
// which is SKIPPED without TEST_DATABASE_URL.

type Row = Record<string, unknown>;

/** A tiny chainable, awaitable stand-in for the drizzle query builder used by adjustWalletTx. */
function makeFakeTx(opts: {
  walletRow: Row | null;          // current locked wallet row (null = none yet)
  ledgerInsertWins: boolean;      // did THIS tx win the ledger idempotency key?
  priorLedgerRow?: Row;           // the existing row read on a conflict (for reuse guard)
}) {
  const calls: string[] = [];
  // `chain` resolves to `result` when awaited, and returns itself for any builder method.
  const chain = (label: string, result: unknown) => {
    const obj: Record<string, unknown> = {};
    const passthrough = () => obj;
    for (const m of ['values', 'from', 'where', 'set', 'limit', 'onConflictDoNothing']) obj[m] = passthrough;
    obj.for = passthrough;
    obj.returning = passthrough;
    obj.then = (res: (v: unknown) => unknown) => { calls.push(label); return Promise.resolve(result).then(res); };
    return obj;
  };
  let selectCount = 0;
  const tx = {
    insert: (table: unknown) => {
      const name = String((table as { [k: symbol]: unknown })?.constructor?.name ?? '');
      void name;
      // Distinguish wallet-ensure vs ledger-insert by call order: the only `.returning()`
      // path is the ledger gate. We tag both; the ledger insert is the one whose result
      // must reflect ledgerInsertWins.
      return {
        values: () => ({
          onConflictDoNothing: (arg?: unknown) => {
            if (arg) {
              // ledger gate (targeted onConflictDoNothing) → supports .returning()
              return {
                returning: () => chain('ledger.insert', opts.ledgerInsertWins ? [{ id: 'led1' }] : []),
                then: (r: (v: unknown) => unknown) => { calls.push('wallet.ensure'); return Promise.resolve(undefined).then(r); },
              };
            }
            return chain('wallet.ensure', undefined);
          },
        }),
      };
    },
    select: () => ({
      from: () => ({
        where: () => {
          selectCount += 1;
          const isWalletLock = selectCount === 1;
          const forUpdate = () => ({ limit: () => chain(isWalletLock ? 'wallet.lock' : 'ledger.read', isWalletLock ? (opts.walletRow ? [opts.walletRow] : []) : (opts.priorLedgerRow ? [opts.priorLedgerRow] : [])) });
          return {
            for: forUpdate,
            limit: () => chain(isWalletLock ? 'wallet.lock' : 'ledger.read', isWalletLock ? (opts.walletRow ? [opts.walletRow] : []) : (opts.priorLedgerRow ? [opts.priorLedgerRow] : [])),
          };
        },
      }),
    }),
    update: () => chain('wallet.update', undefined),
  };
  return { tx, calls };
}

describe('adjustWalletTx control flow (fake tx — no DB)', () => {
  it('applies the balance UPDATE exactly once when it wins the ledger key', async () => {
    const { tx, calls } = makeFakeTx({ walletRow: { userId: 'u', balance: 1000 }, ledgerInsertWins: true });
    const r = await adjustWalletTx(tx as never, 'u', -400, 'table_buy_in', 'buyin:m:u');
    expect(r).toEqual({ balance: 600, applied: true });
    expect(calls.filter((c) => c === 'wallet.update').length).toBe(1);
    // The ledger gate must precede the balance update.
    expect(calls.indexOf('ledger.insert')).toBeLessThan(calls.indexOf('wallet.update'));
  });

  it('does NOT update the balance when the ledger insert conflicts (idempotent no-op)', async () => {
    const { tx, calls } = makeFakeTx({
      walletRow: { userId: 'u', balance: 600 }, ledgerInsertWins: false,
      priorLedgerRow: { userId: 'u', reason: 'table_buy_in', delta: -400 },
    });
    const r = await adjustWalletTx(tx as never, 'u', -400, 'table_buy_in', 'buyin:m:u');
    expect(r).toEqual({ balance: 600, applied: false });
    // The critical invariant: no balance UPDATE on the conflict path.
    expect(calls).not.toContain('wallet.update');
  });

  it('rejects an invalid delta before any DB call', async () => {
    const { tx, calls } = makeFakeTx({ walletRow: { userId: 'u', balance: 1000 }, ledgerInsertWins: true });
    await expect(adjustWalletTx(tx as never, 'u', 0.5, 'table_buy_in', 'k')).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});
