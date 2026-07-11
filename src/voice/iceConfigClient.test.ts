import { describe, it, expect, vi } from 'vitest';
import { fetchIceServers, iceModeOf } from './iceConfigClient';

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('fetchIceServers — runtime endpoint with graceful fallback', () => {
  it('uses the server-provided ICE servers (incl. TURN) when the endpoint answers', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'turn:t.example.com:3478', username: 'u', credential: 'secret' },
      ],
    })) as unknown as typeof fetch;
    const servers = await fetchIceServers({ baseUrl: 'https://api.example.com', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/api/voice/ice-config', expect.any(Object));
    expect(servers).toEqual([
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:t.example.com:3478', username: 'u', credential: 'secret' },
    ]);
  });

  it('falls back to the build-time / STUN default on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false)) as unknown as typeof fetch;
    const servers = await fetchIceServers({ fetchImpl });
    expect(servers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });

  it('falls back when the endpoint throws (offline / aborted)', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const servers = await fetchIceServers({ fetchImpl });
    expect(servers).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });

  it('falls back when the body shape is wrong / entries invalid', async () => {
    const bad = vi.fn(async () => jsonResponse({ iceServers: 'nope' })) as unknown as typeof fetch;
    expect(await fetchIceServers({ fetchImpl: bad })).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    const badEntries = vi.fn(async () => jsonResponse({ iceServers: [{ urls: 'http://evil' }] })) as unknown as typeof fetch;
    expect(await fetchIceServers({ fetchImpl: badEntries })).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
  });

  it('returns the build-time default when no fetch is available', async () => {
    const servers = await fetchIceServers({ fetchImpl: undefined });
    expect(Array.isArray(servers)).toBe(true);
    expect(servers.length).toBeGreaterThan(0);
  });
});

describe('iceModeOf — secret-free mode for the UI indicator', () => {
  it('detects STUN-only vs TURN', () => {
    expect(iceModeOf([{ urls: 'stun:stun.l.google.com:19302' }])).toBe('stun_only');
    expect(iceModeOf([{ urls: 'turn:t:3478', username: 'u', credential: 'x' }])).toBe('turn_configured');
    expect(iceModeOf([{ urls: ['stun:a:3478', 'turns:b:5349'] }])).toBe('turn_configured');
  });
});
