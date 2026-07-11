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
    // Stage 25.8: the Lobby shows an ALWAYS-VISIBLE compact invite block (not gated/collapsed),
    // so guests + no-friends users see an explicit hint instead of nothing.
    expect(online).toMatch(/<FriendsPanel[^>]*variant="invite"/);
    expect(online).toContain('lobby-invite-wrap');
  });

  it('the compact invite block has explicit guest / empty / online-first states', () => {
    expect(panel).toMatch(/variant === 'invite'/);
    expect(panel).toContain("t('friends.signInToInvite')");   // guest
    expect(panel).toContain("t('friends.addInProfile')");     // signed-in, no friends
    expect(panel).toContain("t('friends.inviteFriends')");    // header
  });
});

describe('Presence + request badge + invite affordance (Stage 25.7)', () => {
  const startMenu = read('src/ui/StartMenu.tsx');
  const presence = read('src/hooks/usePresence.ts');

  it('an app-level presence connection keeps a signed-in menu user online + drives the badge', () => {
    expect(startMenu).toContain('usePresence(');
    // A red badge shows on the Profile tile when there are incoming requests.
    expect(startMenu).toMatch(/presence\.incomingCount > 0[\s\S]*notif-badge/);
    // The Friends tab gets a count badge too.
    expect(profileMenu).toMatch(/friendsIncoming > 0[\s\S]*notif-badge/);
  });

  it('presence carries no secrets and re-fetches on FRIEND_PRESENCE', () => {
    const code = presence.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/\bemail\b|reconnectToken|sessionId|\btoken\b/i);
    expect(code).toContain("'FRIEND_PRESENCE'");
    expect(code).toContain('fetchFriends');
  });

  it('shows an explicit online/offline chip and an invite hint when not in a room', () => {
    expect(panel).toContain('friend-status');
    expect(panel).toContain("t('friends.online')");
    expect(panel).toContain("t('friends.offline')");
    // Menu context (no onInvite) → a "create/join a room" hint.
    expect(panel).toMatch(/!onInvite[\s\S]*friends\.inviteNeedsRoom/);
    // Offline friend in a room → a disabled Invite with an offline hint.
    expect(panel).toContain("t('friends.friendOffline')");
  });

  it('a failed invite surfaces a non-fatal toast (not the fatal game error surface)', () => {
    const net = read('src/hooks/useNetworkGame.ts');
    expect(net).toMatch(/FRIEND_NOT_ONLINE'[\s\S]*NOT_FRIENDS'[\s\S]*NOT_IN_ROOM'[\s\S]*setSocialNotice/);
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
