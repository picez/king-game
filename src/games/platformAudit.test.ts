// ---------------------------------------------------------------------------
// Platform consistency audit (Stage 20.0; extended Stage 30.2 for coming_soon,
// Stage 30.7 for the 51 full release). A single high-signal guard over GAME_TYPES
// that catches a game drifting out of its declared support tier. All SIX released
// games (King, Durak, Deberc, Tarneeb, Preferans, 51) must stay uniformly
// available: catalog (local + online + bots), GameDefinition, score-recording,
// favorite coverage, and a real PNG icon. There is no not-yet-released game today
// (51 graduated at Stage 30.7). Per-game specifics live in the catalog/registry/
// gameIcon tests — this asserts the CROSS-CUTTING invariants.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_TYPES, GAME_CATALOG, type GameType } from './catalog';
import { GAME_DEFINITIONS } from './registry';
import { SUPPORTED_FAVORITE_GAMES } from '../net/userSettings';
import { visualAsset, gameIconSrc } from '../visual/visualAssets';
import { ACHIEVEMENTS, type AllStats } from '../stats/achievements';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const iconPath = (id: string) => join(process.cwd(), 'public', gameIconSrc(id).replace(/^\//, ''));

/** Map a catalog game id to its `AllStats` key (only 51 differs: `fifty-one` → `fiftyOne`). */
const statsKey = (id: GameType): string => (id === 'fifty-one' ? 'fiftyOne' : id);
/** Minimal AllStats where the named available games each have a single win. */
const winsFor = (ids: readonly GameType[]): AllStats =>
  Object.fromEntries(ids.map((id) => [statsKey(id), { gamesWon: 1, gamesPlayed: 1 }])) as unknown as AllStats;
// Call ONLY the all-rounder evaluator (it uses the null-safe `won()` aggregate), so a
// minimal per-game stub can't trip a nested game-specific evaluator.
const allRounder = ACHIEVEMENTS.find((a) => a.id === 'all-rounder')!;
const allRounderEarned = (s: AllStats): boolean => allRounder.evaluate(s);

const AVAILABLE: GameType[] = GAME_TYPES.filter((id) => GAME_CATALOG[id].status === 'available');
// Registered but not fully released — experimental or coming_soon. None today.
const NOT_RELEASED: GameType[] = GAME_TYPES.filter((id) => GAME_CATALOG[id].status !== 'available');

describe('platform tiers are internally consistent (Stage 20.0 / 30.7)', () => {
  it('all six games are fully available; there is no not-yet-released game', () => {
    expect(AVAILABLE).toEqual(['king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one']);
    expect(NOT_RELEASED).toEqual([]);
    for (const id of AVAILABLE) {
      const e = GAME_CATALOG[id];
      expect(e.supportsLocal, `${id} local`).toBe(true);
      expect(e.supportsOnline, `${id} online`).toBe(true);
      expect(e.supportsBots, `${id} bots`).toBe(true);
    }
    // 51 is a first-class released member (Stage 30.7).
    expect(GAME_CATALOG['fifty-one'].status).toBe('available');
    expect(GAME_CATALOG['fifty-one'].supportsLocal).toBe(true);
    expect(GAME_CATALOG['fifty-one'].supportsOnline).toBe(true);
    expect(GAME_CATALOG['fifty-one'].supportsBots).toBe(true);
  });

  it('every game has a registered definition + declares seat counts', () => {
    for (const id of GAME_TYPES) {
      const def = GAME_DEFINITIONS[id];
      expect(def, `${id} definition`).toBeTruthy();
      expect(def.id, `${id} definition id`).toBe(id);
      expect(def.catalog, `${id} catalog ref`).toBe(GAME_CATALOG[id]);
      expect(def.supportedPlayerCounts.length, `${id} seat counts`).toBeGreaterThan(0);
    }
  });

  it('every available game records stats', () => {
    for (const id of AVAILABLE) {
      expect(GAME_DEFINITIONS[id].recordsStats, `${id} recordsStats`).toBe(true);
    }
  });

  it('the favorite-game list covers exactly the AVAILABLE games', () => {
    expect([...SUPPORTED_FAVORITE_GAMES].sort()).toEqual([...AVAILABLE].sort());
    for (const id of NOT_RELEASED) {
      expect((SUPPORTED_FAVORITE_GAMES as readonly string[]).includes(id), `${id} not favoritable`).toBe(false);
    }
  });

  it('every AVAILABLE game ships a real PNG icon on disk (manifest + file), each under 150KB', () => {
    for (const id of AVAILABLE) {
      const asset = visualAsset(`icon-${id}`);
      expect(asset, `${id} manifest entry`).toBeTruthy();
      expect(asset!.present, `${id} icon present`).toBe(true);
      const path = iconPath(id);
      expect(existsSync(path), `${id} icon file`).toBe(true);
      expect(statSync(path).size, `${id} icon non-empty`).toBeGreaterThan(0);
      expect(statSync(path).size, `${id} icon < 150KB`).toBeLessThan(150 * 1024);
      expect(readFileSync(path).subarray(0, 8).equals(PNG_SIG), `${id} is a PNG`).toBe(true);
    }
  });

  it('every AVAILABLE game has at least one game-scoped achievement', () => {
    for (const id of AVAILABLE) {
      const scoped = ACHIEVEMENTS.filter((a) => a.gameType === id);
      expect(scoped.length, `${id} achievement coverage`).toBeGreaterThanOrEqual(1);
    }
  });

  it('All-Rounder spans exactly the AVAILABLE games (each one is required)', () => {
    // A win in every available game earns it…
    expect(allRounderEarned(winsFor(AVAILABLE)), 'all six earn All-Rounder').toBe(true);
    // …and dropping any single available game unearns it (so the canonical AllStats
    // aggregate set === the available games, incl. 51 since Stage 30.7).
    for (const missing of AVAILABLE) {
      const partial = winsFor(AVAILABLE.filter((id) => id !== missing));
      expect(allRounderEarned(partial), `missing ${missing} → not earned`).toBe(false);
    }
  });
});
