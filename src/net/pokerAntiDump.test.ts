// ---------------------------------------------------------------------------
// Stage 38.0.8 — the PURE anti-dumping contract: thresholds, pairs, the UTC-day
// boundary, grandfathering, the rebuy allowance and the protocol/privacy shape.
//
// The DB round-trips live in pokerAntiDump.integration.test.ts. Everything decided
// here is decided without a database, so a threshold can never drift silently.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_BANKROLL_REBUYS_PER_SEAT, BANKROLL_PAIR_COOLDOWN_MS,
  MAX_RANKED_BANKROLL_MATCHES_PER_PAIR_UTC_DAY, ANTI_DUMP_POLICY_VERSION,
  decidePairPolicy, unorderedPairs, pairKey, rosterDigest, utcDayStartMs,
  policyEnforced, statsEligibleOf, statsEligibleForRoom, antiDumpCorrupt,
  seatRebuyCount, rebuysLeftForSeat, rebuyCapReached, pairAdvisoryKeys,
  ACTIVE_RESERVATION_RETRY_SECONDS,
  type SettledPairMatch, type PairEvidence,
} from '../../server/pokerAntiDump';
import { readAntiDumpPolicy } from './serverCore';
import { bankrollRebuysLeft } from '../games/poker/stakes';
import type { ServerRoom, PokerEscrow } from './serverCore';
import type { PokerState } from '../games/poker/types';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const NOW = Date.UTC(2026, 6, 21, 12, 0, 0);
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const D = 'dddddddd-0000-4000-8000-000000000004';

const settled = (ms: number, userIds: string[]): SettledPairMatch => ({ settledAtMs: ms, userIds });
/** Evidence with only SETTLED history (the active-reservation cases have their own block). */
const past = (...matches: SettledPairMatch[]): PairEvidence => ({ active: [], settled: matches });

describe('the thresholds are exactly what the owner chose', () => {
  it('2 rebuys per seat, 15-minute pair cooldown, 3 ranked matches per pair per UTC day', () => {
    expect(MAX_BANKROLL_REBUYS_PER_SEAT).toBe(2);
    expect(BANKROLL_PAIR_COOLDOWN_MS).toBe(15 * 60 * 1000);
    expect(MAX_RANKED_BANKROLL_MATCHES_PER_PAIR_UTC_DAY).toBe(3);
    expect(ANTI_DUMP_POLICY_VERSION).toBe(1);
  });
});

describe('pairs are UNORDERED and seat/user order never matters', () => {
  it('builds every unordered pair once', () => {
    expect(unorderedPairs([A, B])).toEqual([[A, B]]);
    expect(unorderedPairs([A, B, C])).toHaveLength(3);
    expect(unorderedPairs([A, B, C, D])).toHaveLength(6);
    expect(unorderedPairs([A])).toEqual([]);
    expect(unorderedPairs([])).toEqual([]);
  });
  it('is order-independent and de-duplicates', () => {
    expect(unorderedPairs([B, A])).toEqual(unorderedPairs([A, B]));
    expect(unorderedPairs([A, A, B])).toEqual([[A, B]]);
    expect(pairKey(A, B)).toBe(pairKey(B, A));
  });
  it('the roster digest is order-independent and reveals no account id', () => {
    expect(rosterDigest([A, B, C])).toBe(rosterDigest([C, A, B]));
    expect(rosterDigest([A, B])).not.toBe(rosterDigest([A, C]));
    const d = rosterDigest([A, B]);
    expect(d).toMatch(/^[0-9a-f]{32}$/);
    expect(d).not.toContain(A.slice(0, 8));
  });
});

describe('the pair cooldown', () => {
  it('blocks when a pair settled a payout inside the window', () => {
    const d = decidePairPolicy([A, B], past(settled(NOW - 60_000, [A, B])), NOW);
    expect(d.cooldownActive).toBe(true);
    expect(d.retryAfterSeconds).toBe(14 * 60);
  });
  it('allows once the window has passed', () => {
    const d = decidePairPolicy([A, B], past(settled(NOW - BANKROLL_PAIR_COOLDOWN_MS - 1, [A, B])), NOW);
    expect(d).toMatchObject({ cooldownActive: false, retryAfterSeconds: 0 });
  });
  it('is exclusive at the exact boundary (a settlement 15m ago no longer blocks)', () => {
    expect(decidePairPolicy([A, B], past(settled(NOW - BANKROLL_PAIR_COOLDOWN_MS, [A, B])), NOW).cooldownActive).toBe(false);
    expect(decidePairPolicy([A, B], past(settled(NOW - BANKROLL_PAIR_COOLDOWN_MS + 1, [A, B])), NOW).cooldownActive).toBe(true);
  });
  it('ignores the seat/user ORDER of the old match', () => {
    expect(decidePairPolicy([A, B], past(settled(NOW - 1000, [B, A])), NOW).cooldownActive).toBe(true);
    expect(decidePairPolicy([B, A], past(settled(NOW - 1000, [A, B])), NOW).cooldownActive).toBe(true);
  });
  it('a DIFFERENT pair is never blocked by someone else’s recent match', () => {
    expect(decidePairPolicy([C, D], past(settled(NOW - 1000, [A, B])), NOW).cooldownActive).toBe(false);
    // …and a shared player alone is not a pair: A+C never played together.
    expect(decidePairPolicy([A, C], past(settled(NOW - 1000, [A, B])), NOW).cooldownActive).toBe(false);
  });
  it('ONE recent pair blocks a whole MULTIWAY roster', () => {
    const d = decidePairPolicy([A, B, C, D], past(settled(NOW - 1000, [C, D])), NOW);
    expect(d.cooldownActive).toBe(true);
  });
  it('reports the LONGEST remaining wait when several pairs are cooling down', () => {
    const d = decidePairPolicy([A, B, C], past(settled(NOW - 10 * 60_000, [A, B]),
      settled(NOW - 2 * 60_000, [B, C])), NOW);
    expect(d.retryAfterSeconds).toBe(13 * 60);
  });
  it('a roster with fewer than two accounts can never be blocked', () => {
    expect(decidePairPolicy([A], past(settled(NOW - 1, [A, B])), NOW))
      .toEqual({ cooldownActive: false, retryAfterSeconds: 0, statsEligible: true });
  });
});

describe('the ranked / unranked gate', () => {
  const day = (n: number, ids: string[] = [A, B]) => settled(utcDayStartMs(NOW) + n * 60_000, ids);

  it('matches 1–3 of a pair in a UTC day are RANKED', () => {
    for (const already of [0, 1, 2]) {
      const history = Array.from({ length: already }, (_, i) => day(i));
      expect(decidePairPolicy([A, B], past(...history), NOW).statsEligible, `after ${already}`).toBe(true);
    }
  });
  it('the FOURTH match of the same pair that day is UNRANKED', () => {
    const history = [day(0), day(1), day(2)];
    expect(decidePairPolicy([A, B], past(...history), NOW).statsEligible).toBe(false);
  });
  it('the UTC-day rollover restores eligibility', () => {
    const yesterday = utcDayStartMs(NOW) - 3 * 60 * 60_000;
    const history = [settled(yesterday, [A, B]), settled(yesterday + 1, [A, B]), settled(yesterday + 2, [A, B])];
    expect(decidePairPolicy([A, B], past(...history), NOW).statsEligible).toBe(true);
  });
  it('ONE over-threshold pair makes a MULTIWAY match unranked', () => {
    const history = [day(0, [C, D]), day(1, [C, D]), day(2, [C, D])];
    expect(decidePairPolicy([A, B, C, D], past(...history), NOW).statsEligible).toBe(false);
    // …while a different roster is unaffected.
    expect(decidePairPolicy([A, B], past(...history), NOW).statsEligible).toBe(true);
  });
  it('counting is per PAIR, not per player', () => {
    // A played 3 today, but each time with a DIFFERENT partner → A+B is still fresh.
    const history = [day(0, [A, C]), day(1, [A, D]), day(2, [A, C])];
    expect(decidePairPolicy([A, B], past(...history), NOW).statsEligible).toBe(true);
  });
  it('a cooldown and an unranked verdict are independent facts', () => {
    const history = [day(0), day(1), day(2), settled(NOW - 60_000, [A, B])];
    const d = decidePairPolicy([A, B], past(...history), NOW);
    expect(d.cooldownActive).toBe(true);
    expect(d.statsEligible).toBe(false);
  });
});

describe('the persisted marker + grandfathering', () => {
  const esc = (over: Partial<PokerEscrow> = {}): PokerEscrow => ({
    matchId: 'm1', buyIn: 5000, status: 'funded',
    seats: [{ seat: 0, userId: A, amount: 5000 }, { seat: 1, userId: B, amount: 5000 }],
    ...over,
  });
  const marker = { version: 1 as const, statsEligible: false, decidedAt: NOW, rosterDigest: rosterDigest([A, B]) };

  it('a LEGACY escrow (no marker) is ranked and uncapped', () => {
    expect(policyEnforced(esc())).toBe(false);
    expect(statsEligibleOf(esc())).toBe(true);
    expect(statsEligibleOf(undefined)).toBe(true);
  });
  it('a marked escrow carries its decision', () => {
    expect(policyEnforced(esc({ antiDumpPolicy: marker }))).toBe(true);
    expect(statsEligibleOf(esc({ antiDumpPolicy: marker }))).toBe(false);
    expect(statsEligibleOf(esc({ antiDumpPolicy: { ...marker, statsEligible: true } }))).toBe(true);
  });
  it('ABSENT and MALFORMED are now different states (38.0.8.1 fail-closed)', () => {
    expect(readAntiDumpPolicy({})).toEqual({ kind: 'absent' });
    expect(readAntiDumpPolicy({ antiDumpPolicy: undefined })).toEqual({ kind: 'absent' });
    expect(readAntiDumpPolicy({ antiDumpPolicy: marker })).toEqual({ kind: 'valid', policy: marker });
    // Every PRESENT-but-invalid shape is CORRUPT — never quietly downgraded to legacy.
    for (const bad of [null, 'x', 1, [], {},
      { version: 2, statsEligible: true, decidedAt: NOW, rosterDigest: marker.rosterDigest },
      { version: 1, statsEligible: 'no', decidedAt: NOW, rosterDigest: marker.rosterDigest },
      { version: 1, statsEligible: true, decidedAt: -1, rosterDigest: marker.rosterDigest },
      { version: 1, statsEligible: true, decidedAt: NOW, rosterDigest: 'nope' },
      { version: 1, statsEligible: true, decidedAt: NOW },
      { ...marker, extra: 'unexpected' }]) {
      expect(readAntiDumpPolicy({ antiDumpPolicy: bad }), JSON.stringify(bad)).toEqual({ kind: 'malformed' });
    }
  });

  it('an unparsable marker never makes the ESCROW look corrupt (money is not policy)', () => {
    const src = read('src/net/serverCore.ts');
    const fn = src.slice(src.indexOf('function deserializePokerEscrow'), src.indexOf('* Rebuilds a ServerRoom'));
    expect(fn).toContain('readAntiDumpPolicy(o)');
    // The marker branch reports `policyCorrupt`, which is a POLICY fact — it never turns the
    // escrow itself into `corrupt: true` (that would risk losing money over a policy field).
    const after = fn.slice(fn.indexOf('readAntiDumpPolicy(o)'));
    expect(after).toContain('policyCorrupt: true');
    expect(after).not.toContain('corrupt: true');
  });
});

describe('the rebuy allowance', () => {
  const state = (rebuys: Array<{ handNumber: number; seat: number }>): PokerState =>
    ({ appliedRebuys: rebuys } as unknown as PokerState);
  const room = (esc: PokerEscrow | undefined, rebuys: Array<{ handNumber: number; seat: number }>): ServerRoom =>
    ({ gameType: 'poker', pokerEscrow: esc, gameState: state(rebuys) } as unknown as ServerRoom);
  const marked: PokerEscrow = {
    matchId: 'm', buyIn: 5000, status: 'funded',
    seats: [{ seat: 0, userId: A, amount: 5000 }, { seat: 1, userId: B, amount: 5000 }],
    antiDumpPolicy: { version: 1, statsEligible: true, decidedAt: NOW, rosterDigest: rosterDigest([A, B]) },
  };

  it('counts per SEAT, never per table', () => {
    const s = state([{ handNumber: 1, seat: 0 }, { handNumber: 2, seat: 0 }, { handNumber: 3, seat: 1 }]);
    expect(seatRebuyCount(s, 0)).toBe(2);
    expect(seatRebuyCount(s, 1)).toBe(1);
    expect(seatRebuyCount(s, 2)).toBe(0);
    expect(seatRebuyCount(null, 0)).toBe(0);
  });
  it('allows exactly two and refuses the third', () => {
    expect(rebuysLeftForSeat(room(marked, []), 0)).toBe(2);
    expect(rebuysLeftForSeat(room(marked, [{ handNumber: 1, seat: 0 }]), 0)).toBe(1);
    const spent = room(marked, [{ handNumber: 1, seat: 0 }, { handNumber: 2, seat: 0 }]);
    expect(rebuysLeftForSeat(spent, 0)).toBe(0);
    expect(rebuyCapReached(spent, 0)).toBe(true);
    expect(rebuyCapReached(spent, 1)).toBe(false);       // the other seat is untouched
  });
  it('a LEGACY escrow is uncapped — `null`, which is NOT zero', () => {
    const legacy = room({ ...marked, antiDumpPolicy: undefined }, [
      { handNumber: 1, seat: 0 }, { handNumber: 2, seat: 0 }, { handNumber: 3, seat: 0 },
    ]);
    expect(rebuysLeftForSeat(legacy, 0)).toBeNull();
    expect(rebuyCapReached(legacy, 0)).toBe(false);
  });
  it('the client-side helper agrees with the server cap', () => {
    expect(bankrollRebuysLeft(0)).toBe(2);
    expect(bankrollRebuysLeft(1)).toBe(1);
    expect(bankrollRebuysLeft(2)).toBe(0);
    expect(bankrollRebuysLeft(9)).toBe(0);
    expect(bankrollRebuysLeft(-1)).toBe(MAX_BANKROLL_REBUYS_PER_SEAT);
  });
});

describe('the cap is SERVER policy — the shared pure engine stays uncapped for local play', () => {
  it('no cap constant leaks into the engine or the rules', () => {
    const engine = read('src/games/poker/engine.ts');
    const rules = read('src/games/poker/rules.ts');
    expect(engine + rules).not.toMatch(/MAX_BANKROLL_REBUYS|antiDump|rebuyCap|maxRebuys/i);
  });
  it('local free Poker never imports the policy or the bankroll config', () => {
    const local = read('src/ui/poker/PokerLocalGame.tsx');
    expect(local).not.toMatch(/antiDump|stakes|statsEligible|rebuysLeft|Ranked/);
  });
  it('the cap lives with the ONLINE bankroll config, which local play does not import', () => {
    expect(read('src/games/poker/stakes.ts')).toContain('MAX_BANKROLL_REBUYS_PER_SEAT = 2');
    expect(read('server/pokerAntiDump.ts')).toContain("export { MAX_BANKROLL_REBUYS_PER_SEAT } from '../src/games/poker/stakes'");
  });
});

describe('protocol + privacy shape', () => {
  const messages = read('src/net/messages.ts');
  const core = read('src/net/serverCore.ts');

  it('START carries only a boolean ACKNOWLEDGEMENT, never a ranked request', () => {
    expect(messages).toContain("| { t: 'START_GAME'; pokerUnrankedConfirmed?: boolean }");
    expect(messages).not.toMatch(/ranked\s*[?]?:\s*boolean/);
    expect(messages).not.toContain('pokerStatsEligible?: boolean;\n  pokerRanked');
  });
  it('both refusal codes exist and an error may carry ONLY a retry hint', () => {
    expect(messages).toContain("| 'POKER_PAIR_COOLDOWN'");
    expect(messages).toContain("| 'POKER_UNRANKED_CONFIRM_REQUIRED'");
    expect(messages).toMatch(/\| \{ t: 'ERROR'; code: ErrorCode; message: string; retryAfterSeconds\?: number \}/);
  });
  it('the snapshot exposes ONE boolean and never the server-only marker', () => {
    expect(messages).toContain('pokerStatsEligible?: boolean;');
    expect(messages).not.toContain('antiDumpPolicy');
    expect(messages).not.toContain('rosterDigest');
    const snap = core.slice(core.indexOf('pokerStatsEligible:'), core.indexOf('pokerStatsEligible:') + 200);
    expect(snap).toContain('room.pokerEscrow.antiDumpPolicy?.statsEligible ?? true');
    // the RoomSummary (lobby list) never carries it at all
    const summary = core.slice(core.indexOf('export function roomSummary'), core.indexOf('export function roomSummary') + 1400);
    expect(summary).not.toContain('antiDumpPolicy');
    expect(summary).not.toContain('pokerStatsEligible');
  });
  it('no policy value is ever logged', () => {
    for (const f of ['server/pokerAntiDump.ts', 'server/pokerEscrow.ts', 'server/pokerRebuy.ts']) {
      const src = read(f);
      const logs = src.match(/console\.(log|error|warn)\([^)]*\)/g) ?? [];
      for (const line of logs) {
        expect(line, `${f}: ${line}`).not.toMatch(/antiDumpPolicy|rosterDigest|statsEligible|userId|pairKey/);
      }
    }
  });
});

describe('the safety invariants the policy must never break', () => {
  const escrow = read('server/pokerEscrow.ts');
  const rebuy = read('server/pokerRebuy.ts');
  const finish = read('server/pokerFinish.ts');

  it('a policy refusal never freezes, never confiscates and never settles anything', () => {
    const catchBlock = escrow.slice(escrow.indexOf('if (err instanceof PairCooldownError)'), escrow.indexOf("return { ok: false, error: 'Economy error"));
    expect(catchBlock).not.toMatch(/freeze|settle|payout|refund|balance/i);
    // The refusal path runs AFTER `rollback()`, so the previous escrow is restored verbatim.
    expect(escrow).toMatch(/rollback\(\);[\s\S]{0,400}PairCooldownError/);
  });
  it('the refund/payout paths know nothing about the policy', () => {
    const payout = escrow.slice(escrow.indexOf('export async function payoutStacks'), escrow.indexOf('export async function refundBuyInsResult'));
    expect(payout).not.toMatch(/antiDump|statsEligible|cooldown|PairCooldown/i);
    const refund = escrow.slice(escrow.indexOf('export async function refundBuyInsResult'));
    expect(refund.slice(0, 4000)).not.toMatch(/antiDump|statsEligible|cooldown|PairCooldown/i);
  });
  it('the decision and the debit share ONE transaction (no TOCTOU)', () => {
    const tx = escrow.slice(escrow.indexOf('await withEconomyBarrier(() => d.transaction'), escrow.indexOf("room.pokerEscrow.status = 'funded'"));
    expect(tx).toContain('evaluatePairPolicyTx(tx, userIds, nowMs)');
    expect(tx).toContain('recordMatchTx(tx, matchId');
    expect(tx).toContain('adjustWalletTx(tx');
    // the refusal throws INSIDE the transaction, so the debit rolls back with it
    expect(tx).toMatch(/throw new PairCooldownError[\s\S]*adjustWalletTx/);
  });
  it('the rebuy allowance is spent by COMMITTED ledger rows, inside the debit transaction', () => {
    const tx = rebuy.slice(rebuy.indexOf('await withEconomyBarrier(() => database.transaction'), rebuy.indexOf('} catch (err) {'));
    expect(tx).toContain('countDurableRebuysTx(tx, esc.matchId, userId)');
    expect(tx).toMatch(/countDurableRebuysTx[\s\S]*adjustWalletTx/);
  });
  it('unranked is a TERMINAL SUCCESS of the stats lifecycle', () => {
    expect(finish).toContain("'unranked_skipped'");
    expect(finish).toMatch(/if \(!statsEligibleForRoom\(room\)\) return 'unranked_skipped';/);
    // …decided AFTER the structural validation, so a malformed match is still `invalid`.
    expect(finish).toMatch(/validateFinishedPaidMatch\(esc, state\)[\s\S]{0,900}statsEligibleForRoom\(room\)/);
    // …and it is never treated as failed/invalid by the caller.
    const at = finish.indexOf('const stats = await deps.recordStats');
    const branch = finish.slice(at, at + 1400);
    expect(branch).toMatch(/stats === 'failed'/);
    expect(branch).toMatch(/stats === 'invalid'/);
    // `unranked_skipped` never appears in a failure/freeze branch — it falls into "resolved".
    expect(branch).not.toMatch(/unranked_skipped[\s\S]{0,120}(freeze|StatsPending = true)/);
    expect(branch).toContain('unranked_skipped → resolved');
  });
  it('Poker is still never written to the six-game online_matches model', () => {
    expect(read('server/pokerFinish.ts')).not.toContain('online_matches');
    expect(read('server/pokerAntiDump.ts')).not.toContain('onlineMatch');
  });
});

// ---------------------------------------------------------------------------
// Stage 38.0.8.1 — the two corrective FAILs, at the pure level.
// ---------------------------------------------------------------------------

describe('FAIL 1 — an ACTIVE (unresolved) match reserves its pairs', () => {
  const active = (...userIds: string[][]): PairEvidence => ({ active: userIds.map((u) => ({ userIds: u })), settled: [] });

  it('blocks a second paid table for a pair with NO settled history at all', () => {
    const d = decidePairPolicy([A, B], active([A, B]), NOW);
    expect(d.cooldownActive).toBe(true);
    expect(d.retryAfterSeconds).toBe(ACTIVE_RESERVATION_RETRY_SECONDS);
  });

  it('the retry hint is a bounded generic nudge, never a predicted end time', () => {
    expect(ACTIVE_RESERVATION_RETRY_SECONDS).toBe(60);
    // Even a very old unresolved match reports the same small bounded hint.
    expect(decidePairPolicy([A, B], active([A, B]), NOW + 5 * 60 * 60_000).retryAfterSeconds)
      .toBe(ACTIVE_RESERVATION_RETRY_SECONDS);
  });

  it('has NO fixed expiry — unlike the settled cooldown', () => {
    // A settled match 16 minutes ago no longer blocks…
    expect(decidePairPolicy([A, B], past(settled(NOW - 16 * 60_000, [A, B])), NOW).cooldownActive).toBe(false);
    // …but an UNRESOLVED one still does, however long it has been running.
    expect(decidePairPolicy([A, B], active([A, B]), NOW).cooldownActive).toBe(true);
  });

  it('ignores order, blocks a multiway roster, and spares an unrelated pair', () => {
    expect(decidePairPolicy([B, A], active([A, B]), NOW).cooldownActive).toBe(true);
    expect(decidePairPolicy([A, B, C], active([B, C]), NOW).cooldownActive).toBe(true);
    expect(decidePairPolicy([C, D], active([A, B]), NOW).cooldownActive).toBe(false);
    // A single shared player is not a pair.
    expect(decidePairPolicy([A, C], active([A, B]), NOW).cooldownActive).toBe(false);
  });

  it('an active reservation never changes the RANKED verdict on its own', () => {
    expect(decidePairPolicy([A, B], active([A, B]), NOW).statsEligible).toBe(true);
  });

  it('the settled cooldown still wins when it is the longer wait', () => {
    const d = decidePairPolicy([A, B], {
      active: [{ userIds: [A, B] }],
      settled: [settled(NOW - 60_000, [A, B])],
    }, NOW);
    expect(d.retryAfterSeconds).toBe(14 * 60);          // 14 min > the 60s active nudge
  });
});

describe('FAIL 1 — the advisory pair locks', () => {
  it('derives one stable key per unordered pair, sorted', () => {
    expect(pairAdvisoryKeys([A, B])).toEqual([pairKey(A, B)]);
    expect(pairAdvisoryKeys([B, A])).toEqual(pairAdvisoryKeys([A, B]));       // order-independent
    const keys = pairAdvisoryKeys([D, A, C, B]);
    expect(keys).toHaveLength(6);
    expect(keys).toEqual([...keys].sort());                                   // deterministic order
    expect(new Set(keys).size).toBe(6);
  });

  it('a roster with fewer than two accounts locks nothing', () => {
    expect(pairAdvisoryKeys([A])).toEqual([]);
    expect(pairAdvisoryKeys([])).toEqual([]);
  });

  it('the lock is transaction-scoped, taken BEFORE the read, and keyed in SQL (not JS)', () => {
    const src = read('server/pokerAntiDump.ts');
    expect(src).toContain('pg_advisory_xact_lock');           // auto-released on commit/rollback
    expect(src).toContain('substr(md5(');                     // stable SQL hash, not a JS one
    const evalFn = src.slice(src.indexOf('export async function evaluatePairPolicyTx'));
    expect(evalFn).toMatch(/lockPairsTx\(tx, userIds\)[\s\S]{0,400}readActivePairMatchesTx/);
    expect(evalFn).toMatch(/lockPairsTx\(tx, userIds\)[\s\S]{0,400}readSettledPairHistoryTx/);
  });

  it('the whole decision happens inside the debit transaction, before the debit', () => {
    const esc = read('server/pokerEscrow.ts');
    const tx = esc.slice(esc.indexOf('await withEconomyBarrier(() => d.transaction'), esc.indexOf("room.pokerEscrow.status = 'funded'"));
    expect(tx).toMatch(/evaluatePairPolicyTx\(tx, userIds, nowMs\)[\s\S]*recordMatchTx\(tx/);
    expect(tx).toMatch(/evaluatePairPolicyTx\(tx, userIds, nowMs\)[\s\S]*adjustWalletTx\(tx/);
  });
});

describe('FAIL 2 — a MALFORMED policy marker fails CLOSED', () => {
  const corruptRoom = (over: Partial<ServerRoom> = {}): ServerRoom => ({
    gameType: 'poker', pokerAntiDumpCorrupt: true,
    pokerEscrow: {
      matchId: 'm', buyIn: 5000, status: 'funded',
      seats: [{ seat: 0, userId: A, amount: 5000 }, { seat: 1, userId: B, amount: 5000 }],
    },
    gameState: { appliedRebuys: [] },
    ...over,
  } as unknown as ServerRoom);

  it('is reported distinctly from a legacy escrow', () => {
    expect(antiDumpCorrupt(corruptRoom())).toBe(true);
    expect(antiDumpCorrupt({ gameType: 'poker' } as unknown as ServerRoom)).toBe(false);
  });

  it('refuses every further rebuy (the spent allowance is unknown)', () => {
    const r = corruptRoom();
    expect(rebuysLeftForSeat(r, 0)).toBe(0);
    expect(rebuyCapReached(r, 0)).toBe(true);
    expect(rebuyCapReached(r, 1)).toBe(true);
  });

  it('is treated as UNRANKED — never assumed ranked', () => {
    expect(statsEligibleForRoom(corruptRoom())).toBe(false);
    // …while a healthy legacy room stays ranked (grandfathering is unchanged).
    expect(statsEligibleForRoom({
      gameType: 'poker',
      pokerEscrow: { matchId: 'm', buyIn: 1, status: 'funded', seats: [] },
    } as unknown as ServerRoom)).toBe(true);
  });

  it('never blocks a payout or a refund, and never freezes', () => {
    const esc = read('server/pokerEscrow.ts');
    const payout = esc.slice(esc.indexOf('export async function payoutStacks'), esc.indexOf('export async function refundBuyInsResult'));
    expect(payout).not.toMatch(/antiDumpCorrupt|pokerAntiDumpCorrupt/);
    const refund = esc.slice(esc.indexOf('export async function refundBuyInsResult'));
    expect(refund.slice(0, 4000)).not.toMatch(/antiDumpCorrupt|pokerAntiDumpCorrupt/);
    // The guard that DOES exist only refuses a NEW paid match, and only while unresolved.
    expect(esc).toMatch(/antiDumpCorrupt\(room\) && room\.pokerEscrow/);
    expect(esc).toMatch(/status !== 'settled' && room\.pokerEscrow\.status !== 'cancelled'/);
    expect(esc).not.toMatch(/antiDumpCorrupt\(room\)[\s\S]{0,200}freeze/i);
  });

  it('the marker is retired ONLY by a committed fresh debit', () => {
    const esc = read('server/pokerEscrow.ts');
    expect((esc.match(/room\.pokerAntiDumpCorrupt = undefined/g) ?? []).length).toBe(1);
    expect(esc).toMatch(/room\.pokerEscrow\.status = 'funded';[\s\S]{0,600}room\.pokerAntiDumpCorrupt = undefined/);
  });

  it('is SERVER-ONLY — never in a snapshot, summary, message or log', () => {
    const core = read('src/net/serverCore.ts');
    const messages = read('src/net/messages.ts');
    expect(messages).not.toContain('pokerAntiDumpCorrupt');
    const snap = core.slice(core.indexOf('export function snapshot'), core.indexOf('export function roomSummary'));
    // It is read ONLY to derive the public boolean — never emitted as a field.
    expect(snap).toContain('pokerStatsEligible');
    expect(snap).not.toMatch(/pokerAntiDumpCorrupt:\s/);
    const summary = core.slice(core.indexOf('export function roomSummary'), core.indexOf('export function roomSummary') + 1400);
    expect(summary).not.toContain('pokerAntiDumpCorrupt');
    for (const f of ['server/pokerAntiDump.ts', 'server/pokerEscrow.ts', 'server/pokerRebuy.ts']) {
      for (const line of read(f).match(/console\.(log|error|warn)\([^)]*\)/g) ?? []) {
        expect(line, f + ': ' + line).not.toMatch(/antiDumpCorrupt|antiDumpPolicy/);
      }
    }
  });

  it('a corrupt table publishes `pokerStatsEligible: false`', () => {
    expect(read('src/net/serverCore.ts')).toMatch(/pokerStatsEligible: room\.pokerAntiDumpCorrupt === true \? false :/);
  });
});
