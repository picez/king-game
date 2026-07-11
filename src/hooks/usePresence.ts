import { useCallback, useEffect, useRef, useState } from 'react';
import { WebSocketTransport } from '../net/transport';
import { fetchFriends, type FriendsData } from '../net/friendsApi';
import type { FriendInvite } from './useNetworkGame';

// ---------------------------------------------------------------------------
// App-level presence connection (Stage 25.7).
//
// The server marks a user ONLINE for the lifetime of ANY authenticated WebSocket (the presence
// attach in server/index.ts happens on connect, independent of joining a room). But the client
// only opened a socket when entering a room — so a signed-in user sitting on the menu appeared
// OFFLINE to friends, and the Profile Friends tab got no live presence / request pushes.
//
// This hook opens ONE lightweight socket while signed-in AT THE MENU: it sends nothing
// room-related, just keeps the user "online" and listens for FRIEND_PRESENCE / a friend room
// invite. On any presence change it re-fetches /api/friends (for the online list + the incoming-
// request badge). It carries no email/token/session. During an online game the room socket owns
// presence instead (this component is unmounted), so there is never a double presence socket.
// ---------------------------------------------------------------------------

export interface PresenceState {
  /** Whether the presence socket is currently open. */
  connected: boolean;
  /** Latest friends snapshot (null before the first fetch / when unavailable). */
  data: FriendsData | null;
  /** Number of incoming friend requests — drives the red menu badge. */
  incomingCount: number;
  /** Bumps on every FRIEND_PRESENCE push (so a list can re-sort). */
  presenceNonce: number;
  /** A friend room-invite received while at the menu (Join/Dismiss toast), or null. */
  invite: FriendInvite | null;
  dismissInvite: () => void;
  /** Force a friends re-fetch (e.g. after a local accept/decline). */
  refetch: () => void;
}

const RECONNECT_MS = 4000;

/** Keep a signed-in user "online" and their friends/request state live while at the menu. */
export function usePresence(url: string, base: string, signedIn: boolean): PresenceState {
  const [connected, setConnected] = useState(false);
  const [data, setData] = useState<FriendsData | null>(null);
  const [presenceNonce, setPresenceNonce] = useState(0);
  const [invite, setInvite] = useState<FriendInvite | null>(null);

  const liveRef = useRef(true);
  const transportRef = useRef<WebSocketTransport | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    if (!signedIn) return;
    void fetchFriends(base).then((d) => { if (liveRef.current && d) setData(d); });
  }, [base, signedIn]);

  useEffect(() => {
    liveRef.current = true;
    if (!signedIn) { setData(null); setConnected(false); return; }

    const open = () => {
      if (!liveRef.current) return;
      const transport = new WebSocketTransport(url);
      transportRef.current = transport;
      transport.onMessage((msg) => {
        if (msg.t === 'FRIEND_PRESENCE') { setPresenceNonce((n) => n + 1); refetch(); }
        else if (msg.t === 'FRIEND_INVITE_RECEIVED') {
          setInvite({ fromUserId: msg.fromUserId, fromName: msg.fromName, code: msg.code, gameType: msg.gameType, at: msg.at });
        }
      });
      transport.onClose(() => {
        if (!liveRef.current || transportRef.current !== transport) return;
        setConnected(false);
        reconnectRef.current = setTimeout(open, RECONNECT_MS); // keep presence alive at the menu
      });
      transport.connect()
        .then(() => { if (liveRef.current) { setConnected(true); refetch(); } }) // server attaches presence from the cookie
        .catch(() => { /* onClose schedules a retry */ });
    };
    open();

    return () => {
      liveRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      transportRef.current?.close();
      transportRef.current = null;
      setConnected(false);
    };
  }, [url, signedIn, refetch]);

  return {
    connected,
    data,
    incomingCount: data?.incoming.length ?? 0,
    presenceNonce,
    invite,
    dismissInvite: () => setInvite(null),
    refetch,
  };
}
