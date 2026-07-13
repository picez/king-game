import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRng } from '../../core/rng';
import { debercReducer } from './engine';
import { EN } from '../../i18n/dictionaries/en';

// ---------------------------------------------------------------------------
// Stage 28.0 — Deberc explicit Solo (3p) / Pairs (4p) modes.
//
// The seat count IS the released mode. These guards pin the engine invariants
// that back the UI labels so a future refactor can't silently turn 3p into a
// team game (or 4p into a free-for-all). Engine/scoring are NOT changed here —
// this only asserts what already ships.
// ---------------------------------------------------------------------------

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

function start(names: string[]) {
  return debercReducer(
    null,
    { type: 'START_DEBERC', playerNames: names, matchSize: 'small' },
    { rng: makeRng(42) },
  )!;
}

describe('Deberc Solo mode (3 players) — every player for themselves', () => {
  const s = start(['a', 'b', 'c']);
  it('has three one-person teams (teamCount 3)', () => {
    expect(s.teamCount).toBe(3);
  });
  it('maps each seat to its own team (0,1,2)', () => {
    expect(s.teamOf).toEqual([0, 1, 2]);
  });
  it('no two seats share a team — genuinely solo', () => {
    expect(new Set(s.teamOf).size).toBe(s.players.length);
  });
});

describe('Deberc Pairs mode (4 players) — two fixed teams of 2', () => {
  const s = start(['a', 'b', 'c', 'd']);
  it('has two teams (teamCount 2)', () => {
    expect(s.teamCount).toBe(2);
  });
  it('partners sit opposite: 0&2 vs 1&3', () => {
    expect(s.teamOf).toEqual([0, 1, 0, 1]);
    expect(s.teamOf[0]).toBe(s.teamOf[2]); // seats 0 & 2 = Team A
    expect(s.teamOf[1]).toBe(s.teamOf[3]); // seats 1 & 3 = Team B
    expect(s.teamOf[0]).not.toBe(s.teamOf[1]); // A ≠ B
  });
});

describe('Deberc setup + lobby name the modes explicitly (Stage 28.0)', () => {
  const setup = read('src/ui/deberc/DebercSetup.tsx');
  const lobby = read('src/ui/online/Lobby.tsx');

  it('setup offers Solo (3p) and Pairs (4p) mode cards', () => {
    expect(setup).toContain("t('deberc.modeSolo')");
    expect(setup).toContain("t('deberc.modePairs')");
    expect(setup).toContain('count: 3');
    expect(setup).toContain('count: 4');
  });

  it('lobby game-line shows Solo/Pairs from the room player count', () => {
    expect(lobby).toContain("room.playerCount === 3 ? 'lobby.debercSolo' : 'lobby.debercPairs'");
  });

  it('the mode labels exist + are non-blank in every language', () => {
    const KEYS = [
      'deberc.mode', 'deberc.modeSolo', 'deberc.modeSoloDesc',
      'deberc.modePairs', 'deberc.modePairsDesc',
      'lobby.debercSolo', 'lobby.debercPairs',
    ];
    const dicts = ['en', 'uk', 'de', 'ar'].map((l) => read(join('src/i18n/dictionaries', `${l}.ts`)));
    for (const key of KEYS) {
      expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
      for (const d of dicts) expect(d, `dict missing ${key}`).toContain(`'${key}'`);
    }
  });
});
