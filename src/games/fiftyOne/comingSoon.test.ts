// ---------------------------------------------------------------------------
// 51 is registered as a coming_soon game (Stage 30.2): the platform is AWARE of
// it (catalog, registry, /api/games, picker), but it is gated OFF everywhere it
// would become playable — no local/host start, no online room, no favorite, no
// stats. These guards assert that gating from data + source, so a future change
// that accidentally makes 51 startable (or leaks its pure core into another game)
// is caught by `npm test`. Playability arrives in 30.3+.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_CATALOG } from '../catalog';
import { SUPPORTED_FAVORITE_GAMES } from '../../net/userSettings';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const ID = 'fifty-one';

describe('51 is gated off as coming_soon (Stage 30.2)', () => {
  it('the catalog makes it non-startable in BOTH picker modes (local + host)', () => {
    const e = GAME_CATALOG[ID];
    expect(e.status).toBe('coming_soon');
    // GamePicker: `usable = mode==='host' ? supportsOnline : supportsLocal`.
    const localUsable = e.supportsLocal;
    const hostUsable = e.supportsOnline;
    expect(localUsable).toBe(false); // disabled + "coming soon" in the Local sheet
    expect(hostUsable).toBe(false);  // disabled + "coming soon" in the Host sheet
  });

  it('is excluded from the favorite-game list', () => {
    expect((SUPPORTED_FAVORITE_GAMES as readonly string[]).includes(ID)).toBe(false);
  });

  it('the server CREATE_ROOM handler rejects any game with supportsOnline=false', () => {
    // 51 has supportsOnline=false, so this existing guard rejects an online 51 room.
    const src = read('server/wsHandlers.ts');
    expect(src).toContain('if (!entry.supportsOnline)');
    expect(GAME_CATALOG[ID].supportsOnline).toBe(false);
  });

  it('does not ship a per-game stats tab (ProfileMenu GAMES stays the 5 available)', () => {
    const src = read('src/ui/ProfileMenu.tsx');
    // The stats/leaderboard tab list is a separate 5-game constant; 51 must not appear.
    expect(src).not.toContain("'fifty-one'");
  });
});

describe('51 pure core stays isolated (source guards)', () => {
  const CORE_DIR = 'src/games/fiftyOne';
  // The pure-core files must not reach into the server / net-runtime / DB / fetch.
  const PURE_FILES = ['types', 'deck', 'melds', 'rules', 'engine', 'ai', 'redact', 'invariants'];

  it('no pure-core file imports server/DB/net-runtime or does I/O', () => {
    for (const f of PURE_FILES) {
      const src = read(join(CORE_DIR, `${f}.ts`));
      expect(src, `${f}.ts must not import net`).not.toMatch(/from '\.\.\/\.\.\/net/);
      expect(src, `${f}.ts must not import server`).not.toMatch(/from '.*server/);
      expect(src, `${f}.ts must not import db`).not.toMatch(/from '.*\/db/);
      expect(src, `${f}.ts must not fetch`).not.toContain('fetch(');
      expect(src, `${f}.ts must not use localStorage`).not.toContain('localStorage');
    }
  });

  it('the five released games do NOT import the 51 core (additive only)', () => {
    for (const game of ['king', 'durak', 'deberc', 'tarneeb', 'preferans']) {
      const dir = join('src/games', game);
      for (const file of readdirSync(join(process.cwd(), dir))) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        const src = read(join(dir, file));
        expect(src, `${game}/${file} imports fiftyOne`).not.toMatch(/from '.*fiftyOne/);
      }
    }
  });
});
