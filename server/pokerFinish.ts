// ---------------------------------------------------------------------------
// Poker bankroll FINISH processing (Stage 37.7.8). Extracted from server/index.ts so the
// SETTLEMENT-BEFORE-STATS ordering and the permanent invalid→frozen transition are unit-testable
// with injected deps (real escrow/stats against Postgres, or spies) WITHOUT booting the WS server.
//
// The previous code ran payout (fire-and-forget) and stats (fire-and-forget) in PARALLEL, so a
// bankroll match's stats/rating/achievements could be written BEFORE — or even without — a
// confirmed payout. Now payout and stats are ONE serialized flow (the caller holds withRoomLock):
//   • paid / already_paid → record stats (idempotent, exactly once);
//   • retry_pending       → NO stats now (the settlement sweep records them after a later paid);
//   • already_refunded    → NEVER record stats; turn the finished table into a cancelled lobby;
//   • invalid             → NEVER record stats; PERMANENTLY freeze for operator review (no retry).
// ---------------------------------------------------------------------------

import type { ServerRoom } from '../src/net/serverCore';
import type { PokerState } from '../src/games/poker/types';
import type { PayoutResult } from './pokerEscrow';
import type { SeatUsers, RecordResult } from './db/stats';
import { pokerFinishSignature } from '../src/net/pokerStats';

/** Injected side effects for recording confirmed bankroll poker stats (idempotent). */
export interface ConfirmedStatsDeps {
  /** True when this room already recorded a finish with this signature (dedup). */
  alreadyRecorded: (roomCode: string, sig: string) => boolean;
  /** Mark this room's finish signature as recorded (before the async write). */
  markRecorded: (roomCode: string, sig: string) => void;
  /** Undo the mark on a failed write so a later retry can record. */
  unmarkRecorded: (roomCode: string) => void;
  /** The actual per-game recorder (idempotent via games.game_key). */
  record: (roomCode: string, state: PokerState, seatUsers: SeatUsers) => Promise<RecordResult>;
}

/**
 * Record stats for a CONFIRMED-paid bankroll poker finish. Applies the same human-only gate,
 * per-room signature dedup, and seat→account mapping as the generic finish path, but is only ever
 * called AFTER a confirmed payout. Idempotent: a rebroadcast/reconnect/restart/retry never writes
 * twice (the signature marker + the recorder's own game_key both no-op). Returns whether it recorded.
 */
export async function recordConfirmedPokerStats(room: ServerRoom, state: PokerState, deps: ConfirmedStatsDeps): Promise<boolean> {
  // Owner rule: rating/stats count ONLY human-vs-human games (any bot or <2 humans → skip).
  const players = [...room.members.values()].filter((m) => m.role === 'player');
  const humanPlayers = players.filter((m) => m.type === 'human').length;
  const botPlayers = players.filter((m) => m.type === 'ai').length;
  if (botPlayers > 0 || humanPlayers < 2) return false;

  const sig = pokerFinishSignature(state);
  if (deps.alreadyRecorded(room.code, sig)) return false; // already recorded (rebroadcast/retry)
  deps.markRecorded(room.code, sig);

  const seatUsers: SeatUsers = new Map<number, string | null>();
  for (const m of room.members.values()) {
    if (m.role === 'player' && m.type === 'human' && m.seatIndex != null && m.userId) {
      seatUsers.set(m.seatIndex, m.userId);
    }
  }
  if (seatUsers.size === 0) return false;

  try {
    const res = await deps.record(room.code, state, seatUsers);
    return !!res.recorded;
  } catch {
    deps.unmarkRecorded(room.code); // allow a later retry (transient DB error)
    return false;
  }
}

/** Injected side effects for the settle-then-record finish flow. */
export interface BankrollFinishDeps {
  /** Pay out the finished match's final stacks (DB-authoritative; idempotent). */
  payoutStacks: (room: ServerRoom, state: PokerState) => Promise<PayoutResult>;
  /** Record confirmed stats (only called after paid/already_paid). */
  recordStats: (room: ServerRoom, state: PokerState) => Promise<boolean>;
  /** Persist the room. */
  persist: (room: ServerRoom) => void;
  /** Broadcast the public room snapshot (recovery status). */
  broadcast: (room: ServerRoom) => void;
  /** Drop any pending rematch readiness. */
  clearRematch: (room: ServerRoom) => void;
  /** PERMANENTLY freeze the room for operator review (invalid payout). Logs once, no auto-retry. */
  freeze: (room: ServerRoom, reason: string) => void;
}

export interface BankrollFinishOutcome {
  result: PayoutResult;
  statsRecorded: boolean;
}

/**
 * Settle a FINISHED bankroll poker match, THEN record stats — never the reverse, and never in
 * parallel. Call inside `withRoomLock(room.code, …)`. Stats are recorded ONLY on a confirmed
 * payout; `already_refunded` cancels the finished table; `invalid` freezes it permanently.
 */
export async function settleAndRecordBankrollPokerFinish(room: ServerRoom, state: PokerState, deps: BankrollFinishDeps): Promise<BankrollFinishOutcome> {
  const result = await deps.payoutStacks(room, state);
  switch (result) {
    case 'paid':
    case 'already_paid': {
      deps.persist(room);
      deps.broadcast(room); // paid → recovery clears → rematch enabled
      const statsRecorded = await deps.recordStats(room, state);
      return { result, statsRecorded };
    }
    case 'already_refunded':
      // The DB gate says this match was refunded → NEVER pay/continue it as paid, and NEVER record
      // stats. Turn the finished table into an honest cancelled lobby.
      room.started = false;
      room.gameState = null;
      room.pokerMatchCancelled = true;
      deps.clearRematch(room);
      deps.persist(room);
      deps.broadcast(room);
      return { result, statsRecorded: false };
    case 'retry_pending':
      // Transient failure → escrow left funded (payout_pending). Stats are DEFERRED to the sweep
      // that eventually pays out (so they can never precede a payout that later proves refunded).
      deps.persist(room);
      deps.broadcast(room);
      return { result, statsRecorded: false };
    case 'invalid':
      // PERMANENT fail-closed/operator condition (bad conservation/escrow) — NOT a transient DB
      // failure. Freeze the room so no sweep retries the impossible payout and no stats are written.
      deps.freeze(room, 'payout conservation invalid');
      deps.persist(room);
      deps.broadcast(room);
      return { result, statsRecorded: false };
  }
}
