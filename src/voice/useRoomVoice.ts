import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { VoiceSession, type VoiceServerMessage, type StreamLike } from './VoiceSession';
import { isVoiceSupported, getMicStream, createPeerConnection } from './webrtc';
import { fetchIceServers, iceModeOf } from './iceConfigClient';

/** The slice of useNetworkGame's return that voice needs (signaling + identity). */
export interface VoiceNet {
  myClientId: string | null;
  sendVoiceJoin: () => void;
  sendVoiceLeave: () => void;
  sendVoiceOffer: (toClientId: string, sdp: string) => void;
  sendVoiceAnswer: (toClientId: string, sdp: string) => void;
  sendVoiceIce: (toClientId: string, candidate: string) => void;
  sendVoiceMute: (muted: boolean) => void;
  registerVoiceListener: (fn: (m: VoiceServerMessage) => void) => () => void;
  /** Bumped on every (re)connect — voice rebuilds the mesh after a transport reconnect. */
  connectionEpoch: number;
}

export interface RoomVoice {
  supported: boolean;
  status: 'idle' | 'requesting' | 'joined' | 'error';
  error: 'unsupported' | 'permission' | null;
  muted: boolean;
  peers: Array<{ clientId: string; name: string; muted: boolean; connState: string }>;
  audioBlocked: boolean;
  /** Resolved voice connectivity mode (Stage 25.6) — for the optional UI indicator. No creds. */
  iceMode: 'stun_only' | 'turn_configured' | 'unknown';
  /** Safe status summary for the UI/debug block (Stage 25.7) — no SDP/ICE/identity. */
  mic: 'idle' | 'requesting' | 'allowed' | 'denied';
  connection: { peers: number; connected: number; connecting: boolean; allFailed: boolean };
  join: () => void;
  leave: () => void;
  toggleMute: () => void;
  enableAudio: () => void;
}

/**
 * In-room voice hook (Stage 25.4). Owns a VoiceSession + the remote `<audio>` sinks. Voice
 * is OPT-IN (nothing happens until join()); leaving the room / unmount tears everything down.
 * No audio is recorded or sent to the server — media is peer-to-peer.
 */
export function useRoomVoice(net: VoiceNet, apiBaseUrl = ''): RoomVoice {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [iceMode, setIceMode] = useState<'stun_only' | 'turn_configured' | 'unknown'>('unknown');
  const sessionRef = useRef<VoiceSession | null>(null);
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  // Runtime ICE servers (GET /api/voice/ice-config). Resolved on mount, read lazily by createPeer
  // at Join time (which is a human tap later, so the fetch has settled). undefined → build-time default.
  const iceServersRef = useRef<RTCIceServer[] | undefined>(undefined);
  const supported = isVoiceSupported();

  // Resolve ICE config once per API host (best-effort; falls back to build-time / STUN).
  useEffect(() => {
    if (!supported) return;
    const ctrl = new AbortController();
    void fetchIceServers({ baseUrl: apiBaseUrl, signal: ctrl.signal }).then((servers) => {
      iceServersRef.current = servers;
      setIceMode(iceModeOf(servers));
    });
    return () => ctrl.abort();
  }, [apiBaseUrl, supported]);

  useEffect(() => {
    const playRemote = (clientId: string, stream: StreamLike) => {
      let el = audioEls.current.get(clientId);
      if (!el) { el = new Audio(); el.autoplay = true; audioEls.current.set(clientId, el); }
      (el as unknown as { srcObject: unknown }).srcObject = stream;
      el.play().catch(() => setAudioBlocked(true)); // autoplay may be blocked → show a tap-to-enable
    };
    const dropRemote = (clientId: string) => {
      const el = audioEls.current.get(clientId);
      if (el) { try { el.pause(); (el as unknown as { srcObject: unknown }).srcObject = null; } catch { /* ignore */ } audioEls.current.delete(clientId); }
    };

    const session = new VoiceSession({
      myClientId: net.myClientId ?? '',
      supported,
      getMic: getMicStream as unknown as () => Promise<StreamLike>,
      // Lazily read the resolved runtime ICE servers (undefined → build-time default).
      createPeer: (() => createPeerConnection(iceServersRef.current)) as unknown as () => never,
      signal: {
        join: net.sendVoiceJoin, leave: net.sendVoiceLeave,
        offer: net.sendVoiceOffer, answer: net.sendVoiceAnswer, ice: net.sendVoiceIce, mute: net.sendVoiceMute,
      },
      onChange: force,
      onRemoteStream: playRemote,
      onRemoteGone: dropRemote,
    });
    sessionRef.current = session;
    const unsub = net.registerVoiceListener((m) => session.onMessage(m));

    return () => {
      unsub();
      session.leave();
      for (const el of audioEls.current.values()) { try { el.pause(); (el as unknown as { srcObject: unknown }).srcObject = null; } catch { /* ignore */ } }
      audioEls.current.clear();
      sessionRef.current = null;
    };
    // Recreate only when the identity or signaling handles change (both stable within a room).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.myClientId, supported]);

  // After a transport reconnect the server has dropped our voice membership, so rebuild the
  // mesh (resync is a no-op unless we were joined). Skips the very first connect (nothing to
  // rebuild yet). Does NOT re-request the mic and does NOT auto-join.
  const firstEpoch = useRef(true);
  useEffect(() => {
    if (firstEpoch.current) { firstEpoch.current = false; return; }
    sessionRef.current?.resync();
  }, [net.connectionEpoch]);

  const join = useCallback(() => { void sessionRef.current?.join(); }, []);
  const leave = useCallback(() => { sessionRef.current?.leave(); }, []);
  const toggleMute = useCallback(() => { sessionRef.current?.toggleMute(); }, []);
  const enableAudio = useCallback(() => {
    setAudioBlocked(false);
    for (const el of audioEls.current.values()) el.play().catch(() => setAudioBlocked(true));
  }, []);

  const s = sessionRef.current;
  const status = s?.status ?? 'idle';
  const error = s?.error ?? null;
  const mic: RoomVoice['mic'] = error === 'permission' ? 'denied'
    : status === 'requesting' ? 'requesting'
      : status === 'joined' ? 'allowed' : 'idle';
  return {
    supported,
    status,
    error,
    muted: s?.muted ?? false,
    peers: s?.peerList() ?? [],
    audioBlocked,
    iceMode,
    mic,
    connection: s?.connectionSummary() ?? { peers: 0, connected: 0, connecting: false, allFailed: false },
    join, leave, toggleMute, enableAudio,
  };
}
