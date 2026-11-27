import { useI18n } from '../../i18n';
import { VARIANT_KEYS } from '../../solitaire/engine';
import { totals, type SolitaireStats } from '../../solitaire/stats';
import { formatClock, labelOf } from '../solitaire/format';

/**
 * "My solitaire stats" in Profile → Statistics. Solitaire stats live on this
 * device (localStorage, see src/solitaire/stats.ts): the totals, then one row per
 * variant that has been played — won/played, best streak, best time and fewest moves.
 */
export default function SolitaireStatsPanel({ stats }: { stats: SolitaireStats }) {
  const { t } = useI18n();
  const all = totals(stats);
  const rows = VARIANT_KEYS.filter((k) => (stats.variants[k]?.played ?? 0) > 0);

  if (all.played === 0) return <p className="stats-msg stats-msg--soft">{t('solStats.empty')}</p>;

  const cards: Array<{ label: string; value: string; sub?: string }> = [
    { label: t('stats.gamesPlayed'), value: String(all.played) },
    { label: t('stats.winRate'), value: `${Math.round((all.won / all.played) * 100)}%`, sub: `${all.won}–${all.played - all.won}` },
    { label: t('solStats.bestStreak'), value: String(all.bestStreak) },
    { label: t('solStats.variantsWon'), value: `${all.variantsWon}/${VARIANT_KEYS.length}` },
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
      <div className="sol-stats-wrap">
        <table className="sol-stats">
          <thead>
            <tr>
              <th>{t('solStats.col.game')}</th>
              <th>{t('solStats.col.won')}</th>
              <th>{t('solStats.bestStreak')}</th>
              <th>{t('solStats.col.time')}</th>
              <th>{t('solStats.col.moves')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => {
              const v = stats.variants[k]!;
              return (
                <tr key={k}>
                  <td>{labelOf(t, k)}</td>
                  <td>{v.won}/{v.played}</td>
                  <td>{v.bestStreak}</td>
                  <td>{v.bestMs !== null ? formatClock(v.bestMs) : '—'}</td>
                  <td>{v.bestMoves ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="stats-lastgame">{t('solStats.local')}</p>
    </div>
  );
}
