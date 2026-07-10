// Source guards for the Preferans stats + leaderboard UI (Stage 19.6). The project
// runs in a `node` env (no jsdom), so these are string-level checks on the panels +
// ProfileMenu wiring + i18n reuse.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../i18n/dictionaries/en';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const panel = read('src/ui/components/PreferansStatsPanel.tsx');
const board = read('src/ui/components/PreferansLeaderboardPanel.tsx');
const profile = read('src/ui/ProfileMenu.tsx');

describe('PreferansStatsPanel — score-only, soft states', () => {
  it('renders record / contract / declarer / score cards from the stats view', () => {
    expect(panel).toContain("t('stats.gamesPlayed')");
    expect(panel).toContain("t('stats.winRate')");
    expect(panel).toContain("t('stats.contractRate')");
    expect(panel).toContain("t('stats.declarerHands')");
    expect(panel).toContain("t('stats.avgScore')");
    // Per-seat score fields (not team).
    expect(panel).toContain('s.averageScore');
    expect(panel).toContain('s.bestGameScore');
    expect(panel).toContain('s.worstGameScore');
    expect(panel).toContain('s.gamesDrawn');
  });
  it('has empty / auth / unavailable / error states', () => {
    expect(panel).toContain("t('stats.noGames')");
    expect(panel).toContain("t('stats.signInPrompt')");
    expect(panel).toContain("t('stats.unavailable')");
    expect(panel).toContain("t('stats.error')");
  });
  it('never renders card / rank / suit — it is a score-only view', () => {
    expect(/\.rank|\.suit|handsBySeat|talon|discards|CardView/.test(panel)).toBe(false);
    expect(/\.rank|\.suit|handsBySeat|talon|discards|CardView/.test(board)).toBe(false);
  });
});

describe('ProfileMenu wires Preferans stats + leaderboard + achievements (Stage 19.7)', () => {
  it('adds preferans to the game sub-tabs + panels', () => {
    expect(profile).toContain("'king', 'durak', 'deberc', 'tarneeb', 'preferans'");
    expect(profile).toContain('fetchPreferansStats');
    expect(profile).toContain('fetchPreferansLeaderboard');
    expect(profile).toContain('<PreferansStatsPanel');
    expect(profile).toContain('<PreferansLeaderboardPanel');
  });
  it('includes Preferans in the achievements AllStats (released, Stage 19.7)', () => {
    // allStats now carries preferans, so its badge (preferans-declarer) can earn.
    expect(profile).toContain('preferans: dataOf(preferansStats)');
    expect(profile).toContain('debercStats && tarneebStats && preferansStats');
  });
});

describe('reuses existing stats i18n keys (no new keys needed)', () => {
  it('the base (EN) dictionary already defines the keys the panels use', () => {
    for (const k of ['stats.winRate', 'stats.contractRate', 'stats.declarerHands', 'stats.avgScore',
      'stats.gpShort', 'stats.wShort', 'stats.contractShort', 'gameType.preferans']) {
      expect((EN as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});
