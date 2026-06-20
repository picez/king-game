import { useI18n } from '../../i18n';
import type { GameState } from '../../models/types';
import { buildScoreTracker } from '../../core/scoreTracker';

interface Props {
  state: GameState;
}

/**
 * One compact score table (KING_RULES.md → Score Tracker). Rows = players;
 * columns = the 9 game slots + Total. A cell lists this row-player's score in
 * each dealer's round of that game, tagged with the dealer's marker (①..④ — see
 * the legend). A small dot marks games the row-player has dealt. Scrolls
 * horizontally on mobile; uses only public scores.
 */
export default function ScoreTracker({ state }: Props) {
  const { t } = useI18n();
  const { legend, rows, columns } = buildScoreTracker(state);

  const colLabel = (c: typeof columns[number]) =>
    c.trumpNo ? `${t('track.trump')} ${c.trumpNo}` : t(c.labelKey);

  return (
    <div className="score-tracker">
      {/* Legend: marker → avatar + name */}
      <ul className="score-tracker__legend">
        {legend.map((l) => (
          <li key={l.playerId}>
            <span className="score-tracker__marker">{l.marker}</span>
            {l.avatar && <span className="member-avatar">{l.avatar}</span>}
            <span>{l.name}</span>
          </li>
        ))}
      </ul>

      <div className="score-tracker__scroll">
        <table className="score-tracker__table">
          <thead>
            <tr>
              <th className="score-tracker__corner">{t('scoring.player')}</th>
              {columns.map((c) => (
                <th key={c.id} className="score-tracker__col">{colLabel(c)}</th>
              ))}
              <th className="score-tracker__total-h">{t('track.total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.playerId}>
                <th scope="row" className="score-tracker__name">
                  <span className="score-tracker__marker">{row.marker}</span>
                  {row.avatar && <span className="member-avatar">{row.avatar}</span>}
                  {row.name}
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.column} className={`score-tracker__cell ${cell.isLast ? 'score-tracker__cell--last' : ''}`}>
                    {cell.playedByRow && <span className="score-tracker__dot" title={t('track.youDealt')} />}
                    {cell.entries.length === 0 ? (
                      <span className="score-tracker__cell--empty">—</span>
                    ) : (
                      cell.entries.map((e) => (
                        <span key={e.dealerId} className="score-tracker__entry">
                          <span className="score-tracker__entry-marker">{e.dealerMarker}</span>
                          <span className={e.score >= 0 ? 'score--positive' : 'score--negative'}>
                            {e.score >= 0 ? `+${e.score}` : e.score}
                          </span>
                        </span>
                      ))
                    )}
                  </td>
                ))}
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
