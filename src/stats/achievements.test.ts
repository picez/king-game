import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACHIEVEMENTS, evaluateAchievements, earnedCount, totalWins, totalGames,
  groupAchievements,
  type AllStats,
} from './achievements';
import type { KingStats, DurakStats, DebercStats, TarneebStats, PreferansStats, FiftyOneStats, PokerStats } from '../net/statsApi';
import { EN } from '../i18n/dictionaries/en';

// ── zeroed stat factories (only the fields under test matter) ────────────────
const king = (o: Partial<KingStats> = {}): KingStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null, roundsPlayed: 0,
  totalScore: 0, averageScore: null, bestScore: null, worstScore: null,
  trumpRoundsPlayed: 0, negativeRoundsPlayed: 0, surrenderedCount: 0,
  surrenderedSupported: false, modeBreakdown: {},
  perfectNegativeRounds: {}, trumpSweeps: 0, trumpLowTricks: 0, lastGameAt: null, ...o,
});
const durak = (o: Partial<DurakStats> = {}): DurakStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null,
  foolCount: 0, drawCount: 0, foolRate: null,
  wonBySixes: 0, lostBySixes: 0, lastGameAt: null, ...o,
});
const deberc = (o: Partial<DebercStats> = {}): DebercStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null, jackpotCount: 0, jackpotRate: null,
  combinations: { terz: 0, platina: 0, bella: 0, total: 0, handsPlayed: 0, handsWithMeld: 0, meldRate: null },
  bestGameScore: null, worstGameScore: null, gamesWithNoMeld: 0, gamesWonNoBeyt: 0,
  lastGameAt: null, ...o,
});
const tarneeb = (o: Partial<TarneebStats> = {}): TarneebStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null, handsPlayed: 0, handsAsDeclarer: 0,
  contractsMade: 0, contractsFailed: 0, contractSuccessRate: null, totalTeamScore: 0,
  averageTeamScore: null, bestGameScore: null, worstGameScore: null,
  cleanContractGames: 0, maxWinningBid: 0, lastGameAt: null, ...o,
});
const preferans = (o: Partial<PreferansStats> = {}): PreferansStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, gamesDrawn: 0, winRate: null, handsPlayed: 0, handsAsDeclarer: 0,
  contractsMade: 0, contractsFailed: 0, contractSuccessRate: null, totalScore: 0,
  averageScore: null, bestGameScore: null, worstGameScore: null, lastGameAt: null, ...o,
});
const fiftyOne = (o: Partial<FiftyOneStats> = {}): FiftyOneStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null, roundsPlayed: 0,
  timesEliminated: 0, totalPenalty: 0, averagePenalty: null, bestPenalty: null,
  gamesWithInstantRoundWin: 0, gamesNeverOpened: 0, gamesWithTwoJokerDeal: 0, gamesWithNoHundred: 0,
  lastGameAt: null, ...o,
});
const poker = (o: Partial<PokerStats> = {}): PokerStats => ({
  gamesPlayed: 0, gamesWon: 0, gamesLost: 0, winRate: null, handsPlayed: 0, handsWon: 0,
  showdownsWon: 0, potsWon: 0, biggestPot: 0, allInsWon: 0, royalFlushCount: 0, lastGameAt: null, ...o,
});
const zero = (): AllStats => ({ king: king(), durak: durak(), deberc: deberc(), tarneeb: tarneeb(), preferans: preferans(), fiftyOne: fiftyOne(), poker: poker() });
const earnedId = (s: AllStats, id: string): boolean =>
  evaluateAchievements(s).find((r) => r.achievement.id === id)!.earned;

describe('achievements catalog', () => {
  it('has 52 badges with unique ids (14 original + 15 Stage 32.1 + 5 Stage 37.0 + 14 Stage 37.3 + 4 Stage 37.4)', () => {
    expect(ACHIEVEMENTS.length).toBe(52);
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('tarneeb-soloist'); // Stage 28.6
    // The expansion's basic per-game win badges (Deberc/Tarneeb/Preferans previously had none).
    for (const id of ['deberc-winner', 'tarneeb-winner', 'preferans-winner', 'six-game-regular']) {
      expect(ids).toContain(id);
    }
  });

  it('every badge has a valid rarity, an icon, and a game scope in the catalog', () => {
    for (const a of ACHIEVEMENTS) {
      expect(['common', 'uncommon', 'rare', 'epic']).toContain(a.rarity);
      expect(a.icon.length).toBeGreaterThan(0);
      if (a.gameType) expect(['king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one', 'poker']).toContain(a.gameType);
    }
  });

  it('every title/description key exists (non-blank) in every language', () => {
    const dicts = ['en', 'uk', 'de', 'ar'].map((l) =>
      readFileSync(join(process.cwd(), 'src/i18n/dictionaries', `${l}.ts`), 'utf8'));
    for (const a of ACHIEVEMENTS) {
      for (const key of [a.titleKey, a.descriptionKey]) {
        expect(EN[key as keyof typeof EN], `EN missing ${key}`).toBeTruthy();
        for (const d of dicts) expect(d, `dict missing ${key}`).toContain(`'${key}'`);
      }
    }
  });

  it('defines the section + progress + empty UI keys', () => {
    for (const key of ['profile.achievements', 'ach.progress', 'ach.emptyLocked']) {
      expect(EN[key as keyof typeof EN], key).toBeTruthy();
    }
  });
});

describe('achievements module is pure (derived from AllStats only)', () => {
  const src = readFileSync(join(process.cwd(), 'src/stats/achievements.ts'), 'utf8');
  it('imports no runtime net/server/db/ws and runs no fetch/reducer', () => {
    const importLines = src.split('\n').filter((l) => l.trimStart().startsWith('import'));
    for (const line of importLines) {
      // A `import type … from '../net/statsApi'` (types only) is allowed; a runtime import is not.
      if (/^import\s+type\b/.test(line.trimStart())) continue;
      expect(line, line).not.toMatch(/\/(net|server|db)\/|\bws\b|serverCore|wsHandlers/);
    }
    expect(src).not.toMatch(/fetch\(|Reducer\(|Math\.random/);
  });
  it('every evaluator is a pure predicate over AllStats (no side effects in the catalog)', () => {
    // Structural: every badge exposes an `evaluate` function; running the whole catalog twice over
    // the same snapshot yields identical results (deterministic, no hidden state).
    const snap: AllStats = { ...zero(), king: king({ gamesWon: 3, gamesPlayed: 12 }) };
    expect(evaluateAchievements(snap).map((r) => r.earned)).toEqual(evaluateAchievements(snap).map((r) => r.earned));
  });
});

describe('evaluateAchievements — graceful with missing stats', () => {
  it('returns one row per badge, all locked, when nothing is loaded', () => {
    const rows = evaluateAchievements({ king: null, durak: null, deberc: null, tarneeb: null, preferans: null, fiftyOne: null, poker: null });
    expect(rows).toHaveLength(ACHIEVEMENTS.length);
    expect(earnedCount(rows)).toBe(0);
  });

  it('aggregate helpers are null-safe', () => {
    const empty = { king: null, durak: null, deberc: null, tarneeb: null, preferans: null, fiftyOne: null, poker: null };
    expect(totalWins(empty)).toBe(0);
    expect(totalGames(empty)).toBe(0);
  });
});

// Each MVP badge: one state that earns it, one that does not.
describe('each badge has a positive + negative case', () => {
  const cases: Array<{ id: string; earn: AllStats; lock: AllStats }> = [
    { id: 'first-win', earn: { ...zero(), king: king({ gamesWon: 1 }) }, lock: zero() },
    { id: 'veteran', earn: { ...zero(), king: king({ gamesPlayed: 25 }) }, lock: { ...zero(), king: king({ gamesPlayed: 24 }) } },
    { id: 'centurion', earn: { ...zero(), durak: durak({ gamesPlayed: 100 }) }, lock: { ...zero(), durak: durak({ gamesPlayed: 99 }) } },
    {
      id: 'all-rounder',
      earn: { king: king({ gamesWon: 1 }), durak: durak({ gamesWon: 1 }), deberc: deberc({ gamesWon: 1 }), tarneeb: tarneeb({ gamesWon: 1 }), preferans: preferans({ gamesWon: 1 }), fiftyOne: fiftyOne({ gamesWon: 1 }), poker: poker({ gamesWon: 1 }) },
      // Won every game except Poker → still locked (a win in EVERY of the seven games is required).
      lock: { king: king({ gamesWon: 1 }), durak: durak({ gamesWon: 1 }), deberc: deberc({ gamesWon: 1 }), tarneeb: tarneeb({ gamesWon: 1 }), preferans: preferans({ gamesWon: 1 }), fiftyOne: fiftyOne({ gamesWon: 1 }), poker: poker({ gamesWon: 0 }) },
    },
    { id: 'king-winner', earn: { ...zero(), king: king({ gamesWon: 1 }) }, lock: { ...zero(), king: king({ gamesWon: 0, gamesPlayed: 3 }) } },
    { id: 'durak-survivor', earn: { ...zero(), durak: durak({ gamesWon: 1 }) }, lock: { ...zero(), durak: durak({ gamesWon: 0, foolCount: 2 }) } },
    { id: 'tarneeb-declarer', earn: { ...zero(), tarneeb: tarneeb({ handsAsDeclarer: 1 }) }, lock: { ...zero(), tarneeb: tarneeb({ handsAsDeclarer: 0, handsPlayed: 5 }) } },
    { id: 'tarneeb-contractor', earn: { ...zero(), tarneeb: tarneeb({ contractsMade: 5 }) }, lock: { ...zero(), tarneeb: tarneeb({ contractsMade: 4 }) } },
    { id: 'tarneeb-soloist', earn: { ...zero(), tarneebSolo: tarneeb({ gamesWon: 1 }) }, lock: { ...zero(), tarneebSolo: tarneeb({ gamesWon: 0, gamesPlayed: 3 }) } },
    { id: 'preferans-declarer', earn: { ...zero(), preferans: preferans({ handsAsDeclarer: 1 }) }, lock: { ...zero(), preferans: preferans({ handsAsDeclarer: 0, handsPlayed: 5 }) } },
    { id: 'fifty-one-winner', earn: { ...zero(), fiftyOne: fiftyOne({ gamesWon: 1 }) }, lock: { ...zero(), fiftyOne: fiftyOne({ gamesWon: 0, gamesPlayed: 3 }) } },
    { id: 'deberc-meld-maker', earn: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 0, bella: 0, total: 10, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) }, lock: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 0, bella: 0, total: 9, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) } },
    { id: 'deberc-bella', earn: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 0, bella: 1, total: 1, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) }, lock: zero() },
    { id: 'deberc-jackpot', earn: { ...zero(), deberc: deberc({ jackpotCount: 1 }) }, lock: { ...zero(), deberc: deberc({ jackpotCount: 0, gamesWon: 3 }) } },
    // ── Stage 32.1 expansion ──────────────────────────────────────────────────
    {
      id: 'six-game-regular',
      earn: { king: king({ gamesPlayed: 1 }), durak: durak({ gamesPlayed: 1 }), deberc: deberc({ gamesPlayed: 1 }), tarneeb: tarneeb({ gamesPlayed: 1 }), preferans: preferans({ gamesPlayed: 1 }), fiftyOne: fiftyOne({ gamesPlayed: 1 }), poker: poker({ gamesPlayed: 1 }) },
      lock: { king: king({ gamesPlayed: 1 }), durak: durak({ gamesPlayed: 1 }), deberc: deberc({ gamesPlayed: 1 }), tarneeb: tarneeb({ gamesPlayed: 1 }), preferans: preferans({ gamesPlayed: 1 }), fiftyOne: fiftyOne({ gamesPlayed: 1 }), poker: poker({ gamesPlayed: 0 }) },
    },
    { id: 'champions-circle', earn: { ...zero(), king: king({ gamesWon: 25 }) }, lock: { ...zero(), king: king({ gamesWon: 24 }) } },
    { id: 'king-regular', earn: { ...zero(), king: king({ gamesPlayed: 10 }) }, lock: { ...zero(), king: king({ gamesPlayed: 9 }) } },
    { id: 'king-champion', earn: { ...zero(), king: king({ gamesWon: 10 }) }, lock: { ...zero(), king: king({ gamesWon: 9 }) } },
    { id: 'durak-defender', earn: { ...zero(), durak: durak({ gamesWon: 5 }) }, lock: { ...zero(), durak: durak({ gamesWon: 4 }) } },
    { id: 'durak-regular', earn: { ...zero(), durak: durak({ gamesPlayed: 10 }) }, lock: { ...zero(), durak: durak({ gamesPlayed: 9 }) } },
    { id: 'deberc-winner', earn: { ...zero(), deberc: deberc({ gamesWon: 1 }) }, lock: { ...zero(), deberc: deberc({ gamesWon: 0, gamesPlayed: 4 }) } },
    { id: 'deberc-terz-collector', earn: { ...zero(), deberc: deberc({ combinations: { terz: 10, platina: 0, bella: 0, total: 10, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) }, lock: { ...zero(), deberc: deberc({ combinations: { terz: 9, platina: 0, bella: 0, total: 9, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) } },
    { id: 'tarneeb-winner', earn: { ...zero(), tarneeb: tarneeb({ gamesWon: 1 }) }, lock: { ...zero(), tarneeb: tarneeb({ gamesWon: 0, gamesPlayed: 4 }) } },
    {
      // Skill badge: earned at ≥70% over ≥10 decided; LOCKED at a perfect but tiny sample (1/1) — anti-fluke.
      id: 'tarneeb-sharp-bidder',
      earn: { ...zero(), tarneeb: tarneeb({ contractsMade: 8, contractsFailed: 2, contractSuccessRate: 80 }) },
      lock: { ...zero(), tarneeb: tarneeb({ contractsMade: 1, contractsFailed: 0, contractSuccessRate: 100 }) },
    },
    { id: 'preferans-winner', earn: { ...zero(), preferans: preferans({ gamesWon: 1 }) }, lock: { ...zero(), preferans: preferans({ gamesWon: 0, gamesPlayed: 4 }) } },
    { id: 'preferans-contract-regular', earn: { ...zero(), preferans: preferans({ contractsMade: 10 }) }, lock: { ...zero(), preferans: preferans({ contractsMade: 9 }) } },
    { id: 'fifty-one-regular', earn: { ...zero(), fiftyOne: fiftyOne({ gamesPlayed: 10 }) }, lock: { ...zero(), fiftyOne: fiftyOne({ gamesPlayed: 9 }) } },
    { id: 'fifty-one-champion', earn: { ...zero(), fiftyOne: fiftyOne({ gamesWon: 5 }) }, lock: { ...zero(), fiftyOne: fiftyOne({ gamesWon: 4 }) } },
    { id: 'fifty-one-low-penalty', earn: { ...zero(), fiftyOne: fiftyOne({ bestPenalty: 50 }) }, lock: { ...zero(), fiftyOne: fiftyOne({ bestPenalty: 51 }) } },
    // ── Stage 37.0 — new derived badges ──────────────────────────────────────
    {
      id: 'king-all-negatives',
      // Conceded points (totalScore < 0) in ALL six negative modes.
      earn: { ...zero(), king: king({ modeBreakdown: {
        no_tricks: { rounds: 1, totalScore: -2, averageScore: -2 },
        no_hearts: { rounds: 1, totalScore: -2, averageScore: -2 },
        no_jacks: { rounds: 1, totalScore: -2, averageScore: -2 },
        no_queens: { rounds: 1, totalScore: -2, averageScore: -2 },
        king_of_hearts: { rounds: 1, totalScore: -4, averageScore: -4 },
        last_two_tricks: { rounds: 1, totalScore: -4, averageScore: -4 },
      } }) },
      // Missing one negative mode (only five have a negative total) → not earned.
      lock: { ...zero(), king: king({ modeBreakdown: {
        no_tricks: { rounds: 1, totalScore: -2, averageScore: -2 },
        no_hearts: { rounds: 1, totalScore: -2, averageScore: -2 },
        no_jacks: { rounds: 1, totalScore: -2, averageScore: -2 },
        no_queens: { rounds: 1, totalScore: -2, averageScore: -2 },
        king_of_hearts: { rounds: 1, totalScore: -4, averageScore: -4 },
      } }) },
    },
    { id: 'deberc-platina-collector',
      earn: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 3, bella: 0, total: 3, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) },
      lock: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 2, bella: 0, total: 2, handsPlayed: 0, handsWithMeld: 0, meldRate: null } }) } },
    { id: 'deberc-multi-meld',
      // total (3) > handsWithMeld (2) ⇒ a hand held 2+ combinations.
      earn: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 0, bella: 0, total: 3, handsPlayed: 2, handsWithMeld: 2, meldRate: null } }) },
      // total == handsWithMeld ⇒ at most one per hand.
      lock: { ...zero(), deberc: deberc({ combinations: { terz: 0, platina: 0, bella: 0, total: 2, handsPlayed: 2, handsWithMeld: 2, meldRate: null } }) } },
    { id: 'tarneeb-negative-game',
      earn: { ...zero(), tarneeb: tarneeb({ worstGameScore: -5 }) },
      lock: { ...zero(), tarneeb: tarneeb({ worstGameScore: 10 }) } },
    { id: 'tarneeb-all-bids-down',
      earn: { ...zero(), tarneeb: tarneeb({ contractsMade: 0, contractsFailed: 3 }) },
      lock: { ...zero(), tarneeb: tarneeb({ contractsMade: 1, contractsFailed: 3 }) } },
    // ── Stage 37.3 — the full owner-requested pack (real telemetry) ──────────────
    { id: 'king-perfect-negatives',
      // A perfect (score-0) round in ALL SIX negative modes.
      earn: { ...zero(), king: king({ perfectNegativeRounds: {
        no_tricks: 1, no_hearts: 1, no_jacks: 1, no_queens: 1, king_of_hearts: 1, last_two_tricks: 1,
      } }) },
      // Missing one negative mode (only five perfect) → locked.
      lock: { ...zero(), king: king({ perfectNegativeRounds: {
        no_tricks: 1, no_hearts: 1, no_jacks: 1, no_queens: 1, king_of_hearts: 1,
      } }) } },
    { id: 'king-trump-sweep',
      earn: { ...zero(), king: king({ trumpSweeps: 1 }) },
      lock: { ...zero(), king: king({ trumpSweeps: 0, trumpRoundsPlayed: 5 }) } },
    { id: 'king-trump-fewest',
      earn: { ...zero(), king: king({ trumpLowTricks: 1 }) },
      lock: { ...zero(), king: king({ trumpLowTricks: 0, trumpRoundsPlayed: 5 }) } },
    { id: 'durak-lose-to-sixes',
      earn: { ...zero(), durak: durak({ lostBySixes: 1 }) },
      lock: { ...zero(), durak: durak({ lostBySixes: 0, foolCount: 2 }) } },
    { id: 'durak-win-by-sixes',
      earn: { ...zero(), durak: durak({ wonBySixes: 1 }) },
      lock: { ...zero(), durak: durak({ wonBySixes: 0, gamesWon: 2 }) } },
    { id: 'deberc-no-beyt-win',
      earn: { ...zero(), deberc: deberc({ gamesWonNoBeyt: 1 }) },
      lock: { ...zero(), deberc: deberc({ gamesWonNoBeyt: 0, gamesWon: 3 }) } },
    { id: 'deberc-negative-final',
      earn: { ...zero(), deberc: deberc({ worstGameScore: -5 }) },
      lock: { ...zero(), deberc: deberc({ worstGameScore: 10 }) } },
    { id: 'deberc-no-meld-game',
      earn: { ...zero(), deberc: deberc({ gamesWithNoMeld: 1 }) },
      lock: { ...zero(), deberc: deberc({ gamesWithNoMeld: 0, gamesPlayed: 3 }) } },
    { id: 'tarneeb-clean-contract-game',
      earn: { ...zero(), tarneeb: tarneeb({ cleanContractGames: 1 }) },
      lock: { ...zero(), tarneeb: tarneeb({ cleanContractGames: 0, gamesPlayed: 3 }) } },
    { id: 'tarneeb-bid-13-win',
      earn: { ...zero(), tarneeb: tarneeb({ maxWinningBid: 13 }) },
      lock: { ...zero(), tarneeb: tarneeb({ maxWinningBid: 12 }) } },
    { id: 'fifty-one-instant-round',
      earn: { ...zero(), fiftyOne: fiftyOne({ gamesWithInstantRoundWin: 1 }) },
      lock: { ...zero(), fiftyOne: fiftyOne({ gamesWithInstantRoundWin: 0, gamesPlayed: 3 }) } },
    { id: 'fifty-one-never-opened',
      earn: { ...zero(), fiftyOne: fiftyOne({ gamesNeverOpened: 1 }) },
      lock: { ...zero(), fiftyOne: fiftyOne({ gamesNeverOpened: 0, gamesPlayed: 3 }) } },
    { id: 'fifty-one-two-jokers',
      earn: { ...zero(), fiftyOne: fiftyOne({ gamesWithTwoJokerDeal: 1 }) },
      lock: { ...zero(), fiftyOne: fiftyOne({ gamesWithTwoJokerDeal: 0, gamesPlayed: 3 }) } },
    { id: 'fifty-one-no-hundred',
      earn: { ...zero(), fiftyOne: fiftyOne({ gamesWithNoHundred: 1 }) },
      lock: { ...zero(), fiftyOne: fiftyOne({ gamesWithNoHundred: 0, gamesPlayed: 3 }) } },
    // ── Stage 37.4 — Poker badges ─────────────────────────────────────────────
    { id: 'poker-winner',
      earn: { ...zero(), poker: poker({ gamesWon: 1 }) },
      lock: { ...zero(), poker: poker({ gamesWon: 0, gamesPlayed: 3 }) } },
    { id: 'poker-all-in-survivor',
      earn: { ...zero(), poker: poker({ allInsWon: 1 }) },
      lock: { ...zero(), poker: poker({ allInsWon: 0, gamesPlayed: 3 }) } },
    { id: 'poker-big-pot',
      earn: { ...zero(), poker: poker({ biggestPot: 1000 }) },
      lock: { ...zero(), poker: poker({ biggestPot: 999 }) } },
    { id: 'poker-royal-flush',
      earn: { ...zero(), poker: poker({ royalFlushCount: 1 }) },
      lock: { ...zero(), poker: poker({ royalFlushCount: 0, gamesPlayed: 3 }) } },
  ];

  it('covers every catalog badge', () => {
    expect(new Set(cases.map((c) => c.id))).toEqual(new Set(ACHIEVEMENTS.map((a) => a.id)));
  });

  for (const c of cases) {
    it(`${c.id}: earned on the positive case`, () => expect(earnedId(c.earn, c.id)).toBe(true));
    it(`${c.id}: locked on the negative case`, () => expect(earnedId(c.lock, c.id)).toBe(false));
  }
});

describe('Tarneeb Soloist is isolated from Pairs / All-Rounder / aggregates (Stage 28.6)', () => {
  it('a PAIRS Tarneeb win alone does NOT earn the solo badge', () => {
    const s: AllStats = { ...zero(), tarneeb: tarneeb({ gamesWon: 3 }) }; // no tarneebSolo
    expect(earnedId(s, 'tarneeb-soloist')).toBe(false);
  });

  it('a SOLO win does NOT satisfy All-Rounder (still needs a win in every canonical game)', () => {
    // Won 5 canonical games + a solo win, but NOT the 6th canonical (preferans) → locked.
    const s: AllStats = {
      king: king({ gamesWon: 1 }), durak: durak({ gamesWon: 1 }), deberc: deberc({ gamesWon: 1 }),
      tarneeb: tarneeb({ gamesWon: 1 }), preferans: preferans({ gamesWon: 0 }), fiftyOne: fiftyOne({ gamesWon: 1 }), poker: poker({ gamesWon: 1 }),
      tarneebSolo: tarneeb({ gamesWon: 5 }),
    };
    expect(earnedId(s, 'all-rounder')).toBe(false);
    // And All-Rounder ignores solo entirely: winning every CANONICAL game earns it with NO solo.
    const canonical: AllStats = {
      king: king({ gamesWon: 1 }), durak: durak({ gamesWon: 1 }), deberc: deberc({ gamesWon: 1 }),
      tarneeb: tarneeb({ gamesWon: 1 }), preferans: preferans({ gamesWon: 1 }), fiftyOne: fiftyOne({ gamesWon: 1 }), poker: poker({ gamesWon: 1 }),
    };
    expect(earnedId(canonical, 'all-rounder')).toBe(true);
  });

  it('solo wins/games are excluded from totalWins + totalGames', () => {
    const s: AllStats = { ...zero(), tarneebSolo: tarneeb({ gamesWon: 4, gamesPlayed: 9 }) };
    expect(totalWins(s)).toBe(0);
    expect(totalGames(s)).toBe(0);
  });

  it('the solo badge earns from tarneebSolo wins, and is null-safe when solo is absent', () => {
    expect(earnedId({ ...zero(), tarneebSolo: tarneeb({ gamesWon: 1 }) }, 'tarneeb-soloist')).toBe(true);
    expect(earnedId(zero(), 'tarneeb-soloist')).toBe(false);           // undefined tarneebSolo
    expect(earnedId({ king: null, durak: null, deberc: null, tarneeb: null, preferans: null, fiftyOne: null, poker: null }, 'tarneeb-soloist')).toBe(false);
  });

  it('Tarneeb PAIRS win badge reads canonical `tarneeb`, not the solo dimension', () => {
    // A solo-only win does not earn the Pairs win badge; a pairs win does.
    expect(earnedId({ ...zero(), tarneebSolo: tarneeb({ gamesWon: 3 }) }, 'tarneeb-winner')).toBe(false);
    expect(earnedId({ ...zero(), tarneeb: tarneeb({ gamesWon: 1 }) }, 'tarneeb-winner')).toBe(true);
  });
});

describe('Stage 32.1 expansion — aggregates + All-Rounder stay unchanged', () => {
  it('Six-Game Regular needs PLAYING each game (distinct from All-Rounder, which needs a WIN in each)', () => {
    // Played every game once but won NONE → Six-Game Regular earned, All-Rounder locked.
    const playedOnly: AllStats = {
      king: king({ gamesPlayed: 1 }), durak: durak({ gamesPlayed: 1 }), deberc: deberc({ gamesPlayed: 1 }),
      tarneeb: tarneeb({ gamesPlayed: 1 }), preferans: preferans({ gamesPlayed: 1 }), fiftyOne: fiftyOne({ gamesPlayed: 1 }), poker: poker({ gamesPlayed: 1 }),
    };
    expect(earnedId(playedOnly, 'six-game-regular')).toBe(true);
    expect(earnedId(playedOnly, 'all-rounder')).toBe(false);
  });

  it('the new play/win-count badges do NOT change totalWins / totalGames semantics', () => {
    // totalWins/totalGames are still the plain sums of the six canonical games' counters.
    const s: AllStats = {
      king: king({ gamesWon: 2, gamesPlayed: 5 }), durak: durak({ gamesWon: 3, gamesPlayed: 8 }),
      deberc: deberc({ gamesWon: 1, gamesPlayed: 4 }), tarneeb: tarneeb({ gamesWon: 4, gamesPlayed: 10 }),
      preferans: preferans({ gamesWon: 0, gamesPlayed: 2 }), fiftyOne: fiftyOne({ gamesWon: 5, gamesPlayed: 11 }),
      poker: poker({ gamesWon: 0, gamesPlayed: 0 }),
      tarneebSolo: tarneeb({ gamesWon: 9, gamesPlayed: 20 }), // solo excluded
    };
    expect(totalWins(s)).toBe(2 + 3 + 1 + 4 + 0 + 5);        // 15 (solo not counted)
    expect(totalGames(s)).toBe(5 + 8 + 4 + 10 + 2 + 11);     // 40 (solo not counted)
  });

  it('earning many new game-specific badges never earns All-Rounder without a win in every game', () => {
    // Lots of plays + some wins, but zero Preferans wins → All-Rounder stays locked.
    const s: AllStats = {
      king: king({ gamesPlayed: 10, gamesWon: 10 }), durak: durak({ gamesPlayed: 10, gamesWon: 5 }),
      deberc: deberc({ gamesPlayed: 10, gamesWon: 1 }), tarneeb: tarneeb({ gamesPlayed: 10, gamesWon: 1 }),
      preferans: preferans({ gamesPlayed: 10, gamesWon: 0 }), fiftyOne: fiftyOne({ gamesPlayed: 10, gamesWon: 5 }),
      poker: poker({ gamesPlayed: 10, gamesWon: 5 }),
    };
    expect(earnedId(s, 'king-champion')).toBe(true);   // a new badge is earned…
    expect(earnedId(s, 'all-rounder')).toBe(false);    // …but All-Rounder is unaffected
  });
});

describe('boundaries — derived only, no DB/network/private data', () => {
  const cat = readFileSync(join(process.cwd(), 'src/stats/achievements.ts'), 'utf8');
  const panel = readFileSync(join(process.cwd(), 'src/ui/components/AchievementsPanel.tsx'), 'utf8');
  const menu = readFileSync(join(process.cwd(), 'src/ui/ProfileMenu.tsx'), 'utf8');

  it('the catalog does no I/O and touches no server/db/socket (code, not prose)', () => {
    expect(cat).not.toMatch(/\bfetch\(|['"]\/api\/|new WebSocket|from ['"][^'"]*(server|\/db)/);
  });

  it('the panel renders earned + locked badges from evaluateAchievements', () => {
    expect(panel).toContain('evaluateAchievements');
    expect(panel).toContain('ach-badge--earned');
    expect(panel).toContain('ach-badge--locked');
    expect(panel).toContain("e ? a.icon : '🔒'");
    expect(panel).toContain('data-ach');
  });

  it('ProfileMenu adds an Achievements tab derived from the existing stat loadables', () => {
    expect(menu).toContain("label: t('profile.achievements')");
    expect(menu).toContain('<AchievementsPanel');
    expect(menu).toContain("tab === 'achievements'");
    // No new fetch route — it reuses the four stat loaders already present.
    expect(menu).not.toContain('fetchAchievements');
    expect(menu).not.toMatch(/['"]\/api\/[a-z/]*achievements/);
  });

  it('feeds Tarneeb SOLO into achievements from its OWN state (Stage 28.6), keeping Pairs canonical', () => {
    // allStats.tarneebSolo comes from the separate solo state — the Pairs `tarneeb`
    // source (used by All-Rounder + pair badges) is unchanged.
    expect(menu).toContain('tarneebSolo: dataOf(tarneebSoloStats)');
    expect(menu).toContain('tarneeb: dataOf(tarneebStats)');
    // The Achievements tab loads the solo dimension (once) so the badge can unlock.
    expect(menu).toContain('void loadTarneebSoloStats()');
    // Achievements wait for the solo load to resolve too.
    expect(menu).toMatch(/allResolved =[^\n]*tarneebSoloStats/);
  });
});

describe('groupAchievements (Stage 36.0 — UI grouping is pure & display-only)', () => {
  it('buckets by game (no gameType → global), in canonical order, with per-group counts', () => {
    // King has 1 win + 12 played → king-winner, king-regular earned (3 king badges total);
    // plus first-win (global). Nothing else won/played.
    const s: AllStats = { ...zero(), king: king({ gamesWon: 1, gamesPlayed: 12 }) };
    const rows = evaluateAchievements(s);
    const groups = groupAchievements(rows);
    // canonical order, only non-empty groups (every catalog game has ≥1 badge → all present)
    expect(groups.map((g) => g.key)).toEqual(
      ['global', 'king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one', 'poker'],
    );
    const king_ = groups.find((g) => g.key === 'king')!;
    expect(king_.total).toBe(7);           // + king-perfect-negatives, king-trump-sweep, king-trump-fewest (Stage 37.3)
    expect(king_.earned).toBe(2);          // winner (≥1 win) + regular (≥10 played); no new telemetry earned
    expect(king_.rows.every((r) => r.achievement.gameType === 'king')).toBe(true);
    // global bucket holds only cross-game (no gameType) badges
    const global = groups.find((g) => g.key === 'global')!;
    expect(global.rows.every((r) => r.achievement.gameType === undefined)).toBe(true);
    expect(global.earned).toBe(1);         // first-win only
  });

  it('the sum of every group total equals the whole catalog (no badge lost or duplicated)', () => {
    const rows = evaluateAchievements(zero());
    const groups = groupAchievements(rows);
    expect(groups.reduce((n, g) => n + g.total, 0)).toBe(ACHIEVEMENTS.length);
    // and per-group earned sums to the global earned count — grouping never changes earned
    const s: AllStats = { ...zero(), king: king({ gamesWon: 1, gamesPlayed: 12 }) };
    const rows2 = evaluateAchievements(s);
    expect(groupAchievements(rows2).reduce((n, g) => n + g.earned, 0)).toBe(earnedCount(rows2));
  });

  it('every group key has a segment label in the i18n dictionary', () => {
    for (const g of groupAchievements(evaluateAchievements(zero()))) {
      const key = g.key === 'global' ? 'ach.group.global' : `gameType.${g.key}`;
      expect(EN[key as keyof typeof EN], `missing label for ${g.key}`).toBeTruthy();
    }
    expect(EN['ach.filter.all']).toBeTruthy();
  });
});
