// ---------------------------------------------------------------------------
// WebSocket client-message dispatch (extracted from server/index.ts, Stage 8.1).
//
// `handleClientMessage` is the same big switch as before — moved verbatim into a
// function that receives a context (`WsContext`) of the server-state operations
// that still live in index.ts (broadcast/persist/timers/lifecycle), plus a
// per-connection `sessionRef` and `attachIdentity`. NO protocol, gameplay,
// rules, scoring, persistence, auth, or chat/reaction behaviour changes — every
// branch does exactly what it did inline.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, ErrorCode } from '../src/net/messages';
import {
  createRoom, addMember, removeMember, reconnectMember, reclaimMemberByUserId, findUserRoomCodes,
  kickMember, addBot, setTimer,
  startGame, applyActionRequest, listRoomSummaries, sanitizedStateFor, roomTimerInfo,
  type ServerRoom, type ServerMember,
} from '../src/net/serverCore';
import { isGameType, getGameCatalogEntry } from '../src/games/catalog';
import { normalizeTargetScore } from '../src/games/tarneeb/rules';
import { normalizeEliminationScore } from '../src/games/fiftyOne/rules';
import { findStakesPreset, validateBlindGrowth } from '../src/games/poker/stakes';
import { isDbEnabled } from './db/client';
import { isBankrollRoom, validateBankrollSeats, debitBuyIns, refundBuyIns, withRoomLock, isRoomBusy, escrowMatchesRoomSeats } from './pokerEscrow';
import { RoomSocialStore, handleReaction, handleChat, handleChatMedia, type SocialIO } from './roomSocial';
import type { ConnectionLimiter } from '../src/net/rateLimit';
import { scryptPasswordHasher } from './roomPassword';
import { hashReconnectToken } from './reconnectToken';

/** One connection's room session (mutable; set on CREATE/JOIN/RECONNECT). */
export interface Session { room: ServerRoom; clientId: string }
export interface SessionRef { value: Session | null }

/**
 * Per-connection navigation lifecycle (Stage 37.7.2 FAIL 3). A monotonic revision makes a
 * DELAYED async CREATE/JOIN (awaiting account resolution) safe: it completes ONLY if it is
 * still the latest navigation AND the socket is open. A second CREATE/JOIN — or a socket
 * close — invalidates any in-flight one, so a late auth callback can never leave the current
 * room or spawn a stale/duplicate room.
 */
export interface ConnLifecycle {
  /** Begin a navigation; returns a token that supersedes all prior in-flight navigations. */
  beginNav: () => number;
  /** True only if `token` is still the latest navigation AND the socket is still open. */
  isCurrentNav: (token: number) => boolean;
}

/**
 * If this connection already holds a room session, leave it before establishing a
 * new one. Without this, a socket that CREATEs/JOINs a second room silently
 * abandons the first — its seat stays `connected:true` forever (the close handler
 * only ever sees the *latest* session), leaking the room until its hard TTL (БЕЗ-2).
 */
function leaveCurrentSession(ctx: WsContext, sessionRef: SessionRef): void {
  if (sessionRef.value) {
    ctx.handleLeave(sessionRef.value.room, sessionRef.value.clientId);
    sessionRef.value = null;
  }
}

/** Server-state operations that remain in index.ts and the WS dispatch needs. */
export interface WsContext {
  rooms: Map<string, ServerRoom>;
  sockets: Map<string, WebSocket>;
  social: RoomSocialStore;
  send(socket: WebSocket, msg: ServerMessage): void;
  sendError(socket: WebSocket, code: ErrorCode, message: string): void;
  broadcastRoom(room: ServerRoom): void;
  broadcastToRoom(room: ServerRoom, msg: ServerMessage): void;
  broadcastAndAdvance(room: ServerRoom, opts?: { turnAdvanced?: boolean }): void;
  sendChatHistory(socket: WebSocket, code: string): void;
  persistRoom(room: ServerRoom): void;
  welcome(socket: WebSocket, member: ServerMember, room: ServerRoom, reconnectToken: string): void;
  handleLeave(room: ServerRoom, clientId: string): void;
  makeRoomCode(): string;
  logRoomEvent(event: string, code: string, room: ServerRoom | null, errorCode?: string): void;
  logLatestDeal(room: ServerRoom): void;
}

/**
 * Routes one parsed client message. `sessionRef.value` is read/assigned here (so
 * the connection's close handler sees the current session); `attachIdentity`
 * stamps the resolved userId onto the seated member after CREATE/JOIN/RECONNECT.
 */
export function handleClientMessage(
  ctx: WsContext, socket: WebSocket, sessionRef: SessionRef, attachIdentity: () => void,
  msg: ClientMessage, limiter: ConnectionLimiter,
  // Stage 36.0: the connection's authoritative account id (resolved server-side from
  // the session cookie; null for guests). Used ONLY for same-user cross-device reclaim
  // and discovery — never for the token-based seat authority. Default keeps callers/tests
  // that don't sign in working unchanged.
  getUserId: () => string | null = () => null,
  // Stage 37.7.1: awaits the connection's resolved NON-GUEST account id (or null for
  // guests / no session / no DB). Used ONLY to gate online bankroll Poker creation, which
  // must not race the async session resolution. Default keeps other callers/tests unchanged.
  getAccountUserId: () => Promise<string | null> = async () => null,
  // Stage 37.7.2 (FAIL 3): per-connection navigation lifecycle for cancellable async
  // CREATE/JOIN. Default is a no-op single-shot for callers/tests that don't navigate async.
  lifecycle: ConnLifecycle = { beginNav: () => 0, isCurrentNav: () => true },
): void {
  const { send, sendError } = ctx;
  const socialIO: SocialIO = {
    sendError: ctx.sendError, broadcastToRoom: ctx.broadcastToRoom, newId: randomUUID,
  };

  // Per-connection message throttle (БЕЗ-1): reject before doing any work so a
  // flood costs the server ~nothing. Generous burst → normal play never trips it.
  const now = Date.now();
  if (!limiter.allowMessage(now)) {
    return sendError(socket, 'RATE_LIMITED', 'Too many requests — slow down');
  }

  // (FAIL 4) A navigation (CREATE/JOIN) that would leave the CURRENT room is refused while
  // that room is a bankroll table with a lifecycle op (debit/rematch/settlement) in flight —
  // leaving mid-debit would desync the escrow seats. Retryable once the op completes.
  const navWouldBreakBankroll = (): boolean => {
    const cur = sessionRef.value;
    return !!cur && isBankrollRoom(cur.room) && isRoomBusy(cur.room.code);
  };

  switch (msg.t) {
    case 'CREATE_ROOM': {
      if (navWouldBreakBankroll()) return sendError(socket, 'ILLEGAL_ACTION', 'Your table is mid-hand — try again in a moment');
      const nav = lifecycle.beginNav(); // supersede any in-flight async CREATE/JOIN
      // Resolve & validate the game type (default King). Unknown / not-online → reject.
      if (msg.gameType !== undefined && !isGameType(msg.gameType)) {
        return sendError(socket, 'BAD_MESSAGE', 'Unknown game type');
      }
      const gameType = msg.gameType ?? 'king';
      const entry = getGameCatalogEntry(gameType)!;
      if (!entry.supportsOnline) {
        return sendError(socket, 'BAD_MESSAGE', 'Game is not available online');
      }
      // Room capacity (Stage 9.10; Deberc Solo/Pairs added Stage 28.2). Honor an
      // explicit host player-count when it is within the game's catalog range — this
      // is how a Deberc host picks Solo (3 seats) vs Pairs (4 seats). Otherwise fall
      // back to the catalog max, so older clients that send no playerCount behave
      // exactly as before (backward compatible). Capacity stays server-enforced.
      const requested = msg.playerCount;
      const playerCount = (
        typeof requested === 'number' && requested >= entry.minPlayers && requested <= entry.maxPlayers
          ? requested
          : entry.maxPlayers
      ) as 2 | 3 | 4 | 5 | 6;
      const variant = gameType === 'durak' ? (msg.variant === 'transfer' ? 'transfer' : 'simple') : undefined;
      const matchSize = gameType === 'deberc' ? (msg.matchSize === 'big' ? 'big' : 'small') : undefined;
      // Tarneeb Solo/Pairs (Stage 28.4). Default Pairs; anything but 'solo' → pairs.
      const tarneebVariant = gameType === 'tarneeb' ? (msg.tarneebVariant === 'solo' ? 'solo' : 'pairs') : undefined;
      // Tarneeb match target (Stage 29.8): normalised to a safe integer here (a missing/invalid
      // value → the default 41), so the room stores a sane value the lobby can display pre-start.
      const tarneebTargetScore = gameType === 'tarneeb' ? normalizeTargetScore(msg.tarneebTargetScore) : undefined;
      // 51 elimination score (Stage 30.15): normalised to an allowed preset here (a missing/invalid
      // value → the default 510), so the room stores a sane value the lobby can display pre-start.
      const fiftyOneEliminationScore = gameType === 'fifty-one' ? normalizeEliminationScore(msg.fiftyOneEliminationScore) : undefined;
      // Shared room creation, given resolved poker stakes (empty for other games). Runs
      // the rate-limit + leave + createRoom + welcome. Kept as a closure so the ONLINE
      // BANKROLL Poker path can await its auth/stakes gate first without duplicating this.
      const finishCreate = (poker: { pokerSmallBlind?: number; pokerBigBlind?: number; pokerBuyIn?: number; pokerBlindGrowth?: number }, hostUserId?: string | null): void => {
        // (FAIL 3) Only complete if this is still the latest navigation + the socket is open.
        if (!lifecycle.isCurrentNav(nav)) return;
        // (FAIL 4) Re-check right before we leave the current room.
        if (navWouldBreakBankroll()) return sendError(socket, 'ILLEGAL_ACTION', 'Your table is mid-hand — try again in a moment');
        // Bound room churn (БЕЗ-1): stricter than the general message limit.
        if (!limiter.allowCreateRoom(Date.now())) {
          return sendError(socket, 'RATE_LIMITED', 'Creating rooms too fast — slow down');
        }
        // Abandon any room this connection was already in (else it leaks — БЕЗ-2).
        leaveCurrentSession(ctx, sessionRef);
        const code = ctx.makeRoomCode();
        const clientId = randomUUID();
        const reconnectToken = randomUUID();
        const room = createRoom({
          code, gameType, variant, matchSize, tarneebVariant, tarneebTargetScore, fiftyOneEliminationScore,
          pokerSmallBlind: poker.pokerSmallBlind, pokerBigBlind: poker.pokerBigBlind,
          pokerBuyIn: poker.pokerBuyIn, pokerBlindGrowth: poker.pokerBlindGrowth,
          playerCount,
          modeSelectionType: msg.modeSelectionType === 'dealer_choice' ? 'dealer_choice' : 'fixed',
          // (FAIL 7) The Poker host's account id is stamped ATOMICALLY at creation.
          host: { clientId, reconnectToken: hashReconnectToken(reconnectToken), name: msg.name, avatar: msg.avatar, userId: hostUserId ?? null },
          password: msg.password, salt: randomUUID(), hasher: scryptPasswordHasher, turnTimerSec: msg.turnTimerSec,
        });
        ctx.rooms.set(code, room);
        ctx.sockets.set(clientId, socket);
        sessionRef.value = { room, clientId };
        attachIdentity();
        ctx.welcome(socket, room.members.get(clientId)!, room, reconnectToken);
        ctx.broadcastRoom(room);
        ctx.persistRoom(room);
        ctx.logRoomEvent('CREATE_ROOM', code, room);
      };

      // Poker online is BANKROLL-ONLY (§16, 37.7.1) — there is NO free online Poker table.
      // Require the chip economy (Postgres), an APPROVED whitelisted stakes preset, and a
      // signed-in NON-GUEST creator (awaited, so it can't race the async session resolution).
      // Local Poker is pass-and-play (never reaches CREATE_ROOM), so it stays free. The
      // buy-in is DERIVED server-side (100 BB) — never taken from the client.
      if (gameType === 'poker') {
        if (!isDbEnabled()) return sendError(socket, 'BAD_MESSAGE', 'Online Poker is unavailable here (no chip economy)');
        const preset = findStakesPreset(msg.pokerSmallBlind, msg.pokerBigBlind);
        if (!preset) return sendError(socket, 'BAD_MESSAGE', 'Pick valid Poker stakes to host online');
        const growth = validateBlindGrowth(msg.pokerBlindGrowth ?? 0);
        if (growth === null) return sendError(socket, 'BAD_MESSAGE', 'Invalid blind growth');
        void (async () => {
          const uid = await getAccountUserId(); // resolved NON-GUEST account, or null
          if (!uid) return sendError(socket, 'NOT_SIGNED_IN', 'Sign in to host an online Poker table');
          finishCreate({ pokerSmallBlind: preset.smallBlind, pokerBigBlind: preset.bigBlind, pokerBuyIn: preset.buyIn, pokerBlindGrowth: growth }, uid);
        })();
        break;
      }
      finishCreate({});
      break;
    }

    case 'JOIN_ROOM': {
      if (navWouldBreakBankroll()) return sendError(socket, 'ILLEGAL_ACTION', 'Your table is mid-hand — try again in a moment');
      const nav = lifecycle.beginNav();
      // Brute-force gate (БЕЗ-6): checked before the room lookup so a wrong code
      // and a wrong password are throttled uniformly (no timing oracle on which
      // codes exist). Only FAILED joins spend the budget, so real users are
      // unaffected; a guesser is capped once they burn through it.
      if (!limiter.canAttemptJoin(now)) {
        return sendError(socket, 'RATE_LIMITED', 'Too many failed join attempts — wait a moment');
      }
      const reqCode = String(msg.code || '').toUpperCase();
      const room = ctx.rooms.get(reqCode);
      if (!room) {
        limiter.recordJoinFailure(now);
        ctx.logRoomEvent('JOIN_ROOM', reqCode, null, 'ROOM_NOT_FOUND');
        return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
      }
      const wantsPlayerSeat = msg.role !== 'spectator';
      // Finalize a successful join: leave the prior room, wire the session, welcome.
      const finalizeJoin = (clientId: string, reconnectToken: string): void => {
        // Joined successfully — abandon any previous room this connection held (БЕЗ-2).
        leaveCurrentSession(ctx, sessionRef);
        ctx.sockets.set(clientId, socket);
        sessionRef.value = { room, clientId };
        attachIdentity();
        ctx.welcome(socket, room.members.get(clientId)!, room, reconnectToken);
        ctx.broadcastRoom(room);
        if (room.gameState) send(socket, { t: 'STATE_UPDATE', state: sanitizedStateFor(room, clientId), timer: roomTimerInfo(room, Date.now()) });
        ctx.sendChatHistory(socket, room.code);
        ctx.persistRoom(room);
        ctx.logRoomEvent('JOIN_ROOM', reqCode, room);
      };
      // The sync completion (given the authoritative account id for a bankroll player seat).
      const finishJoin = (userId: string | null): void => {
        if (!lifecycle.isCurrentNav(nav)) return;                         // superseded / socket closed
        if (navWouldBreakBankroll()) return sendError(socket, 'ILLEGAL_ACTION', 'Your table is mid-hand — try again in a moment');
        // (FAIL 2) The target room must STILL be the same live instance in the map (it may
        // have been deleted/replaced while the async auth was pending).
        if (ctx.rooms.get(reqCode) !== room) return sendError(socket, 'ROOM_NOT_FOUND', 'That room is no longer available');
        // (FAIL 1) Never add a PLAYER to a bankroll target room while a lifecycle op
        // (start/debit/rematch/settlement/teardown) is in flight — the escrow seats are frozen.
        if (wantsPlayerSeat && isBankrollRoom(room) && isRoomBusy(room.code)) {
          return sendError(socket, 'ILLEGAL_ACTION', 'That table is starting — try again in a moment');
        }
        const clientId = randomUUID();
        const reconnectToken = randomUUID(); // plaintext minted here; only its hash is stored (БЕЗ-4)
        const res = addMember(room, {
          clientId, reconnectToken: hashReconnectToken(reconnectToken), name: msg.name, role: msg.role, password: msg.password, avatar: msg.avatar, userId,
        }, scryptPasswordHasher);
        if (!res.ok) {
          if (res.error === 'BAD_PASSWORD') limiter.recordJoinFailure(now);
          ctx.logRoomEvent('JOIN_ROOM', reqCode, room, res.error);
          const message = res.error === 'BAD_PASSWORD' ? 'Wrong or missing room password'
            : res.error === 'NOT_SIGNED_IN' ? 'Sign in to take a Poker seat (one seat per account)' : 'Cannot join room';
          return sendError(socket, res.error!, message);
        }
        // (FAIL 2 belt) If the room vanished between addMember and finalize, ROLL BACK the
        // membership so no seat/socket/token leaks into a ghost room.
        if (ctx.rooms.get(reqCode) !== room) {
          removeMember(room, clientId);
          return sendError(socket, 'ROOM_NOT_FOUND', 'That room is no longer available');
        }
        finalizeJoin(clientId, reconnectToken);
      };
      // Bankroll poker PLAYER seat (§16, 37.7.2 FAIL 2): require a resolved non-guest account,
      // awaited (like CREATE) + cancellation-safe. A SPECTATOR seat (or any other game) needs
      // no account gate — it never receives private cards.
      if (isBankrollRoom(room) && wantsPlayerSeat) {
        void (async () => {
          const uid = await getAccountUserId();
          if (!lifecycle.isCurrentNav(nav)) return;
          if (!uid) return sendError(socket, 'NOT_SIGNED_IN', 'Sign in to take a Poker seat');
          finishJoin(uid);
        })();
        break;
      }
      finishJoin(null);
      break;
    }

    case 'RECONNECT': {
      lifecycle.beginNav(); // (FAIL 6) a session transition cancels any in-flight async CREATE/JOIN
      const reqCode = String(msg.code || '').toUpperCase();
      const room = ctx.rooms.get(reqCode);
      if (!room) {
        ctx.logRoomEvent('RECONNECT', reqCode, null, 'ROOM_NOT_FOUND');
        return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
      }
      // Match against the stored hash (БЕЗ-4). Fall back to a raw match for rooms
      // persisted before the upgrade (their token is still plaintext at rest);
      // such rooms are ephemeral and re-hash on the next persisted change.
      const member = reconnectMember(room, hashReconnectToken(msg.reconnectToken))
        ?? reconnectMember(room, msg.reconnectToken);
      if (!member) {
        ctx.logRoomEvent('RECONNECT', reqCode, room, 'UNKNOWN_TOKEN');
        return sendError(socket, 'ROOM_NOT_FOUND', 'Unknown reconnect token');
      }
      ctx.sockets.set(member.clientId, socket);
      sessionRef.value = { room, clientId: member.clientId };
      attachIdentity();
      // Echo back the plaintext the client already holds (never the stored hash).
      ctx.welcome(socket, member, room, msg.reconnectToken);
      ctx.broadcastRoom(room);
      // Reconnecting client immediately gets the current sanitized state.
      if (room.gameState) send(socket, { t: 'STATE_UPDATE', state: sanitizedStateFor(room, member.clientId), timer: roomTimerInfo(room, Date.now()) });
      ctx.sendChatHistory(socket, room.code);
      ctx.persistRoom(room);
      // Re-evaluate timers: the player is connected again, so a pending AI
      // substitute for their turn is cancelled (clearRoomTimers) and only the
      // normal turn timer (if any) is rescheduled.
      if (room.gameState) ctx.broadcastAndAdvance(room);
      break;
    }

    case 'RECLAIM_ROOM': {
      lifecycle.beginNav(); // (FAIL 6) cancel any in-flight async CREATE/JOIN
      // Cross-device reclaim (Stage 36.0): resume THIS signed-in account's own seat in
      // `code` from another device — no reconnect token needed. Server-authoritative:
      // it matches the connection's resolved userId (from the cookie), NEVER a client
      // value. A fresh reconnect token is minted for the new device (the old one dies).
      const uid = getUserId();
      if (!uid) return sendError(socket, 'BAD_MESSAGE', 'Sign in to reclaim a seat');
      const reqCode = String(msg.code || '').toUpperCase();
      const room = ctx.rooms.get(reqCode);
      if (!room) {
        ctx.logRoomEvent('RECLAIM_ROOM', reqCode, null, 'ROOM_NOT_FOUND');
        return sendError(socket, 'ROOM_NOT_FOUND', 'No such room');
      }
      const member = reclaimMemberByUserId(room, uid);
      if (!member) {
        ctx.logRoomEvent('RECLAIM_ROOM', reqCode, room, 'UNKNOWN_TOKEN');
        return sendError(socket, 'ROOM_NOT_FOUND', 'No seat for this account in that room');
      }
      // Abandon any previous room this connection held (БЕЗ-2) before taking the seat.
      leaveCurrentSession(ctx, sessionRef);
      // Mint a fresh reconnect token for the new device; store only its hash (БЕЗ-4).
      const reconnectToken = randomUUID();
      member.reconnectToken = hashReconnectToken(reconnectToken);
      ctx.sockets.set(member.clientId, socket);
      sessionRef.value = { room, clientId: member.clientId };
      attachIdentity();
      ctx.welcome(socket, member, room, reconnectToken);
      ctx.broadcastRoom(room);
      if (room.gameState) send(socket, { t: 'STATE_UPDATE', state: sanitizedStateFor(room, member.clientId), timer: roomTimerInfo(room, Date.now()) });
      ctx.sendChatHistory(socket, room.code);
      ctx.persistRoom(room);
      ctx.logRoomEvent('RECLAIM_ROOM', reqCode, room);
      // Re-evaluate timers: the seat is connected again → cancel any pending AI substitute.
      if (room.gameState) ctx.broadcastAndAdvance(room);
      break;
    }

    case 'FIND_MY_ROOMS': {
      // Cross-device discovery (Stage 36.0): the signed-in caller's own active rooms
      // (codes + meta only). Guests get []. No session/room needed — just the userId.
      send(socket, { t: 'MY_ROOMS', rooms: findUserRoomCodes(ctx.rooms.values(), getUserId()) });
      break;
    }

    case 'START_GAME': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      if (!room.members.get(clientId)?.isHost) return sendError(socket, 'NOT_HOST', 'Only the host may start');
      // (37.7.3 FAIL 5) A frozen room (corrupt durable match) can't start anything.
      if (room.pokerFrozen) return sendError(socket, 'ILLEGAL_ACTION', 'This table is frozen for review');
      // Bankroll poker (§16 F): debit every seat's buy-in ATOMICALLY before starting, all
      // SERIALIZED per room (withRoomLock) so it can't race a leave/kick/settings/second
      // start. Already started → no-op. If the debit commits but startGame then fails, the
      // buy-ins are refunded immediately so a funded escrow never hangs without a match.
      if (isBankrollRoom(room)) {
        void withRoomLock(room.code, async () => {
          if (room.started || room.gameState) return; // duplicate START → no-op
          const seats = validateBankrollSeats(room);
          if (!seats.ok) { sendError(socket, 'NOT_SIGNED_IN', seats.error); return; }
          const debit = await debitBuyIns(room);
          if (!debit.ok) {
            const code = /chip/i.test(debit.error) ? 'INSUFFICIENT_CHIPS' : 'ILLEGAL_ACTION';
            sendError(socket, code, debit.error);
            return;
          }
          // (FAIL 1) The funded escrow seats MUST equal the room's current seated players —
          // a seat that slipped in/out after the escrow was formed would desync the paid set
          // from the game state. If they diverge, refund and abort (never start such a game).
          if (!escrowMatchesRoomSeats(room)) {
            await refundBuyIns(room);
            sendError(socket, 'ILLEGAL_ACTION', 'The table changed while starting — buy-ins refunded, try again');
            return;
          }
          const res = startGame(room, { now: Date.now() });
          if (!res.ok) {
            // Debit committed but the game did not start → refund immediately (idempotent).
            await refundBuyIns(room);
            sendError(socket, res.error!, 'Cannot start game');
            return;
          }
          ctx.logLatestDeal(room);
          ctx.broadcastRoom(room);
          ctx.broadcastAndAdvance(room, { turnAdvanced: true });
          ctx.persistRoom(room);
        });
        break;
      }
      const res = startGame(room, { now: Date.now() });
      if (!res.ok) return sendError(socket, res.error!, 'Cannot start game');
      ctx.logLatestDeal(room);
      ctx.broadcastRoom(room);
      ctx.broadcastAndAdvance(room, { turnAdvanced: true }); // game started → first turn deadline
      ctx.persistRoom(room);
      break;
    }

    case 'ACTION_REQUEST': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      // (37.7.3 FAIL 5) A frozen/cancelled bankroll room accepts no gameplay actions.
      if (room.pokerFrozen || room.pokerMatchCancelled) return sendError(socket, 'ILLEGAL_ACTION', 'This match has been cancelled');
      // `msg.action` is UNTRUSTED (arbitrary JSON). `applyActionRequest` validates and
      // never mutates on rejection, but wrap it so any residual throw becomes a safe
      // BAD_MESSAGE rejection instead of an uncaught exception that could tear down the
      // connection — the room/session stay intact for the next valid action.
      let res;
      try {
        res = applyActionRequest(room, clientId, msg.action);
      } catch {
        return sendError(socket, 'BAD_MESSAGE', 'Malformed action');
      }
      if (!res.ok) return sendError(socket, res.error!, 'Action rejected');
      ctx.broadcastAndAdvance(room, { turnAdvanced: true }); // an action advanced the turn → new deadline
      ctx.persistRoom(room);
      break;
    }

    case 'LIST_ROOMS': {
      // Discovery: public summaries only (no session required).
      send(socket, { t: 'ROOMS_LIST', rooms: listRoomSummaries(ctx.rooms.values()) });
      break;
    }

    // Legacy host-authoritative messages — ignored in server-authoritative mode.
    case 'HOST_STATE':
      break;

    case 'KICK_MEMBER': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      // Don't reshape a bankroll table's composition while a debit/settlement is in flight.
      if (isBankrollRoom(room) && isRoomBusy(room.code)) return sendError(socket, 'ILLEGAL_ACTION', 'Table is starting — try again in a moment');
      const target = String(msg.clientId || '');
      const res = kickMember(room, clientId, target);
      if (!res.ok) return sendError(socket, res.error!, 'Cannot remove member');
      // Tell the kicked client, then drop its socket. Its membership (and
      // reconnect token) is already gone, so it cannot RECONNECT.
      const targetSocket = ctx.sockets.get(target);
      if (targetSocket) {
        send(targetSocket, { t: 'KICKED', reason: 'HOST_REMOVED' });
        try { targetSocket.close(); } catch { /* already closing */ }
      }
      ctx.sockets.delete(target);
      ctx.broadcastRoom(room);
      ctx.persistRoom(room);
      break;
    }

    case 'ADD_BOT': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      // Bankroll poker tables are human-only (§16 E) — a bot has no wallet/buy-in, so
      // reject ADD_BOT outright (the Poker lobby also hides the control for these rooms).
      if (isBankrollRoom(room)) return sendError(socket, 'NOT_SIGNED_IN', 'Bankroll tables are human-only');
      // addBot itself rejects non-host / started / full. A bot never reconnects,
      // but we still store only a hashed token so no plaintext lives at rest (БЕЗ-4).
      const res = addBot(room, clientId, { clientId: randomUUID(), reconnectToken: hashReconnectToken(randomUUID()) });
      if (!res.ok) return sendError(socket, res.error!, 'Cannot add bot');
      ctx.broadcastRoom(room);
      ctx.persistRoom(room);
      ctx.logRoomEvent('ADD_BOT', room.code, room);
      break;
    }

    case 'SET_TIMER': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      const { room, clientId } = sessionRef.value;
      if (isBankrollRoom(room) && isRoomBusy(room.code)) return sendError(socket, 'ILLEGAL_ACTION', 'Table is starting — try again in a moment');
      const res = setTimer(room, clientId, Number(msg.turnTimerSec));
      if (!res.ok) return sendError(socket, res.error!, 'Cannot set timer');
      ctx.broadcastRoom(room);
      ctx.persistRoom(room);
      break;
    }

    case 'LEAVE_ROOM': {
      // A leave during a bankroll debit would desync the escrow seats from the room →
      // reject briefly while the lifecycle op is in flight (the client can retry).
      if (sessionRef.value && isBankrollRoom(sessionRef.value.room) && isRoomBusy(sessionRef.value.room.code)) {
        return sendError(socket, 'ILLEGAL_ACTION', 'Table is starting — try again in a moment');
      }
      lifecycle.beginNav(); // (FAIL 6) an explicit leave cancels any in-flight async CREATE/JOIN
      if (sessionRef.value) ctx.handleLeave(sessionRef.value.room, sessionRef.value.clientId);
      sessionRef.value = null;
      break;
    }

    // ── Room social (Stage 7): reactions + chat. EPHEMERAL — never touches the
    //    reducer/GameState/persistence; server is authoritative on the whitelist,
    //    the 30s reaction cooldown, the 3s chat rate limit, the length cap, and
    //    the profanity/URL filter. No userId/token is exposed.
    case 'SEND_REACTION': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      handleReaction(ctx.social, socialIO, socket, sessionRef.value.room, sessionRef.value.clientId, msg.emoji);
      break;
    }

    case 'SEND_CHAT': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      handleChat(ctx.social, socialIO, socket, sessionRef.value.room, sessionRef.value.clientId, msg.text);
      break;
    }

    case 'SEND_CHAT_MEDIA': {
      if (!sessionRef.value) return sendError(socket, 'BAD_MESSAGE', 'Join a room first');
      handleChatMedia(ctx.social, socialIO, socket, sessionRef.value.room, sessionRef.value.clientId, msg.mediaId);
      break;
    }

    case 'PING':
      send(socket, { t: 'PONG' });
      break;

    default:
      sendError(socket, 'BAD_MESSAGE', `Unknown message: ${(msg as { t: string }).t}`);
  }
}
