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

describe('Timer moved to a bottom-of-table HUD pill with a bigger icon (Scope B)', () => {
  const bar = read('src/ui/components/TurnTimerBar.tsx');
  const css = read('src/styles/game.css');

  it('TurnTimerBar splits the clock icon into its own span so it can be enlarged', () => {
    expect(bar).toContain('turn-timer__icon');
    expect(bar).toContain('turn-timer__num');
  });

  it('the overlay is pinned to the BOTTOM (not the top) and never blocks taps', () => {
    const overlay = css.match(/\.turn-timer--overlay \{[^}]*\}/)?.[0] ?? '';
    expect(overlay).toContain('position: fixed');
    expect(overlay).toMatch(/bottom:\s*calc\(env\(safe-area-inset-bottom/);
    expect(overlay).not.toMatch(/\btop:\s*calc\(env\(safe-area-inset-top/);
    expect(overlay).toContain('pointer-events: none');
  });

  it('the clock glyph is scaled up for the HUD placement', () => {
    expect(css).toContain('.turn-timer__icon');
    expect(css).toMatch(/\.turn-timer--overlay \.turn-timer__icon \{ font-size:/);
  });
});

describe('Tarneeb Solo standings show the current turn + stay solo (Scope C)', () => {
  const screen = read('src/ui/tarneeb/TarneebGameScreen.tsx');
  const css = read('src/styles/tarneeb.css');

  it('marks the acting seat in the standings strip', () => {
    expect(screen).toContain('const isTurn = p.seatIndex === actingSeat && !blocked');
    expect(screen).toContain('tarneeb-solo-chip--turn');
    expect(css).toContain('.tarneeb-solo-chip--turn');
  });

  it('the leader crown only shows once someone is actually ahead (no 0–0 crown)', () => {
    expect(screen).toContain('topScore > 0 && scoresBySeat[p.seatIndex] === topScore');
  });

  it('Solo standings never render the Us/Them team boards', () => {
    // The team scoreboard (teamUs/teamThem) lives only in the Pairs branch.
    expect(screen).toMatch(/if \(solo\) \{[\s\S]*tarneeb-solo-standings/);
    expect(screen).toMatch(/tarneeb-solo-standings[\s\S]*\}[\s\S]*return \([\s\S]*tarneeb-score--us/);
  });
});

describe('Tarneeb Pairs + Deberc score chips restyled for readability (Scope C)', () => {
  const tarneeb = read('src/styles/tarneeb.css');
  const deberc = read('src/styles/deberc.css');

  it('Pairs keeps the Us/Them team boards, now with a coloured top edge', () => {
    expect(tarneeb).toMatch(/\.tarneeb-score--us \{[^}]*border-top-color/);
    expect(tarneeb).toMatch(/\.tarneeb-score--them \{[^}]*border-top-color/);
    expect(tarneeb).toContain('font-variant-numeric: tabular-nums');
  });

  it('Deberc match-score chips get a bigger, tabular score number for both Solo and Pairs', () => {
    expect(deberc).toContain('.deberc-scores .tag strong');
    expect(deberc).toContain('font-variant-numeric: tabular-nums');
    // My own team/seat chip is highlighted (works for 3p Solo + 4p Pairs alike).
    expect(deberc).toContain('.deberc-scores .tag--ok');
  });
});
