// ---------------------------------------------------------------------------
// Poker ANTI-DUMPING policy (Stage 38.0.8) — server economy policy, NOT a card rule.
//
// WHAT THIS IS
//   A MITIGATION. Because a bankroll cash game pays the final stacks into permanent
//   wallets, a deliberate loss can never be reliably distinguished from bad play. This
//   module makes deliberate transfer SLOW and makes repeated arranged matches stop
//   feeding the Poker leaderboard/achievements. It does NOT — and cannot — make
//   collusion impossible. Nothing here confiscates a balance and nothing here can block
//   a refund.
//
// THREE RULES, all decided SERVER-side from durable evidence only:
//   1. REBUY CAP        — at most `MAX_BANKROLL_REBUYS_PER_SEAT` per seat per matchId.
//   2. PAIR COOLDOWN    — no new PAID match while any two of its players settled a
//                         `payout` together less than `BANKROLL_PAIR_COOLDOWN_MS` ago.
//   3. RANKED GATE      — only the first `MAX_RANKED_BANKROLL_MATCHES_PER_PAIR_UTC_DAY`
//                         settled matches of a pair (per UTC day) may feed stats. Beyond
//                         that the table still plays and still pays — it just does not
//                         count. The host must confirm that BEFORE any chip is debited.
//
// SCOPE — deliberately narrow:
//   • ONLINE BANKROLL Poker only. LOCAL free Poker has no wallet, no escrow and no
//     policy: the caps live HERE, never in `src/games/poker` (the shared pure engine),
//     so local play is byte-identical to before.
//   • The other six games are untouched, and Poker is NOT written to `online_matches`
//     (that model belongs to the six non-Poker games).
//
// GRANDFATHERING — a match already in flight when this shipped keeps the OLD behaviour.
//   The policy applies only to an escrow carrying `antiDumpPolicy.version === 1`, which
//   is stamped by every debit made after deploy. A legacy escrow (no marker) is never
//   capped and never becomes unranked because the field is missing.
//
// PRIVACY — the marker is SERVER-ONLY: it never reaches `RoomSnapshot`, `RoomSummary`,
//   a log line or an error payload, and it carries no opponent identifiers (the escrow
//   already holds the authoritative seats). The ONLY public fact is a boolean
//   `pokerStatsEligible`, so every seat can see "Ranked"/"Unranked" — never a reason,
//   a threshold, a history or who triggered it.
// ---------------------------------------------------------------------------

import { and, eq, gte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createHash } from 'node:crypto';
import { pokerMatches, pokerMatchSettlements, pokerLedger } from './db/schema';
import { parseAntiDumpPolicy } from '../src/net/serverCore';
import { MAX_BANKROLL_REBUYS_PER_SEAT as REBUY_CAP } from '../src/games/poker/stakes';
import type { PokerEscrow, ServerRoom } from '../src/net/serverCore';
import type { PokerState } from '../src/games/poker/types';

/**
 * Most times ONE seat may buy back in inside ONE paid match. Defined with the other
 * ONLINE-BANKROLL config (`src/games/poker/stakes.ts`) so the client can render
 * "Rebuys left: N" from the same number — and, critically, NOT in the shared pure
 * engine/rules, which local free Poker uses and which must stay uncapped.
 */
export { MAX_BANKROLL_REBUYS_PER_SEAT } from '../src/games/poker/stakes';

/** How long a pair that settled a paid match together must wait before another one. */
export const BANKROLL_PAIR_COOLDOWN_MS = 15 * 60 * 1000;

/** Settled paid matches per pair per UTC day that may still feed stats/leaderboard. */
export const MAX_RANKED_BANKROLL_MATCHES_PER_PAIR_UTC_DAY = 3;

/** The only policy version this build writes and understands. */
export const ANTI_DUMP_POLICY_VERSION = 1;

/** Re-exported so every anti-dumping consumer has ONE import for the whole policy. */
export { parseAntiDumpPolicy };

// --- Pure helpers -----------------------------------------------------------

/**
 * A stable, order-independent digest of the paying roster. Used ONLY to bind a stored
 * decision to the roster it was made for, so a confirmation cannot be replayed against a
 * different table. It is a one-way hash — it exposes no account id even if it ever leaked.
 */
export function rosterDigest(userIds: readonly string[]): string {
  const canonical = [...userIds].sort().join('|');
  return createHash('sha256').update(`poker-roster-v1:${canonical}`).digest('hex').slice(0, 32);
}

/** Every UNORDERED pair of distinct accounts in a roster. Order never matters. */
export function unorderedPairs(userIds: readonly string[]): Array<[string, string]> {
  const ids = [...new Set(userIds)].sort();
  const out: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
  }
  return out;
}

/** Canonical key for an unordered pair (so A|B and B|A are the same bucket). */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** True when THIS escrow was created under the anti-dumping policy (post-deploy). */
export function policyEnforced(esc: PokerEscrow | undefined): boolean {
  return esc?.antiDumpPolicy?.version === ANTI_DUMP_POLICY_VERSION;
}

/**
 * Does this paid match feed stats/leaderboard/achievements? A LEGACY escrow with no
 * marker keeps the old behaviour (ranked) — a missing field must never silently
 * demote a match that was started before the policy existed.
 */
export function statsEligibleOf(esc: PokerEscrow | undefined): boolean {
  const p = esc?.antiDumpPolicy;
  if (!p || p.version !== ANTI_DUMP_POLICY_VERSION) return true;
  return p.statsEligible;
}

/** How many rebuys this seat has already taken in the CURRENT match (from the state). */
export function seatRebuyCount(state: PokerState | null | undefined, seat: number): number {
  const applied = state?.appliedRebuys ?? [];
  let n = 0;
  for (const r of applied) if (r?.seat === seat) n++;
  return n;
}

/**
 * Rebuys this seat may still take, or `null` when the policy does not apply (a legacy
 * escrow, or a non-bankroll table). `null` means "unlimited, as before" — it is NOT 0.
 */
export function rebuysLeftForSeat(room: ServerRoom, seat: number): number | null {
  if (!policyEnforced(room.pokerEscrow)) return null;
  const used = seatRebuyCount(room.gameType === 'poker' ? (room.gameState as PokerState | null) : null, seat);
  return Math.max(0, REBUY_CAP - used);
}

/** True when the cap forbids another rebuy for this seat right now. */
export function rebuyCapReached(room: ServerRoom, seat: number): boolean {
  if (policyDisabledForTests) return false;
  const left = rebuysLeftForSeat(room, seat);
  return left !== null && left <= 0;
}

/** Start of the UTC day containing `now`, in ms. */
export function utcDayStartMs(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// --- The DB decision --------------------------------------------------------

/** One settled paid match relevant to a roster: when it settled + who was in it. */
export interface SettledPairMatch {
  settledAtMs: number;
  userIds: string[];
}

/** What the policy decided for a candidate roster. Never leaves the server as-is. */
export interface PairPolicyDecision {
  /** A pair of this roster played a paid match together too recently. */
  cooldownActive: boolean;
  /** Whole seconds the client should wait. 0 when no cooldown. Never an exact opponent hint. */
  retryAfterSeconds: number;
  /** Whether a match started NOW may feed stats/leaderboard/achievements. */
  statsEligible: boolean;
}

/**
 * Turn the raw settled history into a decision. PURE, so every threshold, the UTC-day
 * boundary and the multiway rule are unit-testable without a database.
 *
 * - cooldown: ANY pair of the candidate roster settled a `payout` together within the
 *   window → refuse. Multiway inherits it: one recent pair blocks the whole table.
 * - ranked: EVERY pair must be under the daily cap; one pair at/over it makes the whole
 *   match unranked (never a partial "half-ranked" result).
 */
export function decidePairPolicy(
  rosterUserIds: readonly string[],
  history: readonly SettledPairMatch[],
  nowMs: number,
): PairPolicyDecision {
  const pairs = unorderedPairs(rosterUserIds);
  if (pairs.length === 0) return { cooldownActive: false, retryAfterSeconds: 0, statsEligible: true };

  const roster = new Set(rosterUserIds);
  const cooldownFrom = nowMs - BANKROLL_PAIR_COOLDOWN_MS;
  const dayStart = utcDayStartMs(nowMs);

  const todayCount = new Map<string, number>();
  let latestBlockingSettleMs = 0;

  for (const m of history) {
    // Only the accounts of THIS candidate roster matter; a stranger at that old table is
    // irrelevant (and is never inspected further).
    const shared = m.userIds.filter((u) => roster.has(u));
    for (const [a, b] of unorderedPairs(shared)) {
      const key = pairKey(a, b);
      if (m.settledAtMs > cooldownFrom) {
        latestBlockingSettleMs = Math.max(latestBlockingSettleMs, m.settledAtMs);
      }
      if (m.settledAtMs >= dayStart) todayCount.set(key, (todayCount.get(key) ?? 0) + 1);
    }
  }

  const cooldownActive = latestBlockingSettleMs > 0;
  const retryAfterSeconds = cooldownActive
    ? Math.max(1, Math.ceil((latestBlockingSettleMs + BANKROLL_PAIR_COOLDOWN_MS - nowMs) / 1000))
    : 0;

  let statsEligible = true;
  for (const [a, b] of pairs) {
    if ((todayCount.get(pairKey(a, b)) ?? 0) >= MAX_RANKED_BANKROLL_MATCHES_PER_PAIR_UTC_DAY) {
      statsEligible = false;
      break;
    }
  }
  return { cooldownActive, retryAfterSeconds, statsEligible };
}

/**
 * Read every SETTLED-BY-PAYOUT paid match that involved at least one of `userIds` since
 * `sinceMs`, inside the CALLER'S transaction — so the decision and the debit share one
 * snapshot and one lock scope (no TOCTOU).
 *
 * Identity comes from `poker_matches.seats` (account ids) — never a room code, never
 * anything the client sent. A `cancel_refund` settlement is deliberately NOT selected: a
 * refunded match was never played, so it can neither start a cooldown nor spend a
 * ranked slot.
 */
export async function readSettledPairHistoryTx(
  tx: PostgresJsDatabase, userIds: readonly string[], sinceMs: number,
): Promise<SettledPairMatch[]> {
  if (userIds.length === 0) return [];
  const rows = await tx.select({
    settledAt: pokerMatchSettlements.createdAt,
    seats: pokerMatches.seats,
  }).from(pokerMatchSettlements)
    .innerJoin(pokerMatches, eq(pokerMatches.matchId, pokerMatchSettlements.matchId))
    .where(and(
      eq(pokerMatchSettlements.outcome, 'payout'),
      gte(pokerMatchSettlements.createdAt, new Date(sinceMs)),
      // At least one of the candidate accounts sat at that table.
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${pokerMatches.seats}) AS e
                  WHERE e->>'userId' = ANY(${sql.raw(`ARRAY[${userIds.map((u) => `'${sanitizeUuid(u)}'`).join(',')}]::text[]`)}))`,
    ));

  const out: SettledPairMatch[] = [];
  for (const r of rows) {
    const seats = Array.isArray(r.seats) ? r.seats as Array<Record<string, unknown>> : [];
    const ids = seats.map((s) => (typeof s?.userId === 'string' ? s.userId : null)).filter((x): x is string => !!x);
    if (ids.length >= 2) out.push({ settledAtMs: new Date(r.settledAt as unknown as string).getTime(), userIds: ids });
  }
  return out;
}

/**
 * Account ids are server-resolved UUIDs; this is a belt-and-braces guard so the literal
 * built above can never carry anything but a UUID (the values never come from a client,
 * and a non-UUID here is a programming error, not user input).
 */
function sanitizeUuid(v: string): string {
  if (!/^[0-9a-fA-F-]{1,64}$/.test(v)) throw new Error('poker anti-dump: non-uuid account id');
  return v;
}

/** How far back the policy needs to look: the wider of the cooldown and the UTC day. */
export function policyLookbackMs(nowMs: number): number {
  return Math.min(nowMs - BANKROLL_PAIR_COOLDOWN_MS, utcDayStartMs(nowMs));
}

/**
 * TEST-ONLY SEAM (same convention as `__setRefundFailure` / `__setPayoutFailure`).
 *
 * The SETTLEMENT/RECOVERY suites drive many paid matches for one pair back to back to
 * exercise crash windows — behaviour the 15-minute cooldown would otherwise refuse. Those
 * suites are about the money lifecycle, not this policy, so they disable it explicitly and
 * reset it in `afterEach`. The policy's OWN suites never touch this, and production never
 * calls it: the default is ENABLED and only a test can change it.
 */
let policyDisabledForTests = false;
export function __setAntiDumpPolicyDisabled(v: boolean): void { policyDisabledForTests = v; }
export function __antiDumpPolicyDisabled(): boolean { return policyDisabledForTests; }

/** The decision a disabled policy yields: allow, ranked — i.e. the pre-38.0.8 behaviour. */
const ALLOW_RANKED: PairPolicyDecision = { cooldownActive: false, retryAfterSeconds: 0, statsEligible: true };

/** Evaluate the whole policy for a roster inside the caller's transaction. */
export async function evaluatePairPolicyTx(
  tx: PostgresJsDatabase, userIds: readonly string[], nowMs: number,
): Promise<PairPolicyDecision> {
  if (policyDisabledForTests) return ALLOW_RANKED;
  const history = await readSettledPairHistoryTx(tx, userIds, policyLookbackMs(nowMs));
  return decidePairPolicy(userIds, history, nowMs);
}

/**
 * Rebuys this account already has DURABLE evidence for in this match, read inside the
 * caller's transaction. This is the authoritative count for the cap: the state's
 * `appliedRebuys` is a fast pre-check, but only committed ledger rows may spend an
 * allowance — so an insufficient/transient/rolled-back debit costs nothing, and two
 * concurrent requests for the last allowance can only produce one debit.
 */
export async function countDurableRebuysTx(
  tx: PostgresJsDatabase, matchId: string, userId: string,
): Promise<number> {
  const rows = await tx.select({ id: pokerLedger.id }).from(pokerLedger)
    .where(and(
      eq(pokerLedger.matchId, matchId),
      eq(pokerLedger.userId, userId),
      eq(pokerLedger.reason, 'table_rebuy'),
    ));
  return rows.length;
}

/** Thrown inside a debit transaction when a pair of the roster is still cooling down. */
export class PairCooldownError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('poker_pair_cooldown');
    this.name = 'PairCooldownError';
  }
}

/** Thrown inside a debit transaction when the host has not accepted an UNRANKED table. */
export class UnrankedConfirmationRequiredError extends Error {
  constructor() {
    super('poker_unranked_confirm_required');
    this.name = 'UnrankedConfirmationRequiredError';
  }
}

/** Thrown inside a rebuy transaction when the seat has spent its allowance. */
export class RebuyCapReachedError extends Error {
  constructor() {
    super('poker_rebuy_cap_reached');
    this.name = 'RebuyCapReachedError';
  }
}
