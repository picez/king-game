import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../../core/rng';
import { tarneebReducer } from './engine';
import { NUM_SEATS, teamOfSeat, partnerOfSeat, tarneebVariant } from './rules';
import { GAME_CATALOG } from '../catalog';

// ---------------------------------------------------------------------------
// Stage 28.1 — Tarneeb solo PURE CORE now exists (engine/ai/types), but must
// stay invisible: no picker, no online, no stats, no lobby/UI change. This guard
// pins BOTH sides — released pairs is byte-for-byte the shipped game, AND solo is
// not exposed anywhere yet. (Supersedes the Stage 28.0 docs-only guard.)
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('released Tarneeb pairs is unchanged (default variant)', () => {
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

  it('START requires exactly 4 players (no 3-seat game, either variant)', () => {
    const deal = (names: string[], variant?: 'pairs' | 'solo') =>
      tarneebReducer(null, { type: 'START_GAME', playerNames: names, variant }, { rng: makeRng(1) });
    expect(deal(['a', 'b', 'c'])).toBe(null);            // 3p pairs rejected
    expect(deal(['a', 'b', 'c'], 'solo')).toBe(null);    // 3p solo rejected too
    expect(deal(['a', 'b', 'c', 'd'])!.players).toHaveLength(4);
  });

  it('defaults to pairs when no variant is given, and legacy states read as pairs', () => {
    const g = tarneebReducer(null, { type: 'START_GAME', playerNames: ['a', 'b', 'c', 'd'] }, { rng: makeRng(2) })!;
    expect(g.variant).toBe('pairs');
    // Backward-compat: a state object with no `variant` field is treated as pairs.
    expect(tarneebVariant({ variant: undefined as never })).toBe('pairs');
    expect(tarneebVariant({ variant: 'pairs' })).toBe('pairs');
    expect(tarneebVariant({ variant: 'solo' })).toBe('solo');
  });
});

describe('solo is fully released (Stage 28.4) — pairs stays isolated', () => {
  it('the catalog still lists Tarneeb as a single 4-player game (variant is a mode, not a seat count)', () => {
    expect(GAME_CATALOG.tarneeb.minPlayers).toBe(4);
    expect(GAME_CATALOG.tarneeb.maxPlayers).toBe(4);
  });

  it('the LOCAL + ONLINE flows both wire solo, defaulting to Pairs', () => {
    expect(read('src/ui/tarneeb/TarneebLocalGame.tsx')).toMatch(/variant === 'solo'/);
    // Online host sheet has a Pairs/Solo picker; default state is 'pairs'.
    const startMenu = read('src/ui/StartMenu.tsx');
    expect(startMenu).toContain("useState<TarneebVariant>('pairs')");
    expect(startMenu).toContain('tarneebVariant');
    // buildStartAction threads the room's variant (a Solo room starts solo).
    expect(read('src/games/tarneeb/definition.ts')).toContain("room.tarneebVariant === 'solo'");
  });

  it('solo stats are stored under a SEPARATE game_type so pairs aggregates are never touched', () => {
    // The pairs cache stays game_type='tarneeb'; solo uses 'tarneeb-solo'.
    const repo = read('server/db/tarneebStats.ts');
    expect(repo).toContain("'tarneeb-solo'");
    expect(read('src/net/tarneebStats.ts')).toContain('tarneebStatsGameType');
  });

  it('NO DB migration was added for solo stats (game_type is free text, JSONB blob)', () => {
    // Solo reuses the existing (user_id, game_type) key — the latest migration is still 0009.
    const migrations = read('server/db/migrations/0009_friends.sql'); // exists
    expect(migrations.length).toBeGreaterThan(0);
    // 0010 must NOT exist (no schema change this stage).
    expect(() => read('server/db/migrations/0010_tarneeb_solo.sql')).toThrow();
  });

  it('the variant payload carries no session/token/email (protocol stays clean)', () => {
    const messages = read('src/net/messages.ts');
    // The Tarneeb variant field is a bare 'pairs'|'solo' — no identity leaks alongside it.
    expect(messages).toContain('tarneebVariant?: TarneebVariant');
    expect(messages).not.toMatch(/tarneebVariant[^\n]*(token|session|email)/i);
  });

  it('an implementation plan exists (Variant B cutthroat)', () => {
    const plan = read('TARNEEB_SOLO_PLAN.md');
    expect(plan).toMatch(/Variant B/);
    expect(plan).toMatch(/cutthroat/i);
  });
});
