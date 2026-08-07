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

import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createHash } from 'node:crypto';
import { pokerMatches, pokerMatchSettlements, pokerLedger } from './db/schema';
import { readAntiDumpPolicy } from '../src/net/serverCore';
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
export { readAntiDumpPolicy };

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

/**
 * (38.0.8.1) True when this room's persisted policy marker was PRESENT but malformed. The
 * money is fine; the POLICY is unknown, so everything policy-shaped fails closed.
 */
export function antiDumpCorrupt(room: ServerRoom): boolean {
  return room.pokerAntiDumpCorrupt === true;
}

/**
 * Does this room's CURRENT paid match feed stats? Fails CLOSED on a corrupt marker: an
 * unknown decision must never be assumed to be "ranked". This — not `statsEligibleOf` — is
 * what the stats recorder and the public snapshot ask.
 */
export function statsEligibleForRoom(room: ServerRoom): boolean {
  if (antiDumpCorrupt(room)) return false;
  return statsEligibleOf(room.pokerEscrow);
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
  if (room.pokerAntiDumpCorrupt === true) return 0;      // unknown allowance → none left
  if (!policyEnforced(room.pokerEscrow)) return null;
  const used = seatRebuyCount(room.gameType === 'poker' ? (room.gameState as PokerState | null) : null, seat);
  return Math.max(0, REBUY_CAP - used);
}

/** True when the cap forbids another rebuy for this seat right now. */
export function rebuyCapReached(room: ServerRoom, seat: number): boolean {
  if (policyDisabledForTests) return false;
  // (38.0.8.1) A corrupt marker means the allowance already spent is UNKNOWN — refuse any
  // further rebuy rather than hand out chips against an unreadable policy.
  if (antiDumpCorrupt(room)) return true;
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

/**
 * (38.0.8.1) An UNRESOLVED paid match — a `poker_matches` row with no settlement yet. It is
 * a RESERVATION on every pair sitting at it: those accounts may not open a second paid table
 * until this one resolves. Unlike the settled cooldown it has NO fixed expiry — it lasts
 * exactly as long as the match is unresolved, and the existing orphan/recovery settlement
 * paths remain the only thing that ends it (a payout then starts the normal 15-minute
 * cooldown; a `cancel_refund` releases it immediately).
 */
export interface ActivePairMatch {
  userIds: string[];
}

/** Everything the decision reads, from ONE locked snapshot. */
export interface PairEvidence {
  active: readonly ActivePairMatch[];
  settled: readonly SettledPairMatch[];
}

/**
 * Bounded, GENERIC retry hint for an ACTIVE-reservation refusal. A live match has no
 * predictable end, so this is deliberately a small fixed nudge — never an invented
 * prediction of when someone else's table will finish.
 */
export const ACTIVE_RESERVATION_RETRY_SECONDS = 60;

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
  evidence: PairEvidence,
  nowMs: number,
): PairPolicyDecision {
  const pairs = unorderedPairs(rosterUserIds);
  if (pairs.length === 0) return { cooldownActive: false, retryAfterSeconds: 0, statsEligible: true };

  const roster = new Set(rosterUserIds);
  const cooldownFrom = nowMs - BANKROLL_PAIR_COOLDOWN_MS;
  const dayStart = utcDayStartMs(nowMs);

  const todayCount = new Map<string, number>();
  let latestBlockingSettleMs = 0;

  for (const m of evidence.settled) {
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

  // (38.0.8.1) An UNRESOLVED match holding any pair of this roster blocks outright. This is
  // what stops two brand-new rooms of the same pair — with NO settled history at all — from
  // both funding: the first START's durable `poker_matches` row IS the reservation.
  let activeConflict = false;
  for (const m of evidence.active) {
    const shared = m.userIds.filter((u) => roster.has(u));
    if (unorderedPairs(shared).length > 0) { activeConflict = true; break; }
  }

  const settledCooldown = latestBlockingSettleMs > 0;
  const cooldownActive = activeConflict || settledCooldown;
  const settledRetry = settledCooldown
    ? Math.max(1, Math.ceil((latestBlockingSettleMs + BANKROLL_PAIR_COOLDOWN_MS - nowMs) / 1000))
    : 0;
  const retryAfterSeconds = cooldownActive
    ? Math.max(settledRetry, activeConflict ? ACTIVE_RESERVATION_RETRY_SECONDS : 0)
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
 * The advisory-lock keys for a roster: one per unordered pair, in a STABLE sorted order so
 * every caller takes them in the same sequence and two concurrent debits can never deadlock.
 */
export function pairAdvisoryKeys(userIds: readonly string[]): string[] {
  return unorderedPairs(userIds).map(([a, b]) => pairKey(a, b)).sort();
}

/**
 * Take a TRANSACTION-SCOPED Postgres advisory lock for every pair of the roster, in the
 * stable sorted order above.
 *
 * WHY: the in-process `withEconomyBarrier` only serializes ONE Node process. This lock is
 * what makes "read the evidence, then debit" atomic against another CONNECTION — another
 * instance, or simply another transaction — so the reservation cannot be raced.
 * `pg_advisory_xact_lock` releases automatically on COMMIT or ROLLBACK, so a rolled-back
 * debit leaves nothing behind.
 *
 * The key is derived IN SQL from md5 (stable across Postgres versions and platforms) rather
 * than any JS hash. A hash collision can only make two UNRELATED pairs serialize with each
 * other — conservative, never a bypass. Account ids are bound as query parameters only; they
 * are never logged and never returned.
 */
export async function lockPairsTx(tx: PostgresJsDatabase, userIds: readonly string[]): Promise<void> {
  for (const key of pairAdvisoryKeys(userIds)) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint)`);
  }
}

/**
 * Read every UNRESOLVED paid match (a `poker_matches` row with no settlement) that involves
 * at least one of `userIds`, inside the caller's transaction. Identity is the account ids in
 * `poker_matches.seats` — never a room code.
 */
export async function readActivePairMatchesTx(
  tx: PostgresJsDatabase, userIds: readonly string[],
): Promise<ActivePairMatch[]> {
  if (userIds.length === 0) return [];
  const rows = await tx.select({ seats: pokerMatches.seats })
    .from(pokerMatches)
    .leftJoin(pokerMatchSettlements, eq(pokerMatchSettlements.matchId, pokerMatches.matchId))
    .where(and(
      isNull(pokerMatchSettlements.matchId),
      sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${pokerMatches.seats}) AS e
                  WHERE e->>'userId' = ANY(${sql.raw(`ARRAY[${userIds.map((u) => `'${sanitizeUuid(u)}'`).join(',')}]::text[]`)}))`,
    ));
  const out: ActivePairMatch[] = [];
  for (const r of rows) {
    const seats = Array.isArray(r.seats) ? r.seats as Array<Record<string, unknown>> : [];
    const ids = seats.map((s) => (typeof s?.userId === 'string' ? s.userId : null)).filter((x): x is string => !!x);
    if (ids.length >= 2) out.push({ userIds: ids });
  }
  return out;
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
  // ORDER MATTERS: take the pair locks FIRST, then read. Reading before locking would be
  // exactly the race this stage fixes.
  await lockPairsTx(tx, userIds);
  const active = await readActivePairMatchesTx(tx, userIds);
  const settled = await readSettledPairHistoryTx(tx, userIds, policyLookbackMs(nowMs));
  return decidePairPolicy(userIds, { active, settled }, nowMs);
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
