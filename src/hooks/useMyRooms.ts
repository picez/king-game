import { useCallback, useRef, useState } from 'react';
import { WebSocketTransport } from '../net/transport';
import type { GameType } from '../games/catalog';
import type { RoomCode } from '../net/messages';
import { findMyRoomsMessage } from '../net/online';

/** One of the signed-in caller's own active rooms (privacy-safe — no tokens/hands). */
export interface MyRoom {
  code: RoomCode;
  gameType: GameType;
  started: boolean;
  players: number;
  updatedAt: number;
}

export type MyRoomsError = 'timeout' | 'unreachable';

export interface MyRoomsState {
  rooms: MyRoom[];
  loading: boolean;
  error: MyRoomsError | null;
  lastUpdatedAt: number | null;
  /** Open a short-lived (cookie-authenticated) socket, ask FIND_MY_ROOMS, close. */
  refresh: (url: string) => void;
  /** Drop a room locally (e.g. after an expired reclaim) without a round-trip. */
  drop: (code: string) => void;
}

const MY_ROOMS_TIMEOUT_MS = 4000;

/**
 * Same-user cross-device discovery (Stage 36.1). A lightweight, on-demand query —
 * like `useRoomList`, it opens a THROWAWAY WebSocket, sends FIND_MY_ROOMS, applies
 * the privacy-safe MY_ROOMS reply, and closes. The socket's session cookie names the
 * account server-side, so the reply only ever contains THIS user's own rooms (never
 * anyone else's, never a token/hand). A guest's cookie resolves to no userId → []. It
 * holds no game session — create/join/resume/reclaim stay in `useNetworkGame`.
 */
export function useMyRooms(): MyRoomsState {
  const [rooms, setRooms] = useState<MyRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<MyRoomsError | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback((url: string) => {
    if (busyRef.current || !url.trim()) return; // never overlap; no URL → no-op
    busyRef.current = true;
    setLoading(true);

    const transport = new WebSocketTransport(url.trim());
    let done = false;
    const finish = (err?: MyRoomsError) => {
      if (done) return;
      done = true;
      busyRef.current = false;
      setLoading(false);
      if (err) setError(err);
      transport.close();
    };
    const timer = setTimeout(() => finish('timeout'), MY_ROOMS_TIMEOUT_MS);

    transport.onMessage((msg) => {
      if (msg.t === 'MY_ROOMS') {
        setRooms(msg.rooms);
        setError(null);
        setLastUpdatedAt(Date.now());
        clearTimeout(timer);
        finish();
      }
    });

    transport
      .connect()
      .then(() => transport.send(findMyRoomsMessage()))
      .catch(() => { clearTimeout(timer); finish('unreachable'); });
  }, []);

  const drop = useCallback((code: string) => {
    setRooms((rs) => rs.filter((r) => r.code !== code));
  }, []);

  return { rooms, loading, error, lastUpdatedAt, refresh, drop };
}
