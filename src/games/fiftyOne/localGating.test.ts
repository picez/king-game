// ---------------------------------------------------------------------------
// 51 is an EXPERIMENTAL, local-only game (Stage 30.3): playable local (1 human +
// bots) but gated OFF online — no host room, no favorite, no stats. These guards
// assert that gating from data + source, so a future change that accidentally
// makes 51 online-startable (or leaks its pure core into another game) is caught
// by `npm test`. Online arrives in 30.4–30.5.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_CATALOG } from '../catalog';
import { GAME_DEFINITIONS } from '../registry';
import { SUPPORTED_FAVORITE_GAMES } from '../../net/userSettings';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const ID = 'fifty-one';

describe('51 is local-playable but gated off online (Stage 30.3)', () => {
  it('is selectable in the LOCAL picker but DISABLED in the Host picker', () => {
    const e = GAME_CATALOG[ID];
    expect(e.status).toBe('experimental');
    // GamePicker: `usable = mode==='host' ? supportsOnline : supportsLocal`.
    expect(e.supportsLocal).toBe(true);   // Local sheet: selectable (flagged Experimental)
    expect(e.supportsOnline).toBe(false); // Host sheet: disabled + "Coming soon"
  });

  it('App routes local fifty-one to FiftyOneLocalGame', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("mode.gameType === 'fifty-one' ? <FiftyOneLocalGame");
    expect(app).toContain("import FiftyOneLocalGame from './ui/fiftyOne/FiftyOneLocalGame'");
  });

  it('records no stats and is excluded from the favorite-game list', () => {
    expect(GAME_DEFINITIONS[ID].recordsStats).toBe(false);
    expect((SUPPORTED_FAVORITE_GAMES as readonly string[]).includes(ID)).toBe(false);
  });

  it('the server CREATE_ROOM handler rejects any game with supportsOnline=false', () => {
    const src = read('server/wsHandlers.ts');
    expect(src).toContain('if (!entry.supportsOnline)');
    expect(GAME_CATALOG[ID].supportsOnline).toBe(false); // → an online 51 room is rejected
  });

  it('does not ship a per-game stats tab (ProfileMenu GAMES stays the 5 available)', () => {
    const src = read('src/ui/ProfileMenu.tsx');
    expect(src).not.toContain("'fifty-one'");
  });
});

describe('51 pure core + UI stay isolated (source guards)', () => {
  const CORE_DIR = 'src/games/fiftyOne';
  const PURE_FILES = ['types', 'deck', 'melds', 'rules', 'engine', 'ai', 'redact', 'invariants'];
  const UI_DIR = 'src/ui/fiftyOne';

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

  it('the local UI imports no server/ws/db (client-only, offline prototype)', () => {
    for (const file of readdirSync(join(process.cwd(), UI_DIR))) {
      if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue;
      const src = read(join(UI_DIR, file));
      expect(src, `${file} must not import server`).not.toMatch(/from '.*\/server/);
      expect(src, `${file} must not import net transport`).not.toMatch(/from '.*\/net\/(wsHandlers|serverCore|online)/);
      expect(src, `${file} must not import db`).not.toMatch(/from '.*\/db/);
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
