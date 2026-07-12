// Source guards for Stage 27.1: (A) Profile splits Friends / Statistics / Achievements /
// Leaderboards into separate reachable SECTIONS (a scalable grid, not one truncated tab row); the
// Friends request badge stays visible on its entry. (B) Room reactions/stickers float over the
// SENDER's seat (anchored) with a center fallback, using the existing seatIndex — no new payload.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('Profile section split (Stage 27.1, Part A)', () => {
  const menu = read('src/ui/ProfileMenu.tsx');
  const css = read('src/styles/lobby.css');

  it('renders a section GRID of tiles, not a single segmented tab row, as the entry point', () => {
    expect(menu).toContain('profile-sections');
    expect(menu).toContain('profile-section-tile');
    // The old crowded tab row (segmented profile-screen__tabs role="tablist") is gone.
    expect(menu).not.toMatch(/segmented profile-screen__tabs/);
    expect(css).toContain('.profile-section-tile');
  });

  it('Friends / Statistics / Achievements / Leaderboards are each their own reachable section', () => {
    for (const key of ['profile', 'friends', 'stats', 'achievements', 'leaderboard']) {
      expect(menu, key).toMatch(new RegExp(`key: '${key}'`));
    }
    // Each section still renders its panel when opened (drill-in preserved).
    expect(menu).toMatch(/tab === 'friends' &&[\s\S]*<FriendsPanel/);
    expect(menu).toMatch(/tab === 'stats' &&/);
    expect(menu).toMatch(/tab === 'achievements' &&[\s\S]*<AchievementsPanel/);
    // A back control returns to the section grid.
    expect(menu).toContain("t('profile.sections')");
    expect(menu).toMatch(/setInSection\(false\)/);
  });

  it('the incoming friend-request badge is shown on the Friends entry', () => {
    expect(menu).toMatch(/key === 'friends' && friendsIncoming > 0[\s\S]*notif-badge/);
  });

  it('the per-game Stats + Leaderboard selectors survive inside their sections', () => {
    expect(menu).toMatch(/segmented segmented--sub[\s\S]*statsGame/);
    expect(menu).toMatch(/segmented segmented--sub[\s\S]*boardGame/);
  });
});

describe('Sender-anchored reactions (Stage 27.1, Part B)', () => {
  const social = read('src/ui/online/RoomSocial.tsx');
  const online = read('src/ui/online/OnlineGame.tsx');

  it('positions each reaction + sticker by the sender seat (not a hardcoded centre)', () => {
    expect(social).toContain('reactionAnchorForSender');
    // BOTH the emoji reactions and the media stickers get an anchor wrapper.
    expect((social.match(/reaction-anchor--\$\{reactionAnchorForSender/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // The container is no longer a fixed top-centre flex row for ALL chips.
    expect(read('src/styles/social.css')).toContain('.reaction-anchor--bottom');
  });

  it('OnlineGame passes the viewer seat + table size from the public room snapshot', () => {
    expect(online).toContain('mySeatIndex={mySeatIndex}');
    expect(online).toContain('seatCount={seatCount}');
    expect(online).toMatch(/members\.filter\(\(m\) => m\.role === 'player'\)\.length/);
  });

  it('carries NO new identity in the payload — it reuses the existing public seatIndex', () => {
    // The anchor is derived from seatIndex only; no email/token/session/userId is read.
    const anchor = read('src/ui/online/reactionAnchor.ts');
    expect(anchor).not.toMatch(/\bemail\b|\btoken\b|session|userId/i);
    // RReaction/Chat payloads already carry seatIndex (public) — no message shape changed here.
    const messages = read('src/net/messages.ts');
    expect(messages).toMatch(/REACTION'[^}]*seatIndex/);
  });
});
