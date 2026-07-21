import { useState } from 'react';
import { useI18n } from '../../i18n';
import {
  evaluateAchievements, earnedCount, groupAchievements,
  type AllStats, type AchievementGroupKey,
} from '../../stats/achievements';

interface Props {
  /** Combined per-game stats; any game null = not loaded → its badges stay locked. */
  stats: AllStats;
  /** True while the first fetch of the four stat sets is still in flight. */
  loading: boolean;
  /** True when every stat set came back unauthenticated (no session yet). */
  needsSignIn: boolean;
  /** Achievement ids already announced to the user; earned-but-unseen get a "New" chip. */
  seen?: readonly string[];
}

type Filter = 'all' | AchievementGroupKey;

/** Segment label — 'all'/'global' have their own keys; a game key reuses gameType.*. */
function filterLabelKey(f: Filter): string {
  if (f === 'all') return 'ach.filter.all';
  if (f === 'global') return 'ach.group.global';
  return `gameType.${f}`;
}

/**
 * Achievements / badges (Stage 16.0; grouped by game in Stage 36.0). A compact grid
 * derived entirely from the public per-game stats — earned/locked logic, All-Rounder
 * and totals are unchanged. A segment bar (All · Global · each game) filters the grid
 * so 29 badges are browsable per game instead of one big wall; each segment shows its
 * own earned/total. No DB writes, no popups — a read-only overview.
 */
export default function AchievementsPanel({ stats, loading, needsSignIn, seen = [] }: Props) {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>('all');

  if (loading) return <p className="stats-msg">{t('net.connecting')}…</p>;

  const rows = evaluateAchievements(stats);
  const totalEarned = earnedCount(rows);
  const groups = groupAchievements(rows);
  const seenSet = new Set(seen);

  // The rows to show: all, or one group's. (Falling back to `rows` keeps the panel
  // sane if a selected group ever has no badges — it never does today.)
  const shown = filter === 'all' ? rows : (groups.find((g) => g.key === filter)?.rows ?? rows);

  // The segment strip: All first, then each non-empty group, each with its e/t count.
  const segments: { key: Filter; earned: number; total: number }[] = [
    { key: 'all', earned: totalEarned, total: rows.length },
    ...groups.map((g) => ({ key: g.key as Filter, earned: g.earned, total: g.total })),
  ];

  return (
    <div className="ach-panel">
      {needsSignIn && (
        <div className="stats-msg stats-msg--soft ach-signin">
          <p>{t('stats.signInPrompt')}</p>
          <p className="setup-hint">{t('stats.signInHint')}</p>
        </div>
      )}

      <div className="ach-head">
        <span className="ach-head__count">{totalEarned}/{rows.length}</span>
        <span className="ach-head__label">{t('ach.progress')}</span>
      </div>

      {/* Filter segments — horizontally scrollable on mobile, RTL-safe (in-flow flex). */}
      <div className="ach-segments" role="tablist" aria-label={t('ach.filterLabel')}>
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={filter === s.key}
            data-seg={s.key}
            className={`ach-segment ${filter === s.key ? 'ach-segment--active' : ''}`}
            onClick={() => setFilter(s.key)}
          >
            <span className="ach-segment__label">{t(filterLabelKey(s.key))}</span>
            <span className="ach-segment__count">{s.earned}/{s.total}</span>
          </button>
        ))}
      </div>

      <div className="ach-grid">
        {shown.map(({ achievement: a, earned: e }) => {
          const isNew = e && !seenSet.has(a.id);
          return (
            <div
              key={a.id}
              data-ach={a.id}
              className={`ach-badge ach-badge--${a.rarity} ${e ? 'ach-badge--earned' : 'ach-badge--locked'}${isNew ? ' ach-badge--new' : ''}`}
            >
              {isNew && <span className="ach-badge__new">{t('ach.new')}</span>}
              <span className="ach-badge__icon" aria-hidden="true">{e ? a.icon : '🔒'}</span>
              <span className="ach-badge__title">{t(a.titleKey)}</span>
              <span className="ach-badge__desc">{t(a.descriptionKey)}</span>
            </div>
          );
        })}
      </div>

      {totalEarned === 0 && !needsSignIn && (
        <p className="stats-msg stats-msg--soft ach-empty">{t('ach.emptyLocked')}</p>
      )}
    </div>
  );
}
