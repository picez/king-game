import { useI18n } from '../../i18n';
import { type FiftyOneStats, type Loadable, formatLastPlayed } from '../../net/statsApi';

interface Props {
  /** null while the first request is in flight. */
  result: Loadable<FiftyOneStats> | null;
  loading: boolean;
}

/**
 * Presentational "My 51 stats" view (FIFTYONE-STATS-3). 51 is a 2–4 player,
 * each-for-themselves cutthroat rummy scored by PENALTY (lower is better); the
 * recorded outcome is win/loss plus the player's penalty aggregates and how often
 * they were eliminated. Same soft empty/auth/unavailable/error states as the other
 * game panels, so it never blocks; guests with a session see stats too. Score-level
 * only (no cards). Experimental (Stage 30.6) — no achievements/favorite yet.
 */
export default function FiftyOneStatsPanel({ result, loading }: Props) {
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
  const record = `${s.gamesWon}–${s.gamesLost}`;
  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: t('stats.gamesPlayed'), value: String(s.gamesPlayed) },
    { label: t('stats.winRate'), value: s.winRate == null ? '—' : `${s.winRate}%`, sub: record },
    {
      label: t('stats.avgPenalty'),
      value: s.averagePenalty == null ? '—' : String(s.averagePenalty),
      sub: s.bestPenalty == null ? undefined : `${t('stats.bestPenaltyShort')}: ${s.bestPenalty}`,
    },
    { label: t('stats.eliminations'), value: String(s.timesEliminated), sub: `${t('stats.roundsPlayed')}: ${s.roundsPlayed}` },
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
