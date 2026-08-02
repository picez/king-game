// ---------------------------------------------------------------------------
// Permanent "Leave game" orchestration (Stage 38.0.5).
//
// THE ONE server-side helper for an irreversible active-game forfeit. Every rule
// that makes this safe lives here, so there is exactly one ordering to reason about
// and exactly one place a test can drive.
//
// WHAT IT IS NOT
//   • not `LEAVE_ROOM`  — that is LOBBY-only: it frees the seat, records nothing and
//     never spawns a replacement bot;
//   • not "Back to menu" — that only drops the socket; the seat stays RECONNECTABLE.
//   Permanent leave is the third, deliberately separate exit: a durable technical
//   loss, an AI on the same seat (or a closed room), and an annulled reconnect
//   identity. It is never reachable from the lobby, from a spectator seat, or from
//   Poker (whose real-chip economy is out of scope for this stage).
//
// THE ORDER IS THE FEATURE (and it is never inverted):
//   1. serialize on the ROOM (`withRoomLock`) — nothing else may reshape the room;
//   2. validate against AUTHORITATIVE state only (the wire message has NO payload);
//   3. COMMIT the durable forfeit FIRST — for an authenticated account this must
//      succeed, or the whole request fails RETRYABLY with nothing changed;
//   4. only then take the seat over irreversibly (or close the room);
//   5. persist → broadcast the remaining room → ACK the leaver.
//   A takeover without a committed forfeit is impossible by construction, and a
//   committed forfeit without a takeover is retried by the client (the DB gate makes
//   the second attempt a no-op, so it can never produce a second loss).
//
// WHAT IT DOES NOT DO
//   • it never calls `removeMember`/`assignSeats` — re-numbering seats mid-match would
//     repoint every remaining player at a different `player-<n>` than the live game
//     state uses (turn order, dealer, teams, contracts);
//   • it never touches `gameState` — no restart, no re-deal, no playerId change;
//   • it never mints a new turn deadline — the current clock keeps running.
// ---------------------------------------------------------------------------

import {
  planPermanentLeave, hasOtherHuman, takeoverSeatWithAi, type ServerRoom,
} from '../src/net/serverCore';
import { markSeatForfeited, isSeatForfeited, type OnlineMatchMeta } from '../src/net/onlineMatch';
import type { ForfeitResult, StartRecordResult } from './db/onlineMatches';

/** Everything the orchestration needs from the I/O layer (injected → testable). */
export interface PermanentLeaveDeps {
  /** The live room registry — used to prove the room is still the SAME instance. */
  rooms: Map<string, ServerRoom>;
  /** True when Postgres is configured (a durable forfeit is only possible then). */
  dbEnabled: () => boolean;
  /** Make the frozen match durable (idempotent). Throws on a transient DB failure. */
  ensureDurableMatch: (meta: OnlineMatchMeta) => Promise<StartRecordResult>;
  /** The single gated forfeit transition. Throws on a transient DB failure. */
  applyForfeit: (input: {
    matchId: string; seatIndex: number; userId: string | null; at: Date;
  }) => Promise<ForfeitResult>;
  /** Drop the leaver's socket mapping + voice membership (never any other member's). */
  detachClient: (room: ServerRoom, clientId: string) => void;
  /** Tear the room down (no human is left). Handles timers + storage. */
  closeRoom: (room: ServerRoom) => void;
  persist: (room: ServerRoom) => void;
  /** Broadcast the new membership (ROOM_UPDATE) to everyone who stayed. */
  broadcastRoom: (room: ServerRoom) => void;
  /**
   * Re-broadcast the state and RE-EVALUATE the server-driven step. MUST be the
   * "connection event" variant (no `turnAdvanced`), so the current turn deadline is
   * neither reset nor extended; it schedules EXACTLY ONE bot action when the taken-over
   * seat is the one on the clock.
   */
  advance: (room: ServerRoom) => void;
  /** Fresh server-generated identity for the replacement AI (clientId + token hash). */
  newIds: () => { clientId: string; reconnectToken: string };
  now: () => number;
}

/**
 * Why a permanent leave was refused. `retryable` means NOTHING changed and the client
 * may try again (or use the reconnectable Back-to-menu exit); `refused` is terminal for
 * this request (lobby / spectator / Poker / not a member / a durable conflict).
 */
export type PermanentLeaveResult =
  | { ok: true; kind: 'takeover' | 'room_closed' | 'already_left' }
  | { ok: false; reason: 'refused' | 'retryable' };

const REFUSED: PermanentLeaveResult = { ok: false, reason: 'refused' };
const RETRYABLE: PermanentLeaveResult = { ok: false, reason: 'retryable' };

/**
 * Execute one permanent-leave intent. The caller supplies ONLY authoritative values:
 * the room + clientId from the socket's server-side session, and the account id
 * resolved from the session cookie (null for a guest) — never anything client-sent.
 *
 * MUST be invoked inside the room lock (`withRoomLock(room.code, ...)`); the caller
 * owns that so the lock order stays identical to every other room lifecycle op.
 */
export async function runPermanentLeave(
  code: string,
  clientId: string,
  userId: string | null,
  deps: PermanentLeaveDeps,
): Promise<PermanentLeaveResult> {
  const room = deps.rooms.get(code);
  if (!room) return REFUSED;

  const plan = planPermanentLeave(room, clientId);
  if (!plan.ok || plan.seatIndex == null) return REFUSED;
  const seatIndex = plan.seatIndex;
  // The account comes from the SESSION; the seat's stamped id must agree with it, or
  // we would attribute a forfeit to the wrong account.
  const account = userId ?? plan.userId ?? null;
  if (userId && plan.userId && userId !== plan.userId) return REFUSED;

  const meta = room.onlineMatch;
  // No frozen match metadata → no immutable roster, no category, no durable identity.
  // Fail CLOSED: never take a seat over when the result could not be attributed.
  if (!meta) return REFUSED;
  if (meta.roomCode !== room.code || meta.gameType !== room.gameType) return REFUSED;

  // ── 3. DURABLE FORFEIT FIRST ──────────────────────────────────────────────
  if (account) {
    // An AUTHENTICATED leave is only acceptable when the technical loss can be written
    // exactly once. Without a database that is impossible → retryable refusal, and the
    // room/seat/session stay byte-identical.
    if (!deps.dbEnabled()) return RETRYABLE;
    if (meta.durable !== true) {
      let start: StartRecordResult;
      try { start = await deps.ensureDurableMatch(meta); } catch { return RETRYABLE; }
      // The durable record describes a DIFFERENT match than the room JSON claims →
      // never overwrite, never guess: refuse permanently.
      if (start === 'conflict') return REFUSED;
      meta.durable = true;
    }
    let res: ForfeitResult;
    try {
      res = await deps.applyForfeit({ matchId: meta.matchId, seatIndex, userId: account, at: new Date(deps.now()) });
    } catch {
      return RETRYABLE; // transient DB failure → nothing changed, retry is safe
    }
    if (res === 'conflict') return REFUSED;
    // 'applied' | 'already_applied' — the loss is durable exactly once either way.
  } else if (deps.dbEnabled() && meta.durable === true) {
    // A GUEST has no account to attribute, so the durable write is BEST EFFORT: the
    // seat-keyed row is still marked so the finish never re-uses that seat, but a
    // failure must not block the authoritative takeover (there is nothing to lose).
    try { await deps.applyForfeit({ matchId: meta.matchId, seatIndex, userId: null, at: new Date(deps.now()) }); }
    catch { /* best effort — the room JSON forfeit marker below is authoritative here */ }
  }

  // The room may have been finished/torn down by a timer while we awaited the DB (the
  // room lock does not stop the sync timer callbacks). Re-prove everything.
  const live = deps.rooms.get(code);
  if (!live || live !== room) {
    // The forfeit is committed and the room is gone — the client must stop trying to
    // resume it. This is a SUCCESS for the leaver, not an error.
    return { ok: true, kind: 'already_left' };
  }
  // Record the departure in the frozen metadata (idempotent, at most one per seat).
  markSeatForfeited(meta, seatIndex, deps.now());

  const recheck = planPermanentLeave(live, clientId);
  if (!recheck.ok) {
    // The member vanished mid-flight (e.g. its socket closed and the room was purged as
    // an orphan). The durable loss stands; nothing further to transition.
    deps.persist(live);
    return { ok: true, kind: 'already_left' };
  }

  // ── 4/5. IRREVERSIBLE SEAT TRANSITION, then persist → broadcast → ACK ──────
  const othersRemain = hasOtherHuman(live, clientId);
  // Detach the leaver's socket + voice BEFORE the broadcast, so the room update goes
  // only to the players who stayed.
  deps.detachClient(live, clientId);

  if (!othersRemain) {
    // No human is left: an AI-only table must not linger. Close it immediately.
    deps.closeRoom(live);
    return { ok: true, kind: 'room_closed' };
  }

  const takeover = takeoverSeatWithAi(live, clientId, deps.newIds());
  if (!takeover.ok) {
    // Cannot happen after the recheck above, but never leave the room half-changed.
    deps.persist(live);
    return { ok: true, kind: 'already_left' };
  }

  deps.persist(live);
  deps.broadcastRoom(live);
  // Connection-event variant: keeps the current turn deadline and schedules exactly one
  // bot action when the replaced seat is the one to act.
  deps.advance(live);
  return { ok: true, kind: 'takeover' };
}

/** True when this seat's starting human already permanently left THIS match. */
export function seatAlreadyForfeited(room: ServerRoom, seatIndex: number): boolean {
  return !!room.onlineMatch && isSeatForfeited(room.onlineMatch, seatIndex);
}
