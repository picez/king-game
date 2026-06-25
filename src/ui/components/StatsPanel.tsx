import { useI18n } from '../../i18n';
import {
  type KingStats, type Loadable,
  winRatePct, averageScore, formatSigned, formatLastPlayed, modeBreakdownRows,
} from '../../net/statsApi';

interface Props {
  /** null while the first request is in flight. */
  result: Loadable<KingStats> | null;
  loading: boolean;
}

/**
 * Presentational "My King stats" view. Renders only public, score-level data
 * from the Stage 5 API; shows soft empty/auth/unavailable/error states so it
 * never blocks. Guests with a session see their stats normally (no login wall).
 */
export default function StatsPanel({ result, loading }: Props) {
  const { t, lang } = useI18n();

  if (loading && !result) {
    return <p className="stats-msg">{t('net.connecting')}…</p>;
  }
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

  const rate = winRatePct(s.gamesWon, s.gamesPlayed);
  const avg = averageScore(s.totalScore, s.gamesPlayed);
  const lastPlayed = formatLastPlayed(s.lastPlayedAt, lang);
  const modeRows = modeBreakdownRows(s.modeBreakdown);

  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: t('stats.gamesPlayed'), value: String(s.gamesPlayed) },
    { label: t('stats.wins'), value: String(s.gamesWon), sub: `${s.gamesWon}–${s.gamesLost}` },
    { label: t('stats.winRate'), value: rate == null ? '—' : `${rate}%` },
    { label: t('stats.roundsPlayed'), value: String(s.roundsPlayed) },
    { label: t('stats.avgScore'), value: formatSigned(avg) },
    { label: t('stats.bestScore'), value: formatSigned(s.bestGameScore) },
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
        <p className="stats-lastgame">
          {t('stats.lastGame')}: <strong>{lastPlayed}</strong>
        </p>
      )}

      {modeRows.length > 0 && (
        <div className="stats-modes">
          <h4 className="stats-modes__title">{t('stats.byMode')}</h4>
          <ul className="stats-modes__list">
            {modeRows.map((r) => (
              <li className="stats-mode-row" key={r.modeId}>
                <span className="stats-mode-row__name">{t(`mode.${r.modeId}`)}</span>
                <span className={`stats-mode-row__pts ${r.points >= 0 ? 'is-pos' : 'is-neg'}`}>
                  {formatSigned(r.points)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
