import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { VoiceSession, type VoiceServerMessage, type StreamLike } from './VoiceSession';
import { isVoiceSupported, getMicStream, createPeerConnection } from './webrtc';

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
}

export interface RoomVoice {
  supported: boolean;
  status: 'idle' | 'requesting' | 'joined' | 'error';
  error: 'unsupported' | 'permission' | null;
  muted: boolean;
  peers: Array<{ clientId: string; name: string; muted: boolean; connState: string }>;
  audioBlocked: boolean;
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
export function useRoomVoice(net: VoiceNet): RoomVoice {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const sessionRef = useRef<VoiceSession | null>(null);
  const audioEls = useRef(new Map<string, HTMLAudioElement>());
  const supported = isVoiceSupported();

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
      createPeer: createPeerConnection as unknown as () => never,
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

  const join = useCallback(() => { void sessionRef.current?.join(); }, []);
  const leave = useCallback(() => { sessionRef.current?.leave(); }, []);
  const toggleMute = useCallback(() => { sessionRef.current?.toggleMute(); }, []);
  const enableAudio = useCallback(() => {
    setAudioBlocked(false);
    for (const el of audioEls.current.values()) el.play().catch(() => setAudioBlocked(true));
  }, []);

  const s = sessionRef.current;
  return {
    supported,
    status: s?.status ?? 'idle',
    error: s?.error ?? null,
    muted: s?.muted ?? false,
    peers: s?.peerList() ?? [],
    audioBlocked,
    join, leave, toggleMute, enableAudio,
  };
}
