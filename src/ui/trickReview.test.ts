// Source guards for the Stage 25.8 trick/beat reveal delay: every game holds the last card of a
// completed trick/bout on the table before advancing, so players can read it. King + Deberc use
// the SERVER trick_complete pause (serverTiming); Tarneeb + Preferans use a client trick review;
// Durak (bouts resolve inside the reducer) gets a client table-review hold. All are display-only —
// no scoring/rules change.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_TRICK_ADVANCE_MS, MIN_TRICK_ADVANCE_MS } from '../net/serverTiming';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('server-paused games (King / Deberc)', () => {
  it('the trick_complete public screen pauses long enough to read the last card', () => {
    // King + Deberc map their trick_complete state to the generic public-screen delay.
    expect(DEFAULT_TRICK_ADVANCE_MS).toBeGreaterThanOrEqual(900);
    expect(MIN_TRICK_ADVANCE_MS).toBeGreaterThanOrEqual(900);
    const core = read('src/net/serverCore.ts');
    expect(core).toContain("=== 'trick_complete'"); // king status + deberc phase → 'trick_complete'
  });
});

describe('client-review games (Tarneeb / Preferans)', () => {
  it('freeze a just-resolved trick for ~1s before continuing', () => {
    for (const f of ['src/ui/tarneeb/TarneebLocalGame.tsx', 'src/ui/tarneeb/TarneebOnlineGame.tsx',
      'src/ui/preferans/PreferansLocalGame.tsx', 'src/ui/preferans/PreferansOnlineGame.tsx']) {
      const src = read(f);
      expect(src, f).toContain('reviewTrick');
    }
  });

  it('the review is within the 900–1200ms target', () => {
    const local = read('src/ui/tarneeb/TarneebLocalGame.tsx');
    const m = local.match(/TRICK_REVIEW_MS\s*=\s*(\d+)/);
    expect(m).toBeTruthy();
    const ms = Number(m![1]);
    expect(ms).toBeGreaterThanOrEqual(900);
    expect(ms).toBeLessThanOrEqual(1200);
  });
});

describe('Durak — table-review hold on bout clear (Stage 25.8)', () => {
  const screen = read('src/ui/durak/DurakGameScreen.tsx');
  it('lingers on the final bout when the table clears, then goes live', () => {
    expect(screen).toContain('useTableReview');
    expect(screen).toMatch(/TABLE_REVIEW_MS\s*=\s*1100/);
    // Lingers only on a clear (non-empty → empty), and a new card cancels it immediately.
    expect(screen).toMatch(/table\.length === 0 && prev\.length > 0/);
    // The felt renders the reviewed table, not the raw live one.
    expect(screen).toContain('reviewTable.map');
  });
  it('is display-only — it never dispatches an action or mutates state', () => {
    const hook = screen.slice(screen.indexOf('function useTableReview'), screen.indexOf('export default function'));
    expect(hook).not.toMatch(/apply\(|dispatch\(|reducer/);
  });
});
