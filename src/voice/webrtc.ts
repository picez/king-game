// ---------------------------------------------------------------------------
// WebRTC browser adapter (Stage 25.4) — the ONLY module that touches the raw WebRTC /
// getUserMedia APIs. Everything else (VoiceSession, the hook, the UI) goes through these
// thin, injectable functions so the voice logic is unit-testable without a real browser.
//
// STUN-only MVP (no TURN — documented in VOICE_CHAT_PLAN.md §7). No audio is ever recorded,
// stored, or sent to the server; media flows peer-to-peer (DTLS-SRTP).
// ---------------------------------------------------------------------------

/** True when the browser can do WebRTC voice (mic capture + peer connections). */
export function isVoiceSupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined'
    && typeof navigator !== 'undefined'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';
}

/** Request the microphone (audio only). Only ever called AFTER the user taps Join voice. */
export function getMicStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

/** STUN-only ICE config (MVP). TURN is post-MVP / owner-gated (VOICE_CHAT_PLAN §7). */
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** A fresh peer connection for one remote peer (mesh). */
export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}
