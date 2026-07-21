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

/** UI filter for the chip strip: the whole catalog ('all') or one group (Global /
 *  a game). Kept SEPARATE from AchievementGroupKey so 'all' never leaks into the
 *  grouping/earned logic — it only selects which rows the grid renders (Stage 37.2). */
type AchievementFilter = 'all' | AchievementGroupKey;

/** A tiny emoji per filter chip (Stage 37.0; 'all' added back in 37.2). */
const GROUP_ICON: Record<AchievementFilter, string> = {
  all: '🗂️', global: '🏆', king: '👑', durak: '🃏', deberc: '🎴', tarneeb: '♠️', preferans: '🎩', 'fifty-one': '🀄',
};

/** Chip label — 'all' and 'global' have their own keys; a game key reuses gameType.*. */
function filterLabelKey(f: AchievementFilter): string {
  if (f === 'all') return 'ach.filter.all';
  return f === 'global' ? 'ach.group.global' : `gameType.${f}`;
}

/**
 * Achievements / badges (Stage 16.0; grouped by game in Stage 36.0, polished in 37.0,
 * "All" restored in 37.2). A compact grid derived entirely from the public per-game
 * stats — the earned/locked logic, All-Rounder and the totals are unchanged. A styled
 * chip strip filters the grid: the first chip **All** shows the full catalog (default),
 * then **Global** and each game show just their bucket; every chip carries its own
 * earned/total. The strip scrolls horizontally inside itself (styled), so on 360/390 and
 * Arabic RTL the page never overflows. No DB writes, no popups.
 */
export default function AchievementsPanel({ stats, loading, needsSignIn, seen = [] }: Props) {
  const { t } = useI18n();
  // Default to "All" — the full catalog of every badge (earned + locked) (Stage 37.2).
  const [filter, setFilter] = useState<AchievementFilter>('all');

  if (loading) return <p className="stats-msg">{t('net.connecting')}…</p>;

  const rows = evaluateAchievements(stats);
  const totalEarned = earnedCount(rows);
  const groups = groupAchievements(rows);
  const seenSet = new Set(seen);

  // Chip strip: an "All" chip (whole catalog) followed by each group, each with its
  // own earned/total. "All" carries the global earned/total so it mirrors the header.
  const segments: Array<{ key: AchievementFilter; earned: number; total: number }> = [
    { key: 'all', earned: totalEarned, total: rows.length },
    ...groups.map((g) => ({ key: g.key, earned: g.earned, total: g.total })),
  ];

  // The rows the grid renders: the full catalog for 'all', otherwise the active group
  // (falling back to the whole catalog if a game filter ever has no bucket).
  const activeGroup = filter === 'all' ? null : groups.find((g) => g.key === filter);
  const shown = filter === 'all' ? rows : (activeGroup ? activeGroup.rows : rows);

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

      {/* Filter chips — "All" first (full catalog), then Global + each game. Styled
          horizontal scroll (see stats.css .ach-segments), so 360/390 + RTL never
          overflow the page. */}
      <div className="ach-segments" role="tablist" aria-label={t('ach.filterLabel')}>
        {segments.map((seg) => (
          <button
            key={seg.key}
            type="button"
            role="tab"
            aria-selected={filter === seg.key}
            data-seg={seg.key}
            className={`ach-segment ${filter === seg.key ? 'ach-segment--active' : ''}`}
            onClick={() => setFilter(seg.key)}
          >
            <span className="ach-segment__icon" aria-hidden="true">{GROUP_ICON[seg.key]}</span>
            <span className="ach-segment__label">{t(filterLabelKey(seg.key))}</span>
            <span className="ach-segment__count">{seg.earned}/{seg.total}</span>
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
