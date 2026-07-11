// ---------------------------------------------------------------------------
// WebRTC browser adapter (Stage 25.4) — the ONLY module that touches the raw WebRTC /
// getUserMedia APIs. Everything else (VoiceSession, the hook, the UI) goes through these
// thin, injectable functions so the voice logic is unit-testable without a real browser.
//
// STUN-only by default (no TURN — documented in VOICE_CHAT_PLAN.md §7). A deployment MAY
// supply its own ICE servers (incl. TURN for strict NAT) via `VITE_VOICE_ICE_SERVERS` — see
// iceConfig.ts. No audio is ever recorded, stored, or sent to the server; media flows
// peer-to-peer (DTLS-SRTP).
// ---------------------------------------------------------------------------

import { parseIceServers } from './iceConfig';

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

/**
 * ICE config: STUN-only by default, overridable at build time via `VITE_VOICE_ICE_SERVERS`
 * (a JSON array — see iceConfig.ts). Credentials, if any, come from the env and are NEVER
 * committed. Resolved once at module load.
 */
const ICE_SERVERS: RTCIceServer[] = parseIceServers(
  typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_VOICE_ICE_SERVERS as string | undefined) : undefined,
);

/**
 * A fresh peer connection for one remote peer (mesh). Callers may pass ICE servers resolved at
 * runtime (GET /api/voice/ice-config, Stage 25.6); absent → the build-time default above.
 */
export function createPeerConnection(iceServers: RTCIceServer[] = ICE_SERVERS): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers });
}
