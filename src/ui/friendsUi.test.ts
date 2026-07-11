// Source guards for the Stage 25.2 Friends UI + room-invite wiring (pure string checks).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const panel = read('src/ui/components/FriendsPanel.tsx');
const profileMenu = read('src/ui/ProfileMenu.tsx');
const online = read('src/ui/online/OnlineGame.tsx');

describe('Friends tab (Profile)', () => {
  it('is a dedicated Profile tab rendering FriendsPanel', () => {
    expect(profileMenu).toContain("import FriendsPanel");
    expect(profileMenu).toMatch(/key: 'friends'/);
    expect(profileMenu).toMatch(/tab === 'friends'[\s\S]*<FriendsPanel/);
  });

  it('shows the friend code + copy, add-by-code, accept/decline, online-first, guest CTA', () => {
    expect(panel).toContain("t('friends.yourCode')");
    expect(panel).toMatch(/clipboard.*writeText\(data\.friendCode\)/);
    expect(panel).toContain('requestFriend(base');
    expect(panel).toContain('acceptFriend(base');
    expect(panel).toContain('declineFriend(base');
    expect(panel).toContain('removeFriend(base');
    // Online-first ordering comes from parseFriendsData (client sorts online first).
    expect(read('src/net/friendsApi.ts')).toMatch(/sort\(\(a, b\) => Number\(b\.online\) - Number\(a\.online\)\)/);
    // Guest → sign-in CTA, and NO fetch when not signed in.
    expect(panel).toMatch(/if \(!signedIn\) return;/);
    expect(panel).toContain("t('friends.guestCta')");
  });

  it('renders the OTHER user\'s avatar (emoji/synced img), never the local "me" MyAvatar', () => {
    expect(panel).not.toContain('MyAvatar');
    expect(panel).toContain('friend.avatarImageUrl');
  });
});

describe('Room invite wiring (OnlineGame)', () => {
  it('offers Invite on online friends (in-room) and shows a received-invite toast', () => {
    expect(online).toContain('sendFriendInvite');
    expect(online).toContain('friend-invite-toast');
    expect(online).toContain("t('friends.join')");
    expect(online).toContain("t('friends.dismiss')");
    // Join reuses the existing ?room= invite flow — never auto-joins.
    expect(online).toMatch(/\/\?room=\$\{encodeURIComponent\(net\.friendInvite/);
    // The FriendsPanel invite surface is gated on being signed in.
    expect(online).toMatch(/signedIn && \([\s\S]*<FriendsPanel/);
  });
});

describe('privacy — no secrets in the friends client', () => {
  it('the client never reads/sends email, token, session, reconnect, or the LOCAL custom avatar', () => {
    for (const src of [panel, read('src/net/friendsApi.ts')]) {
      const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''); // strip comments
      expect(code).not.toMatch(/\bemail\b|reconnectToken|sessionId|\btoken\b/i);
      expect(code).not.toMatch(/customAvatar|loadCustomAvatar/); // local-only avatar never on a friend
    }
  });
});
