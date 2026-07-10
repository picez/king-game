import { describe, it, expect, vi, afterEach } from 'vitest';
import { uploadAvatar, deleteServerAvatar } from './avatarApi';

// Client adaptor tests: upload MUST be multipart FormData (never JSON base64), delete
// hits the right endpoint, and HTTP statuses map to typed errors the UI can localise.

interface Call { url: string; init: RequestInit }
function mockFetch(res: { ok: boolean; status: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    return {
      ok: res.ok, status: res.status,
      json: async () => { if (res.body === undefined) throw new Error('no body'); return res.body; },
    } as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return calls;
}
afterEach(() => { vi.restoreAllMocks(); });

const file = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

describe('uploadAvatar — multipart, not JSON', () => {
  it('POSTs FormData to /api/me/avatar and returns the avatar URL', async () => {
    const calls = mockFetch({ ok: true, status: 200, body: { avatarImageUrl: '/api/avatar/x.webp?v=1' } });
    const r = await uploadAvatar('http://h', file());
    expect(r).toEqual({ ok: true, avatarImageUrl: '/api/avatar/x.webp?v=1' });
    expect(calls[0].url).toBe('http://h/api/me/avatar');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.credentials).toBe('include');
    // Body is a FormData (the browser sets the multipart boundary) — NOT a JSON string.
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    expect((calls[0].init.body as FormData).get('file')).toBeInstanceOf(File);
    // We must NOT force a content-type (that would break the multipart boundary),
    // and there is no base64/data-URL anywhere in the request.
    expect(calls[0].init.headers).toBeUndefined();
  });

  it('maps HTTP statuses to typed errors', async () => {
    const cases: Array<[number, unknown, string]> = [
      [401, {}, 'unauthenticated'],
      [403, { error: 'guest_forbidden' }, 'forbidden'],
      [413, { error: 'too_large' }, 'too_large'],
      [429, { error: 'rate_limited' }, 'rate_limited'],
      [503, { error: 'unavailable' }, 'unavailable'],
      [400, { error: 'unsupported_type' }, 'unsupported_type'],
      [400, { error: 'no_file' }, 'failed'],
    ];
    for (const [status, body, expected] of cases) {
      mockFetch({ ok: false, status, body });
      const r = await uploadAvatar('http://h', file());
      expect(r, `status ${status}`).toEqual({ ok: false, error: expected });
    }
  });

  it('a thrown fetch (offline) → network error', async () => {
    mockFetch(new Error('offline'));
    expect(await uploadAvatar('http://h', file())).toEqual({ ok: false, error: 'network' });
  });
});

describe('deleteServerAvatar', () => {
  it('DELETEs /api/me/avatar and returns ok', async () => {
    const calls = mockFetch({ ok: true, status: 200, body: { avatarImageUrl: null } });
    expect(await deleteServerAvatar('http://h')).toBe(true);
    expect(calls[0].url).toBe('http://h/api/me/avatar');
    expect(calls[0].init.method).toBe('DELETE');
    expect(calls[0].init.credentials).toBe('include');
  });
  it('returns false when the request fails', async () => {
    mockFetch({ ok: false, status: 500 });
    expect(await deleteServerAvatar('http://h')).toBe(false);
  });
});
