// ---------------------------------------------------------------------------
// Local solitaire stats (S2), per variant. Pure reducers + a tiny localStorage
// store. A game counts as PLAYED once it has a move; it ends as a win, or as a
// loss when the player leaves it (new deal / back to the hub) — that is what
// breaks a streak. S3 mirrors the wins to the server for leaderboards.
// ---------------------------------------------------------------------------

import { VARIANT_KEYS, type VariantKey } from './engine';

export interface VariantStats {
  played: number;
  won: number;
  streak: number;
  bestStreak: number;
  bestMs: number | null;
  bestMoves: number | null;
  /** Wins without a single undo / restart. */
  cleanWins: number;
  /** Wins without a hint. */
  noHintWins: number;
  dailyWins: number;
  /** Hearts: times you shot the moon. */
  moons: number;
}

export interface SolitaireStats {
  v: 1;
  variants: Partial<Record<VariantKey, VariantStats>>;
  /** variant → the last deal-of-the-day result. */
  daily: Partial<Record<VariantKey, { day: string; won: boolean; ms: number; moves: number }>>;
}

export const emptyVariant = (): VariantStats => ({
  played: 0, won: 0, streak: 0, bestStreak: 0, bestMs: null, bestMoves: null, cleanWins: 0, noHintWins: 0, dailyWins: 0, moons: 0,
});
export const emptyStats = (): SolitaireStats => ({ v: 1, variants: {}, daily: {} });
export const variantStats = (s: SolitaireStats, k: VariantKey): VariantStats => s.variants[k] ?? emptyVariant();

export interface GameResult {
  key: VariantKey;
  won: boolean;
  ms: number;
  moves: number;
  undos: number;
  hints: number;
  daily: string | null;
  /** Hearts: moons shot during the game. */
  moons?: number;
}

export function recordResult(stats: SolitaireStats, r: GameResult): SolitaireStats {
  const v = variantStats(stats, r.key);
  const next: VariantStats = r.won
    ? {
      ...v,
      played: v.played + 1,
      won: v.won + 1,
      streak: v.streak + 1,
      bestStreak: Math.max(v.bestStreak, v.streak + 1),
      bestMs: v.bestMs === null ? r.ms : Math.min(v.bestMs, r.ms),
      bestMoves: v.bestMoves === null ? r.moves : Math.min(v.bestMoves, r.moves),
      cleanWins: v.cleanWins + (r.undos === 0 ? 1 : 0),
      noHintWins: v.noHintWins + (r.hints === 0 ? 1 : 0),
      dailyWins: v.dailyWins + (r.daily ? 1 : 0),
    }
    : { ...v, played: v.played + 1, streak: 0 };
  next.moons = v.moons + Math.max(0, r.moons ?? 0);
  const daily = r.daily
    ? { ...stats.daily, [r.key]: { day: r.daily, won: r.won, ms: r.ms, moves: r.moves } }
    : stats.daily;
  return { ...stats, variants: { ...stats.variants, [r.key]: next }, daily };
}

/** Totals over all variants (hub header, achievements). */
export function totals(s: SolitaireStats): { played: number; won: number; variantsWon: number; bestStreak: number } {
  let played = 0, won = 0, variantsWon = 0, bestStreak = 0;
  for (const k of VARIANT_KEYS) {
    const v = s.variants[k];
    if (!v) continue;
    played += v.played; won += v.won; if (v.won > 0) variantsWon++;
    bestStreak = Math.max(bestStreak, v.bestStreak);
  }
  return { played, won, variantsWon, bestStreak };
}

export function parseStats(raw: unknown): SolitaireStats {
  if (!raw || typeof raw !== 'object' || (raw as SolitaireStats).v !== 1) return emptyStats();
  const r = raw as SolitaireStats;
  const out = emptyStats();
  for (const k of VARIANT_KEYS) {
    const v = r.variants?.[k];
    if (v && typeof v === 'object') out.variants[k] = { ...emptyVariant(), ...v };
    const d = r.daily?.[k];
    if (d && typeof d === 'object' && typeof d.day === 'string') out.daily[k] = d;
  }
  return out;
}

// ── storage ─────────────────────────────────────────────────────────────────

export const STATS_KEY = 'king.solitaire.stats.v1';
export const SAVED_KEY = 'king.solitaire.game.v1';

function store(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadStats(): SolitaireStats {
  try { return parseStats(JSON.parse(store()?.getItem(STATS_KEY) ?? 'null')); } catch { return emptyStats(); }
}
export function saveStats(s: SolitaireStats): void {
  try { store()?.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* quota / private mode */ }
}
export function loadSavedGame(): unknown {
  try { return JSON.parse(store()?.getItem(SAVED_KEY) ?? 'null'); } catch { return null; }
}
export function saveGame(g: unknown | null): void {
  try {
    if (g === null) store()?.removeItem(SAVED_KEY);
    else store()?.setItem(SAVED_KEY, JSON.stringify(g));
  } catch { /* quota / private mode */ }
}
