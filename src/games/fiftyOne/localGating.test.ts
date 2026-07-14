// ---------------------------------------------------------------------------
// 51 is a fully RELEASED game (Stage 30.7): playable LOCAL (1 human + bots, Stage
// 30.3) AND ONLINE (server-authoritative, Stage 30.5), records score-only stats +
// leaderboard (Stage 30.6), and is a first-class member — favoritable + in the
// achievements derivation / All-Rounder. These guards assert that tier from data +
// source, so a regression that drops 51 out of the released tier (favorite /
// achievements) — or leaks its pure core into another game — is caught by `npm test`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_CATALOG } from '../catalog';
import { GAME_DEFINITIONS } from '../registry';
import { SUPPORTED_FAVORITE_GAMES } from '../../net/userSettings';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const ID = 'fifty-one';

describe('51 is a released game — local + online + stats + favorite (Stage 30.7)', () => {
  it('is selectable in BOTH the Local and Host pickers as an available game', () => {
    const e = GAME_CATALOG[ID];
    expect(e.status).toBe('available');
    // GamePicker: `usable = mode==='host' ? supportsOnline : supportsLocal`.
    expect(e.supportsLocal).toBe(true);  // Local sheet: selectable
    expect(e.supportsOnline).toBe(true); // Host sheet: selectable
  });

  it('App routes local fifty-one to FiftyOneLocalGame', () => {
    const app = read('src/App.tsx');
    expect(app).toContain("mode.gameType === 'fifty-one' ? <FiftyOneLocalGame");
    expect(app).toContain("import FiftyOneLocalGame from './ui/fiftyOne/FiftyOneLocalGame'");
  });

  it('OnlineGame routes online fifty-one to FiftyOneOnlineGame (not King GameRouter)', () => {
    const src = read('src/ui/online/OnlineGame.tsx');
    expect(src).toContain("net.room?.gameType === 'fifty-one'");
    expect(src).toContain('<FiftyOneOnlineGame');
    expect(src).toContain("import FiftyOneOnlineGame from '../fiftyOne/FiftyOneOnlineGame'");
  });

  it('records score-only stats (Stage 30.6) and is favoritable (Stage 30.7)', () => {
    expect(GAME_DEFINITIONS[ID].recordsStats).toBe(true);  // Stage 30.6: stats on
    expect((SUPPORTED_FAVORITE_GAMES as readonly string[]).includes(ID)).toBe(true); // Stage 30.7: released
  });

  it('CREATE_ROOM now ACCEPTS 51 (supportsOnline true); the generic guard still gates any online:false game', () => {
    const src = read('server/wsHandlers.ts');
    expect(src).toContain('if (!entry.supportsOnline)'); // generic gate still present
    expect(GAME_CATALOG[ID].supportsOnline).toBe(true);   // → an online 51 room is now allowed
  });

  it('ships a 51 stats + leaderboard sub-tab AND feeds achievements (Stage 30.7)', () => {
    const profile = read('src/ui/ProfileMenu.tsx');
    // 51 is a stats/leaderboard sub-tab…
    expect(profile).toContain("'fifty-one'");
    expect(profile).toContain('FiftyOneStatsPanel');
    expect(profile).toContain('FiftyOneLeaderboardPanel');
    // …and the achievements derivation (AllStats) now includes a 51 field (Stage 30.7).
    const ach = read('src/stats/achievements.ts');
    expect(ach).toMatch(/fiftyOne/);
    expect(ach).toContain('fifty-one-winner');
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

  it('the UI imports no server/ws/db transport directly (client-only; dispatch is injected)', () => {
    for (const file of readdirSync(join(process.cwd(), UI_DIR))) {
      if (!file.endsWith('.tsx') && !file.endsWith('.ts')) continue;
      const src = read(join(UI_DIR, file));
      expect(src, `${file} must not import server`).not.toMatch(/from '.*\/server/);
      expect(src, `${file} must not import net transport`).not.toMatch(/from '.*\/net\/(wsHandlers|serverCore|online)/);
      expect(src, `${file} must not import db`).not.toMatch(/from '.*\/db/);
    }
  });

  it('the other five games do NOT import the 51 core (additive only)', () => {
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
