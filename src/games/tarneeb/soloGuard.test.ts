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

describe('solo is LOCAL-only (Stage 28.3) — not online, not stats', () => {
  it('the catalog still lists Tarneeb as a 4-only game (no solo seat counts)', () => {
    expect(GAME_CATALOG.tarneeb.minPlayers).toBe(4);
    expect(GAME_CATALOG.tarneeb.maxPlayers).toBe(4);
  });

  it('the online start-action builder never sets the solo variant', () => {
    // buildTarneebStartAction must not thread a variant → online rooms stay pairs.
    const def = read('src/games/tarneeb/definition.ts');
    expect(def).not.toMatch(/variant\s*:\s*['"]solo['"]/);
    expect(def).not.toContain("variant: 'solo'");
  });

  it('the LOCAL game wires solo (setup picker → START_GAME variant)', () => {
    // Stage 28.3: solo is playable locally — the setup offers it and the local game
    // threads variant:'solo' into the start action.
    expect(read('src/ui/tarneeb/TarneebSetup.tsx')).toContain("t('tarneeb.modeSolo')");
    expect(read('src/ui/tarneeb/TarneebLocalGame.tsx')).toMatch(/variant === 'solo'/);
  });

  it('ONLINE surfaces never expose Tarneeb solo (Host + Lobby stay Pairs)', () => {
    // The online lobby and the host sheet must not branch Tarneeb on solo.
    expect(read('src/ui/online/Lobby.tsx')).not.toMatch(/tarneeb[^\n]*solo|solo[^\n]*tarneeb/i);
    const startMenu = read('src/ui/StartMenu.tsx');
    // No Tarneeb variant/playerCount picker in the host flow (Deberc has one; Tarneeb does not).
    expect(startMenu).not.toMatch(/tarneeb[\s\S]{0,80}variant:\s*'solo'/i);
  });

  it('no solo stats/leaderboard yet (tarneebStats records the team outcome only)', () => {
    const stats = read('src/net/tarneebStats.ts');
    expect(stats).not.toMatch(/scoresBySeat|soloWinnerSeat|lastSoloHand/);
  });

  it('an implementation plan exists (Variant B cutthroat)', () => {
    const plan = read('TARNEEB_SOLO_PLAN.md');
    expect(plan).toMatch(/Variant B/);
    expect(plan).toMatch(/cutthroat/i);
  });
});
