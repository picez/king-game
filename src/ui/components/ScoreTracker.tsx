import { useI18n } from '../../i18n';
import type { GameState } from '../../models/types';
import { buildScoreTracker, TRACKER_COLUMNS } from '../../core/scoreTracker';

interface Props {
  state: GameState;
  /** Show every dealer's section (default), or only dealers who have played. */
  onlyPlayed?: boolean;
}

/**
 * Per-dealer score-tracker board (KING_RULES.md → Score Tracker). One section
 * per dealer with the 9 columns of that dealer's games; rows are ALL players;
 * each cell is that player's own score in the round the dealer chose that mode
 * ("—" if not played, last round highlighted). A grand-total strip sums every
 * round per player. Scrolls horizontally on mobile; uses only public scores.
 */
export default function ScoreTracker({ state, onlyPlayed = false }: Props) {
  const { t } = useI18n();
  const { sections, grandTotals, lastRoundNumber } = buildScoreTracker(state);
  const shown = onlyPlayed ? sections.filter((s) => s.hasPlayed) : sections;

  const colLabel = (c: typeof TRACKER_COLUMNS[number]) =>
    c.trumpNo ? `${t('track.trump')} ${c.trumpNo}` : t(c.labelKey);

  return (
    <div className="score-tracker">
      {shown.map((section) => (
        <div key={section.dealerId} className="score-tracker__section">
          <div className="score-tracker__dealer">
            <span className="dealer-crown" title="Dealer">👑</span>
            {t('common.dealer')}: <strong>{section.dealerName}</strong>
          </div>
          <div className="score-tracker__scroll">
            <table className="score-tracker__table">
              <thead>
                <tr>
                  <th className="score-tracker__corner">{t('scoring.player')}</th>
                  {TRACKER_COLUMNS.map((c) => (
                    <th key={c.id} className="score-tracker__col">{colLabel(c)}</th>
                  ))}
                  <th className="score-tracker__total-h">{t('track.subtotal')}</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.playerId}>
                    <th scope="row" className="score-tracker__name">{row.name}</th>
                    {row.cells.map((cell) => {
                      const played = cell.score !== null;
                      const isLast = played && cell.roundNumber === lastRoundNumber;
                      const cls = !played
                        ? 'score-tracker__cell score-tracker__cell--empty'
                        : `score-tracker__cell ${cell.score! >= 0 ? 'score--positive' : 'score--negative'}` +
                          (isLast ? ' score-tracker__cell--last' : '');
                      return (
                        <td key={cell.column} className={cls}>
                          {played ? (cell.score! >= 0 ? `+${cell.score}` : cell.score) : '—'}
                        </td>
                      );
                    })}
                    <td className={`score-tracker__total ${row.subtotal >= 0 ? 'score--positive' : 'score--negative'}`}>
                      {row.subtotal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Grand totals across every dealer's rounds. */}
      <div className="score-tracker__grand">
        <h4 className="score-tracker__grand-title">{t('track.total')}</h4>
        <ul className="score-tracker__grand-list">
          {grandTotals.map((g) => (
            <li key={g.playerId}>
              <span>{g.name}</span>
              <strong className={g.total >= 0 ? 'score--positive' : 'score--negative'}>{g.total}</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
