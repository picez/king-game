import { useI18n } from '../../i18n';
import { type TarneebStats, type Loadable, formatLastPlayed, formatSigned } from '../../net/statsApi';

interface Props {
  /** null while the first request is in flight. */
  result: Loadable<TarneebStats> | null;
  loading: boolean;
}

/**
 * Presentational "My Tarneeb stats" view (TARNEEB-STATS-3). Tarneeb is a 2v2
 * partnership, bid-and-trump game scored to a target — the recorded outcome is
 * win/loss plus contract success and the team's cumulative score. Same soft
 * empty/auth/unavailable/error states as the King/Durak/Deberc panels, so it
 * never blocks; guests with a session see stats too. Score-level only (no cards).
 */
export default function TarneebStatsPanel({ result, loading }: Props) {
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
  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: t('stats.gamesPlayed'), value: String(s.gamesPlayed) },
    { label: t('stats.winRate'), value: s.winRate == null ? '—' : `${s.winRate}%`, sub: `${s.gamesWon}–${s.gamesLost}` },
    {
      label: t('stats.contractRate'),
      value: s.contractSuccessRate == null ? '—' : `${s.contractSuccessRate}%`,
      sub: `${s.contractsMade}–${s.contractsFailed}`,
    },
    { label: t('stats.declarerHands'), value: String(s.handsAsDeclarer), sub: `${t('stats.handsPlayed')}: ${s.handsPlayed}` },
    {
      label: t('stats.avgScore'),
      value: formatSigned(s.averageTeamScore),
      sub: `${formatSigned(s.bestGameScore)} / ${formatSigned(s.worstGameScore)}`,
    },
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
    </div>
  );
}
