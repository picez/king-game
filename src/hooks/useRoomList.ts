import { useCallback, useRef, useState } from 'react';
import { WebSocketTransport } from '../net/transport';
import type { RoomSummary } from '../net/messages';

/** Error CODE (translated by the consumer via `roomList.<code>`), not a message. */
export type RoomListError = 'timeout' | 'unreachable';

export interface RoomListState {
  rooms: RoomSummary[];
  loading: boolean;
  error: RoomListError | null;
  /** Open a short-lived connection, fetch the public room list, then close. */
  refresh: (url: string) => void;
}

const LIST_TIMEOUT_MS = 4000;

/**
 * Lightweight, on-demand room discovery. It does NOT hold a game session — each
 * refresh opens a throwaway WebSocket, sends LIST_ROOMS, applies the public
 * ROOMS_LIST reply, and closes. Keeps create/join/resume (useNetworkGame)
 * completely separate.
 */
export function useRoomList(): RoomListState {
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RoomListError | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback((url: string) => {
    if (busyRef.current || !url.trim()) return;
    busyRef.current = true;
    setLoading(true);
    setError(null);

    const transport = new WebSocketTransport(url.trim());
    let done = false;
    const finish = (err?: RoomListError) => {
      if (done) return;
      done = true;
      busyRef.current = false;
      setLoading(false);
      if (err) setError(err);
      transport.close();
    };

    const timer = setTimeout(() => finish('timeout'), LIST_TIMEOUT_MS);

    transport.onMessage((msg) => {
      if (msg.t === 'ROOMS_LIST') {
        setRooms(msg.rooms);
        clearTimeout(timer);
        finish();
      }
    });

    transport
      .connect()
      .then(() => transport.send({ t: 'LIST_ROOMS' }))
      .catch(() => { clearTimeout(timer); finish('unreachable'); });
  }, []);

  return { rooms, loading, error, refresh };
}
