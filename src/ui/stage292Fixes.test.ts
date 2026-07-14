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
    // Threaded into each non-King branch's social cluster (Stage 29.7 — no longer a
    // standalone table overlay); passed as the last renderSocial arg in all four.
    const mounts = online.match(/renderSocial\([^)]*timerEl\)/g) ?? [];
    expect(mounts.length).toBe(4); // durak, deberc, tarneeb, preferans
    // No table overlay mount remains.
    expect(online).not.toMatch(/^\s*\{timerEl\}\s*$/m);
    // Off (turnTimerSec 0) → the helper returns null.
    expect(online).toContain('if (turnTimerSec <= 0 || !gameType || !state) return null');
  });
});

describe('Tarneeb Solo in-game trick visibility (Stage 29.2 → 29.7 ranked table)', () => {
  const screen = read('src/ui/tarneeb/TarneebGameScreen.tsx');

  it('every seat’s live trick count is shown in the ranked table (🃏 column)', () => {
    // Stage 29.7: the per-seat chips became a ranked table; tricks come from the helper row.
    expect(screen).toContain('tarneeb-rank__tricks');
    expect(screen).toContain('{r.tricks}');
  });

  it('solo keeps a bigger, dedicated "review my tricks" button (not the compact badge)', () => {
    expect(screen).toContain('tarneeb-solo-tricks-btn');
    // The compact topbar badge is Pairs-only.
    expect(screen).toMatch(/\{!solo && \([\s\S]*tarneeb-tricks-btn/);
  });

  it('Pairs is unchanged — team tricks in the topbar + Us/Them rows in the table', () => {
    expect(screen).toContain("t('tarneeb.teamUs')");
    // Solo never renders the Team A/B labels on the felt board.
    expect(screen).toContain("solo ? p.seatIndex === humanSeat : teamOfSeat(p.seatIndex) === myTeam");
  });
});
