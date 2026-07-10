import { useI18n } from '../../i18n';
import { type PreferansStats, type Loadable, formatLastPlayed, formatSigned } from '../../net/statsApi';

interface Props {
  /** null while the first request is in flight. */
  result: Loadable<PreferansStats> | null;
  loading: boolean;
}

/**
 * Presentational "My Preferans stats" view (PREFERANS-STATS-3). Preferans is a
 * 3-player, each-for-themselves contract game scored to a target — the recorded
 * outcome is win/loss/draw plus contract success and the player's cumulative
 * score. Same soft empty/auth/unavailable/error states as the King/Durak/Deberc/
 * Tarneeb panels, so it never blocks; guests with a session see stats too.
 * Score-level only (no cards). Experimental (Stage 19.6).
 */
export default function PreferansStatsPanel({ result, loading }: Props) {
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
  // Record sub: W–L, plus a draw count only when there are any.
  const record = `${s.gamesWon}–${s.gamesLost}${s.gamesDrawn > 0 ? ` · ${s.gamesDrawn}=` : ''}`;
  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: t('stats.gamesPlayed'), value: String(s.gamesPlayed) },
    { label: t('stats.winRate'), value: s.winRate == null ? '—' : `${s.winRate}%`, sub: record },
    {
      label: t('stats.contractRate'),
      value: s.contractSuccessRate == null ? '—' : `${s.contractSuccessRate}%`,
      sub: `${s.contractsMade}–${s.contractsFailed}`,
    },
    { label: t('stats.declarerHands'), value: String(s.handsAsDeclarer), sub: `${t('stats.handsPlayed')}: ${s.handsPlayed}` },
    {
      label: t('stats.avgScore'),
      value: formatSigned(s.averageScore),
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
