import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../i18n/dictionaries/en';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const toast = read('src/ui/components/AchievementToast.tsx');
const panel = read('src/ui/components/AchievementsPanel.tsx');
const menu = read('src/ui/ProfileMenu.tsx');
const store = read('src/stats/achievementsSeen.ts');

const NEW_KEYS = [
  'ach.unlocked', 'ach.new', 'ach.more', 'ach.next',
  'ach.rarity.common', 'ach.rarity.uncommon', 'ach.rarity.rare', 'ach.rarity.epic',
];

describe('i18n parity — unlock-toast keys in every language', () => {
  const dicts = ['en', 'uk', 'de', 'ar'].map((l) =>
    read(join('src/i18n/dictionaries', `${l}.ts`)));
  for (const key of NEW_KEYS) {
    it(`${key} exists (non-blank) in EN and every dictionary`, () => {
      expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
      for (const d of dicts) expect(d, `dict missing ${key}`).toContain(`'${key}'`);
    });
  }
});

describe('AchievementToast — renders the unlock, queues multiples, dismisses', () => {
  it('shows the "Achievement unlocked" eyebrow + the badge title', () => {
    expect(toast).toContain("t('ach.unlocked')");
    expect(toast).toContain('t(current.titleKey)');
  });
  it('summarises the remainder with a "+N more" chip and a Next action', () => {
    expect(toast).toContain("t('ach.more')");
    expect(toast).toContain('+{remaining}');
    expect(toast).toContain("t('ach.next')");
  });
  it('advances through the queue, then dismisses on the last one', () => {
    expect(toast).toContain('hasMore ? ');
    expect(toast).toContain('onDismiss()');
    // a close (✕) button that dismisses the whole queue immediately
    expect(toast).toContain('ach-toast__close');
  });
  it('is a polite status region, not a blocking dialog', () => {
    expect(toast).toContain('role="status"');
    expect(toast).toContain('aria-live="polite"');
    expect(toast).not.toContain('role="dialog"');
  });
});

describe('AchievementsPanel — "New" marker for unseen earned badges', () => {
  it('accepts a seen list and flags earned-but-unseen badges', () => {
    expect(panel).toContain('seen');
    expect(panel).toContain('const isNew = e && !seenSet.has(a.id)');
    expect(panel).toContain('ach-badge__new');
    expect(panel).toContain("t('ach.new')");
  });
});

describe('ProfileMenu — post-stats-load trigger, local seen ledger', () => {
  it('detects unlocks only after all stats resolve and never when logged out', () => {
    expect(menu).toContain('!allResolved || needsSignIn');
    expect(menu).toContain('unseenEarned');
    expect(menu).toContain('earnedIds(evaluateAchievements(allStats))');
  });
  it('snapshots the seen ledger on open and passes it to the grid', () => {
    expect(menu).toContain('loadSeen()');
    expect(menu).toContain('seen={seenAtOpen}');
  });
  it('marks the earned ids seen when the toast is dismissed', () => {
    expect(menu).toContain('markSeen(earnedIds(evaluateAchievements(allStats)))');
    expect(menu).toContain('<AchievementToast');
  });
});

describe('boundaries — local-only, no DB/server/ws/sound, off the gameplay path', () => {
  it('the seen store does no I/O beyond localStorage (no fetch/socket/server import)', () => {
    expect(store).not.toMatch(/\bfetch\(|new WebSocket|['"]\/api\/|from ['"][^'"]*(\/server|\/db)/);
    expect(store).toContain('localStorage');
  });
  it('neither the toast nor the store imports the sound engine / audio', () => {
    for (const src of [toast, store]) {
      expect(src).not.toMatch(/soundEngine|['"][^'"]*\/audio\//);
      expect(src).not.toMatch(/new Audio\(|AudioContext/);
    }
  });
  it('the toast does no network / DB / socket I/O', () => {
    expect(toast).not.toMatch(/\bfetch\(|new WebSocket|['"]\/api\//);
  });

  // No gameplay module (core rules, game engines, or the server) may import the
  // toast or the seen ledger — achievements stay a read-only client overlay.
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(join(process.cwd(), dir))) {
      const rel = `${dir}/${name}`;
      const full = join(process.cwd(), rel);
      if (statSync(full).isDirectory()) out.push(...walk(rel));
      else if (/\.tsx?$/.test(name)) out.push(rel);
    }
    return out;
  };
  it('src/core, src/games, and the server do not import the toast or seen store', () => {
    const files = ['src/core', 'src/games', 'server'].flatMap(walk);
    for (const f of files) {
      const src = read(f);
      expect(src, `${f} imports AchievementToast`).not.toMatch(/AchievementToast/);
      expect(src, `${f} imports achievementsSeen`).not.toMatch(/achievementsSeen/);
    }
  });
});
