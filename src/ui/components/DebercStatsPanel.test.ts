// Source guards for the Deberc combinations UI (Stage 13.8). The project runs in a
// `node` env (no jsdom), so these are string-level checks on the panel + i18n.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EN } from '../../i18n/dictionaries/en';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const panel = read('src/ui/components/DebercStatsPanel.tsx');

describe('DebercStatsPanel renders the combinations section', () => {
  it('reads combinations from the stats view (not from cards)', () => {
    expect(panel).toContain('s.combinations');
    expect(panel).toContain('stats-combos');
    expect(panel).toContain("t('stats.combinations')");
    // Uses the existing meld labels for each kind.
    expect(panel).toContain("t('deberc.meldTerz')");
    expect(panel).toContain("t('deberc.meldPlatina')");
    expect(panel).toContain("t('deberc.meldBella')");
  });

  it('has an empty state when no combinations are recorded', () => {
    expect(panel).toContain("t('stats.noCombinations')");
    expect(panel).toContain('hasCombos');
  });

  it('shows a per-kind frequency (% of hands)', () => {
    expect(panel).toContain("t('stats.ofHands')");
    expect(panel).toContain('handsPlayed');
  });

  it('never renders card/rank/suit — it is a counts-only view', () => {
    expect(/\.rank|\.suit|cardFace|CardView/.test(panel)).toBe(false);
  });

  it('the new i18n keys exist in the base (EN) dictionary', () => {
    for (const k of ['stats.combinations', 'stats.noCombinations', 'stats.ofHands', 'stats.handsWithMeld']) {
      expect((EN as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});
