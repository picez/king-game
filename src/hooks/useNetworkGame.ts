import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../models/types';
import type { GameAction } from '../core/gameEngine';
import { getActingPlayerId } from '../core/gameEngine';
import { WebSocketTransport } from '../net/transport';
import type { ClientMessage, ErrorCode, RoomSnapshot, ServerMessage } from '../net/messages';
import { firstConnectMessage, seatToPlayerId } from '../net/online';
import type { OnlineIntent } from '../net/online';
import { saveSession, clearSession } from '../net/session';

export type { OnlineIntent };

export type OnlineStatus = 'connecting' | 'lobby' | 'in_game' | 'finished' | 'error' | 'disconnected' | 'kicked';

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
  isHost: boolean;
  /** True when it is this client's turn to act. */
  myTurn: boolean;
  dispatch: (action: GameAction) => void;
  startGame: () => void;
  /** Host-only: remove another member (by clientId) from the lobby. */
  kick: (clientId: string) => void;
  /** Host-only: add a server-side AI bot to a free seat in the lobby. */
  addBot: () => void;
  /** Host-only: set the per-turn timer (seconds; 0 = off) before start. */
  setTimer: (turnTimerSec: number) => void;
  leave: () => void;
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
  const [mySeat, setMySeat] = useState<number | null>(null);

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
    switch (msg.t) {
      case 'WELCOME': {
        clientIdRef.current = msg.clientId;
        tokenRef.current = msg.reconnectToken;
        codeRef.current = msg.room.code;
        reconnectAttemptsRef.current = 0;
        applyRoom(msg.room);
        setStatus(msg.room.started ? 'in_game' : 'lobby');
        break;
      }
      case 'ROOM_UPDATE': {
        applyRoom(msg.room);
        if (msg.room.started) setStatus((s) => (s === 'lobby' || s === 'connecting' ? 'in_game' : s));
        break;
      }
      case 'STATE_UPDATE': {
        // The server is authoritative — just render what it sends.
        setState(msg.state);
        if (msg.state?.status === 'game_finished') setStatus('finished');
        else if (msg.state) setStatus('in_game');
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
      case 'ERROR': {
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
        if (kickedRef.current) return; // kicked: stay on the removed-by-host screen
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

  const dispatch = useCallback((action: GameAction) => {
    // Server-authoritative: the server validates and applies the reducer.
    send({ t: 'ACTION_REQUEST', action });
  }, [send]);

  const startGame = useCallback(() => send({ t: 'START_GAME' }), [send]);
  const kick = useCallback((clientId: string) => send({ t: 'KICK_MEMBER', clientId }), [send]);
  const addBot = useCallback(() => send({ t: 'ADD_BOT' }), [send]);
  const setTimer = useCallback((turnTimerSec: number) => send({ t: 'SET_TIMER', turnTimerSec }), [send]);
  const leave = useCallback(() => {
    // Explicit leave / back to menu: drop the saved session so we don't offer
    // to resume a game the player intentionally left.
    send({ t: 'LEAVE_ROOM' });
    clearSession();
    transportRef.current?.close();
  }, [send]);

  const myTurn = !!state && getActingPlayerId(state) === myPlayerId;

  return {
    status, error, errorCode, room, state, myPlayerId,
    myClientId: clientIdRef.current, isHost: isHostRef.current,
    myTurn, dispatch, startGame, kick, addBot, setTimer, leave,
  };
}
