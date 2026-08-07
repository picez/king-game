// ---------------------------------------------------------------------------
// Stage 38.0.6 — the "Online matches" panel: what it renders, and where it sits.
//
// The vitest env is `node` (no jsdom), so behaviour is proved by SSR markup +
// source/CSS contracts; the real browser geometry (360/390, LTR/RTL) is measured by
// `scripts/profile-tracker-qa.mjs`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import OnlineTrackerPanel from './OnlineTrackerPanel';
import { LangProvider } from '../../i18n';
import { buildOnlineTracker, emptyTracker, TRACKED_ONLINE_GAMES } from '../../net/onlineTracker';
import type { Loadable, OnlineTracker } from '../../net/statsApi';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function render(result: Loadable<OnlineTracker> | null, loading = false): string {
  return renderToStaticMarkup(createElement(LangProvider, null,
    createElement(OnlineTrackerPanel, { result, loading })));
}

const populated = buildOnlineTracker([
  { gameType: 'king', category: 'human_only', wins: 3, losses: 2, draws: 1, forfeits: 1 },
  { gameType: 'king', category: 'with_bots', wins: 1, losses: 0, draws: 0, forfeits: 0 },
  { gameType: 'durak', category: 'human_only', wins: 0, losses: 4, draws: 0, forfeits: 2 },
]);

describe('the block always exists, with a chip per tracked game', () => {
  const out = render({ state: 'ok', data: populated });

  it('shows Overall plus the six tracked games — and no Poker chip', () => {
    expect((out.match(/online-tracker__chip/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(out).toContain('Overall');
    for (const g of TRACKED_ONLINE_GAMES) {
      expect(out.toLowerCase(), g).toContain(g === 'fifty-one' ? '51' : g.slice(0, 4));
    }
    expect(out).not.toMatch(/>Poker</);
  });

  it('opens on Overall', () => {
    const firstChip = out.slice(out.indexOf('online-tracker__chips'));
    expect(firstChip).toMatch(/aria-selected="true"[^>]*class="online-tracker__chip online-tracker__chip--active"|online-tracker__chip--active[^>]*>Overall</);
    // Overall is the selected tab and the only active chip.
    expect((out.match(/online-tracker__chip--active/g) ?? []).length).toBe(1);
    expect((out.match(/aria-selected="true"/g) ?? []).length).toBe(1);
  });

  it('renders exactly TWO category cards, always both', () => {
    expect((out.match(/tracker-card"/g) ?? []).length).toBe(2);
    expect(out).toContain('People only');
    expect(out).toContain('With bots');
  });

  it('each card shows matches, wins, losses, draws, forfeits and a win rate', () => {
    for (const label of ['Matches', 'Wins', 'Losses', 'Draws', 'Quit for good', 'Win rate']) {
      expect((out.match(new RegExp(label, 'g')) ?? []).length, label).toBe(2);   // one per card
    }
    // Overall human_only = king(3W/2L/1D) + durak(0W/4L) = 3W/6L/1D → 10 matches, 30%.
    expect(out).toContain('>10</dd>');
    expect(out).toContain('>30%</dd>');
    // …and with_bots stays separate: king(1W) only → 1 match, 100%.
    expect(out).toContain('>100%</dd>');
  });

  it('states the online-only / local-excluded rule', () => {
    expect(out).toContain('online-tracker__note');
    expect(out).toContain('Only online matches count.');
    expect(out).toMatch(/Local games/);
    expect(out).toMatch(/Poker/);
  });
});

describe('the empty state shows ZEROS, never a missing block', () => {
  const out = render({ state: 'ok', data: emptyTracker() });

  it('still renders the title, the chips, both cards and the note', () => {
    expect(out).toContain('online-tracker__title');
    expect(out).toContain('online-tracker__chips');
    expect((out.match(/tracker-card"/g) ?? []).length).toBe(2);
    expect(out).toContain('online-tracker__note');
  });

  it('a zero win rate reads "—", never NaN or Infinity', () => {
    expect(out).toContain('—');
    expect(out).not.toContain('NaN');
    expect(out).not.toContain('Infinity');
    expect((out.match(/>0</g) ?? []).length).toBeGreaterThanOrEqual(10);   // 5 zero counters × 2 cards
  });
});

describe('the soft load / auth / failure states keep the block', () => {
  it('the first load shows a message, not an empty page', () => {
    const out = render(null, true);
    expect(out).toContain('online-tracker__title');
    expect(out).toContain('stats-msg');
    expect(out).not.toContain('tracker-card"');
  });

  it('no session → the sign-in prompt, and no counters at all', () => {
    const out = render({ state: 'unauthenticated' });
    expect(out).toContain('stats-msg--soft');
    expect(out).not.toContain('tracker-card"');
    expect(out).not.toMatch(/>0</);
  });

  it('unavailable and error each get their own message (never fake zeros)', () => {
    for (const state of ['unavailable', 'error'] as const) {
      const out = render({ state });
      expect(out, state).toContain('stats-msg');
      expect(out, state).not.toContain('tracker-card"');
    }
  });
});

describe('accessibility', () => {
  const out = render({ state: 'ok', data: populated });

  it('the chips are a real tablist controlling one labelled tabpanel', () => {
    expect(out).toContain('role="tablist"');
    expect((out.match(/role="tab"/g) ?? []).length).toBe(7);
    expect(out).toContain('role="tabpanel"');
    expect(out).toMatch(/aria-controls="[^"]+-body"/);
    expect(out).toMatch(/role="tabpanel"[^>]*aria-labelledby="[^"]+-tab-overall"/);
  });

  it('the section and its cards carry real headings', () => {
    expect(out).toMatch(/<section class="online-tracker" aria-labelledby="[^"]+-title">/);
    expect(out).toMatch(/<h4 class="online-tracker__title"/);
    expect((out.match(/<h5 class="tracker-card__title"/g) ?? []).length).toBe(2);
  });

  it('every number is paired with a visible label (a dl of dt/dd)', () => {
    expect((out.match(/<dl class="tracker-card__grid">/g) ?? []).length).toBe(2);
    expect((out.match(/<dt class="tracker-stat__label">/g) ?? []).length).toBe(12);
    expect((out.match(/<dd class="tracker-stat__value">/g) ?? []).length).toBe(12);
  });

  it('every chip is a real button (keyboard reachable, not a div)', () => {
    const chips = out.slice(out.indexOf('online-tracker__chips'), out.indexOf('online-tracker__body'));
    expect((chips.match(/<button type="button"/g) ?? []).length).toBe(7);
    expect(chips).not.toContain('<div role="tab"');
  });
});

describe('mobile / RTL CSS contract', () => {
  const css = read('src/styles/stats.css');
  const block = css.slice(css.indexOf('.online-tracker {'));

  it('the chip strip scrolls inside itself so the page never overflows', () => {
    expect(block).toMatch(/\.online-tracker__chips \{[^}]*overflow-x: auto/);
    expect(block).toMatch(/\.online-tracker__chips \{[^}]*max-width: 100%/);
  });

  it('chips are a full 44x44 tap target in BOTH axes and never shrink', () => {
    expect(block).toMatch(/\.online-tracker__chip \{[^}]*min-height: 44px/);
    expect(block).toMatch(/\.online-tracker__chip \{[^}]*min-width: 44px/);
    expect(block).toMatch(/\.online-tracker__chip \{[^}]*flex: 0 0 auto/);
  });

  it('the two cards stack on a phone and only pair up when they fit', () => {
    expect(block).toMatch(/\.online-tracker__cards \{[^}]*grid-template-columns: 1fr;/);
    expect(block).toMatch(/@media \(min-width: 560px\) \{\s*\.online-tracker__cards \{ grid-template-columns: 1fr 1fr; \}/);
  });

  it('nothing is absolutely positioned over the existing stats panels', () => {
    expect(block).not.toMatch(/position:\s*(fixed|absolute)/);
    expect(block).toMatch(/\.online-tracker \{[^}]*min-width: 0/);
  });

  it('no physical left/right property — RTL mirrors for free', () => {
    const decls = block.match(/(margin|padding|border)-(left|right)\s*:/g) ?? [];
    expect(decls).toEqual([]);
  });

  it('numbers use tabular figures so columns stay aligned', () => {
    expect(block).toMatch(/\.tracker-stat__value \{[^}]*font-variant-numeric: tabular-nums/);
  });
});

describe('where it is mounted, and what it must not disturb', () => {
  const menu = read('src/ui/ProfileMenu.tsx');

  it('it renders in the Statistics tab, ABOVE the per-game panels', () => {
    const stats = menu.slice(menu.indexOf("{tab === 'stats' && ("), menu.indexOf("{tab === 'achievements' && ("));
    const tracker = stats.indexOf('<OnlineTrackerPanel');
    const selector = stats.indexOf('className="segmented segmented--sub"');
    const firstPanel = stats.indexOf('<StatsPanel');
    expect(tracker).toBeGreaterThan(-1);
    expect(tracker).toBeLessThan(selector);
    expect(tracker).toBeLessThan(firstPanel);
    expect((menu.match(/<OnlineTrackerPanel/g) ?? []).length).toBe(1);
  });

  it('it is fetched ONLY when the Statistics section is open', () => {
    expect(menu).toMatch(/if \(tab === 'stats'\) \{[\s\S]{0,400}trackerOnce\.current[\s\S]{0,80}loadTracker\(\)/);
    // Not from the achievements or leaderboard branches.
    const ach = menu.slice(menu.indexOf("if (tab === 'achievements') {"), menu.indexOf("if (tab === 'leaderboard') {"));
    expect(ach).not.toContain('loadTracker');
  });

  it('a rerender cannot fire a second parallel request', () => {
    expect(menu).toContain('const trackerInFlight = useRef(false)');
    expect(menu).toMatch(/if \(trackerInFlight\.current\) return;/);
    expect(menu).toMatch(/trackerOnce\.current = true; void loadTracker\(\)/);
  });

  it('Refresh updates the tracker AND the visible detailed panel', () => {
    const refresh = menu.slice(menu.indexOf('function refresh()'), menu.indexOf('/** Switch the Tarneeb'));
    expect(refresh).toContain('void loadTracker();');
    expect(refresh).toContain('loadStats()');
    expect(menu).toContain('const anyLoading = loadingTracker ||');
  });

  it('the detailed panels, achievements and leaderboards are untouched', () => {
    for (const panel of ['<StatsPanel', '<DurakStatsPanel', '<DebercStatsPanel', '<TarneebStatsPanel',
      '<PreferansStatsPanel', '<FiftyOneStatsPanel', '<PokerStatsPanel', '<AchievementsPanel', '<LeaderboardPanel']) {
      expect(menu, panel).toContain(panel);
    }
    // The Poker DETAILED stats panel stays; only the tracker excludes Poker.
    expect(menu).toContain("{statsGame === 'poker' && <PokerStatsPanel");
  });

  it('the panel itself derives nothing — it only renders what the server counted', () => {
    const src = read('src/ui/components/OnlineTrackerPanel.tsx');
    expect(src).not.toMatch(/\bfetch\(|localStorage|sessionStorage/);
    // The arithmetic lives in onlineTracker.ts — the panel only formats it.
    expect(src).not.toMatch(/Math\.round|\* 100|\.wins \//);
    expect(src).toContain("import {");
  });
});
