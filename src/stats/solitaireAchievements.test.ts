// Solitaire badges (owner 2026-11-27): local stats, their own 'solitaire' group,
// never part of the table-game aggregates.
import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, evaluateAchievements, groupAchievements, totalWins, type AllStats } from './achievements';
import { emptyStats, recordResult, type GameResult, type SolitaireStats } from '../solitaire/stats';
import type { VariantKey } from '../solitaire/engine';

const base: AllStats = { king: null, durak: null, deberc: null, tarneeb: null, preferans: null, fiftyOne: null, poker: null };
const win = (key: VariantKey, extra: Partial<GameResult> = {}): GameResult => ({ key, won: true, ms: 200_000, moves: 100, undos: 1, hints: 1, daily: null, ...extra });
const earned = (solitaire: SolitaireStats) => new Set(evaluateAchievements({ ...base, solitaire }).filter((r) => r.earned).map((r) => r.achievement.id));

describe('solitaire achievements', () => {
  const sol = ACHIEVEMENTS.filter((a) => a.group === 'solitaire');

  it('fourteen badges, all in the solitaire group, none tied to a table game', () => {
    expect(sol).toHaveLength(14);
    expect(sol.every((a) => a.gameType === undefined)).toBe(true);
    const g = groupAchievements(evaluateAchievements(base)).find((x) => x.key === 'solitaire');
    expect(g?.total).toBe(14);
  });

  it('locked without stats; unlock from local results', () => {
    expect(earned(emptyStats()).size).toBe(0);
    let s = recordResult(emptyStats(), win('klondike-3'));
    expect(earned(s)).toEqual(new Set(['sol-first-win', 'sol-klondike-3']));
    s = recordResult(s, win('klondike-1', { ms: 170_000, undos: 0 }));
    expect(earned(s).has('sol-speed')).toBe(true);
    expect(earned(s).has('sol-clean')).toBe(true);
    for (const k of ['spider-4', 'freecell', 'pyramid', 'tripeaks', 'yukon', 'forty-thieves'] as VariantKey[]) s = recordResult(s, win(k));
    expect(earned(s).has('sol-explorer')).toBe(true);
    expect(earned(s).has('sol-spider-4')).toBe(true);
    expect(earned(s).has('sol-ten-wins')).toBe(false); // 8 wins
    for (let i = 0; i < 5; i++) s = recordResult(s, win('pyramid', { daily: `2026-11-2${i}` }));
    expect(earned(s).has('sol-ten-wins')).toBe(true);
    expect(earned(s).has('sol-streak-5')).toBe(true);
    expect(earned(s).has('sol-daily-7')).toBe(false);
  });

  it('solitaire wins never count toward the table-game totals', () => {
    const s = recordResult(emptyStats(), win('freecell'));
    expect(totalWins({ ...base, solitaire: s })).toBe(0);
  });
});
