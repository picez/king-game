import { describe, it, expect, beforeEach } from 'vitest';
import { createRoom, addMember, addBot, snapshot, serializeRoom, deserializeRoom } from './serverCore';
import { resolveAvatarImageUrl } from '../../server/api';

// Stage 17.3 — the uploaded avatar rides the room snapshot as a SAME-ORIGIN URL only.
// These are pure serverCore checks (no DB): the snapshot/persistence gate on
// isSafeAvatarImageUrl, so bots/guests/legacy/tampered values degrade to the emoji.

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const VALID = `/api/avatar/${UUID}.webp?v=2`;

function room4() {
  return createRoom({
    code: 'ABCD', playerCount: 4, modeSelectionType: 'fixed',
    host: { clientId: 'host', reconnectToken: 'h', name: 'Ann', avatar: '🦊' },
  });
}
const memberIn = (snap: ReturnType<typeof snapshot>, clientId: string) =>
  snap.members.find((m) => m.clientId === clientId)!;

describe('snapshot — emits avatarImageUrl only for a valid same-origin value', () => {
  it('a stamped human seat carries the URL; a guest seat + a bot do not', () => {
    const room = room4();
    room.members.get('host')!.avatarImageUrl = VALID;           // signed-in with avatar
    addMember(room, { clientId: 'g', reconnectToken: 'x', name: 'Gil', avatar: '🐸' }); // guest, no url
    addBot(room, 'host', { clientId: 'b', reconnectToken: 'z' });                      // bot

    const snap = snapshot(room);
    expect(memberIn(snap, 'host').avatarImageUrl).toBe(VALID);
    expect('avatarImageUrl' in memberIn(snap, 'g')).toBe(false);
    expect('avatarImageUrl' in memberIn(snap, 'b')).toBe(false);
  });

  it('a remote / non-same-origin URL is NEVER emitted (gate), even if set', () => {
    const room = room4();
    room.members.get('host')!.avatarImageUrl = `https://evil.example/api/avatar/${UUID}.webp`;
    expect('avatarImageUrl' in memberIn(snapshot(room), 'host')).toBe(false);
    // Nor a data URL / OAuth-style absolute.
    room.members.get('host')!.avatarImageUrl = 'data:image/webp;base64,AAAA';
    expect('avatarImageUrl' in memberIn(snapshot(room), 'host')).toBe(false);
  });
});

describe('persistence — round-trip + legacy/tampered restore', () => {
  it('serialize→deserialize preserves a valid URL', () => {
    const room = room4();
    room.members.get('host')!.avatarImageUrl = VALID;
    const restored = deserializeRoom(serializeRoom(room))!;
    expect(restored.members.get('host')!.avatarImageUrl).toBe(VALID);
  });

  it('a legacy persisted room (no avatarImageUrl field) restores to null', () => {
    const room = room4();
    const persisted = serializeRoom(room) as unknown as { members: Array<Record<string, unknown>> };
    for (const m of persisted.members) delete m.avatarImageUrl;
    const restored = deserializeRoom(persisted)!;
    expect(restored.members.get('host')!.avatarImageUrl).toBeNull();
  });

  it('a tampered (remote) persisted URL restores to null', () => {
    const room = room4();
    room.members.get('host')!.avatarImageUrl = VALID;
    const persisted = serializeRoom(room) as unknown as { members: Array<Record<string, unknown>> };
    persisted.members.find((m) => m.clientId === 'host')!.avatarImageUrl = 'http://evil/x.webp';
    const restored = deserializeRoom(persisted)!;
    expect(restored.members.get('host')!.avatarImageUrl).toBeNull();
  });
});

describe('resolveAvatarImageUrl — DB-gated, never throws', () => {
  beforeEach(() => { delete process.env.DATABASE_URL; });
  it('returns null with no DB and for a null user', async () => {
    expect(await resolveAvatarImageUrl(UUID)).toBeNull();
    expect(await resolveAvatarImageUrl(null)).toBeNull();
  });
});
