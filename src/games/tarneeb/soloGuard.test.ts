import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../../core/rng';
import { tarneebReducer } from './engine';
import { NUM_SEATS, teamOfSeat, partnerOfSeat } from './rules';

// ---------------------------------------------------------------------------
// Stage 28.0 — Tarneeb solo is FOUNDATION/DESIGN ONLY (see TARNEEB_SOLO_PLAN.md,
// Variant B = 4-player cutthroat). No solo gameplay was implemented this stage.
//
// This is the TODO-guard the plan requires: it pins the released 4-player 2×2
// pairs behaviour so a future solo build (a `variant` flag) can be added WITHOUT
// silently altering the shipped team game, its stats, or its leaderboard.
// When solo lands, these assertions must all still hold for the default team mode.
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('released Tarneeb stays 4-player, fixed 2×2 partnerships', () => {
  it('is hard-wired to exactly 4 seats', () => {
    expect(NUM_SEATS).toBe(4);
  });

  it('partnerships are the fixed A = 0&2, B = 1&3', () => {
    expect(teamOfSeat(0)).toBe('A');
    expect(teamOfSeat(2)).toBe('A');
    expect(teamOfSeat(1)).toBe('B');
    expect(teamOfSeat(3)).toBe('B');
    expect(partnerOfSeat(0)).toBe(2);
    expect(partnerOfSeat(1)).toBe(3);
  });

  it('START requires exactly 4 players (no 3-seat solo deal)', () => {
    const deal = (names: string[]) =>
      tarneebReducer(null, { type: 'START_GAME', playerNames: names }, { rng: makeRng(1) });
    expect(deal(['a', 'b', 'c'])).toBe(null); // 3p rejected — not a solo game
    const four = deal(['a', 'b', 'c', 'd']);
    expect(four).not.toBe(null);
    expect(four!.players).toHaveLength(4);
  });

  it('engine has NOT grown a solo/variant branch yet (foundation is docs-only)', () => {
    const engine = read('src/games/tarneeb/engine.ts');
    const types = read('src/games/tarneeb/types.ts');
    // Guard against a half-wired solo mode: no `variant` field on state/actions,
    // no cutthroat/solo scoring branch. Solo must arrive as its own tested stage.
    expect(types).not.toMatch(/variant\s*:/);
    expect(engine).not.toMatch(/\bsolo\b|cutthroat/i);
  });

  it('an implementation-ready solo plan exists (Variant B foundation)', () => {
    const plan = read('TARNEEB_SOLO_PLAN.md');
    expect(plan).toMatch(/Variant B/);
    expect(plan).toMatch(/cutthroat/i);
  });
});
