import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Stage 17.3 — other players' seats show the server avatar (or emoji), NEVER the
// local-only custom image. Source-level contract (no testing-library in the repo).

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const seatAvatar = read('src/ui/components/SeatAvatar.tsx');
const lobby = read('src/ui/online/Lobby.tsx');
const table = read('src/ui/components/TablePlayers.tsx');
const online = read('src/ui/online/OnlineGame.tsx');

describe('SeatAvatar — same-origin image with an emoji fallback', () => {
  it('gates the image behind isSafeAvatarImageUrl and falls back on error', () => {
    expect(seatAvatar).toContain("import { isSafeAvatarImageUrl } from '../../net/avatarImage'");
    expect(seatAvatar).toContain('isSafeAvatarImageUrl(imageUrl)');
    expect(seatAvatar).toContain('member-avatar__img');
    expect(seatAvatar).toContain('onError={() => setFailed(true)}');
    expect(seatAvatar).toContain('{emoji}'); // fallback
  });

  it('NEVER reads the local custom-avatar store (that is a "me"-only surface)', () => {
    expect(seatAvatar).not.toMatch(/customAvatar|useCustomAvatar|MyAvatar/);
  });
});

describe('seat surfaces render SeatAvatar with the member/seat URL', () => {
  it('Lobby uses the room member avatarImageUrl', () => {
    expect(lobby).toContain('<SeatAvatar emoji={m.avatar} imageUrl={m.avatarImageUrl}');
  });
  it('the King table uses the seat→URL map from context (not the local store)', () => {
    expect(table).toContain('seatAvatarImages');
    expect(table).toContain('<SeatAvatar emoji={p.avatar} imageUrl={seatAvatarImages?.[p.seatIndex]}');
    expect(table).not.toMatch(/customAvatar|MyAvatar/);
  });
  it('OnlineGame builds the seat→URL map, validated + provided via context', () => {
    expect(online).toContain('const seatAvatarImages: Record<number, string> = {}');
    expect(online).toContain('isSafeAvatarImageUrl(m.avatarImageUrl)');
    expect(online).toContain('seatAvatarImages,'); // passed into GameContext.Provider
  });
});

describe('privacy / boundary — only an optional same-origin URL on the wire', () => {
  it('messages.ts RoomMember has an OPTIONAL avatarImageUrl and no image bytes', () => {
    const messages = read('src/net/messages.ts');
    expect(messages).toContain('avatarImageUrl?: string | null');
    expect(/data:image|base64/i.test(messages)).toBe(false);
  });
  it('the server snapshot only emits a validated same-origin value', () => {
    const core = read('src/net/serverCore.ts');
    expect(core).toContain('isSafeAvatarImageUrl(m.avatarImageUrl)');
  });
  it('the local custom-avatar image is never sent to other players (no store on seats)', () => {
    // The only avatar the wire carries for others is the emoji + the server URL.
    for (const src of [lobby, table]) {
      expect(src).not.toContain('customAvatarStore');
    }
  });
});
