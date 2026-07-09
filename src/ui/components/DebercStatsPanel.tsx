import { useI18n } from '../../i18n';
import { type DebercStats, type Loadable, formatLastPlayed } from '../../net/statsApi';

interface Props {
  /** null while the first request is in flight. */
  result: Loadable<DebercStats> | null;
  loading: boolean;
}

/**
 * Presentational "My Deberc stats" view (DEBERC-STATS-3). Deberc is a team game
 * scored to a target — the recorded outcome is win/loss plus how many matches
 * were won by a деберц jackpot. Same soft empty/auth/unavailable/error states as
 * the King/Durak panels, so it never blocks; guests with a session see stats too.
 */
export default function DebercStatsPanel({ result, loading }: Props) {
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
    { label: t('stats.jackpots'), value: String(s.jackpotCount), sub: s.jackpotRate == null ? undefined : `${s.jackpotRate}%` },
  ];

  // Combination breakdown (Stage 13.8): count + frequency per meld kind. The
  // per-kind percentage is "% of scored hands" (count / handsPlayed).
  const c = s.combinations;
  const hands = c.handsPlayed;
  const ofHands = (n: number) => (hands > 0 ? `${Math.round((n / hands) * 100)}% ${t('stats.ofHands')}` : undefined);
  const combos: Array<{ label: string; count: number }> = [
    { label: t('deberc.meldTerz'), count: c.terz },
    { label: t('deberc.meldPlatina'), count: c.platina },
    { label: t('deberc.meldBella'), count: c.bella },
  ];
  const hasCombos = c.total > 0;

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

      <div className="stats-combos">
        <h4 className="stats-combos__title">{t('stats.combinations')}</h4>
        {!hasCombos ? (
          <p className="stats-msg stats-msg--soft stats-combos__empty">{t('stats.noCombinations')}</p>
        ) : (
          <ul className="stats-combos__list">
            {combos.map((cb) => (
              <li className="stats-combos__row" key={cb.label}>
                <span className="stats-combos__label">{cb.label}</span>
                <span className="stats-combos__count">{cb.count}</span>
                {ofHands(cb.count) && <span className="stats-combos__freq">· {ofHands(cb.count)}</span>}
              </li>
            ))}
            {c.meldRate != null && (
              <li className="stats-combos__row stats-combos__row--total">
                <span className="stats-combos__label">{t('stats.handsWithMeld')}</span>
                <span className="stats-combos__count">{c.handsWithMeld}</span>
                <span className="stats-combos__freq">· {c.meldRate}% {t('stats.ofHands')}</span>
              </li>
            )}
          </ul>
        )}
      </div>

      {lastPlayed && (
        <p className="stats-lastgame">{t('stats.lastGame')}: <strong>{lastPlayed}</strong></p>
      )}
    </div>
  );
}
