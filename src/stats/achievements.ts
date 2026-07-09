// ---------------------------------------------------------------------------
// Achievements / player badges (Stage 16.0) — a PURE, derived-from-stats catalog.
//
// Every badge is computed on the client from the same read-only per-game stats
// the Profile already fetches (KingStats / DurakStats / DebercStats / TarneebStats).
// There is NO new DB column, no server route, no write path, and nothing based on
// private/card-level or ephemeral social data — a badge is just a boolean over the
// public aggregate counters. Missing/unloaded stats degrade to "locked" (false).
//
// This is the foundation only: no real-time unlock popups in this stage.
// ---------------------------------------------------------------------------

import type { GameType } from '../games/catalog';
import type { KingStats, DurakStats, DebercStats, TarneebStats } from '../net/statsApi';

export type Rarity = 'common' | 'rare' | 'epic';

/**
 * A combined snapshot of the user's per-game stats. Any game may be `null` when
 * its stats haven't loaded / aren't available (no session, DB off, error) — the
 * evaluators treat that as "no progress", so badges for it stay locked.
 */
export interface AllStats {
  king: KingStats | null;
  durak: DurakStats | null;
  deberc: DebercStats | null;
  tarneeb: TarneebStats | null;
}

export interface Achievement {
  /** Stable unique id (kebab-case); also the CSS / test handle. */
  id: string;
  titleKey: string;
  descriptionKey: string;
  /** Decorative emoji glyph (no image asset added this stage). */
  icon: string;
  /** Optional game scope; omitted for cross-game (aggregate) badges. */
  gameType?: GameType;
  rarity: Rarity;
  /** Pure predicate over the combined stats; MUST be null-safe. */
  evaluate: (s: AllStats) => boolean;
}

export interface AchievementProgress {
  achievement: Achievement;
  earned: boolean;
}

// ── null-safe aggregate helpers ──────────────────────────────────────────────
const won = (s: { gamesWon: number } | null): number => (s ? s.gamesWon : 0);
const played = (s: { gamesPlayed: number } | null): number => (s ? s.gamesPlayed : 0);

/** Total wins across every game (0 when nothing loaded). */
export function totalWins(a: AllStats): number {
  return won(a.king) + won(a.durak) + won(a.deberc) + won(a.tarneeb);
}
/** Total games played across every game (0 when nothing loaded). */
export function totalGames(a: AllStats): number {
  return played(a.king) + played(a.durak) + played(a.deberc) + played(a.tarneeb);
}
/** True only when the user has at least one win in EVERY game (all loaded). */
function wonEveryGame(a: AllStats): boolean {
  return won(a.king) >= 1 && won(a.durak) >= 1 && won(a.deberc) >= 1 && won(a.tarneeb) >= 1;
}

// ── the catalog (11 badges, spread across games + rarities) ──────────────────
export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first-win', titleKey: 'ach.firstWin.title', descriptionKey: 'ach.firstWin.desc',
    icon: '🥇', rarity: 'common', evaluate: (s) => totalWins(s) >= 1,
  },
  {
    id: 'veteran', titleKey: 'ach.veteran.title', descriptionKey: 'ach.veteran.desc',
    icon: '🎖️', rarity: 'rare', evaluate: (s) => totalGames(s) >= 25,
  },
  {
    id: 'centurion', titleKey: 'ach.centurion.title', descriptionKey: 'ach.centurion.desc',
    icon: '💯', rarity: 'epic', evaluate: (s) => totalGames(s) >= 100,
  },
  {
    id: 'all-rounder', titleKey: 'ach.allRounder.title', descriptionKey: 'ach.allRounder.desc',
    icon: '🌟', rarity: 'epic', evaluate: wonEveryGame,
  },
  {
    id: 'king-winner', titleKey: 'ach.kingWinner.title', descriptionKey: 'ach.kingWinner.desc',
    icon: '👑', gameType: 'king', rarity: 'common', evaluate: (s) => won(s.king) >= 1,
  },
  {
    id: 'durak-survivor', titleKey: 'ach.durakSurvivor.title', descriptionKey: 'ach.durakSurvivor.desc',
    icon: '🃏', gameType: 'durak', rarity: 'common', evaluate: (s) => won(s.durak) >= 1,
  },
  {
    id: 'tarneeb-declarer', titleKey: 'ach.tarneebDeclarer.title', descriptionKey: 'ach.tarneebDeclarer.desc',
    icon: '📣', gameType: 'tarneeb', rarity: 'common', evaluate: (s) => (s.tarneeb ? s.tarneeb.handsAsDeclarer : 0) >= 1,
  },
  {
    id: 'tarneeb-contractor', titleKey: 'ach.tarneebContractor.title', descriptionKey: 'ach.tarneebContractor.desc',
    icon: '🤝', gameType: 'tarneeb', rarity: 'rare', evaluate: (s) => (s.tarneeb ? s.tarneeb.contractsMade : 0) >= 5,
  },
  {
    id: 'deberc-meld-maker', titleKey: 'ach.debercMeldMaker.title', descriptionKey: 'ach.debercMeldMaker.desc',
    icon: '🎴', gameType: 'deberc', rarity: 'rare', evaluate: (s) => (s.deberc ? s.deberc.combinations.total : 0) >= 10,
  },
  {
    id: 'deberc-bella', titleKey: 'ach.debercBella.title', descriptionKey: 'ach.debercBella.desc',
    icon: '💍', gameType: 'deberc', rarity: 'rare', evaluate: (s) => (s.deberc ? s.deberc.combinations.bella : 0) >= 1,
  },
  {
    id: 'deberc-jackpot', titleKey: 'ach.debercJackpot.title', descriptionKey: 'ach.debercJackpot.desc',
    icon: '💰', gameType: 'deberc', rarity: 'epic', evaluate: (s) => (s.deberc ? s.deberc.jackpotCount : 0) >= 1,
  },
] as const;

/** Evaluate every achievement against the combined stats, in catalog order. */
export function evaluateAchievements(s: AllStats): AchievementProgress[] {
  return ACHIEVEMENTS.map((achievement) => ({ achievement, earned: achievement.evaluate(s) }));
}

/** How many of the given progress rows are earned. */
export function earnedCount(rows: AchievementProgress[]): number {
  return rows.reduce((n, r) => n + (r.earned ? 1 : 0), 0);
}
