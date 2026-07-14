// ---------------------------------------------------------------------------
// Platform consistency audit (Stage 20.0; extended Stage 30.2 for coming_soon).
// A single high-signal guard over GAME_TYPES that catches a game drifting out of
// its declared support tier. The FIVE released games must stay uniformly
// available (catalog, GameDefinition, stats, favorite coverage, PNG icon); a
// registered-but-not-playable game (51 / Syrian 51, coming_soon) must be present
// in the registry yet gated OFF everywhere it counts (no stats, no favorite, no
// startable mode, no required PNG). Per-game specifics live in the
// catalog/registry/gameIcon tests — this asserts the CROSS-CUTTING invariants.
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
const COMING_SOON: GameType[] = GAME_TYPES.filter((id) => GAME_CATALOG[id].status === 'coming_soon');

describe('platform tiers are internally consistent (Stage 20.0 / 30.2)', () => {
  it('the five released games are all fully available; 51 is registered coming_soon', () => {
    expect(AVAILABLE).toEqual(['king', 'durak', 'deberc', 'tarneeb', 'preferans']);
    expect(COMING_SOON).toEqual(['fifty-one']);
    for (const id of AVAILABLE) {
      const e = GAME_CATALOG[id];
      expect(e.supportsLocal, `${id} local`).toBe(true);
      expect(e.supportsOnline, `${id} online`).toBe(true);
      expect(e.supportsBots, `${id} bots`).toBe(true);
    }
  });

  it('every game (incl. coming_soon) has a registered definition + declares seat counts', () => {
    for (const id of GAME_TYPES) {
      const def = GAME_DEFINITIONS[id];
      expect(def, `${id} definition`).toBeTruthy();
      expect(def.id, `${id} definition id`).toBe(id);
      expect(def.catalog, `${id} catalog ref`).toBe(GAME_CATALOG[id]);
      expect(def.supportedPlayerCounts.length, `${id} seat counts`).toBeGreaterThan(0);
    }
  });

  it('available games record stats; a coming_soon game does not (and cannot start)', () => {
    for (const id of AVAILABLE) {
      expect(GAME_DEFINITIONS[id].recordsStats, `${id} recordsStats`).toBe(true);
    }
    for (const id of COMING_SOON) {
      const e = GAME_CATALOG[id];
      expect(GAME_DEFINITIONS[id].recordsStats, `${id} no stats yet`).toBe(false);
      expect(e.supportsLocal, `${id} not local yet`).toBe(false);
      expect(e.supportsOnline, `${id} not online yet`).toBe(false);
    }
  });

  it('the favorite-game list covers exactly the AVAILABLE games (coming_soon excluded)', () => {
    expect([...SUPPORTED_FAVORITE_GAMES].sort()).toEqual([...AVAILABLE].sort());
    for (const id of COMING_SOON) {
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
