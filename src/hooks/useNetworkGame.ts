import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../models/types';
import { getActingPlayerId } from '../core/gameEngine';
import type { AnyGameAction } from '../games/anyGame';
import { WebSocketTransport } from '../net/transport';
import type { ClientMessage, ErrorCode, RoomSnapshot, ServerMessage, ChatMessage } from '../net/messages';
import { firstConnectMessage, seatToPlayerId } from '../net/online';
import type { OnlineIntent } from '../net/online';
import { saveSession, clearSession } from '../net/session';

export type { OnlineIntent };

export type OnlineStatus = 'connecting' | 'lobby' | 'in_game' | 'finished' | 'error' | 'disconnected' | 'kicked';

/** A transient reaction event for the floating display (Stage 7). */
export interface ReactionEvent {
  /** Unique client-side key (server may send several with the same `at`). */
  key: string;
  clientId: string;
  name: string;
  avatar: string;
  emoji: string;
  seatIndex: number | null;
  at: number;
}

/** A non-fatal social notice (rate-limited / message blocked) for a small toast. */
export interface SocialNotice { code: ErrorCode; message: string; at: number }

/**
 * The authoritative turn-timer, resolved for THIS client (Stage 37.5). `deadlineAt`
 * is a server epoch-ms deadline (null when no human is on a room timer). `revision`
 * is the stable turn identity (changes only on a real gameplay transition, never on
 * reload/reconnect). `clockOffset = serverNow − Date.now()` at receipt, so the client
 * counts down against the SERVER clock (skew-safe). The countdown is derived from
 * these each tick via `Date.now()`, so it survives reload/reconnect and background-tab
 * throttling instead of running an independent per-second decrement.
 */
export interface ClientTimer { deadlineAt: number | null; revision: number; clockOffset: number }

export interface NetworkGame {
  status: OnlineStatus;
  error: string | null;
  errorCode: ErrorCode | null;
  room: RoomSnapshot | null;
  /** Authoritative state, already redacted by the server for this client. */
  state: GameState | null;
  myPlayerId: string | null;
  /** This client's stable connection id (used to identify self in the lobby). */
  myClientId: string | null;
  /** Authoritative turn-timer for the current turn, or null (no active timer). */
  timer: ClientTimer | null;
  isHost: boolean;
  /** True when it is this client's turn to act. */
  myTurn: boolean;
  /** Send an action for the room's game (King or Durak — Stage 9.6). */
  dispatch: (action: AnyGameAction) => void;
  startGame: () => void;
  /** Host-only: remove another member (by clientId) from the lobby. */
  kick: (clientId: string) => void;
  /** Host-only: add a server-side AI bot to a free seat in the lobby. */
  addBot: () => void;
  /** Host-only: set the per-turn timer (seconds; 0 = off) before start. */
  setTimer: (turnTimerSec: number) => void;
  /** Lobby "Leave lobby": remove the member + clear the saved session. */
  leave: () => void;
  /** Active-game "Leave game": drop the socket only — stays reconnectable +
   *  the saved session is kept so the menu still offers Resume. */
  backToMenu: () => void;
  // ── Room social (Stage 7) ──
  /** Recent reaction events (transient; the UI prunes by age). */
  reactions: ReactionEvent[];
  /** Recent chat messages (server-sanitised; capped). */
  chat: ChatMessage[];
  /** Send a whitelisted emoji reaction (server enforces the 30s cooldown). */
  sendReaction: (emoji: string) => void;
  /** Send a chat message (server filters + rate-limits). */
  sendChat: (text: string) => void;
  /** Send a whitelisted chat sticker by catalog id (server validates + rate-limits). */
  sendChatMedia: (mediaId: string) => void;
  /** A transient rate-limit / blocked notice for a small toast, or null. */
  socialNotice: SocialNotice | null;
  clearSocialNotice: () => void;
  /** Friends (Stage 25.2): invite an online friend to THIS room. */
  sendFriendInvite: (toUserId: string) => void;
  /** A friend invite this client just received (Join/Dismiss toast), or null. */
  friendInvite: FriendInvite | null;
  dismissFriendInvite: () => void;
  /** Rematch progress after an online game finishes (Stage 25.9), or null when none pending. */
  rematch: RematchProgress | null;
  /** "Play again" for an online room — mark this client ready for a rematch. */
  sendRematchReady: () => void;
  /** Cancel this client's rematch readiness. */
  sendRematchDecline: () => void;
  /** Bumped on every FRIEND_PRESENCE push so a friends list can re-fetch live. */
  presenceNonce: number;
  /**
   * Bumped on every WELCOME (first connect + each successful reconnect). Voice uses it to
   * re-announce after a transport reconnect: the old socket's peer connections are stale
   * server-side, so the mesh must rebuild (Stage 25.5).
   */
  connectionEpoch: number;
  /**
   * Voice signaling (Stage 25.3) — plumbing only (no WebRTC/audio yet; 25.4 wires the
   * peer connections). Send helpers + a listener that receives the relayed VOICE_* server
   * messages. INERT until a caller registers a listener.
   */
  sendVoiceJoin: () => void;
  sendVoiceLeave: () => void;
  sendVoiceOffer: (toClientId: string, sdp: string) => void;
  sendVoiceAnswer: (toClientId: string, sdp: string) => void;
  sendVoiceIce: (toClientId: string, candidate: string) => void;
  sendVoiceMute: (muted: boolean) => void;
  registerVoiceListener: (fn: (msg: VoiceServerMessage) => void) => () => void;
}

/** The server→client voice signaling messages (25.4 consumes these to drive WebRTC). */
export type VoiceServerMessage = Extract<ServerMessage, { t:
  'VOICE_PEERS' | 'VOICE_PEER_JOINED' | 'VOICE_PEER_LEFT'
  | 'VOICE_SIGNAL_OFFER' | 'VOICE_SIGNAL_ANSWER' | 'VOICE_SIGNAL_ICE' | 'VOICE_MUTE_STATE' }>;

/** A received friend room-invite (public routing fields only — no email/token). */
export interface FriendInvite { fromUserId: string; fromName: string; code: string; gameType: string; at: number; }

/** Rematch progress for the online finish screen (Stage 25.9) — public clientIds only. */
export interface RematchProgress { ready: string[]; needed: number; }

/** Is a game state (any of the 6 games) in its terminal/finished screen? */
function stateIsFinished(s: unknown): boolean {
  if (!s || typeof s !== 'object') return false;
  const o = s as { status?: string; phase?: string };
  return o.status === 'game_finished' || o.status === 'finished'
    || o.phase === 'game_finished' || o.phase === 'finished';
}

const RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Server-authoritative online client. The server owns the GameState and runs
 * the reducer; this hook only sends ACTION_REQUESTs and renders the redacted
 * STATE_UPDATEs it receives. It never applies the reducer itself.
 */
export function useNetworkGame(url: string, intent: OnlineIntent): NetworkGame {
  const [status, setStatus] = useState<OnlineStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [timer, setTimerState] = useState<ClientTimer | null>(null);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [socialNotice, setSocialNotice] = useState<SocialNotice | null>(null);
  const [friendInvite, setFriendInvite] = useState<FriendInvite | null>(null);
  const [rematch, setRematch] = useState<RematchProgress | null>(null);
  const [presenceNonce, setPresenceNonce] = useState(0);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  // Voice signaling listeners (Stage 25.3). Inert until 25.4 registers one.
  const voiceListeners = useRef(new Set<(m: VoiceServerMessage) => void>());
  const reactionKeyRef = useRef(0);

  const transportRef = useRef<WebSocketTransport | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(intent.kind === 'resume' ? intent.reconnectToken : null);
  const codeRef = useRef<string | null>(
    intent.kind === 'join' || intent.kind === 'resume' ? intent.code.toUpperCase() : null,
  );
  const isHostRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  // Set when the host kicks us: suppresses auto-reconnect and the 'disconnected'
  // state so we land on a clear "removed by host" screen instead.
  const kickedRef = useRef(false);
  // Set when the player deliberately backs out of an ACTIVE game ("Leave game"):
  // we drop the socket (server marks us disconnected → seat stays reconnectable)
  // and suppress auto-reconnect, but DO NOT remove the member or clear the saved
  // session — so the start menu still offers "Resume online game".
  const leavingRef = useRef(false);
  // StrictMode-safe connection guard: teardown is deferred one tick so a dev
  // double-mount reuses the same transport instead of opening a second one
  // (which would create a duplicate room / seat).
  const liveRef = useRef(true);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myPlayerId = mySeat != null ? seatToPlayerId(mySeat) : null;

  const send = useCallback((msg: ClientMessage) => {
    transportRef.current?.send(msg);
  }, []);

  const handleMessage = useCallback((msg: ServerMessage) => {
    // Voice signaling (Stage 25.3): forward every VOICE_* server message to registered
    // listeners (25.4 drives WebRTC from them). Handled before the room switch; inert here.
    if (msg.t.startsWith('VOICE_')) { voiceListeners.current.forEach((l) => l(msg as VoiceServerMessage)); return; }
    switch (msg.t) {
      case 'WELCOME': {
        clientIdRef.current = msg.clientId;
        tokenRef.current = msg.reconnectToken;
        codeRef.current = msg.room.code;
        reconnectAttemptsRef.current = 0;
        applyRoom(msg.room);
        setStatus(msg.room.started ? 'in_game' : 'lobby');
        setConnectionEpoch((e) => e + 1); // signals voice to rebuild the mesh after a reconnect
        break;
      }
      case 'ROOM_UPDATE': {
        applyRoom(msg.room);
        if (msg.room.started) setStatus((s) => (s === 'lobby' || s === 'connecting' ? 'in_game' : s));
        break;
      }
      case 'STATE_UPDATE': {
        // The server is authoritative — just render what it sends. STATE_UPDATE
        // carries a game-state union (King | Durak | Deberc). The `state` field is
        // typed as King's GameState for legacy callers; game-specific online
        // components (DurakOnlineGame / DebercOnlineGame) cast it to their own type
        // and own their finished screen, so only King drives net.status here.
        const s = msg.state;
        setState(s as GameState | null);
        // Adopt the authoritative turn-timer (Stage 37.5). We store `clockOffset` (the
        // server clock minus ours, at receipt) so the countdown runs against the SERVER
        // deadline regardless of client clock skew; a reload/reconnect just receives the
        // same deadline/revision and continues — it never resets or extends the timer.
        if (msg.timer) {
          setTimerState({ deadlineAt: msg.timer.deadlineAt, revision: msg.timer.revision, clockOffset: msg.timer.serverNow - Date.now() });
        }
        // A fresh (non-finished) state means a new game/deal is live — clear any pending
        // rematch so the NEXT finish starts a clean rematch (Stage 25.9).
        if (!stateIsFinished(s)) setRematch(null);
        // `'status' in s` narrows the union: King/Durak carry `status`, Deberc
        // carries `phase`. King's game_finished is the only wrapper-level finish.
        if (s && 'status' in s && s.status === 'game_finished') setStatus('finished');
        else if (s) setStatus('in_game');
        break;
      }
      case 'KICKED': {
        // Host removed us before the game started. Kill reconnect + saved
        // session (the old token is already invalid server-side) and show a
        // clear message. The UI surfaces err.KICKED_BY_HOST.
        kickedRef.current = true;
        tokenRef.current = null;
        codeRef.current = null;
        clearSession();
        setErrorCode('KICKED_BY_HOST');
        setError(null);
        setStatus('kicked');
        transportRef.current?.close();
        break;
      }
      case 'REACTION': {
        reactionKeyRef.current += 1;
        const ev: ReactionEvent = {
          key: `${msg.at}-${reactionKeyRef.current}`,
          clientId: msg.clientId, name: msg.name, avatar: msg.avatar,
          emoji: msg.emoji, seatIndex: msg.seatIndex, at: msg.at,
        };
        setReactions((r) => [...r, ev].slice(-12));
        break;
      }
      case 'CHAT': {
        setChat((c) => [...c, msg.message].slice(-100));
        break;
      }
      case 'CHAT_HISTORY': {
        setChat(msg.messages.slice(-100));
        break;
      }
      case 'FRIEND_INVITE_RECEIVED': {
        // Show a Join/Dismiss toast (never auto-join). Public routing fields only.
        setFriendInvite({ fromUserId: msg.fromUserId, fromName: msg.fromName, code: msg.code, gameType: msg.gameType, at: msg.at });
        break;
      }
      case 'FRIEND_PRESENCE': {
        setPresenceNonce((n) => n + 1); // nudge any open friends list to re-fetch
        break;
      }
      case 'REMATCH_STATE': {
        setRematch({ ready: msg.ready, needed: msg.needed });
        break;
      }
      case 'ERROR': {
        // Non-fatal social limits + friend-invite failures → a small toast, not the game
        // error surface (Stage 25.7).
        if (msg.code === 'RATE_LIMITED' || msg.code === 'MESSAGE_BLOCKED'
          || msg.code === 'FRIEND_NOT_ONLINE' || msg.code === 'NOT_FRIENDS' || msg.code === 'NOT_IN_ROOM') {
          setSocialNotice({ code: msg.code, message: msg.message, at: Date.now() });
          break;
        }
        setError(msg.message);
        setErrorCode(msg.code);
        // Fatal lobby/join errors abort; in-game errors are transient (bad move…).
        if (
          msg.code === 'ROOM_NOT_FOUND' || msg.code === 'ROOM_FULL' ||
          msg.code === 'NAME_TAKEN' || msg.code === 'BAD_PASSWORD' ||
          msg.code === 'GAME_ALREADY_STARTED'
        ) {
          setStatus((s) => (s === 'in_game' || s === 'finished' ? s : 'error'));
        }
        break;
      }
      // ACTION_FORWARD / PONG are not used by the server-authoritative client.
    }

    function applyRoom(snapshot: RoomSnapshot) {
      setRoom(snapshot);
      const me = snapshot.members.find((m) => m.clientId === clientIdRef.current);
      if (me) {
        // Persist a small reconnect handle (no GameState, no hands) so a tab
        // reload or short drop can resume. Re-saved on every room update so a
        // changed seat / promoted host / new token is kept current.
        if (codeRef.current && tokenRef.current) {
          saveSession({
            serverUrl: url,
            roomCode: codeRef.current,
            reconnectToken: tokenRef.current,
            playerName: me.name,
            role: me.isHost ? 'host' : 'join',
            seatIndex: me.seatIndex,
          });
        }
        isHostRef.current = me.isHost;
        setMySeat(me.seatIndex);
      }
    }
  }, []);

  // ── Connection lifecycle (StrictMode-safe; create/join sent exactly once) ──
  useEffect(() => {
    liveRef.current = true;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    function open(isReconnect: boolean) {
      const transport = new WebSocketTransport(url);
      transportRef.current = transport;
      transport.onMessage(handleMessage);
      transport.onClose(() => {
        if (!liveRef.current || transportRef.current !== transport) return;
        if (kickedRef.current) return;   // kicked: stay on the removed-by-host screen
        if (leavingRef.current) return;  // deliberate "Leave game": no auto-reconnect
        setStatus('disconnected');
        scheduleReconnect();
      });
      transport
        .connect()
        .then(() => {
          if (!liveRef.current || transportRef.current !== transport) return;
          if (isReconnect && codeRef.current && tokenRef.current) {
            transport.send({ t: 'RECONNECT', code: codeRef.current, reconnectToken: tokenRef.current });
          } else {
            transport.send(firstConnectMessage(intent));
          }
        })
        .catch(() => {
          if (!liveRef.current || transportRef.current !== transport) return;
          setError('Cannot reach the server. Check the address and that it is running.');
          setStatus('error');
        });
    }

    function scheduleReconnect() {
      if (!liveRef.current) return;
      if (!codeRef.current || !tokenRef.current) return;
      if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;
      reconnectAttemptsRef.current += 1;
      setTimeout(() => { if (liveRef.current) open(true); }, RECONNECT_DELAY_MS);
    }

    if (!transportRef.current) open(false);

    return () => {
      closeTimerRef.current = setTimeout(() => {
        liveRef.current = false;
        transportRef.current?.close();
        transportRef.current = null;
      }, 0);
    };
    // intent/url are fixed for the lifetime of this online session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dispatch = useCallback((action: AnyGameAction) => {
    // Server-authoritative: the server validates and applies the reducer.
    send({ t: 'ACTION_REQUEST', action });
  }, [send]);

  const startGame = useCallback(() => send({ t: 'START_GAME' }), [send]);
  const sendReaction = useCallback((emoji: string) => send({ t: 'SEND_REACTION', emoji }), [send]);
  const sendChat = useCallback((text: string) => send({ t: 'SEND_CHAT', text }), [send]);
  const sendChatMedia = useCallback((mediaId: string) => send({ t: 'SEND_CHAT_MEDIA', mediaId }), [send]);
  const sendFriendInvite = useCallback((toUserId: string) => send({ t: 'FRIEND_INVITE', toUserId }), [send]);
  const sendRematchReady = useCallback(() => send({ t: 'REMATCH_READY' }), [send]);
  const sendRematchDecline = useCallback(() => send({ t: 'REMATCH_DECLINE' }), [send]);
  const sendVoiceJoin = useCallback(() => send({ t: 'VOICE_JOIN' }), [send]);
  const sendVoiceLeave = useCallback(() => send({ t: 'VOICE_LEAVE' }), [send]);
  const sendVoiceOffer = useCallback((toClientId: string, sdp: string) => send({ t: 'VOICE_SIGNAL_OFFER', toClientId, sdp }), [send]);
  const sendVoiceAnswer = useCallback((toClientId: string, sdp: string) => send({ t: 'VOICE_SIGNAL_ANSWER', toClientId, sdp }), [send]);
  const sendVoiceIce = useCallback((toClientId: string, candidate: string) => send({ t: 'VOICE_SIGNAL_ICE', toClientId, candidate }), [send]);
  const sendVoiceMute = useCallback((muted: boolean) => send({ t: 'VOICE_MUTE_STATE', muted }), [send]);
  const registerVoiceListener = useCallback((fn: (m: VoiceServerMessage) => void) => {
    voiceListeners.current.add(fn);
    return () => { voiceListeners.current.delete(fn); };
  }, []);
  const clearSocialNotice = useCallback(() => setSocialNotice(null), []);
  const kick = useCallback((clientId: string) => send({ t: 'KICK_MEMBER', clientId }), [send]);
  const addBot = useCallback(() => send({ t: 'ADD_BOT' }), [send]);
  const setTimer = useCallback((turnTimerSec: number) => send({ t: 'SET_TIMER', turnTimerSec }), [send]);
  const leave = useCallback(() => {
    // Explicit LEAVE the room (lobby "Leave lobby"): remove the member + drop the
    // saved session so we don't offer to resume a game the player left for good.
    send({ t: 'LEAVE_ROOM' });
    clearSession();
    transportRef.current?.close();
  }, [send]);

  const backToMenu = useCallback(() => {
    // Active-game "Leave game / Back to menu": just drop the socket (the server
    // marks us disconnected → the seat stays reconnectable). We do NOT send
    // LEAVE_ROOM (keeps the member) and do NOT clearSession (keeps Resume).
    leavingRef.current = true;
    transportRef.current?.close();
  }, []);

  // King-only turn flag (the King UI uses it). Durak online derives its own turn
  // from the Durak state, so skip King's getActingPlayerId for Durak states.
  const myTurn = !!state && !('gameType' in state) && getActingPlayerId(state) === myPlayerId;

  return {
    status, error, errorCode, room, state, myPlayerId, timer,
    myClientId: clientIdRef.current, isHost: isHostRef.current,
    myTurn, dispatch, startGame, kick, addBot, setTimer, leave, backToMenu,
    reactions, chat, sendReaction, sendChat, sendChatMedia, socialNotice, clearSocialNotice,
    sendFriendInvite, friendInvite, dismissFriendInvite: () => setFriendInvite(null), presenceNonce,
    rematch, sendRematchReady, sendRematchDecline,
    connectionEpoch,
    sendVoiceJoin, sendVoiceLeave, sendVoiceOffer, sendVoiceAnswer, sendVoiceIce, sendVoiceMute, registerVoiceListener,
  };
}
