import { useI18n } from '../../i18n';
import type { GameState } from '../../models/types';
import { buildScoreTracker, TRACKER_COLUMNS } from '../../core/scoreTracker';

interface Props {
  state: GameState;
}

/**
 * Per-dealer score-tracker table (KING_RULES.md → Score Tracker). Rows are
 * players; columns are the 9 games of that player's dealing set plus Total. The
 * cell shows the dealer's own score for that game ("—" if not played yet); the
 * most recent round is highlighted. Scrolls horizontally on mobile and uses
 * only public score data (no hands/cards). Works for 3- and 4-player tables.
 */
export default function ScoreTracker({ state }: Props) {
  const { t } = useI18n();
  const { rows, lastRoundNumber } = buildScoreTracker(state);

  return (
    <div className="score-tracker">
      <div className="score-tracker__scroll">
        <table className="score-tracker__table">
          <thead>
            <tr>
              <th className="score-tracker__corner">{t('scoring.player')}</th>
              {TRACKER_COLUMNS.map((c) => (
                <th key={c.id} className="score-tracker__col">
                  {c.trumpNo ? `${t('track.trump')} ${c.trumpNo}` : t(c.labelKey)}
                </th>
              ))}
              <th className="score-tracker__total-h">{t('track.total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
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
                <td className={`score-tracker__total ${row.total >= 0 ? 'score--positive' : 'score--negative'}`}>
                  {row.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
