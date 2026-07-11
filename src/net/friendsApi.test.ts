import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseFriend, parseFriendsData, requestFriend } from './friendsApi';

const resp = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
afterEach(() => vi.unstubAllGlobals());

describe('friendsApi — parse / normalize (public fields only)', () => {
  it('parseFriend coerces a valid item and drops malformed ones', () => {
    expect(parseFriend({ userId: 'u1', displayName: 'Alex', avatar: '🦁', avatarImageUrl: '/api/avatar/x.webp?v=1', online: true, since: '2026-07-11' }))
      .toEqual({ userId: 'u1', displayName: 'Alex', avatar: '🦁', avatarImageUrl: '/api/avatar/x.webp?v=1', online: true, since: '2026-07-11' });
    expect(parseFriend({ displayName: 'no id' })).toBeNull();
    expect(parseFriend(null)).toBeNull();
  });

  it('parseFriendsData sorts online friends first and ignores junk', () => {
    const d = parseFriendsData({
      friendCode: 'CM-A2B3-C4D5',
      friends: [
        { userId: 'off', online: false }, { userId: 'on', online: true }, 'garbage',
      ],
      incoming: [{ userId: 'in' }],
      outgoing: null,
    });
    expect(d.friendCode).toBe('CM-A2B3-C4D5');
    expect(d.friends.map((f) => f.userId)).toEqual(['on', 'off']); // online first
    expect(d.incoming.map((f) => f.userId)).toEqual(['in']);
    expect(d.outgoing).toEqual([]);
  });

  it('never surfaces an email even if the server erroneously included one', () => {
    // parseFriend copies ONLY the whitelisted fields — an `email` key is dropped.
    const f = parseFriend({ userId: 'u1', email: 'alex@example.com', displayName: 'Alex' })!;
    expect(JSON.stringify(f)).not.toMatch(/@|email/);
  });
});

describe('friendsApi — requestFriend outcome mapping', () => {
  it('maps 200 created/accepted and the safe error codes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, { status: 'created' })));
    expect(await requestFriend('http://x', 'CM-A2B3-C4D5')).toBe('created');
    vi.stubGlobal('fetch', vi.fn(async () => resp(200, { status: 'accepted' })));
    expect(await requestFriend('http://x', 'CM-A2B3-C4D5')).toBe('accepted');
    for (const [status, code, want] of [
      [409, 'already_friends', 'already_friends'], [409, 'pending_exists', 'pending_exists'],
      [400, 'self', 'self'], [404, 'invalid_code', 'invalid_code'], [403, 'forbidden', 'forbidden'],
      [429, 'rate_limited', 'rate_limited'], [503, 'db_disabled', 'unavailable'],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => resp(status, { error: code })));
      expect(await requestFriend('http://x', 'CM-A2B3-C4D5'), code).toBe(want);
    }
  });

  it('a network failure resolves to a typed error (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    await expect(requestFriend('http://x', 'CM-A2B3-C4D5')).resolves.toBe('error');
  });
});
