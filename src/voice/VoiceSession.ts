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

export interface VoicePeerView { clientId: string; name: string; muted: boolean; connState: string; iceState: string; }

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
  iceConnectionState?: string;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null;
  ontrack: ((ev: { streams: StreamLike[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange?: (() => void) | null;
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
  // Automatic re-offers spent per peer since it last connected (see `onPeerFailed`).
  private readonly retries = new Map<string, number>();

  constructor(private readonly deps: VoiceDeps) {}

  peerList(): VoicePeerView[] { return [...this.peers.values()]; }

  /** A secret-free connectivity summary for the UI (Stage 25.7/25.8) — counts + states, no SDP/ICE. */
  connectionSummary(): { peers: number; connected: number; connecting: boolean; allFailed: boolean; iceState: string } {
    const views = this.peerList();
    const states = views.map((p) => p.connState);
    const connected = states.filter((s) => s === 'connected' || s === 'completed').length;
    const failed = states.filter((s) => s === 'failed' || s === 'disconnected' || s === 'closed').length;
    // Representative ICE state for the debug line: worst-first so a problem is visible.
    const ices = views.map((p) => p.iceState);
    const iceState = views.length === 0 ? 'new'
      : ices.find((s) => s === 'failed') ?? ices.find((s) => s === 'disconnected')
        ?? ices.find((s) => s === 'checking' || s === 'new')
        ?? (ices.every((s) => s === 'connected' || s === 'completed') ? 'connected' : (ices[0] ?? 'new'));
    return {
      peers: states.length,
      connected,
      connecting: states.some((s) => s === 'new' || s === 'connecting' || s === 'checking'),
      allFailed: states.length > 0 && failed === states.length,
      iceState,
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
    this.retries.clear();
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
      case 'VOICE_PEER_JOINED':
        // A JOINED for a peer we still hold a connection to means that peer came back on a
        // NEW socket (a reconnect whose old socket the server had not closed yet, so no
        // VOICE_PEER_LEFT came first). The old connection is dead on their side — keeping it
        // left the pair silent for good: the offerer never re-offered (it "already had" a
        // PC) and the answerer fed a fresh offer into the stale PC. Start clean instead.
        if (this.pcs.has(msg.clientId)) this.dropConnection(msg.clientId);
        this.addPeer(msg.clientId, msg.name, msg.muted);
        break;
      case 'VOICE_PEER_LEFT': this.removePeer(msg.clientId); break;
      case 'VOICE_SIGNAL_OFFER': this.guard(msg.fromClientId, this.onOffer(msg.fromClientId, msg.sdp)); break;
      case 'VOICE_SIGNAL_ANSWER': this.guard(msg.fromClientId, this.onAnswer(msg.fromClientId, msg.sdp)); break;
      case 'VOICE_SIGNAL_ICE': this.guard(msg.fromClientId, this.onIce(msg.fromClientId, msg.candidate)); break;
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
    this.retries.clear();
    for (const tr of this.local?.getTracks() ?? []) { try { tr.stop(); } catch { /* ignore */ } }
    this.local = null;
    this.muted = false;
  }

  private addPeer(clientId: string, name: string, muted: boolean): void {
    if (this.status !== 'joined' || clientId === this.deps.myClientId) return;
    if (!this.peers.has(clientId)) this.peers.set(clientId, { clientId, name, muted, connState: 'new', iceState: 'new' });
    if (!this.pcs.has(clientId)) {
      const pc = this.newPeer(clientId);
      // GLARE: only the lower clientId offers; the other waits for the offer.
      if (shouldOffer(this.deps.myClientId, clientId)) this.guard(clientId, this.makeOffer(clientId, pc));
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
      if (this.pcs.get(clientId) !== pc) return; // a replaced connection reporting late
      const p = this.peers.get(clientId);
      if (p) { p.connState = pc.connectionState; this.deps.onChange(); }
      if (pc.connectionState === 'connected') this.retries.delete(clientId);
      if (pc.connectionState === 'failed') this.onPeerFailed(clientId);
    };
    pc.oniceconnectionstatechange = () => {
      const p = this.peers.get(clientId);
      if (p && pc.iceConnectionState) { p.iceState = pc.iceConnectionState; this.deps.onChange(); }
    };
    return pc;
  }

  private async makeOffer(clientId: string, pc: PeerConnLike): Promise<void> {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.deps.signal.offer(clientId, JSON.stringify(offer));
  }

  private async onOffer(from: string, sdp: string): Promise<void> {
    if (this.status !== 'joined') return; // left (or never joined) — never answer with no mic
    if (!this.peers.has(from)) this.peers.set(from, { clientId: from, name: from, muted: false, connState: 'new', iceState: 'new' });
    // An offer on a connection that ALREADY completed a negotiation is a brand-new session
    // from that peer (it reconnected, or it is retrying a failed link): answer it on a fresh
    // connection — a stale one rejects the new DTLS fingerprint and the pair stays silent.
    if (this.remoteReady.has(from)) this.dropConnection(from);
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

  /**
   * A link that FAILED (typically ICE: strict NAT, a network switch on a phone) is not
   * left dead. The side that offers rebuilds it and offers again, a bounded number of
   * times; the other side answers on a fresh connection (see `onOffer`). Without TURN some
   * networks can never connect — the retries stop, and the UI shows the failure.
   */
  private onPeerFailed(clientId: string): void {
    if (this.status !== 'joined' || !shouldOffer(this.deps.myClientId, clientId)) return;
    const used = this.retries.get(clientId) ?? 0;
    if (used >= MAX_RETRIES) return;
    this.retries.set(clientId, used + 1);
    this.dropConnection(clientId);
    const p = this.peers.get(clientId);
    if (p) { p.connState = 'connecting'; p.iceState = 'new'; }
    const pc = this.newPeer(clientId);
    this.guard(clientId, this.makeOffer(clientId, pc));
    this.deps.onChange();
  }

  /** Close one peer's connection + its audio sink, keeping the peer itself listed. */
  private dropConnection(clientId: string): void {
    const pc = this.pcs.get(clientId);
    if (pc) { try { pc.close(); } catch { /* ignore */ } this.pcs.delete(clientId); }
    this.pendingIce.delete(clientId);
    this.remoteReady.delete(clientId);
    this.deps.onRemoteGone?.(clientId);
  }

  /**
   * Signaling steps are async and were fired with `void` — a rejected step (a malformed
   * SDP, a closed connection) became an unhandled rejection and the peer sat at
   * "connecting" forever. Now a failed step marks that peer failed, which the UI shows.
   */
  private guard(clientId: string, step: Promise<void>): void {
    step.catch(() => {
      const p = this.peers.get(clientId);
      if (p) { p.connState = 'failed'; this.deps.onChange(); }
    });
  }

  private removePeer(clientId: string): void {
    const pc = this.pcs.get(clientId);
    if (pc) { try { pc.close(); } catch { /* ignore */ } this.pcs.delete(clientId); }
    this.peers.delete(clientId);
    this.pendingIce.delete(clientId);
    this.remoteReady.delete(clientId);
    this.retries.delete(clientId);
    this.deps.onRemoteGone?.(clientId);
    this.deps.onChange();
  }
}

/** Automatic re-offers per peer before a failed link is left to the UI (see onPeerFailed). */
const MAX_RETRIES = 2;

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return {}; }
}
