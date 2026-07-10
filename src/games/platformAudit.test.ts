// ---------------------------------------------------------------------------
// Five-game platform consistency audit (Stage 20.0). A single high-signal guard
// over GAME_TYPES that catches a future game (or a released one) drifting out of
// full platform support: catalog availability, the GameDefinition seam, per-game
// stats, favorite-game coverage, and a real icon asset. Per-game specifics are
// already covered by catalog/registry/gameIcon tests — this asserts the CROSS-
// CUTTING invariants that must hold uniformly across all games.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_TYPES, GAME_CATALOG } from './catalog';
import { GAME_DEFINITIONS } from './registry';
import { SUPPORTED_FAVORITE_GAMES } from '../net/userSettings';
import { visualAsset, gameIconSrc } from '../visual/visualAssets';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const iconPath = (id: string) => join(process.cwd(), 'public', gameIconSrc(id).replace(/^\//, ''));

describe('five-game platform is uniformly available (Stage 20.0)', () => {
  it('there are exactly 5 games and every one is fully available', () => {
    expect(GAME_TYPES).toEqual(['king', 'durak', 'deberc', 'tarneeb', 'preferans']);
    for (const id of GAME_TYPES) {
      const e = GAME_CATALOG[id];
      expect(e.status, `${id} status`).toBe('available');
      expect(e.supportsLocal, `${id} local`).toBe(true);
      expect(e.supportsOnline, `${id} online`).toBe(true);
      expect(e.supportsBots, `${id} bots`).toBe(true);
    }
  });

  it('every game has a registered definition that records stats + declares seat counts', () => {
    for (const id of GAME_TYPES) {
      const def = GAME_DEFINITIONS[id];
      expect(def, `${id} definition`).toBeTruthy();
      expect(def.id, `${id} definition id`).toBe(id);
      expect(def.catalog, `${id} catalog ref`).toBe(GAME_CATALOG[id]);
      expect(def.recordsStats, `${id} recordsStats`).toBe(true);
      expect(def.supportedPlayerCounts.length, `${id} seat counts`).toBeGreaterThan(0);
    }
  });

  it('the favorite-game list covers exactly the game catalog (no drift)', () => {
    expect([...SUPPORTED_FAVORITE_GAMES].sort()).toEqual([...GAME_TYPES].sort());
  });

  it('every game ships a real PNG icon on disk (manifest + file), each under 150KB', () => {
    for (const id of GAME_TYPES) {
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
});
