import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyFriendInvite, inviteReasonToErrorCode } from './friendInvite';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const base = {
  senderUserId: 'me', senderRoomCode: 'ABCD', toUserId: 'friend', areFriends: true, targetOnline: true,
};

describe('verifyFriendInvite — authorisation', () => {
  it('accepts when authed + in a room + friends + target online; code is the SENDER room', () => {
    expect(verifyFriendInvite(base)).toEqual({ ok: true, toUserId: 'friend', code: 'ABCD' });
  });

  it('rejects: unauthenticated / not-in-room / bad target / not-friends / offline', () => {
    expect(verifyFriendInvite({ ...base, senderUserId: null })).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(verifyFriendInvite({ ...base, senderRoomCode: null })).toEqual({ ok: false, reason: 'not_in_room' });
    expect(verifyFriendInvite({ ...base, toUserId: '' })).toEqual({ ok: false, reason: 'bad_target' });
    expect(verifyFriendInvite({ ...base, toUserId: 42 })).toEqual({ ok: false, reason: 'bad_target' });
    expect(verifyFriendInvite({ ...base, toUserId: 'me' })).toEqual({ ok: false, reason: 'bad_target' }); // self
    expect(verifyFriendInvite({ ...base, areFriends: false })).toEqual({ ok: false, reason: 'not_friends' });
    expect(verifyFriendInvite({ ...base, targetOnline: false })).toEqual({ ok: false, reason: 'offline' });
  });

  it('the room code is NEVER a client value — it is always the sender\'s own room', () => {
    // There is no client `code` field in the check; the verdict returns senderRoomCode.
    const v = verifyFriendInvite({ ...base, senderRoomCode: 'WXYZ' });
    expect(v.ok && v.code).toBe('WXYZ');
  });
});

describe('inviteReasonToErrorCode — surface actionable failures (Stage 25.7)', () => {
  it('maps user-actionable reasons to a client error code', () => {
    expect(inviteReasonToErrorCode('offline')).toBe('FRIEND_NOT_ONLINE');
    expect(inviteReasonToErrorCode('not_friends')).toBe('NOT_FRIENDS');
    expect(inviteReasonToErrorCode('not_in_room')).toBe('NOT_IN_ROOM');
  });
  it('stays silent for states the UI cannot cause', () => {
    expect(inviteReasonToErrorCode('unauthenticated')).toBeNull();
    expect(inviteReasonToErrorCode('bad_target')).toBeNull();
  });
});

describe('server invite/presence wiring (source guards)', () => {
  const index = read('server/index.ts');
  const messages = read('src/net/messages.ts');

  it('FRIEND_INVITE is verified (friends + online + in-room) and rate-limited before delivery', () => {
    expect(index).toContain('verifyFriendInvite');
    expect(index).toContain('allowFriendInvite');
    expect(index).toContain('areFriends');
    expect(index).toContain('deliverFriendInvite');
    // The delivered code is the sender's own room (verdict.code), never msg.code.
    expect(index).toMatch(/code: verdict\.code/);
    expect(messages).not.toMatch(/FRIEND_INVITE'[^}]*code:/); // client FRIEND_INVITE has no code field
  });

  it('presence changes fan out FRIEND_PRESENCE to online friends only', () => {
    expect(index).toContain('broadcastPresence');
    expect(index).toContain('presenceSocketsFor');
    expect(index).toContain('friendUserIds');
  });

  it('the FRIEND_INVITE_RECEIVED payload carries no email/token/reconnect secret', () => {
    // The `payload` object literal is the only thing sent to the target sockets.
    const fn = index.slice(index.indexOf('const payload: ServerMessage'), index.indexOf('const payload: ServerMessage') + 240);
    expect(fn).not.toMatch(/\bemail\b|\btoken\b|reconnect|password/i);
    // It carries only public routing fields.
    expect(fn).toContain('fromUserId'); expect(fn).toContain('fromName'); expect(fn).toContain('code:');
  });
});
