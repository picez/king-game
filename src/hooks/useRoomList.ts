import { useCallback, useRef, useState } from 'react';
import { WebSocketTransport } from '../net/transport';
import type { RoomSummary } from '../net/messages';

export interface RoomListState {
  rooms: RoomSummary[];
  loading: boolean;
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const refresh = useCallback((url: string) => {
    if (busyRef.current || !url.trim()) return;
    busyRef.current = true;
    setLoading(true);
    setError(null);

    const transport = new WebSocketTransport(url.trim());
    let done = false;
    const finish = (err?: string) => {
      if (done) return;
      done = true;
      busyRef.current = false;
      setLoading(false);
      if (err) setError(err);
      transport.close();
    };

    const timer = setTimeout(() => finish('Timed out — is the server running?'), LIST_TIMEOUT_MS);

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
      .catch(() => { clearTimeout(timer); finish('Cannot reach the server.'); });
  }, []);

  return { rooms, loading, error, refresh };
}
