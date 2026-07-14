// ---------------------------------------------------------------------------
// Platform consistency audit (Stage 20.0; extended Stage 30.2 for coming_soon).
// A single high-signal guard over GAME_TYPES that catches a game drifting out of
// its declared support tier. The FIVE released games must stay uniformly
// available (catalog, GameDefinition, stats, favorite coverage, PNG icon); a
// not-yet-released game (51 / Syrian 51, experimental) may be startable — local +
// online-experimental (Stage 30.5) — yet must still be gated OFF where RELEASE
// counts (no stats, no favorite, status !== 'available', no required PNG). Per-game
// specifics live in the catalog/registry/gameIcon tests — this asserts the
// CROSS-CUTTING invariants.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_TYPES, GAME_CATALOG, type GameType } from './catalog';
import { GAME_DEFINITIONS } from './registry';
import { SUPPORTED_FAVORITE_GAMES } from '../net/userSettings';
import { visualAsset, gameIconSrc } from '../visual/visualAssets';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const iconPath = (id: string) => join(process.cwd(), 'public', gameIconSrc(id).replace(/^\//, ''));

const AVAILABLE: GameType[] = GAME_TYPES.filter((id) => GAME_CATALOG[id].status === 'available');
// Registered but not fully released — experimental (local-only) or coming_soon.
const NOT_RELEASED: GameType[] = GAME_TYPES.filter((id) => GAME_CATALOG[id].status !== 'available');

describe('platform tiers are internally consistent (Stage 20.0 / 30.3)', () => {
  it('the five released games are all fully available; 51 is the lone not-yet-released game', () => {
    expect(AVAILABLE).toEqual(['king', 'durak', 'deberc', 'tarneeb', 'preferans']);
    expect(NOT_RELEASED).toEqual(['fifty-one']);
    for (const id of AVAILABLE) {
      const e = GAME_CATALOG[id];
      expect(e.supportsLocal, `${id} local`).toBe(true);
      expect(e.supportsOnline, `${id} online`).toBe(true);
      expect(e.supportsBots, `${id} bots`).toBe(true);
    }
    // 51 is experimental: local + online playable (Stage 30.5) but still NOT released
    // (status !== 'available' → no stats/favorite/PNG requirement — see below).
    expect(GAME_CATALOG['fifty-one'].status).toBe('experimental');
    expect(GAME_CATALOG['fifty-one'].supportsLocal).toBe(true);
    expect(GAME_CATALOG['fifty-one'].supportsOnline).toBe(true);
  });

  it('every game (incl. not-yet-released) has a registered definition + declares seat counts', () => {
    for (const id of GAME_TYPES) {
      const def = GAME_DEFINITIONS[id];
      expect(def, `${id} definition`).toBeTruthy();
      expect(def.id, `${id} definition id`).toBe(id);
      expect(def.catalog, `${id} catalog ref`).toBe(GAME_CATALOG[id]);
      expect(def.supportedPlayerCounts.length, `${id} seat counts`).toBeGreaterThan(0);
    }
  });

  it('available games record stats; a not-yet-released game records none (even if online-experimental)', () => {
    for (const id of AVAILABLE) {
      expect(GAME_DEFINITIONS[id].recordsStats, `${id} recordsStats`).toBe(true);
    }
    for (const id of NOT_RELEASED) {
      // The RELEASE gate is `recordsStats` (+ favorite/PNG below), NOT online support:
      // 51 is online-experimental (Stage 30.5) yet still records no stats and is not
      // "available". That separation is exactly what keeps it out of the released tier.
      expect(GAME_DEFINITIONS[id].recordsStats, `${id} no stats yet`).toBe(false);
      expect(GAME_CATALOG[id].status, `${id} not available`).not.toBe('available');
    }
  });

  it('the favorite-game list covers exactly the AVAILABLE games (not-yet-released excluded)', () => {
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
    // A coming_soon game needs no PNG yet — GameIcon falls back to an emoji glyph.
  });
});
