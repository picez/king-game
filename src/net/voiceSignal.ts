// ---------------------------------------------------------------------------
// Voice signaling — PURE, dependency-free helpers (Stage 25.3).
//
// The server relays WebRTC SDP/ICE between two members of the SAME room; these helpers
// are the shared validation (size caps — the payloads are opaque strings the server never
// parses beyond length) and the deterministic GLARE rule used in 25.4 (the peer with the
// lexicographically-LOWER clientId is the offerer, so two peers never both offer). No DOM,
// no WebRTC, no audio here.
// ---------------------------------------------------------------------------

/** Hard caps so a hostile/oversized signaling payload can't be relayed. */
export const MAX_SDP_BYTES = 16 * 1024; // 16 KB — a full SDP offer/answer is well under this
export const MAX_ICE_BYTES = 4 * 1024;  // 4 KB — a single ICE candidate string

/** A valid SDP payload: a non-empty string within the cap. */
export function isValidSdp(sdp: unknown): sdp is string {
  return typeof sdp === 'string' && sdp.length > 0 && sdp.length <= MAX_SDP_BYTES;
}

/** A valid ICE candidate payload: a non-empty string within the cap. */
export function isValidIce(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_ICE_BYTES;
}

/**
 * GLARE rule (used by the 25.4 WebRTC client, documented + testable here): of two peers,
 * the one with the lexicographically-lower clientId creates the OFFER; the other waits.
 * `shouldOffer(me, them)` → true when I should be the offerer. Never true against myself.
 */
export function shouldOffer(myClientId: string, peerClientId: string): boolean {
  return myClientId < peerClientId;
}
