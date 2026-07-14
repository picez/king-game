import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Stage 29.5 — table HUD polish:
//   A) reactions anchor over the sender's ACTUAL seat (Tarneeb mirror fix) — see
//      reactionAnchor.test.ts + menuSectionsReactions.test.ts for the behaviour.
//   B) the per-turn timer moves from a top-centre overlay to a bottom HUD pill
//      with a larger clock icon.
//   C) the in-game score/tricks HUD is more readable (Tarneeb Solo current-turn
//      highlight; Tarneeb Pairs + Deberc score chips restyled).
// These are source-level guards; the render paths run through the shared screens.
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Timer lives in the social control cluster with a bigger icon (Scope B; moved in 29.7)', () => {
  const bar = read('src/ui/components/TurnTimerBar.tsx');
  const css = read('src/styles/game.css');
  const online = read('src/ui/online/OnlineGame.tsx');
  const social = read('src/ui/online/RoomSocial.tsx');

  it('TurnTimerBar splits the clock icon into its own span so it can be enlarged', () => {
    expect(bar).toContain('turn-timer__icon');
    expect(bar).toContain('turn-timer__num');
  });

  it('the timer is a social-cluster pill (not a fixed table overlay) and never blocks taps', () => {
    // Stage 29.7: the old bottom/top fixed overlay class is gone; the timer now uses --social.
    expect(css).not.toContain('.turn-timer--overlay');
    const pill = css.match(/\.turn-timer--social \{[^}]*\}/)?.[0] ?? '';
    expect(pill).toContain('pointer-events: none');
    expect(pill).not.toContain('position: fixed'); // it flows inside the fixed .social-controls
    // OnlineGame tags the timer with the social class and RoomSocial renders the slot.
    expect(online).toContain("className=\"turn-timer--social\"");
    expect(social).toContain('timerSlot');
  });

  it('the clock glyph is scaled up for the cluster placement', () => {
    expect(css).toContain('.turn-timer__icon');
    expect(css).toMatch(/\.turn-timer--social \.turn-timer__icon \{ font-size:/);
  });
});

describe('Tarneeb Solo standings show the current turn + stay solo (Scope C)', () => {
  const screen = read('src/ui/tarneeb/TarneebGameScreen.tsx');
  const css = read('src/styles/tarneeb.css');

  it('marks the acting seat via the ranked table (Stage 29.7 replaced the chip strip)', () => {
    // The turn highlight now comes from the pure helper's isTurn flag → an .is-turn row.
    expect(screen).toContain('is-turn');
    expect(css).toContain('.tarneeb-rank__row.is-turn');
  });

  it('the leader crown only shows once someone is actually ahead (no 0–0 crown)', () => {
    // Enforced in the helper: isLeader requires the top score to be > 0.
    const helper = read('src/ui/tarneeb/tarneebScoreTable.ts');
    expect(helper).toContain('top > 0 && r.score === top');
    expect(screen).toContain("r.isLeader ? '👑'");
  });
});

describe('Deberc score chips restyled for readability (Scope C, still active in 29.7)', () => {
  const deberc = read('src/styles/deberc.css');

  it('Deberc match-score chips get a bigger, tabular score number for both Solo and Pairs', () => {
    expect(deberc).toContain('.deberc-scores .tag strong');
    expect(deberc).toContain('font-variant-numeric: tabular-nums');
    // My own team/seat chip is highlighted (works for 3p Solo + 4p Pairs alike).
    expect(deberc).toContain('.deberc-scores .tag--ok');
  });
});
