// ---------------------------------------------------------------------------
// VoiceSession (Stage 25.4) — the in-room WebRTC mesh controller.
//
// A plain, framework-free class so it is FULLY unit-testable with mocked deps (no React,
// no real WebRTC, no jsdom). It owns the local mic stream, one peer connection per remote
// voice peer, mute state, and the signaling glue. All browser APIs (getUserMedia, RTCPeer-
// Connection) and the signaling send are INJECTED. Glare: the lower clientId offers (shared
// rule). No audio is recorded/stored/sent to the server — media is peer-to-peer.
// ---------------------------------------------------------------------------

import type { ServerMessage } from '../net/messages';
import { shouldOffer } from '../net/voiceSignal';

export type VoiceStatus = 'idle' | 'requesting' | 'joined' | 'error';
export type VoiceError = 'unsupported' | 'permission' | null;

export interface VoicePeerView { clientId: string; name: string; muted: boolean; connState: string; }

/** Server → client voice messages the session reacts to. */
export type VoiceServerMessage = Extract<ServerMessage, { t:
  'VOICE_PEERS' | 'VOICE_PEER_JOINED' | 'VOICE_PEER_LEFT'
  | 'VOICE_SIGNAL_OFFER' | 'VOICE_SIGNAL_ANSWER' | 'VOICE_SIGNAL_ICE' | 'VOICE_MUTE_STATE' }>;

// Minimal structural types so the class needs no DOM lib for testing.
export interface TrackLike { kind: string; enabled: boolean; stop(): void; }
export interface StreamLike { getTracks(): TrackLike[]; getAudioTracks(): TrackLike[]; }
export interface PeerConnLike {
  addTrack(track: TrackLike, stream: StreamLike): void;
  createOffer(): Promise<unknown>;
  createAnswer(): Promise<unknown>;
  setLocalDescription(desc: unknown): Promise<void>;
  setRemoteDescription(desc: unknown): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  close(): void;
  connectionState: string;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null;
  ontrack: ((ev: { streams: StreamLike[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
}

export interface VoiceSignalOut {
  join(): void; leave(): void;
  offer(to: string, sdp: string): void;
  answer(to: string, sdp: string): void;
  ice(to: string, candidate: string): void;
  mute(muted: boolean): void;
}

export interface VoiceDeps {
  myClientId: string;
  supported: boolean;
  getMic: () => Promise<StreamLike>;
  createPeer: () => PeerConnLike;
  signal: VoiceSignalOut;
  onChange: () => void;
  onRemoteStream?: (clientId: string, stream: StreamLike) => void;
  onRemoteGone?: (clientId: string) => void;
}

export class VoiceSession {
  status: VoiceStatus = 'idle';
  error: VoiceError = null;
  muted = false;
  readonly peers = new Map<string, VoicePeerView>();
  private local: StreamLike | null = null;
  private readonly pcs = new Map<string, PeerConnLike>();
  // ICE candidates that arrive BEFORE the peer's remote description is set must be buffered —
  // adding them early throws and the candidate is lost, which can stall/kill the connection so
  // no audio ever flows. Flushed in order once setRemoteDescription resolves (Stage 25.7).
  private readonly pendingIce = new Map<string, unknown[]>();
  private readonly remoteReady = new Set<string>();

  constructor(private readonly deps: VoiceDeps) {}

  peerList(): VoicePeerView[] { return [...this.peers.values()]; }

  /** A secret-free connectivity summary for the UI (Stage 25.7) — counts + states, no SDP/ICE. */
  connectionSummary(): { peers: number; connected: number; connecting: boolean; allFailed: boolean } {
    const states = this.peerList().map((p) => p.connState);
    const connected = states.filter((s) => s === 'connected' || s === 'completed').length;
    const failed = states.filter((s) => s === 'failed' || s === 'disconnected' || s === 'closed').length;
    return {
      peers: states.length,
      connected,
      connecting: states.some((s) => s === 'new' || s === 'connecting' || s === 'checking'),
      allFailed: states.length > 0 && failed === states.length,
    };
  }

  /** Request the mic (once), then announce VOICE_JOIN. Sets an error state on failure. */
  async join(): Promise<void> {
    if (this.status === 'joined' || this.status === 'requesting') return;
    if (!this.deps.supported) { this.fail('unsupported'); return; }
    this.status = 'requesting'; this.error = null; this.deps.onChange();
    try {
      this.local = await this.deps.getMic();
    } catch {
      this.fail('permission'); return;
    }
    this.status = 'joined'; this.deps.onChange();
    this.deps.signal.join(); // server replies with VOICE_PEERS
  }

  /** Leave voice: announce, close every peer connection, stop the mic. */
  leave(): void {
    if (this.status === 'joined') this.deps.signal.leave();
    this.teardown();
    this.status = 'idle'; this.error = null; this.deps.onChange();
  }

  /**
   * Re-announce after a transport reconnect (Stage 25.5). The previous socket's peer
   * connections are stale — the server dropped our voice membership when the old socket
   * closed — so tear every PC down (removing remote audio sinks) and re-JOIN with the SAME
   * mic. The server replies with a fresh VOICE_PEERS and the mesh rebuilds cleanly (no
   * duplicate PCs). No-op unless we are currently joined; the mic is never re-requested.
   */
  resync(): void {
    if (this.status !== 'joined') return;
    for (const [clientId, pc] of this.pcs) {
      try { pc.close(); } catch { /* already closed */ }
      this.deps.onRemoteGone?.(clientId);
    }
    this.pcs.clear();
    this.peers.clear();
    this.pendingIce.clear();
    this.remoteReady.clear();
    this.deps.signal.join();               // server → fresh VOICE_PEERS → rebuild
    if (this.muted) this.deps.signal.mute(true); // re-assert mute (server resets it on rejoin)
    this.deps.onChange();
  }

  /** Toggle the mic on/off (real: disables the local track) and broadcast the state. */
  toggleMute(): void {
    if (this.status !== 'joined') return;
    this.muted = !this.muted;
    for (const tr of this.local?.getAudioTracks() ?? []) tr.enabled = !this.muted;
    this.deps.signal.mute(this.muted);
    this.deps.onChange();
  }

  /** React to a relayed voice signaling message from the server. */
  onMessage(msg: VoiceServerMessage): void {
    switch (msg.t) {
      case 'VOICE_PEERS': for (const p of msg.peers) this.addPeer(p.clientId, p.name, p.muted); break;
      case 'VOICE_PEER_JOINED': this.addPeer(msg.clientId, msg.name, msg.muted); break;
      case 'VOICE_PEER_LEFT': this.removePeer(msg.clientId); break;
      case 'VOICE_SIGNAL_OFFER': void this.onOffer(msg.fromClientId, msg.sdp); break;
      case 'VOICE_SIGNAL_ANSWER': void this.onAnswer(msg.fromClientId, msg.sdp); break;
      case 'VOICE_SIGNAL_ICE': void this.onIce(msg.fromClientId, msg.candidate); break;
      case 'VOICE_MUTE_STATE': {
        const p = this.peers.get(msg.clientId);
        if (p) { p.muted = msg.muted; this.deps.onChange(); }
        break;
      }
    }
  }

  // ── internals ───────────────────────────────────────────────────────────
  private fail(err: Exclude<VoiceError, null>): void {
    this.teardown(); this.status = 'error'; this.error = err; this.deps.onChange();
  }

  private teardown(): void {
    for (const pc of this.pcs.values()) { try { pc.close(); } catch { /* already closed */ } }
    this.pcs.clear();
    this.peers.clear();
    this.pendingIce.clear();
    this.remoteReady.clear();
    for (const tr of this.local?.getTracks() ?? []) { try { tr.stop(); } catch { /* ignore */ } }
    this.local = null;
    this.muted = false;
  }

  private addPeer(clientId: string, name: string, muted: boolean): void {
    if (this.status !== 'joined' || clientId === this.deps.myClientId) return;
    if (!this.peers.has(clientId)) this.peers.set(clientId, { clientId, name, muted, connState: 'new' });
    if (!this.pcs.has(clientId)) {
      const pc = this.newPeer(clientId);
      // GLARE: only the lower clientId offers; the other waits for the offer.
      if (shouldOffer(this.deps.myClientId, clientId)) void this.makeOffer(clientId, pc);
    }
    this.deps.onChange();
  }

  private newPeer(clientId: string): PeerConnLike {
    const pc = this.deps.createPeer();
    this.pcs.set(clientId, pc);
    for (const tr of this.local?.getTracks() ?? []) pc.addTrack(tr, this.local!);
    pc.onicecandidate = (ev) => { if (ev.candidate) this.deps.signal.ice(clientId, JSON.stringify(ev.candidate)); };
    pc.ontrack = (ev) => { const s = ev.streams?.[0]; if (s) this.deps.onRemoteStream?.(clientId, s); };
    pc.onconnectionstatechange = () => {
      const p = this.peers.get(clientId);
      if (p) { p.connState = pc.connectionState; this.deps.onChange(); }
    };
    return pc;
  }

  private async makeOffer(clientId: string, pc: PeerConnLike): Promise<void> {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.deps.signal.offer(clientId, JSON.stringify(offer));
  }

  private async onOffer(from: string, sdp: string): Promise<void> {
    if (!this.peers.has(from)) this.peers.set(from, { clientId: from, name: from, muted: false, connState: 'new' });
    const pc = this.pcs.get(from) ?? this.newPeer(from);
    await pc.setRemoteDescription(safeParse(sdp));
    await this.flushIce(from, pc); // remote description is now set — apply any buffered candidates
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.deps.signal.answer(from, JSON.stringify(answer));
    this.deps.onChange();
  }

  private async onAnswer(from: string, sdp: string): Promise<void> {
    const pc = this.pcs.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(safeParse(sdp));
    await this.flushIce(from, pc);
  }

  private async onIce(from: string, candidate: string): Promise<void> {
    const pc = this.pcs.get(from);
    if (!pc) return;
    const cand = safeParse(candidate);
    if (!this.remoteReady.has(from)) {
      // Remote description not set yet — buffer instead of dropping (see pendingIce above).
      const q = this.pendingIce.get(from) ?? [];
      q.push(cand);
      this.pendingIce.set(from, q);
      return;
    }
    try { await pc.addIceCandidate(cand); } catch { /* malformed candidate */ }
  }

  /** Mark a peer's remote description ready and drain its buffered ICE candidates in order. */
  private async flushIce(from: string, pc: PeerConnLike): Promise<void> {
    this.remoteReady.add(from);
    const queued = this.pendingIce.get(from);
    if (!queued) return;
    this.pendingIce.delete(from);
    for (const c of queued) { try { await pc.addIceCandidate(c); } catch { /* malformed candidate */ } }
  }

  private removePeer(clientId: string): void {
    const pc = this.pcs.get(clientId);
    if (pc) { try { pc.close(); } catch { /* ignore */ } this.pcs.delete(clientId); }
    this.peers.delete(clientId);
    this.pendingIce.delete(clientId);
    this.remoteReady.delete(clientId);
    this.deps.onRemoteGone?.(clientId);
    this.deps.onChange();
  }
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
