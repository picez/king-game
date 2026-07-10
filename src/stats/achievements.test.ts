import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACHIEVEMENTS, evaluateAchievements, earnedCount, totalWins, totalGames,
  type AllStats,
} from './achievements';
import type { KingStats, DurakStats, DebercStats, TarneebStats, PreferansStats } from '../net/statsApi';
import { EN } from '../i18n/dictionaries/en';

// ── zeroed stat factories (only the fields under test matter) ────────────────
const king = (o: Partial<KingStats> = {}): KingStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null, roundsPlayed: 0,
  totalScore: 0, averageScore: null, bestScore: null, worstScore: null,
  trumpRoundsPlayed: 0, negativeRoundsPlayed: 0, surrenderedCount: 0,
  surrenderedSupported: false, modeBreakdown: {}, lastGameAt: null, ...o,
});
const durak = (o: Partial<DurakStats> = {}): DurakStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null,
  foolCount: 0, drawCount: 0, foolRate: null, lastGameAt: null, ...o,
});
const deberc = (o: Partial<DebercStats> = {}): DebercStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null, jackpotCount: 0, jackpotRate: null,
  combinations: { terz: 0, platina: 0, bella: 0, total: 0, handsPlayed: 0, handsWithMeld: 0, meldRate: null },
  lastGameAt: null, ...o,
});
const tarneeb = (o: Partial<TarneebStats> = {}): TarneebStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null, handsPlayed: 0, handsAsDeclarer: 0,
  contractsMade: 0, contractsFailed: 0, contractSuccessRate: null, totalTeamScore: 0,
  averageTeamScore: null, bestGameScore: null, worstGameScore: null, lastGameAt: null, ...o,
});
const preferans = (o: Partial<PreferansStats> = {}): PreferansStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, gamesDrawn: 0, winRate: null, handsPlayed: 0, handsAsDeclarer: 0,
  contractsMade: 0, contractsFailed: 0, contractSuccessRate: null, totalScore: 0,
  averageScore: null, bestGameScore: null, worstGameScore: null, lastGameAt: null, ...o,
});
const zero = (): AllStats => ({ king: king(), durak: durak(), deberc: deberc(), tarneeb: tarneeb(), preferans: preferans() });
const earnedId = (s: AllStats, id: string): boolean =>
  evaluateAchievements(s).find((r) => r.achievement.id === id)!.earned;

describe('achievements catalog', () => {
  it('has 8–12 badges with unique ids', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(8);
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(12);
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every badge has a valid rarity, an icon, and a game scope in the catalog', () => {
    for (const a of ACHIEVEMENTS) {
      expect(['common', 'rare', 'epic']).toContain(a.rarity);
      expect(a.icon.length).toBeGreaterThan(0);
      if (a.gameType) expect(['king', 'durak', 'deberc', 'tarneeb', 'preferans']).toContain(a.gameType);
    }
  });

  it('every title/description key exists (non-blank) in every language', () => {
    const dicts = ['en', 'uk', 'de', 'ar'].map((l) =>
      readFileSync(join(process.cwd(), 'src/i18n/dictionaries', `${l}.ts`), 'utf8'));
    for (const a of ACHIEVEMENTS) {
      for (const key of [a.titleKey, a.descriptionKey]) {
        expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
        for (const d of dicts) expect(d, `dict missing ${key}`).toContain(`'${key}'`);
      }
    }
  });

  it('defines the section + progress + empty UI keys', () => {
    for (const key of ['profile.achievements', 'ach.progress', 'ach.emptyLocked']) {
      expect(EN[key as keyof typeof EN], key).toBeTruthy();
    }
  });
});

describe('evaluateAchievements — graceful with missing stats', () => {
  it('returns one row per badge, all locked, when nothing is loaded', () => {
    const rows = evaluateAchievements({ king: null, durak: null, deberc: null, tarneeb: null, preferans: null });
    expect(rows).toHaveLength(ACHIEVEMENTS.length);
    expect(earnedCount(rows)).toBe(0);
  });

  it('aggregate helpers are null-safe', () => {
    const empty = { king: null, durak: null, deberc: null, tarneeb: null, preferans: null };
    expect(totalWins(empty)).toBe(0);
    expect(totalGames(empty)).toBe(0);
  });
});

// Each MVP badge: one state that earns it, one that does not.
describe('each badge has a positive + negative case', () => {
  const cases: Array<{ id: string; earn: AllStats; lock: AllStats }> = [
    { id: 'first-win', earn: { ...zero(), king: king({ gamesWon: 1 }) }, lock: zero() },
    { id: 'veteran', earn: { ...zero(), king: king({ gamesPlayed: 25 }) }, lock: { ...zero(), king: king({ gamesPlayed: 24 }) } },
    { id: 'centurion', earn: { ...zero(), durak: durak({ gamesPlayed: 100 }) }, lock: { ...zero(), durak: durak({ gamesPlayed: 99 }) } },
    {
      id: 'all-rounder',
      earn: { king: king({ gamesWon: 1 }), durak: durak({ gamesWon: 1 }), deberc: deberc({ gamesWon: 1 }), tarneeb: tarneeb({ gamesWon: 1 }), preferans: preferans({ gamesWon: 1 }) },
      // Won every game except Preferans → still locked (a win in EVERY game is required).
      lock: { king: king({ gamesWon: 1 }), durak: durak({ gamesWon: 1 }), deberc: deberc({ gamesWon: 1 }), tarneeb: tarneeb({ gamesWon: 1 }), preferans: preferans({ gamesWon: 0 }) },
    },
    { id: 'king-winner', earn: { ...zero(), king: king({ gamesWon: 1 }) }, lock: { ...zero(), king: king({ gamesWon: 0, gamesPlayed: 3 }) } },
    { id: 'durak-survivor', earn: { ...zero(), durak: durak({ gamesWon: 1 }) }, lock: { ...zero(), durak: durak({ gamesWon: 0, foolCount: 2 }) } },
    { id: 'tarneeb-declarer', earn: { ...zero(), tarneeb: tarneeb({ handsAsDeclarer: 1 }) }, lock: { ...zero(), tarneeb: tarneeb({ handsAsDeclarer: 0, handsPlayed: 5 }) } },
    { id: 'tarneeb-contractor', earn: { ...zero(), tarneeb: tarneeb({ contractsMade: 5 }) }, lock: { ...zero(), tarneeb: tarneeb({ contractsMade: 4 }) } },
    { id: 'preferans-declarer', earn: { ...zero(), preferans: preferans({ handsAsDeclarer: 1 }) }, lock: { ...zero(), preferans: preferans({ handsAsDeclarer: 0, handsPlayed: 5 }) } },
    { id: 'deberc-meld-maker', earn: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 0, bella: 0, total: 10, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) }, lock: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 0, bella: 0, total: 9, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) } },
    { id: 'deberc-bella', earn: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 0, bella: 1, total: 1, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) }, lock: zero() },
    { id: 'deberc-jackpot', earn: { ...zero(), deberc: deberc({ jackpotCount: 1 }) }, lock: { ...zero(), deberc: deberc({ jackpotCount: 0, gamesWon: 3 }) } },
  ];

  it('covers every catalog badge', () => {
    expect(new Set(cases.map((c) => c.id))).toEqual(new Set(ACHIEVEMENTS.map((a) => a.id)));
  });

  for (const c of cases) {
    it(`${c.id}: earned on the positive case`, () => expect(earnedId(c.earn, c.id)).toBe(true));
    it(`${c.id}: locked on the negative case`, () => expect(earnedId(c.lock, c.id)).toBe(false));
  }
});

describe('boundaries — derived only, no DB/network/private data', () => {
  const cat = readFileSync(join(process.cwd(), 'src/stats/achievements.ts'), 'utf8');
  const panel = readFileSync(join(process.cwd(), 'src/ui/components/AchievementsPanel.tsx'), 'utf8');
  const menu = readFileSync(join(process.cwd(), 'src/ui/ProfileMenu.tsx'), 'utf8');

  it('the catalog does no I/O and touches no server/db/socket (code, not prose)', () => {
    expect(cat).not.toMatch(/\bfetch\(|['"]\/api\/|new WebSocket|from ['"][^'"]*(server|\/db)/);
  });

  it('the panel renders earned + locked badges from evaluateAchievements', () => {
    expect(panel).toContain('evaluateAchievements');
    expect(panel).toContain('ach-badge--earned');
    expect(panel).toContain('ach-badge--locked');
    expect(panel).toContain("e ? a.icon : '🔒'");
    expect(panel).toContain('data-ach');
  });

  it('ProfileMenu adds an Achievements tab derived from the existing stat loadables', () => {
    expect(menu).toContain("label: t('profile.achievements')");
    expect(menu).toContain('<AchievementsPanel');
    expect(menu).toContain("tab === 'achievements'");
    // No new fetch route — it reuses the four stat loaders already present.
    expect(menu).not.toContain('fetchAchievements');
    expect(menu).not.toMatch(/['"]\/api\/[a-z/]*achievements/);
  });
});
