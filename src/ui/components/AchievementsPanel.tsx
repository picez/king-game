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

/** A tiny emoji per group for the compact filter chip (Stage 37.0). */
const GROUP_ICON: Record<AchievementGroupKey, string> = {
  global: '🏆', king: '👑', durak: '🃏', deberc: '🎴', tarneeb: '♠️', preferans: '🎩', 'fifty-one': '🀄',
};

/** Segment label — 'global' has its own key; a game key reuses gameType.*. */
function groupLabelKey(g: AchievementGroupKey): string {
  return g === 'global' ? 'ach.group.global' : `gameType.${g}`;
}

/**
 * Achievements / badges (Stage 16.0; grouped by game in Stage 36.0, polished in 37.0).
 * A compact grid derived entirely from the public per-game stats — the earned/locked
 * logic, All-Rounder and the totals are unchanged. A styled chip strip (**Global** and
 * each game) filters the grid so the badges are browsed one group at a time; each chip
 * shows its game icon + its own earned/total. There is no "All" tab — the owner's ask
 * was to implement the full requested badge *pack* (Stage 37.3), not a combined tab;
 * the header still reports the global earned/total across every badge. The strip scrolls
 * horizontally inside itself (styled), so on 360/390 and Arabic RTL the page never
 * overflows. No DB writes, no popups.
 */
export default function AchievementsPanel({ stats, loading, needsSignIn, seen = [] }: Props) {
  const { t } = useI18n();
  // Default to the first group (Global). The full badge set is reached by tabbing
  // through the game groups, not a single "All" tab (Stage 37.3 owner correction).
  const [filter, setFilter] = useState<AchievementGroupKey>('global');

  if (loading) return <p className="stats-msg">{t('net.connecting')}…</p>;

  const rows = evaluateAchievements(stats);
  const totalEarned = earnedCount(rows);
  const groups = groupAchievements(rows);
  const seenSet = new Set(seen);

  // The active group (fall back to the first if the default ever isn't present).
  const active = groups.find((g) => g.key === filter) ?? groups[0];
  const shown = active ? active.rows : rows;

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

      {/* Filter chips — one per group (Global + each game), no "All". Styled horizontal
          scroll (see stats.css .ach-segments), so 360/390 + RTL never overflow the page. */}
      <div className="ach-segments" role="tablist" aria-label={t('ach.filterLabel')}>
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={(active?.key ?? filter) === g.key}
            data-seg={g.key}
            className={`ach-segment ${(active?.key ?? filter) === g.key ? 'ach-segment--active' : ''}`}
            onClick={() => setFilter(g.key)}
          >
            <span className="ach-segment__icon" aria-hidden="true">{GROUP_ICON[g.key]}</span>
            <span className="ach-segment__label">{t(groupLabelKey(g.key))}</span>
            <span className="ach-segment__count">{g.earned}/{g.total}</span>
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
