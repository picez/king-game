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
import type { KingStats, DurakStats, DebercStats, TarneebStats, PreferansStats, FiftyOneStats } from '../net/statsApi';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';

/**
 * A combined snapshot of the user's per-game stats. Any game may be `null` when
 * its stats haven't loaded / aren't available (no session, DB off, error) — the
 * evaluators treat that as "no progress", so badges for it stay locked.
 */
export interface AllStats {
  king: KingStats | null;
  durak: DurakStats | null;
  deberc: DebercStats | null;
  /** Canonical Tarneeb (PAIRS) stats — the source for every existing Tarneeb badge
   *  and for the cross-game aggregates (All-Rounder etc.). */
  tarneeb: TarneebStats | null;
  preferans: PreferansStats | null;
  /** 51 / Syrian 51 stats (Stage 30.7 — the 6th released game). A canonical member
   *  of the cross-game aggregates (totalWins / totalGames / wonEveryGame). Missing → locked. */
  fiftyOne: FiftyOneStats | null;
  /**
   * Tarneeb SOLO stats (Stage 28.6) — a SEPARATE, optional dimension (game_type
   * 'tarneeb-solo'). Only the dedicated solo badge reads it; it is intentionally
   * excluded from `totalWins` / `totalGames` / `wonEveryGame`, so Solo is never
   * required for All-Rounder and the existing badges are unchanged. Missing → locked.
   */
  tarneebSolo?: TarneebStats | null;
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

/** The six King NEGATIVE round modes (everything except Trump). A negative mode's
 *  per-mode `totalScore` is only ever ≤ 0 (penalties), so a value < 0 means the
 *  player conceded points in that mode across their games (Stage 37.0). */
export const KING_NEGATIVE_MODES = [
  'no_tricks', 'no_hearts', 'no_jacks', 'no_queens', 'king_of_hearts', 'last_two_tricks',
] as const;

/** Total wins across every game (0 when nothing loaded). */
export function totalWins(a: AllStats): number {
  return won(a.king) + won(a.durak) + won(a.deberc) + won(a.tarneeb) + won(a.preferans) + won(a.fiftyOne);
}
/** Total games played across every game (0 when nothing loaded). */
export function totalGames(a: AllStats): number {
  return played(a.king) + played(a.durak) + played(a.deberc) + played(a.tarneeb) + played(a.preferans) + played(a.fiftyOne);
}
/** True only when the user has at least one win in EVERY game (all six, all loaded). */
function wonEveryGame(a: AllStats): boolean {
  return won(a.king) >= 1 && won(a.durak) >= 1 && won(a.deberc) >= 1
    && won(a.tarneeb) >= 1 && won(a.preferans) >= 1 && won(a.fiftyOne) >= 1;
}

/** True when the user has PLAYED at least one game of every canonical game (Stage 32.1). */
function playedEveryGame(a: AllStats): boolean {
  return played(a.king) >= 1 && played(a.durak) >= 1 && played(a.deberc) >= 1
    && played(a.tarneeb) >= 1 && played(a.preferans) >= 1 && played(a.fiftyOne) >= 1;
}

/** Whether a game's contract-success is ≥ `pct` over a MINIMUM decided sample (anti-fluke). */
function contractSkill(
  s: { contractsMade: number; contractsFailed: number; contractSuccessRate: number | null } | null,
  pct: number, minDecided: number,
): boolean {
  if (!s) return false;
  const decided = s.contractsMade + s.contractsFailed;
  return decided >= minDecided && (s.contractSuccessRate ?? 0) >= pct;
}

// ── the catalog (34 badges: original 14 + Stage 32.1 (+15) + Stage 37.0 (+5)) ──
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
    id: 'preferans-declarer', titleKey: 'ach.preferansDeclarer.title', descriptionKey: 'ach.preferansDeclarer.desc',
    icon: '🎩', gameType: 'preferans', rarity: 'common', evaluate: (s) => (s.preferans ? s.preferans.handsAsDeclarer : 0) >= 1,
  },
  {
    // 51 / Syrian 51 cutthroat-rummy win (Stage 30.7) — a win empties your hand first.
    id: 'fifty-one-winner', titleKey: 'ach.fiftyOneWinner.title', descriptionKey: 'ach.fiftyOneWinner.desc',
    icon: '🀄', gameType: 'fifty-one', rarity: 'common', evaluate: (s) => won(s.fiftyOne) >= 1,
  },
  {
    id: 'tarneeb-contractor', titleKey: 'ach.tarneebContractor.title', descriptionKey: 'ach.tarneebContractor.desc',
    icon: '🤝', gameType: 'tarneeb', rarity: 'rare', evaluate: (s) => (s.tarneeb ? s.tarneeb.contractsMade : 0) >= 5,
  },
  {
    // Solo cutthroat win (Stage 28.6) — reads ONLY the separate solo dimension, so it
    // never affects the Pairs badges or All-Rounder. Locked until a solo win lands.
    id: 'tarneeb-soloist', titleKey: 'ach.tarneebSoloist.title', descriptionKey: 'ach.tarneebSoloist.desc',
    icon: '🗡️', gameType: 'tarneeb', rarity: 'common', evaluate: (s) => won(s.tarneebSolo ?? null) >= 1,
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

  // ── Stage 32.1 expansion (ACHIEVEMENTS_PLAN.md §4) — 15 derived badges ──────
  // Global
  {
    id: 'six-game-regular', titleKey: 'ach.sixGameRegular.title', descriptionKey: 'ach.sixGameRegular.desc',
    icon: '🎲', rarity: 'uncommon', evaluate: playedEveryGame,
  },
  {
    id: 'champions-circle', titleKey: 'ach.championsCircle.title', descriptionKey: 'ach.championsCircle.desc',
    icon: '🏆', rarity: 'rare', evaluate: (s) => totalWins(s) >= 25,
  },
  // King
  {
    id: 'king-regular', titleKey: 'ach.kingRegular.title', descriptionKey: 'ach.kingRegular.desc',
    icon: '♚', gameType: 'king', rarity: 'common', evaluate: (s) => played(s.king) >= 10,
  },
  {
    id: 'king-champion', titleKey: 'ach.kingChampion.title', descriptionKey: 'ach.kingChampion.desc',
    icon: '🏰', gameType: 'king', rarity: 'rare', evaluate: (s) => won(s.king) >= 10,
  },
  // Durak
  {
    id: 'durak-defender', titleKey: 'ach.durakDefender.title', descriptionKey: 'ach.durakDefender.desc',
    icon: '🛡️', gameType: 'durak', rarity: 'uncommon', evaluate: (s) => won(s.durak) >= 5,
  },
  {
    id: 'durak-regular', titleKey: 'ach.durakRegular.title', descriptionKey: 'ach.durakRegular.desc',
    icon: '🔁', gameType: 'durak', rarity: 'common', evaluate: (s) => played(s.durak) >= 10,
  },
  // Deberc — fills the missing basic Deberc win badge, plus a combination-depth badge.
  {
    id: 'deberc-winner', titleKey: 'ach.debercWinner.title', descriptionKey: 'ach.debercWinner.desc',
    icon: '🏵️', gameType: 'deberc', rarity: 'common', evaluate: (s) => won(s.deberc) >= 1,
  },
  {
    id: 'deberc-terz-collector', titleKey: 'ach.debercTerzCollector.title', descriptionKey: 'ach.debercTerzCollector.desc',
    icon: '📇', gameType: 'deberc', rarity: 'uncommon', evaluate: (s) => (s.deberc ? s.deberc.combinations.terz : 0) >= 10,
  },
  // Tarneeb (PAIRS — canonical `tarneeb`, never the separate solo dimension).
  {
    id: 'tarneeb-winner', titleKey: 'ach.tarneebWinner.title', descriptionKey: 'ach.tarneebWinner.desc',
    icon: '♠️', gameType: 'tarneeb', rarity: 'common', evaluate: (s) => won(s.tarneeb) >= 1,
  },
  {
    id: 'tarneeb-sharp-bidder', titleKey: 'ach.tarneebSharpBidder.title', descriptionKey: 'ach.tarneebSharpBidder.desc',
    icon: '🎯', gameType: 'tarneeb', rarity: 'rare', evaluate: (s) => contractSkill(s.tarneeb, 70, 10),
  },
  // Preferans — fills the missing basic Preferans win badge, plus a contract-volume badge.
  {
    id: 'preferans-winner', titleKey: 'ach.preferansWinner.title', descriptionKey: 'ach.preferansWinner.desc',
    icon: '🏅', gameType: 'preferans', rarity: 'common', evaluate: (s) => won(s.preferans) >= 1,
  },
  {
    id: 'preferans-contract-regular', titleKey: 'ach.preferansContractRegular.title', descriptionKey: 'ach.preferansContractRegular.desc',
    icon: '📜', gameType: 'preferans', rarity: 'uncommon', evaluate: (s) => (s.preferans ? s.preferans.contractsMade : 0) >= 10,
  },
  // 51
  {
    id: 'fifty-one-regular', titleKey: 'ach.fiftyOneRegular.title', descriptionKey: 'ach.fiftyOneRegular.desc',
    icon: '🧧', gameType: 'fifty-one', rarity: 'common', evaluate: (s) => played(s.fiftyOne) >= 10,
  },
  {
    id: 'fifty-one-champion', titleKey: 'ach.fiftyOneChampion.title', descriptionKey: 'ach.fiftyOneChampion.desc',
    icon: '🏮', gameType: 'fifty-one', rarity: 'rare', evaluate: (s) => won(s.fiftyOne) >= 5,
  },
  {
    // bestPenalty is the LOWEST final running penalty across games (lower is better).
    id: 'fifty-one-low-penalty', titleKey: 'ach.fiftyOneLowPenalty.title', descriptionKey: 'ach.fiftyOneLowPenalty.desc',
    icon: '🧊', gameType: 'fifty-one', rarity: 'uncommon',
    evaluate: (s) => s.fiftyOne != null && s.fiftyOne.bestPenalty != null && s.fiftyOne.bestPenalty <= 50,
  },

  // ── Stage 37.0 — new badges DERIVED FROM EXISTING STATS (no new fields) ──────
  {
    // Comedy: conceded points in EVERY one of the six King negative rounds — a
    // negative mode's per-mode total is < 0 only if you took a penalty there.
    id: 'king-all-negatives', titleKey: 'ach.kingAllNegatives.title', descriptionKey: 'ach.kingAllNegatives.desc',
    icon: '🙈', gameType: 'king', rarity: 'uncommon',
    evaluate: (s) => {
      const mb = s.king?.modeBreakdown;
      return !!mb && KING_NEGATIVE_MODES.every((m) => (mb[m]?.totalScore ?? 0) < 0);
    },
  },
  {
    // Платина (Deberc's four-in-a-row) is the rarest sequence — collect a few.
    id: 'deberc-platina-collector', titleKey: 'ach.debercPlatinaCollector.title', descriptionKey: 'ach.debercPlatinaCollector.desc',
    icon: '🎼', gameType: 'deberc', rarity: 'rare',
    evaluate: (s) => (s.deberc ? s.deberc.combinations.platina : 0) >= 3,
  },
  {
    // A single hand with 2+ combinations: total melds exceed the count of
    // hands-with-a-meld, so by pigeonhole one hand held more than one (Stage 37.0).
    id: 'deberc-multi-meld', titleKey: 'ach.debercMultiMeld.title', descriptionKey: 'ach.debercMultiMeld.desc',
    icon: '🎰', gameType: 'deberc', rarity: 'uncommon',
    evaluate: (s) => {
      const c = s.deberc?.combinations;
      return !!c && c.handsWithMeld >= 1 && c.total > c.handsWithMeld;
    },
  },
  {
    // Comedy: finished a game with a NEGATIVE team total (worst final ≤ -1). Pairs
    // only — `tarneeb` is the canonical Pairs source (solo is never mixed in).
    id: 'tarneeb-negative-game', titleKey: 'ach.tarneebNegativeGame.title', descriptionKey: 'ach.tarneebNegativeGame.desc',
    icon: '📉', gameType: 'tarneeb', rarity: 'uncommon',
    evaluate: (s) => s.tarneeb != null && s.tarneeb.worstGameScore != null && s.tarneeb.worstGameScore < 0,
  },
  {
    // Comedy: declared at least 3 hands and made NONE of them — every bid went down.
    id: 'tarneeb-all-bids-down', titleKey: 'ach.tarneebAllBidsDown.title', descriptionKey: 'ach.tarneebAllBidsDown.desc',
    icon: '🤡', gameType: 'tarneeb', rarity: 'uncommon',
    evaluate: (s) => s.tarneeb != null && s.tarneeb.contractsMade === 0 && s.tarneeb.contractsFailed >= 3,
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

// ── grouping for the Profile UI (Stage 36.0 — filter by game) ────────────────
// PURE and display-only: it re-buckets the SAME evaluated rows by their `gameType`
// (cross-game badges → 'global'). It NEVER changes earned/locked, All-Rounder, or
// the totals — those still come from evaluateAchievements over the full stat set.

/** A filter segment: cross-game badges ('global') or one game. */
export type AchievementGroupKey = 'global' | GameType;

/** Canonical segment order shown in the Profile (Global first, then the six games). */
export const ACHIEVEMENT_GROUP_ORDER: readonly AchievementGroupKey[] = [
  'global', 'king', 'durak', 'deberc', 'tarneeb', 'preferans', 'fifty-one',
] as const;

export interface AchievementGroup {
  key: AchievementGroupKey;
  rows: AchievementProgress[];
  earned: number;
  total: number;
}

/**
 * Bucket evaluated rows by game (a badge with no `gameType` is 'global'), in the
 * canonical order, skipping empty groups. Per-group earned/total lets the UI show
 * progress inside each game without touching the global count.
 */
export function groupAchievements(rows: AchievementProgress[]): AchievementGroup[] {
  const byKey = new Map<AchievementGroupKey, AchievementProgress[]>();
  for (const r of rows) {
    const key: AchievementGroupKey = r.achievement.gameType ?? 'global';
    const bucket = byKey.get(key);
    if (bucket) bucket.push(r); else byKey.set(key, [r]);
  }
  return ACHIEVEMENT_GROUP_ORDER.filter((k) => byKey.has(k)).map((key) => {
    const g = byKey.get(key)!;
    return { key, rows: g, earned: earnedCount(g), total: g.length };
  });
}
