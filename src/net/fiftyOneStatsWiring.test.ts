// ---------------------------------------------------------------------------
// 51 stats source guards (Stage 30.6 foundation; Stage 30.7 release). Assert the
// cross-cutting invariants that keep 51 stats correct AND wired into the released
// tier:
//   • the WS finish path is wired to the 51 recorder + signature;
//   • recordsStats is on and the game is available (favoritable + achievement);
//   • NO new DB migration was added (reuses the free-text game_type column);
//   • the achievements derivation DOES count 51 (All-Rounder needs a 51 win);
//   • no card/hand/draw vocabulary appears in the pure stats summarizer source.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_CATALOG } from '../games/catalog';
import { GAME_DEFINITIONS } from '../games/registry';
import { totalWins, totalGames, type AllStats } from '../stats/achievements';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('51 stats are wired into the online finish path (Stage 30.6)', () => {
  it('the definition records stats and the game is available (favoritable)', () => {
    expect(GAME_DEFINITIONS['fifty-one'].recordsStats).toBe(true);
    expect(GAME_CATALOG['fifty-one'].status).toBe('available');
  });

  it('server/index.ts routes a finished 51 game to its recorder + finish signature', () => {
    const idx = read('server/index.ts');
    expect(idx).toContain('fiftyOneFinishSignature');
    expect(idx).toContain('recordFinishedFiftyOneGame');
    expect(idx).toContain("gt === 'fifty-one'");
  });

  it('the API exposes 51 stats + leaderboard routes', () => {
    const api = read('server/api.ts');
    expect(api).toContain("/api/games/fifty-one/stats");
    expect(api).toContain("/api/games/fifty-one/leaderboard");
    expect(api).toContain('getFiftyOneStats');
    expect(api).toContain('getFiftyOneLeaderboard');
  });
});

describe('51 stats add NO migration but DO feed achievements (Stage 30.7 release)', () => {
  it('no migration is needed for 51 stats (they reuse the free-text game_type)', () => {
    // 51 stats add NO migration of their own — they reuse the shared
    // games/game_players/user_stats tables via the free-text `game_type='fifty-one'`.
    // (Later stages may add UNRELATED migrations — e.g. the Stage 37.7 Poker wallet —
    // so we assert the 51-stats invariant directly, not a fixed latest-migration number.)
    const files = readdirSync(join(process.cwd(), 'server/db/migrations'))
      .filter((f) => f.endsWith('.sql')).sort();
    // No migration file mentions fifty-one / 51 stats.
    for (const f of files) {
      expect(read(join('server/db/migrations', f)), `${f} must not reference fifty-one`).not.toMatch(/fifty-one/);
    }
  });

  it('the achievements AllStats type has a 51 field, so All-Rounder counts 51', () => {
    const src = read('src/stats/achievements.ts');
    expect(src).toMatch(/fiftyOne/);
    // The cross-game aggregates now include the 51 field at runtime.
    const withFiftyOne = { fiftyOne: { gamesPlayed: 9, gamesWon: 9 } } as unknown as AllStats;
    expect(totalWins(withFiftyOne)).toBe(9);
    expect(totalGames(withFiftyOne)).toBe(9);
  });
});

describe('the 51 stats summarizer source carries no private card vocabulary', () => {
  it('src/net/fiftyOneStats.ts reads only score-level fields', () => {
    const src = read('src/net/fiftyOneStats.ts');
    // It may name the fields it deliberately excludes in comments, but must never
    // READ card data: no handsBySeat/drawPile/discardPile/publicMelds field access.
    expect(src).not.toMatch(/state\.handsBySeat|state\.drawPile|state\.discardPile|state\.publicMelds/);
    // It reads the public outcome fields it is supposed to.
    expect(src).toContain('state.scoresBySeat');
    expect(src).toContain('state.eliminatedSeats');
    expect(src).toContain('state.winnerSeat');
  });
});
