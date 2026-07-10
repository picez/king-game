import { useI18n } from '../../i18n';
import { evaluateAchievements, earnedCount, type AllStats } from '../../stats/achievements';

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

/**
 * Achievements / badges (Stage 16.0) — a compact grid derived entirely from the
 * public per-game stats. Earned badges show their emoji in gold; locked ones show
 * a muted padlock with the same title/description so the goal is always visible.
 * No DB writes, no popups — a read-only overview.
 */
export default function AchievementsPanel({ stats, loading, needsSignIn, seen = [] }: Props) {
  const { t } = useI18n();

  if (loading) return <p className="stats-msg">{t('net.connecting')}…</p>;

  const rows = evaluateAchievements(stats);
  const earned = earnedCount(rows);
  const seenSet = new Set(seen);

  return (
    <div className="ach-panel">
      {needsSignIn && (
        <div className="stats-msg stats-msg--soft ach-signin">
          <p>{t('stats.signInPrompt')}</p>
          <p className="setup-hint">{t('stats.signInHint')}</p>
        </div>
      )}

      <div className="ach-head">
        <span className="ach-head__count">{earned}/{rows.length}</span>
        <span className="ach-head__label">{t('ach.progress')}</span>
      </div>

      <div className="ach-grid">
        {rows.map(({ achievement: a, earned: e }) => {
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

      {earned === 0 && !needsSignIn && (
        <p className="stats-msg stats-msg--soft ach-empty">{t('ach.emptyLocked')}</p>
      )}
    </div>
  );
}
