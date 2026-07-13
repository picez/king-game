import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../i18n/dictionaries/en';

// ---------------------------------------------------------------------------
// Stage 28.5 — Tarneeb Solo production QA / hardening source guards.
// Two real drifts fixed after the 28.4 release: (1) the room browser hard-coded
// "2 teams" for every Tarneeb room (mislabelling Solo rooms); (2) the profile
// achievements read the toggled Tarneeb stats, so switching to Solo could feed
// solo data into achievements. Both are pinned here.
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('room browser shows the room’s actual Tarneeb mode (not a hard "2 teams")', () => {
  const menu = read('src/ui/StartMenu.tsx');
  it('uses r.tarneebVariant → Solo / Pairs label', () => {
    expect(menu).toContain("r.tarneebVariant === 'solo' ? 'tarneeb.modeSolo' : 'tarneeb.modePairs'");
    // The stale hard-coded room-row label is gone.
    expect(menu).not.toContain("gameType === 'tarneeb' ? <span className=\"sb-variant\"> · {t('tarneeb.twoTeams')}");
  });
});

describe('profile achievements never mix in Solo stats (Stage 28.5)', () => {
  const profile = read('src/ui/ProfileMenu.tsx');
  it('Solo stats/leaderboard live in their OWN state, separate from the canonical Pairs state', () => {
    expect(profile).toContain('tarneebSoloStats');
    expect(profile).toContain('tarneebSoloBoard');
    // The Pairs loader always fetches pairs (canonical for achievements).
    expect(profile).toContain("setTarneebStats(await fetchTarneebStats(base, 'pairs'))");
    expect(profile).toContain("setTarneebSoloStats(await fetchTarneebStats(base, 'solo'))");
  });

  it('achievements read the PAIRS state (tarneebStats), never the toggled/solo value', () => {
    expect(profile).toContain('tarneeb: dataOf(tarneebStats)');
    // The stats panel picks the state by the current toggle, but allStats does not.
    expect(profile).toContain("tarneebVariant === 'solo' ? tarneebSoloStats : tarneebStats");
  });

  it('the leaderboard panel also picks its state by variant (no cross-mode mixing)', () => {
    expect(profile).toContain("tarneebVariant === 'solo' ? tarneebSoloBoard : tarneebBoard");
  });
});

describe('i18n parity — Tarneeb mode keys used by the browser/lobby/toggle', () => {
  const dicts = ['en', 'uk', 'de', 'ar'].map((l) => read(join('src/i18n/dictionaries', `${l}.ts`)));
  for (const key of ['tarneeb.modePairs', 'tarneeb.modeSolo', 'tarneeb.modePairsDesc', 'tarneeb.modeSoloDesc']) {
    it(`${key} present + non-blank in every language`, () => {
      expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
      for (const d of dicts) expect(d, `dict missing ${key}`).toContain(`'${key}'`);
    });
  }
});
