import { useI18n } from '../../i18n';
import { type PokerStats, type Loadable, formatLastPlayed } from '../../net/statsApi';

interface Props {
  /** null while the first request is in flight. */
  result: Loadable<PokerStats> | null;
  loading: boolean;
}

/**
 * Presentational "My poker stats" view (POKER-STATS-3). No-Limit Texas Hold'em is a
 * 2–6 player, each-for-themselves chip game; the recorded outcome is win/loss plus
 * public counters (hands/showdowns/pots won, biggest pot, all-in wins, royal
 * flushes). Same soft empty/auth/unavailable/error states as the other game panels,
 * so it never blocks; guests with a session see stats too. Score-level only (no
 * cards). Released game (Stage 37.4) — feeds achievements + favorite.
 */
export default function PokerStatsPanel({ result, loading }: Props) {
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
    { label: t('poker.stats.handsWon'), value: String(s.handsWon), sub: `${t('poker.stats.handsPlayed')}: ${s.handsPlayed}` },
    { label: t('poker.stats.biggestPot'), value: String(s.biggestPot), sub: `${t('poker.stats.showdownsWon')}: ${s.showdownsWon}` },
    { label: t('poker.stats.allInsWon'), value: String(s.allInsWon), sub: `${t('poker.stats.potsWon')}: ${s.potsWon}` },
    { label: t('poker.stats.royalFlushes'), value: String(s.royalFlushCount) },
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
