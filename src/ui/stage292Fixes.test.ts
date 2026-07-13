import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Stage 29.2 — Durak trump/deck sizing, per-turn timer visible in ALL online
// games, and Tarneeb Solo in-game trick counts + a bigger "my tricks" button.
// Source-level guards (the render paths are covered by the shared components).
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('Durak trump + deck enlarged, scoped to the Durak screen (no Deberc bleak)', () => {
  const css = read('src/styles/durak.css');
  it('the Durak-scoped .durak-deck bumps --dw (~+22%)', () => {
    expect(css).toMatch(/\.durak-screen \.durak-deck \{[^}]*--dw:\s*clamp\(3\.55rem/);
  });
});

describe('per-turn timer is game-agnostic and shown in every online game (Stage 29.2)', () => {
  const bar = read('src/ui/components/TurnTimerBar.tsx');
  const king = read('src/ui/components/TurnTimer.tsx');
  const online = read('src/ui/online/OnlineGame.tsx');

  it('TurnTimerBar renders nothing when the timer is off, and pills when on', () => {
    expect(bar).toContain('if (total <= 0) return null');
    expect(bar).toContain('turn-timer');
    // The low-time sound stays gated to MY turn via the `active` prop.
    expect(bar).toContain('active: total > 0 && active');
  });

  it("King's TurnTimer delegates to the shared bar (my-turn gate preserved)", () => {
    expect(king).toContain('TurnTimerBar');
    expect(king).toContain('active={myPlayerId != null && actingId === myPlayerId}');
  });

  it('OnlineGame mounts the timer for the four non-King games via the GameDefinition', () => {
    // Game-agnostic acting player + a card-progress key.
    expect(online).toContain('def.getActingPlayerId(state as never)');
    expect(online).toContain('active={actingId != null && actingId === myPlayerId}');
    // Rendered in each non-King branch.
    const mounts = online.match(/\{timerEl\}/g) ?? [];
    expect(mounts.length).toBe(4); // durak, deberc, tarneeb, preferans
    // Off (turnTimerSec 0) → the helper returns null.
    expect(online).toContain('if (turnTimerSec <= 0 || !gameType || !state) return null');
  });
});

describe('Tarneeb Solo in-game trick visibility (Stage 29.2)', () => {
  const screen = read('src/ui/tarneeb/TarneebGameScreen.tsx');

  it('the solo standings show every seat’s live trick count (🃏)', () => {
    expect(screen).toContain('tarneeb-solo-chip__tricks');
    expect(screen).toContain('🃏 {tricksBySeat[p.seatIndex]}');
  });

  it('solo gets a bigger, dedicated "review my tricks" button (not the compact badge)', () => {
    expect(screen).toContain('tarneeb-solo-tricks-btn');
    // The compact topbar badge is Pairs-only now.
    expect(screen).toMatch(/\{!solo && \([\s\S]*tarneeb-tricks-btn/);
  });

  it('Pairs is unchanged — team tricks in the topbar + the team scoreboard', () => {
    expect(screen).toContain("state.tricksByTeam[myTeam]");
    expect(screen).toContain("t('tarneeb.teamUs')");
    // Solo never renders the Team A/B boards.
    expect(screen).toContain("solo ? p.seatIndex === humanSeat : teamOfSeat(p.seatIndex) === myTeam");
  });
});
