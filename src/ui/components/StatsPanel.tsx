import { useI18n } from '../../i18n';
import {
  type KingStats, type Loadable,
  formatSigned, formatLastPlayed, modeBreakdownRows,
} from '../../net/statsApi';

interface Props {
  /** null while the first request is in flight. */
  result: Loadable<KingStats> | null;
  loading: boolean;
}

/**
 * Presentational "My King stats" view. Renders only public, score-level data
 * from the stats API (win rate, averages, best/worst, trump/negative round
 * counts, per-mode breakdown); shows soft empty/auth/unavailable/error states so
 * it never blocks. Guests with a session see their stats normally (no login
 * wall). Tolerant of missing fields — an older/partial payload still renders.
 */
export default function StatsPanel({ result, loading }: Props) {
  const { t, lang } = useI18n();

  if (loading && !result) return <p className="stats-msg">{t('net.connecting')}…</p>;
  if (!result) return null;

  if (result.state === 'unauthenticated') {
    return (
      <div className="stats-msg stats-msg--soft">
        <p>{t('stats.signInPrompt')}</p>
        <p className="setup-hint">{t('stats.signInHint')}</p>
      </div>
    );
  }
  if (result.state === 'unavailable') return <p className="stats-msg">{t('stats.unavailable')}</p>;
  if (result.state === 'error') return <p className="stats-msg">{t('stats.error')}</p>;

  const s = result.data;
  if (s.gamesPlayed === 0) {
    return <p className="stats-msg stats-msg--soft">{t('stats.noGames')}</p>;
  }

  const lastPlayed = formatLastPlayed(s.lastGameAt, lang);
  const modeRows = modeBreakdownRows(s.modeBreakdown);

  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: t('stats.gamesPlayed'), value: String(s.gamesPlayed) },
    { label: t('stats.winRate'), value: s.winRate == null ? '—' : `${s.winRate}%`, sub: `${s.gamesWon}–${s.gamesLost}` },
    { label: t('stats.roundsPlayed'), value: String(s.roundsPlayed) },
    { label: t('stats.avgScore'), value: formatSigned(s.averageScore) },
    { label: t('stats.bestScore'), value: formatSigned(s.bestScore) },
    { label: t('stats.worstScore'), value: formatSigned(s.worstScore) },
    { label: t('stats.trumpRounds'), value: String(s.trumpRoundsPlayed) },
    { label: t('stats.negativeRounds'), value: String(s.negativeRoundsPlayed) },
  ];

  return (
    <div className="stats-panel">
      <div className="stats-grid">
        {cards.map((c) => (
          <div className="stat-card" key={c.label}>
            <span className="stat-card__value">{c.value}</span>
            <span className="stat-card__label">{c.label}</span>
            {c.sub && <span className="stat-card__sub">{c.sub}</span>}
          </div>
        ))}
      </div>

      {lastPlayed && (
        <p className="stats-lastgame">{t('stats.lastGame')}: <strong>{lastPlayed}</strong></p>
      )}

      {modeRows.length > 0 && (
        <div className="stats-modes">
          <h4 className="stats-modes__title">{t('stats.byMode')}</h4>
          <ul className="stats-modes__list">
            {modeRows.map((r) => (
              <li className="stats-mode-row" key={r.modeId}>
                <span className="stats-mode-row__name">{t(`mode.${r.modeId}`)}</span>
                <span className="stats-mode-row__meta">
                  <span className="stats-mode-row__rounds">{r.rounds}×</span>
                  <span className={`stats-mode-row__pts ${r.totalScore >= 0 ? 'is-pos' : 'is-neg'}`}>
                    {formatSigned(r.totalScore)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
