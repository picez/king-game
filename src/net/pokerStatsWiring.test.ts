// ---------------------------------------------------------------------------
// Poker stats source guards (Stage 37.4). Assert the cross-cutting invariants that
// keep poker stats correct AND wired into the released tier:
//   • the WS finish path is wired to the poker recorder + signature;
//   • recordsStats is on and the game is available (favoritable + achievement);
//   • NO new DB migration was added (reuses the free-text game_type column);
//   • the achievements derivation DOES count poker (All-Rounder needs a poker win);
//   • no hole-card/deck/burn vocabulary appears in the pure stats summarizer source.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_CATALOG } from '../games/catalog';
import { GAME_DEFINITIONS } from '../games/registry';
import { totalWins, totalGames, type AllStats } from '../stats/achievements';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('poker stats are wired into the online finish path (Stage 37.4)', () => {
  it('the definition records stats and the game is available (favoritable)', () => {
    expect(GAME_DEFINITIONS.poker.recordsStats).toBe(true);
    expect(GAME_CATALOG.poker.status).toBe('available');
  });

  it('server/index.ts routes a finished poker game to its recorder + finish signature', () => {
    const idx = read('server/index.ts');
    expect(idx).toContain('pokerFinishSignature');
    expect(idx).toContain('recordFinishedPokerGame');
    expect(idx).toContain("gt === 'poker'");
  });

  it('the API exposes poker stats + leaderboard routes', () => {
    const api = read('server/api.ts');
    expect(api).toContain('/api/games/poker/stats');
    expect(api).toContain('/api/games/poker/leaderboard');
    expect(api).toContain('getPokerStats');
    expect(api).toContain('getPokerLeaderboard');
  });
});

describe('poker stats add NO migration but DO feed achievements (Stage 37.4)', () => {
  it('the latest DB migration is still 0009 (poker stats reuse the free-text game_type)', () => {
    const files = readdirSync(join(process.cwd(), 'server/db/migrations'))
      .filter((f) => f.endsWith('.sql')).sort();
    const last = files[files.length - 1];
    expect(last).toBe('0009_friends.sql');
    for (const f of files) {
      expect(read(join('server/db/migrations', f)), `${f} must not reference poker`).not.toMatch(/poker/i);
    }
  });

  it('the achievements AllStats type has a poker field, so All-Rounder counts poker', () => {
    const src = read('src/stats/achievements.ts');
    expect(src).toMatch(/poker/);
    const withPoker = { poker: { gamesPlayed: 9, gamesWon: 9 } } as unknown as AllStats;
    expect(totalWins(withPoker)).toBe(9);
    expect(totalGames(withPoker)).toBe(9);
  });
});

describe('the poker stats summarizer source carries no private card vocabulary', () => {
  it('src/net/pokerStats.ts reads only score-level fields', () => {
    const src = read('src/net/pokerStats.ts');
    // Must never READ hole cards / deck / burns.
    expect(src).not.toMatch(/state\.holeCardsBySeat|state\.deck|state\.burned|state\.board/);
    // It reads the public outcome fields it is supposed to.
    expect(src).toContain('state.winnerSeat');
    expect(src).toContain('state.telemetry');
    expect(src).toContain('state.handNumber');
  });
});
