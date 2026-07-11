import { describe, it, expect, vi } from 'vitest';
import { VoiceSession, type PeerConnLike, type StreamLike, type TrackLike, type VoiceDeps } from './VoiceSession';

/** Flush the microtask queue several times so a chain of awaited async steps settles. */
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

function fakeTrack(kind = 'audio'): TrackLike & { stop: ReturnType<typeof vi.fn> } {
  return { kind, enabled: true, stop: vi.fn() };
}
function fakeStream(): StreamLike & { tracks: TrackLike[] } {
  const tracks = [fakeTrack('audio')];
  return { tracks, getTracks: () => tracks, getAudioTracks: () => tracks.filter((t) => t.kind === 'audio') };
}
function fakePeer(): PeerConnLike & Record<string, ReturnType<typeof vi.fn>> {
  return {
    addTrack: vi.fn(), createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'o' })),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'a' })),
    setLocalDescription: vi.fn(async () => {}), setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}), close: vi.fn(),
    connectionState: 'new', onicecandidate: null, ontrack: null, onconnectionstatechange: null,
  } as unknown as PeerConnLike & Record<string, ReturnType<typeof vi.fn>>;
}
function makeDeps(over: Partial<VoiceDeps> = {}) {
  const signal = { join: vi.fn(), leave: vi.fn(), offer: vi.fn(), answer: vi.fn(), ice: vi.fn(), mute: vi.fn() };
  const mic = fakeStream();
  const peers: ReturnType<typeof fakePeer>[] = [];
  const getMic = vi.fn(async () => mic as StreamLike);
  const createPeer = vi.fn(() => { const p = fakePeer(); peers.push(p); return p; });
  const deps: VoiceDeps = {
    myClientId: 'aaa', supported: true, getMic, createPeer, signal,
    onChange: vi.fn(), onRemoteStream: vi.fn(), onRemoteGone: vi.fn(), ...over,
  };
  return { deps, signal, mic, getMic, createPeer, peers };
}

describe('VoiceSession — join / leave / mute', () => {
  it('join requests the mic ONCE and announces VOICE_JOIN → joined', async () => {
    const { deps, signal, getMic } = makeDeps();
    const s = new VoiceSession(deps);
    await s.join();
    expect(getMic).toHaveBeenCalledTimes(1);
    expect(signal.join).toHaveBeenCalledTimes(1);
    expect(s.status).toBe('joined');
    await s.join(); // idempotent — no second mic request
    expect(getMic).toHaveBeenCalledTimes(1);
  });

  it('unsupported → error(unsupported), never touches the mic', async () => {
    const { deps, getMic } = makeDeps({ supported: false });
    const s = new VoiceSession(deps);
    await s.join();
    expect(s.status).toBe('error'); expect(s.error).toBe('unsupported');
    expect(getMic).not.toHaveBeenCalled();
  });

  it('permission denied → error(permission)', async () => {
    const { deps } = makeDeps({ getMic: vi.fn(async () => { throw new Error('denied'); }) });
    const s = new VoiceSession(deps);
    await s.join();
    expect(s.status).toBe('error'); expect(s.error).toBe('permission');
  });

  it('leave announces, closes every PC, and stops the mic tracks', async () => {
    const { deps, signal, mic, peers } = makeDeps();
    const s = new VoiceSession(deps);
    await s.join();
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    s.leave();
    expect(signal.leave).toHaveBeenCalledTimes(1);
    expect(peers[0].close).toHaveBeenCalled();
    expect(mic.tracks[0].stop).toHaveBeenCalled();
    expect(s.status).toBe('idle');
    expect(s.peerList()).toEqual([]);
  });

  it('mute toggles the local track.enabled AND broadcasts VOICE_MUTE_STATE', async () => {
    const { deps, signal, mic } = makeDeps();
    const s = new VoiceSession(deps);
    await s.join();
    s.toggleMute();
    expect(s.muted).toBe(true);
    expect(mic.tracks[0].enabled).toBe(false);
    expect(signal.mute).toHaveBeenLastCalledWith(true);
    s.toggleMute();
    expect(mic.tracks[0].enabled).toBe(true);
    expect(signal.mute).toHaveBeenLastCalledWith(false);
  });
});

describe('VoiceSession — mesh signaling', () => {
  it('the LOWER clientId offers (glare); the higher one waits', async () => {
    // me = 'aaa' < 'bbb' → I offer.
    const lower = makeDeps({ myClientId: 'aaa' });
    const sLower = new VoiceSession(lower.deps); await sLower.join();
    sLower.onMessage({ t: 'VOICE_PEER_JOINED', clientId: 'bbb', name: 'B', muted: false });
    await Promise.resolve(); await Promise.resolve();
    expect(lower.signal.offer).toHaveBeenCalledWith('bbb', expect.any(String));

    // me = 'zzz' > 'bbb' → I do NOT offer (I wait).
    const higher = makeDeps({ myClientId: 'zzz' });
    const sHigher = new VoiceSession(higher.deps); await sHigher.join();
    sHigher.onMessage({ t: 'VOICE_PEER_JOINED', clientId: 'bbb', name: 'B', muted: false });
    await Promise.resolve(); await Promise.resolve();
    expect(higher.signal.offer).not.toHaveBeenCalled();
  });

  it('an incoming OFFER → createAnswer + VOICE_SIGNAL_ANSWER; ICE is applied', async () => {
    const { deps, signal, peers } = makeDeps({ myClientId: 'zzz' });
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_SIGNAL_OFFER', fromClientId: 'bbb', sdp: JSON.stringify({ type: 'offer' }) });
    await flush();
    expect(peers[0].setRemoteDescription).toHaveBeenCalled();
    expect(peers[0].createAnswer).toHaveBeenCalled();
    expect(signal.answer).toHaveBeenCalledWith('bbb', expect.any(String));
    s.onMessage({ t: 'VOICE_SIGNAL_ICE', fromClientId: 'bbb', candidate: JSON.stringify({ candidate: 'c' }) });
    await flush();
    expect(peers[0].addIceCandidate).toHaveBeenCalled();
  });

  it('VOICE_PEER_LEFT closes + removes that peer; a peer mute updates its view', async () => {
    const { deps, peers } = makeDeps();
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    s.onMessage({ t: 'VOICE_MUTE_STATE', clientId: 'bbb', muted: true });
    expect(s.peers.get('bbb')?.muted).toBe(true);
    s.onMessage({ t: 'VOICE_PEER_LEFT', clientId: 'bbb' });
    expect(peers[0].close).toHaveBeenCalled();
    expect(s.peers.has('bbb')).toBe(false);
    expect(deps.onRemoteGone).toHaveBeenCalledWith('bbb');
  });

  it('a local echo of myself is ignored (never a self peer connection)', async () => {
    const { deps, createPeer } = makeDeps({ myClientId: 'aaa' });
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_PEER_JOINED', clientId: 'aaa', name: 'me', muted: false });
    expect(createPeer).not.toHaveBeenCalled();
    expect(s.peers.has('aaa')).toBe(false);
  });

  it('a duplicate VOICE_PEERS refresh never creates a second PC for the same peer', async () => {
    const { deps, createPeer } = makeDeps({ myClientId: 'aaa' });
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    s.onMessage({ t: 'VOICE_PEER_JOINED', clientId: 'bbb', name: 'B', muted: false });
    expect(createPeer).toHaveBeenCalledTimes(1);
    expect([...s.peers.keys()]).toEqual(['bbb']);
  });
});

describe('VoiceSession — reconnect / resync (Stage 25.5)', () => {
  it('resync closes stale PCs, drops audio sinks, re-JOINs, and keeps the SAME mic', async () => {
    const { deps, signal, getMic, peers } = makeDeps({ myClientId: 'aaa' });
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    expect(peers).toHaveLength(1);
    signal.join.mockClear();

    s.resync();
    expect(peers[0].close).toHaveBeenCalled();               // stale PC torn down
    expect(deps.onRemoteGone).toHaveBeenCalledWith('bbb');   // audio sink removed
    expect(s.peers.size).toBe(0);                            // fresh VOICE_PEERS will refill
    expect(signal.join).toHaveBeenCalledTimes(1);            // re-announced
    expect(getMic).toHaveBeenCalledTimes(1);                 // mic NOT re-requested
    expect(s.status).toBe('joined');
  });

  it('resync rebuilds the mesh when the server replies with a fresh VOICE_PEERS', async () => {
    const { deps, createPeer } = makeDeps({ myClientId: 'aaa' });
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    s.resync();
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    expect(createPeer).toHaveBeenCalledTimes(2); // one before, one after the reconnect
    expect(s.peers.has('bbb')).toBe(true);
  });

  it('resync re-asserts mute state (the server resets it on rejoin)', async () => {
    const { deps, signal } = makeDeps({ myClientId: 'aaa' });
    const s = new VoiceSession(deps); await s.join();
    s.toggleMute(); // muted
    signal.mute.mockClear();
    s.resync();
    expect(signal.mute).toHaveBeenCalledWith(true);
  });

  it('resync is a no-op when not joined (nothing to rebuild)', () => {
    const { deps, signal } = makeDeps({ myClientId: 'aaa' });
    const s = new VoiceSession(deps);
    s.resync();
    expect(signal.join).not.toHaveBeenCalled();
    expect(s.status).toBe('idle');
  });
});

describe('VoiceSession — ICE queueing + connection summary (Stage 25.7)', () => {
  it('an ICE candidate arriving BEFORE the remote description is buffered, then applied', async () => {
    // me = 'zzz' > 'bbb' → I wait for the offer, so the PC has no remote description yet.
    const { deps, peers } = makeDeps({ myClientId: 'zzz' });
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_PEER_JOINED', clientId: 'bbb', name: 'B', muted: false });
    await flush();
    s.onMessage({ t: 'VOICE_SIGNAL_ICE', fromClientId: 'bbb', candidate: JSON.stringify({ candidate: 'early' }) });
    await flush();
    expect(peers[0].addIceCandidate).not.toHaveBeenCalled();      // buffered, NOT dropped
    s.onMessage({ t: 'VOICE_SIGNAL_OFFER', fromClientId: 'bbb', sdp: JSON.stringify({ type: 'offer' }) });
    await flush();
    expect(peers[0].addIceCandidate).toHaveBeenCalledTimes(1);    // flushed after setRemoteDescription
  });

  it('ontrack hands the remote stream to onRemoteStream (drives the audio sink)', async () => {
    const onRemoteStream = vi.fn();
    const { deps, peers } = makeDeps({ myClientId: 'aaa', onRemoteStream });
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    await flush();
    const remote = fakeStream();
    (peers[0] as unknown as { ontrack: (e: { streams: StreamLike[] }) => void }).ontrack({ streams: [remote] });
    expect(onRemoteStream).toHaveBeenCalledWith('bbb', remote);
  });

  it('connectionSummary tracks peer states; allFailed only when every peer is down', async () => {
    const { deps, peers } = makeDeps({ myClientId: 'aaa' });
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    await flush();
    const pc = peers[0] as unknown as { connectionState: string; onconnectionstatechange: () => void };
    pc.connectionState = 'connected';
    pc.onconnectionstatechange();
    expect(s.connectionSummary()).toMatchObject({ peers: 1, connected: 1, allFailed: false });
    pc.connectionState = 'failed';
    pc.onconnectionstatechange();
    expect(s.connectionSummary().allFailed).toBe(true);
  });

  it('connectionSummary surfaces the peer ICE state for the debug line (Stage 25.8)', async () => {
    const { deps, peers } = makeDeps({ myClientId: 'aaa' });
    const s = new VoiceSession(deps); await s.join();
    s.onMessage({ t: 'VOICE_PEERS', peers: [{ clientId: 'bbb', name: 'B', muted: false }] });
    await flush();
    expect(s.connectionSummary().iceState).toBe('new');
    const pc = peers[0] as unknown as { iceConnectionState: string; oniceconnectionstatechange: () => void };
    pc.iceConnectionState = 'checking';
    pc.oniceconnectionstatechange();
    expect(s.connectionSummary().iceState).toBe('checking');
    pc.iceConnectionState = 'connected';
    pc.oniceconnectionstatechange();
    expect(s.connectionSummary().iceState).toBe('connected');
  });
});
