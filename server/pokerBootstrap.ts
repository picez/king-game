// ---------------------------------------------------------------------------
// Poker bankroll BOOTSTRAP recovery (Stage 37.7.10 FAIL 1; hardened 37.7.11). Extracted from
// server/index.ts so the production restart-recovery ORCHESTRATION is testable WITHOUT booting the
// WS server — `recoverRestoredBankrollRoom` is the exact function index.ts runs per restored room
// (reconcile → classify → apply → persist/advance decision), so a test can never drift from it.
//
// On restart a restored bankroll room that still carries a game state must be classified — a LIVE
// funded match, a payout still owed, a PAID finish whose stats need finalizing, a refunded/cancelled
// match, an INCOHERENT paid one, or a frozen one:
//   • a `settled` (PAID) escrow with a FINISHED game is a PAID finish (keep the state, finalize
//     stats), NEVER a refund/cancel (37.7.10 FAIL 1);
//   • a `settled` (PAID) escrow with an UNFINISHED game is INCOHERENT — money is out but the final
//     state was lost — and must FAIL CLOSED into a permanent frozen state, never resume as `live`
//     (37.7.11 FAIL 1).
// ---------------------------------------------------------------------------

import type { ServerRoom } from '../src/net/serverCore';
import type { PokerState } from '../src/games/poker/types';
import { isCorruptEvidence, withEconomyBarrier, type EscrowReconcileResult } from './pokerEscrow';
import { isBankrollRoomShape } from './pokerParticipants';
import { escrowGameBinding, clearGameBinding, resolveUnboundEscrowGame } from './pokerBinding';

export type BootstrapRecovery =
  | 'not_bankroll'     // not a bankroll room (or no game state) — nothing to classify
  | 'frozen'           // already frozen (corrupt/invalid) — kept for operator, no advance
  | 'incoherent_paid'  // settled escrow + UNFINISHED (or unbound) game — paid, final state lost → freeze
  | 'unbound_debit'    // LIVE escrow whose match never produced this state — refund the fresh debit
  | 'unknown_binding'  // a legacy save: a game state + escrow but NO generation marker → freeze
  | 'recovery_pending' // (37.7.13) the durable outcome is UNKNOWN — keep everything, retry later
  | 'corrupt_debit'    // (37.7.13) only SOME seats have a durable buy-in → freeze, never auto-settle
  | 'live'             // funded escrow + BOUND UNFINISHED game — a live match to advance
  | 'payout_pending'   // funded escrow + BOUND FINISHED game — payout not yet confirmed
  | 'paid_finish'      // settled escrow + BOUND FINISHED game — a PAID finish; finalize stats
  | 'cancelled';       // PROVEN-uncommitted or durably refunded escrow — the game can't continue

/**
 * (37.7.13 FAIL 1) Classifications whose match must be PROTECTED from the global orphan-debit scan.
 * Anything that is live, unproven or frozen keeps its durable debit: the scan may only settle a
 * match the room lifecycle has PROVEN nobody owns. `unbound_debit` is deliberately absent — an
 * explicitly stale generation IS an orphan and goes through the failed-start refund exactly once.
 */
const SETTLEMENT_PROTECTED: ReadonlySet<BootstrapRecovery> = new Set<BootstrapRecovery>([
  'live', 'payout_pending', 'paid_finish', 'incoherent_paid', 'unknown_binding', 'recovery_pending',
  'corrupt_debit', 'frozen',
]);

/**
 * (37.7.11 FAIL 1) TRUE when the initial restore loop must NOT arm timers/advance for this room and
 * must leave that decision to the economy recovery classification.
 *
 * The old guard deferred only `hasUnsettledEscrow` rooms, so a room whose escrow was already
 * `settled`/`cancelled` (or that carried stats-pending/frozen state) was advanced BEFORE any
 * classification ran — an already-PAID match could take a timer, a bot step, or an ACTION_REQUEST
 * before recovery even looked at it. EVERY bankroll room now defers: only `recoverRestoredBankrollRoom`
 * (classification `live`) may re-arm the advance.
 */
export function shouldDeferBootstrapAdvance(room: ServerRoom): boolean {
  return isBankrollRoomShape(room);
}

/**
 * (37.7.16 FAIL 2) TRUE when a restored bankroll room CLAIMS an economy match in any way — an escrow
 * (of ANY status, terminal included), a carried game state, a generation binding, or owed stats.
 * Every such room must have its durable ownership proven before recovery may act on it; the old
 * `hasUnsettledEscrow` filter silently exempted terminal escrows.
 */
export function claimsEconomyMatch(room: ServerRoom): boolean {
  return !!room.pokerEscrow || !!room.gameState || !!room.pokerGameMatchId || !!room.pokerStatsPending;
}

/**
 * PURE classification of a RESTORED bankroll room that still has a game state, AFTER `reconcileEscrow`
 * has resolved any transient (pending/settling) escrow against the durable DB settlement. `isFinished`
 * is the poker finished-state predicate; `reconcile` is that reconciliation's EXPLICIT outcome
 * (37.7.13 — default `noop` for a room that was never reconciled).
 */
export function classifyBootstrapRecovery(
  room: ServerRoom, isFinished: (s: PokerState) => boolean, reconcile: EscrowReconcileResult = 'noop',
): BootstrapRecovery {
  if (!isBankrollRoomShape(room) || !room.gameState) return 'not_bankroll';
  if (room.pokerFrozen) return 'frozen';
  // (37.7.13 FAIL 2) The durable outcome decides EVERYTHING below, so an unproven one is handled
  // first. A PARTIAL debit can be settled neither way (a refund would short a debited seat, a payout
  // would mint chips) → permanent operator state. A TRANSIENT read failure proves nothing at all →
  // hold the room inert, unchanged, for the next reconciliation. Neither is ever a cancellation.
  // (37.7.15 FAIL 2) EVERY permanent structural failure of the exact durable ownership proof —
  // a missing/unparseable durable row, one that describes another match, or a buy-in ledger that does
  // not back this escrow — shares the ONE fail-closed classification.
  if (isCorruptEvidence(reconcile)) return 'corrupt_debit';
  if (reconcile === 'retry_pending') return 'recovery_pending';
  const esc = room.pokerEscrow;
  const finished = isFinished(room.gameState as PokerState);
  // (37.7.17 FAIL 2) A MISSING escrow is not proof of a refund. The room still claims a match (it has
  // a game state), so only an explicit durable proof — a committed `cancel_refund`, a provably
  // uncommitted debit, or a refund for this exact matchId CONFIRMED in this boot — may cancel it.
  // Everything else is inert (`escrowless_unresolved`) or permanent operator evidence.
  if (!esc) {
    if (reconcile === 'cancelled' || reconcile === 'proven_uncommitted') return 'cancelled';
    if (reconcile === 'escrowless_unresolved') return 'recovery_pending';
    return 'corrupt_debit';
  }
  // `cancelled` for an escrow is durable proof: a committed refund row.
  if (esc.status === 'cancelled') return 'cancelled';
  // (37.7.13 FAIL 2) A transient status that SURVIVED reconciliation is unproven, never "nothing was
  // charged" — the old code read it as `cancelled` and wiped a possibly-paid match's state/binding.
  if (esc.status === 'pending' || esc.status === 'settling') return 'recovery_pending';

  // (37.7.12 FAIL 1) WHICH escrow generation produced this state decides everything below. A state
  // from a different generation must never be paid out or recorded against the current escrow.
  const binding = escrowGameBinding(room);
  if (binding === 'unknown') return 'unknown_binding'; // legacy save → can't prove it → fail closed

  if (esc.status === 'settled') {
    // (37.7.10 FAIL 1) A `settled` escrow is a durable PAID payout — a BOUND finished game here is a
    // PAID FINISH whose stats must be finalized (NEVER a refund/cancel).
    // (37.7.11 FAIL 1) `settled` + UNFINISHED — and (37.7.12) `settled` + a state from ANOTHER
    // generation — are INCOHERENT PAID states: the payout committed but the authoritative final state
    // is gone. They fail CLOSED into a frozen operator state instead of resuming or cancelling.
    return (finished && binding === 'bound') ? 'paid_finish' : 'incoherent_paid';
  }
  // funded: only the generation that produced this state may continue or be paid.
  if (binding !== 'bound') return 'unbound_debit';
  return finished ? 'payout_pending' : 'live';
}

/**
 * (37.7.13 FAIL 1) The matchId the GLOBAL orphan-debit scan must NOT settle for this room, or null
 * when the room's durable match may be treated as an orphan.
 *
 * The old bootstrap built its "active match" set from a room SHAPE test (funded/settling + a game
 * state + a bound binding) and ran the scan BEFORE any classification. A legacy room with an
 * `unknown` binding therefore fell outside the set and was REFUNDED by the scan seconds before
 * recovery froze it — breaking the stated "an unknown binding freezes with no settlement" guarantee
 * and leaving a funded+frozen room whose durable match was already cancelled. Protection is now
 * derived from the SAME classification the recovery pass applies, and the scan runs after it.
 *
 * Protected: any non-terminal escrow that is live, unproven (`pending`/`settling`, transient or
 * partial reconciliation) or frozen — including a room with NO game state whose reconciliation could
 * not prove the outcome. Unprotected: an explicitly stale generation (`unbound_debit`), a resolved
 * match, and a plain funded orphan with no game (a failed start the scan legitimately refunds).
 */
export function settlementProtectedMatchId(
  room: ServerRoom, recovery: BootstrapRecovery, reconcile: EscrowReconcileResult = 'noop',
): string | null {
  if (!isBankrollRoomShape(room)) return null;
  const esc = room.pokerEscrow;
  if (!esc || typeof esc.matchId !== 'string' || !esc.matchId) return null;
  // (37.7.16 FAIL 2) An UNPROVEN terminal claim is NOT a resolved match. A room whose escrow says
  // `settled` while the DB holds no settlement row would otherwise be left unprotected and refunded
  // by the global scan seconds before classification freezes it for the operator — the same
  // settle-before-classify mistake 37.7.13 fixed for the unknown-binding case.
  if (isCorruptEvidence(reconcile) || recovery === 'corrupt_debit' || room.pokerFrozen) return esc.matchId;
  if (esc.status === 'settled' || esc.status === 'cancelled') return null; // proven resolved
  // An unproven durable outcome protects the match even for a room with no game state.
  if (reconcile === 'retry_pending' || reconcile === 'corrupt_partial') return esc.matchId;
  if (esc.status === 'pending' || esc.status === 'settling') return esc.matchId;
  return SETTLEMENT_PROTECTED.has(recovery) ? esc.matchId : null;
}

/** Injected side effects for applying a bootstrap recovery classification. */
export interface BootstrapApplyDeps {
  /** Reschedule the server-driven advance for a live match. */
  rescheduleAdvance: (room: ServerRoom) => void;
  /** Persist the room. */
  persist: (room: ServerRoom) => void;
  /** Clear the room's server timers (on cancel / freeze). */
  clearTimers: (room: ServerRoom) => void;
  /** PERMANENTLY freeze the room for operator review (logs the room code + a safe reason ONCE). */
  freeze: (room: ServerRoom, reason: string) => void;
}

/**
 * Apply a bootstrap recovery classification to a restored room (mutations + persistence via deps).
 * Returns the classification for logging/tests.
 *
 * ONLY `live` re-arms the advance. `paid_finish` keeps the finished state and marks the stats as
 * owed (the sweep records them idempotently — never re-paying); `incoherent_paid` freezes;
 * `cancelled` wipes the refunded match back to a clean lobby.
 */
export function applyBootstrapRecovery(room: ServerRoom, recovery: BootstrapRecovery, deps: BootstrapApplyDeps): BootstrapRecovery {
  switch (recovery) {
    case 'live':
      deps.rescheduleAdvance(room);
      break;
    case 'payout_pending':
      // Leave the finished state + funded escrow — the settlement sweep pays out then records stats.
      break;
    case 'paid_finish':
      // (37.7.10 FAIL 1) A durable PAID finish restored across a crash → keep the finished state and
      // finalize stats: mark stats-pending (idempotent via the durable game_key) so the sweep records
      // them EXACTLY once. NEVER cancel, never re-pay.
      room.pokerStatsPending = true;
      deps.persist(room);
      break;
    case 'recovery_pending':
      // (37.7.13 FAIL 2) The durable outcome is UNKNOWN (a transient reconciliation failure, or a
      // transient escrow that was never reconciled). Change NOTHING that could be wrong later: keep
      // the game state, the binding and the escrow as evidence, do not cancel, do not freeze, do not
      // settle. Only the timers are cleared so the table cannot advance or time out while unproven —
      // `escrowUnresolved` keeps gameplay/rematch/purge blocked until a later pass proves the
      // outcome (then: zero debit → cancelled, full + bound → live/finish, full + unbound → refund).
      deps.clearTimers(room);
      deps.persist(room);
      break;
    case 'corrupt_debit':
      // (37.7.13 FAIL 2) Only SOME seats have a durable buy-in. A refund would leave a debited seat
      // short and a payout would mint chips, so NEITHER is safe: freeze permanently for operator
      // review with the state + escrow intact (idempotent across repeated boots).
      // (37.7.15 FAIL 2) Also reached for a missing / unparseable / mismatched durable record and for
      // a buy-in ledger that does not back this escrow — one fail-closed operator state for all.
      deps.clearTimers(room);
      deps.freeze(room, 'durable match evidence does not match this table');
      deps.persist(room);
      break;
    case 'unknown_binding':
      // (37.7.12 FAIL 1) A legacy save carries a game state + a live escrow but no record of WHICH
      // match produced it. Guessing could pay a fresh buy-in for an old result (or refund a real live
      // match), so it fails CLOSED exactly like an incoherent paid state: no advance, no settlement,
      // no purge — frozen for operator review with the escrow + state kept intact.
      deps.clearTimers(room);
      deps.freeze(room, 'unknown match generation for the persisted game');
      deps.persist(room);
      break;
    case 'incoherent_paid':
      // (37.7.11 FAIL 1) Fail CLOSED: no advance, no timers, no gameplay/rematch, no settlement —
      // and NOT `pokerMatchCancelled` (nothing was refunded). Frozen is persisted, so it survives a
      // further restart, blocks START/ACTION/REMATCH, keeps teardown from purging, and surfaces
      // publicly as the opaque `frozen` recovery status.
      deps.clearTimers(room);
      deps.freeze(room, 'paid match with no finished state');
      deps.persist(room);
      break;
    case 'cancelled':
      room.pokerMatchCancelled = true;
      room.gameState = null;
      clearGameBinding(room); // (37.7.12) the binding dies with the state
      room.started = false;
      deps.clearTimers(room);
      deps.persist(room);
      break;
    // 'unbound_debit' needs a DB refund → handled by `recoverRestoredBankrollRoom` (async).
    // 'frozen' / 'not_bankroll' → no-op.
  }
  return recovery;
}

/** Injected side effects for the full per-room bootstrap recovery orchestration. */
export interface BootstrapRecoveryDeps extends BootstrapApplyDeps {
  /** Reconcile a restored transient (pending/settling) escrow vs the durable DB settlement. */
  reconcileEscrow: (room: ServerRoom) => Promise<EscrowReconcileResult | void>;
  /** True when `state` is a finished poker game. */
  isFinished: (state: PokerState) => boolean;
  /** Refund a buy-in (an UNBOUND fresh debit whose game never started) — the EXPLICIT outcome. */
  refundBuyIns: (room: ServerRoom) => Promise<import('./pokerEscrow').RefundResult>;
}

/**
 * PRODUCTION bootstrap recovery for ONE restored bankroll room — the whole sequence index.ts runs:
 * reconcile the durable escrow, classify, then apply (mutations + persist + the advance decision).
 * Call inside `withRoomLock(room.code, …)`.
 *
 * (37.7.11) This exists so the integration tests drive the REAL orchestration instead of re-creating
 * the branching locally — Stage 37.7.10's integration test mirrored these steps by hand, which is
 * why it never noticed that the restore loop had already armed the advance, nor that a `settled`
 * escrow with an unfinished state was classified `live`.
 */
export async function recoverRestoredBankrollRoom(
  room: ServerRoom, deps: BootstrapRecoveryDeps, reconciled?: EscrowReconcileResult,
): Promise<BootstrapRecovery> {
  if (!isBankrollRoomShape(room) || !room.gameState) return 'not_bankroll';
  // (37.7.13) `reconciled` is the outcome the ORCHESTRATION already obtained for this room — reusing
  // it keeps one boot's protection decision and its recovery decision derived from the SAME durable
  // read. Called standalone (no precomputed value), this reconciles here as before.
  const reconcile = reconciled ?? (await deps.reconcileEscrow(room)) ?? 'noop';
  const recovery = classifyBootstrapRecovery(room, deps.isFinished, reconcile);
  if (recovery === 'unbound_debit') {
    // (37.7.12 FAIL 1) A fresh buy-in whose game never started, restored next to the PREVIOUS match's
    // state: drop the stale state and refund the new escrow (idempotent). A transient refund failure
    // leaves an honest settlement-pending room the sweep retries. Never paid, never recorded.
    const res = await resolveUnboundEscrowGame(room, { refundBuyIns: deps.refundBuyIns, persist: deps.persist, clearTimers: deps.clearTimers });
    // (37.7.18 FAIL 1) The payout won the race (or the evidence is unprovable) → NOT a refund: this
    // is a paid/incoherent match with no game, so it fails closed into a frozen operator state.
    if (res === 'paid_conflict') {
      deps.freeze(room, 'durable match evidence does not match this table');
      deps.persist(room);
      return 'corrupt_debit';
    }
    return recovery;
  }
  return applyBootstrapRecovery(room, recovery, deps);
}

/** Injected side effects for the WHOLE startup economy pipeline (37.7.13). */
export interface BootstrapEconomyDeps extends BootstrapRecoveryDeps {
  /** True for an online poker room with a server-derived buy-in (economy enabled). */
  isBankrollRoom: (room: ServerRoom) => boolean;
  /** True when the room still holds unsettled escrow (or a corrupt/frozen one). */
  hasUnsettledEscrow: (room: ServerRoom) => boolean;
  /** DB-authoritative orphan scan: refunds every committed match NOT in the protected set, and
   *  reports the room codes owning a MALFORMED durable record (37.7.14 FAIL 3). */
  reconcileOrphanedDebits: (protectedMatchIds: Set<string>, protectedRoomCodes?: ReadonlySet<string>) => Promise<{ refunded: string[]; corrupt: string[]; corruptRefs?: ReadonlyArray<{ matchId: string; roomCode: string; reasonCode: string }>; retryable?: string[]; alreadyPaid?: string[] }>;
  /** Resolve a room whose PERSISTED escrow was malformed; false → freeze for operator review. */
  reconcileCorruptRoom: (room: ServerRoom) => Promise<boolean>;
  /** The per-room lifecycle mutex. */
  withRoomLock: <T>(code: string, fn: () => Promise<T>) => Promise<T>;
  /** True while the room is still registered (it may be swept mid-recovery). */
  roomExists: (room: ServerRoom) => boolean;
  /** Operator log sinks (room codes + safe reasons only — never a matchId/userId). */
  log: (message: string) => void;
  logError: (message: string) => void;
}

export interface BootstrapEconomyReport {
  /** room code → the classification that was applied (absent for a non-bankroll room). */
  recoveries: Map<string, BootstrapRecovery>;
  /** room code → the EXPLICIT reconciliation outcome for that room. */
  reconciled: Map<string, EscrowReconcileResult>;
  /** The exact set handed to the orphan scan. */
  protectedMatchIds: Set<string>;
  /** Match ids the orphan scan actually refunded. */
  orphanRefunded: string[];
  /** Room codes frozen because their DURABLE match record is malformed (37.7.14 FAIL 3). */
  corruptDurableRooms: string[];
}

/**
 * (37.7.13 FAIL 1) The COMPLETE startup economy pipeline for every restored room — the single
 * function `server/index.ts` runs and the integration tests drive, so a test can no longer verify a
 * per-room helper while silently skipping the GLOBAL orphan scan that runs before it.
 *
 * ORDER (the fix): reconcile → classify → derive settlement protection FROM those classifications →
 * orphan scan → corrupt-room pass → apply recovery. Previously the scan ran on a set built from a
 * room SHAPE test BEFORE any classification existed, so a room that classification would have frozen
 * (an unknown/unproven binding) was refunded first.
 *
 * The classification computed for protection is REUSED by the apply pass, so protection and recovery
 * can never disagree within one boot.
 */
export async function runBootstrapEconomyRecovery(restored: ServerRoom[], deps: BootstrapEconomyDeps): Promise<BootstrapEconomyReport> {
  const bankroll = restored.filter((r) => deps.isBankrollRoom(r));
  const reconciled = new Map<string, EscrowReconcileResult>();

  // (a) Prove EXACT durable ownership for every room that CLAIMS an economy match, keeping the
  // EXPLICIT outcome. (37.7.16 FAIL 2) The filter used to be `hasUnsettledEscrow`, so a room whose
  // escrow was already `settled`/`cancelled` skipped validation entirely — a terminal status in room
  // JSON is a CLAIM, not DB proof, so such a room could reach `paid_finish` (and write stats
  // attributed from a room escrow that no durable record backs) or wipe its state as `cancelled`.
  await Promise.all(bankroll.filter(claimsEconomyMatch).map((r) => deps
    .withRoomLock(r.code, async () => (await deps.reconcileEscrow(r)) ?? 'noop')
    .then((res) => { reconciled.set(r.code, res); if (deps.roomExists(r)) deps.persist(r); })
    .catch(() => { reconciled.set(r.code, 'retry_pending'); }))); // a thrown reconcile proves nothing

  // (b) Classify (PURE) — this is what decides which durable matches the orphan scan may settle.
  const recoveries = new Map<string, BootstrapRecovery>();
  for (const r of bankroll) {
    recoveries.set(r.code, classifyBootstrapRecovery(r, deps.isFinished, reconciled.get(r.code) ?? 'noop'));
  }

  // (c) Protect every match that is live, unproven or frozen — derived from (b), never from a shape.
  const protectedMatchIds = new Set<string>();
  for (const r of bankroll) {
    const id = settlementProtectedMatchId(r, recoveries.get(r.code) ?? 'not_bankroll', reconciled.get(r.code) ?? 'noop');
    if (id) protectedMatchIds.add(id);
  }

  // (37.7.18 FAIL 2) A room with a CORRUPT persisted escrow has no provable matchId, so every durable
  // match naming its ROOM CODE is fail-closed protected — the code alone can never authorise a
  // settlement (a reused code may belong to an entirely different generation).
  const protectedRoomCodes = new Set(restored.filter((r) => r.pokerEscrowCorrupt).map((r) => r.code));

  // (d) DB-authoritative orphan scan — ONLY now, and only for unprotected matches.
  let orphanRefunded: string[] = [];
  let corruptMatchIds = new Set<string>();
  try {
    // (37.7.19 FAIL 3) Inside the economy barrier, with protection re-read for any in-flight escrow.
    const scan = await withEconomyBarrier(async () => {
      for (const r of bankroll) {
        const e = r.pokerEscrow;
        if (e?.status === 'pending' || e?.status === 'settling') protectedMatchIds.add(e.matchId);
      }
      return deps.reconcileOrphanedDebits(protectedMatchIds, protectedRoomCodes);
    });
    orphanRefunded = scan.refunded;
    corruptMatchIds = new Set((scan.corruptRefs ?? []).map((c) => c.matchId));
    if (scan.refunded.length) deps.log(`crash recovery: refunded ${scan.refunded.length} orphaned poker match(es)`);
  } catch (err) {
    deps.logError(`orphaned-debit reconciliation failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }

  // (e) Corrupt PERSISTED escrow: refund by room code, or freeze when the durable record is corrupt.
  await Promise.all(restored.filter((r) => r.pokerEscrowCorrupt).map(async (r) => {
    const ok = await deps.reconcileCorruptRoom(r).catch(() => false);
    if (!ok) deps.freeze(r, 'corrupt durable match');
    if (deps.roomExists(r)) deps.persist(r);
  }));

  // (e2) (37.7.14 FAIL 3) A restored room whose DURABLE match record is malformed must be FROZEN
  // BEFORE the apply pass. `pokerEscrowCorrupt` above only covers a malformed persisted room JSON;
  // this is the opposite shape — a structurally VALID room escrow whose `poker_matches` row cannot be
  // parsed. Its participant evidence is unsafe, so the table can never be classified/applied as
  // `live`: it is never advanced, refunded, paid, recorded or purged, and everything is kept for the
  // operator. Freezing here makes the (f) pass a no-op for it (classification short-circuits to
  // `frozen`), and the freeze is logged exactly once so repeated boots do not spam.
  //
  // (37.7.15 FAIL 1) The association is by **matchId**, never by room code. A room code is 4 chars
  // and `makeRoomCode` only avoids collisions with the LIVE in-memory rooms, while an unresolved
  // corrupt `poker_matches` row survives indefinitely — so matching on the code permanently froze a
  // brand-new healthy table that reused a dead room's code. `roomCode` stays audit context only.
  const corruptRooms: string[] = [];
  for (const r of bankroll) {
    const matchId = r.pokerEscrow?.matchId;
    if (!matchId || !corruptMatchIds.has(matchId)) continue;
    corruptRooms.push(r.code);
    if (r.pokerFrozen) continue;
    deps.clearTimers(r);
    deps.freeze(r, 'corrupt durable match record');
    recoveries.set(r.code, 'frozen');
    if (deps.roomExists(r)) deps.persist(r);
  }

  // (e3) (37.7.17 FAIL 2) CONFIRMED-REFUND GATING. An escrowless claim may only become a clean
  // cancelled lobby once a refund for THAT EXACT matchId was confirmed by the scan in this boot.
  // A transient scan failure, a corrupt record, or a durable payout leaves it inert/frozen instead —
  // the old code cancelled it (and wiped state + binding) regardless of what the scan actually did.
  const confirmedRefunded = new Set(orphanRefunded);
  const reconciledFor = (r: ServerRoom): EscrowReconcileResult => {
    const res = reconciled.get(r.code) ?? 'noop';
    if (res === 'escrowless_unresolved' && r.pokerGameMatchId && confirmedRefunded.has(r.pokerGameMatchId)) return 'cancelled';
    return res;
  };
  // (e4) A room with NO game state cannot go through the apply pass below, so freeze an unprovable
  // claim (e.g. owed stats with no escrow) here — never leave it silently resolvable.
  for (const r of bankroll) {
    if (r.gameState || r.pokerFrozen || !isCorruptEvidence(reconciledFor(r))) continue;
    deps.clearTimers(r);
    deps.freeze(r, 'durable match evidence does not match this table');
    recoveries.set(r.code, 'corrupt_debit');
    if (deps.roomExists(r)) deps.persist(r);
  }

  // (f) Apply the recovery decided in (b), serialized per room.
  for (const r of bankroll) {
    if (!r.gameState) continue;
    const recovery = await deps.withRoomLock(r.code, () => recoverRestoredBankrollRoom(r, deps, reconciledFor(r)))
      .catch((err) => {
        // A failure leaves the room UNCLASSIFIED — no advance was armed (the restore loop deferred
        // it), so it stays inert until the next sweep/restart resolves it.
        deps.logError(`bootstrap recovery failed for room ${r.code}: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
        return null;
      });
    if (recovery) recoveries.set(r.code, recovery);
    if (recovery === 'cancelled') deps.log(`bankroll match cancelled on recovery (room ${r.code}) — buy-ins were refunded`);
    if (recovery === 'recovery_pending') deps.log(`bankroll match UNRESOLVED on recovery (room ${r.code}) — held for the next reconciliation`);
  }
  return {
    recoveries, reconciled, protectedMatchIds, orphanRefunded,
    corruptDurableRooms: corruptRooms,
  };
}

/** The outcome of ONE runtime recovery sweep for a room (37.7.14 FAIL 1). */
export interface RecoverySweepOutcome {
  /** The reconciliation outcome, or null when nothing needed reconciling. */
  reconciled: EscrowReconcileResult | null;
  /** The classification applied, or null when the room carries no game state. */
  recovery: BootstrapRecovery | null;
  /** True when this sweep PROVED something new (→ the caller broadcasts/logs; false = still unproven). */
  changed: boolean;
}

/**
 * (37.7.14 FAIL 1) RUNTIME recovery sweep for ONE room — the periodic counterpart of the bootstrap
 * pass, and the fix for a room that could only be unstuck by a server restart.
 *
 * Stage 37.7.13 said an unresolved (`pending`/`settling`) escrow would be "retried on the next
 * sweep". It was not: `retryPendingSettlements` never called `reconcileEscrow`, and its predicates
 * (`settlementPending`/`payoutPending`) require a FUNDED escrow, so an unresolved room simply stayed
 * blocked for the life of the process — while the FIRST branch, `unboundEscrowGame`, did match a
 * `pending`/`settling` unbound room and dropped its state + binding before any durable proof.
 *
 * RECONCILIATION HAS PRECEDENCE over every unbound/refund/payout/stats route. Call inside
 * `withRoomLock(room.code, …)`. Reuses the SHARED classify/apply policy — no second copy of the
 * recovery branching in `server/index.ts`. Because the entry condition is "escrow is transient", a
 * resolved room stops matching, so a `live` room is re-armed EXACTLY once (never every sweep tick).
 */
export async function runRoomRecoverySweep(room: ServerRoom, deps: BootstrapRecoveryDeps): Promise<RecoverySweepOutcome> {
  const idle: RecoverySweepOutcome = { reconciled: null, recovery: null, changed: false };
  if (!isBankrollRoomShape(room)) return idle;
  if (room.pokerFrozen) return { reconciled: null, recovery: 'frozen', changed: false }; // permanent operator state
  const status = room.pokerEscrow?.status;
  if (status !== 'pending' && status !== 'settling') return idle; // durable → the funded retries apply

  const reconciled = (await deps.reconcileEscrow(room)) ?? 'noop';
  const proven = reconciled !== 'retry_pending';
  if (!room.gameState) {
    // No state to classify. A PARTIAL debit still can't be settled either way → freeze; anything else
    // just carries its now-proven escrow status into the normal funded/settled/cancelled handling.
    if (isCorruptEvidence(reconciled)) { deps.clearTimers(room); deps.freeze(room, 'durable match evidence does not match this table'); }
    deps.persist(room);
    return { reconciled, recovery: null, changed: proven };
  }
  const recovery = await recoverRestoredBankrollRoom(room, deps, reconciled);
  return { reconciled, recovery, changed: proven };
}

/** Injected side effects for the RUNTIME economy recovery pass (37.7.18 FAIL 3). */
export interface RuntimeRecoveryDeps extends BootstrapRecoveryDeps {
  isBankrollRoom: (room: ServerRoom) => boolean;
  reconcileOrphanedDebits: BootstrapEconomyDeps['reconcileOrphanedDebits'];
  withRoomLock: <T>(code: string, fn: () => Promise<T>) => Promise<T>;
  roomExists: (room: ServerRoom) => boolean;
  log: (message: string) => void;
  logError: (message: string) => void;
}

export interface RuntimeRecoveryReport {
  /** room code → the reconciliation outcome for each ESCROWLESS claim this pass resolved. */
  reconciled: Map<string, EscrowReconcileResult>;
  /** room code → the recovery applied to it (absent when nothing was applied). */
  recoveries: Map<string, BootstrapRecovery>;
  protectedMatchIds: Set<string>;
  protectedRoomCodes: Set<string>;
  orphanRefunded: string[];
  orphanAlreadyPaid: string[];
  orphanRetryable: string[];
}

/**
 * (37.7.18 FAIL 3) The RUNTIME counterpart of the bootstrap economy pass — the fix for recovery work
 * that previously needed a server RESTART.
 *
 * The global orphan scan ran ONLY at bootstrap, so a roomless orphan whose guarded refund failed
 * transiently stayed debited for the life of the process; and an `escrowless_unresolved` room stayed
 * inert forever because the periodic sweep only looked at `pending`/`settling` escrows.
 *
 * It deliberately does NOT re-run the full bootstrap apply: a healthy `live` / `payout_pending` /
 * `paid_finish` room is classified for PROTECTION only and never re-applied, so no timer or advance
 * is re-armed on a 45s tick. Only escrowless claims are resolved and applied here.
 * The caller must make this SINGLE-FLIGHT (one pass at a time, never concurrent with bootstrap).
 */
export async function runRuntimeEconomyRecovery(rooms: ServerRoom[], deps: RuntimeRecoveryDeps): Promise<RuntimeRecoveryReport> {
  const bankroll = rooms.filter((r) => deps.isBankrollRoom(r));
  const reconciled = new Map<string, EscrowReconcileResult>();
  const recoveries = new Map<string, BootstrapRecovery>();

  // (a) Resolve ONLY the rooms this pass owns: escrowless economy claims. (A transient escrow keeps
  // its own per-room `runRoomRecoverySweep` branch; a healthy room is never touched.)
  for (const r of bankroll) {
    if (r.pokerFrozen || r.pokerEscrow || !claimsEconomyMatch(r)) continue;
    const res = await deps.withRoomLock(r.code, async () => (await deps.reconcileEscrow(r)) ?? 'noop')
      .catch(() => 'retry_pending' as EscrowReconcileResult);
    reconciled.set(r.code, res);
  }

  // (b) Protection is derived from EVERY bankroll room's classification (never from a room shape).
  const protectedMatchIds = new Set<string>();
  const protectedRoomCodes = new Set<string>();
  for (const r of bankroll) {
    if (r.pokerEscrowCorrupt) protectedRoomCodes.add(r.code);
    const rec = reconciled.get(r.code) ?? 'noop';
    const id = settlementProtectedMatchId(r, classifyBootstrapRecovery(r, deps.isFinished, rec), rec);
    if (id) protectedMatchIds.add(id);
    // An escrowless claim is only scan-eligible once it is PROVEN to be an exact, unsettled orphan.
    if (!r.pokerEscrow && r.pokerGameMatchId && rec !== 'escrowless_unresolved') protectedMatchIds.add(r.pokerGameMatchId);
  }

  // (c) The guarded global scan — the same one bootstrap runs, INSIDE the economy barrier so no
  // durable debit can commit between the protection rebuild and the scan (37.7.19 FAIL 3).
  let orphanRefunded: string[] = [];
  let orphanAlreadyPaid: string[] = [];
  let orphanRetryable: string[] = [];
  try {
    const scan = await withEconomyBarrier(async () => {
      // Re-read protection INSIDE the barrier: any debit that already marked its escrow `pending`
      // is now visible and protected; any that has not yet started cannot commit until we finish.
      for (const r of bankroll) {
        const rec = reconciled.get(r.code) ?? 'noop';
        const id = settlementProtectedMatchId(r, classifyBootstrapRecovery(r, deps.isFinished, rec), rec);
        if (id) protectedMatchIds.add(id);
        // Fail-closed for an IN-FLIGHT debit only (`pending`/`settling`): a `funded` escrow is
        // already decided by classification (an unbound one must stay orphan-refundable).
        if (r.pokerEscrow?.status === 'pending' || r.pokerEscrow?.status === 'settling') {
          protectedMatchIds.add(r.pokerEscrow.matchId);
        }
      }
      return deps.reconcileOrphanedDebits(protectedMatchIds, protectedRoomCodes);
    });
    orphanRefunded = scan.refunded;
    orphanAlreadyPaid = scan.alreadyPaid ?? [];
    orphanRetryable = scan.retryable ?? [];
    if (scan.refunded.length) deps.log(`runtime recovery: refunded ${scan.refunded.length} orphaned poker match(es)`);
  } catch (err) {
    deps.logError(`runtime orphaned-debit recovery failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }

  // (d) Apply ONLY the escrowless outcomes — a claim becomes a clean lobby solely on a CONFIRMED
  // refund of that exact matchId in THIS pass.
  const confirmed = new Set(orphanRefunded);
  for (const r of bankroll) {
    if (!reconciled.has(r.code) || r.pokerFrozen) continue;
    let rec = reconciled.get(r.code) as EscrowReconcileResult;
    if (rec === 'escrowless_unresolved' && r.pokerGameMatchId && confirmed.has(r.pokerGameMatchId)) rec = 'cancelled';
    if (rec === 'escrowless_unresolved' || rec === 'retry_pending') continue; // still unproven → inert
    const recovery = await deps.withRoomLock(r.code, async () => {
      if (!deps.roomExists(r) || r.pokerFrozen) return null;
      const cls = classifyBootstrapRecovery(r, deps.isFinished, rec);
      if (cls === 'not_bankroll') {
        // No game state to classify (e.g. owed stats with no escrow) — freeze an unprovable claim.
        if (!isCorruptEvidence(rec)) return null;
        deps.clearTimers(r);
        deps.freeze(r, 'durable match evidence does not match this table');
        deps.persist(r);
        return 'corrupt_debit' as BootstrapRecovery;
      }
      return applyBootstrapRecovery(r, cls, deps);
    }).catch(() => null);
    if (recovery) recoveries.set(r.code, recovery);
  }
  return { reconciled, recoveries, protectedMatchIds, protectedRoomCodes, orphanRefunded, orphanAlreadyPaid, orphanRetryable };
}
