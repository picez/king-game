import { useI18n } from '../../i18n';
import type { GameState } from '../../models/types';
import { buildScoreTracker } from '../../core/scoreTracker';
import { seatColor } from '../../core/avatars';

interface Props {
  state: GameState;
}

/**
 * One compact score table (KING_RULES.md → Score Tracker). Rows = players;
 * columns = the 9 game slots + Total. A cell lists this row-player's score in
 * each dealer's round of that game, tagged with the DEALER's avatar + seat
 * colour (see the legend). A small colour dot marks games the row-player has
 * dealt. Scrolls horizontally on mobile; uses only public scores.
 */
export default function ScoreTracker({ state }: Props) {
  const { t } = useI18n();
  const { legend, rows, columns } = buildScoreTracker(state);

  const colLabel = (c: typeof columns[number]) =>
    c.trumpNo ? `${t('track.trump')} ${c.trumpNo}` : t(c.labelKey);

  return (
    <div className="score-tracker">
      {/* Legend: avatar chip + colour + name */}
      <ul className="score-tracker__legend">
        {legend.map((l) => (
          <li key={l.playerId} style={{ borderColor: seatColor(l.seat) }}>
            <span className="st-chip" style={{ color: seatColor(l.seat), borderColor: seatColor(l.seat) }}>
              {l.avatar ?? '•'}
            </span>
            <span className="st-name" style={{ color: seatColor(l.seat) }}>{l.name}</span>
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
                <th
                  scope="row"
                  className="score-tracker__name"
                  style={{ boxShadow: `inset 3px 0 0 ${seatColor(row.seat)}` }}
                >
                  <span className="st-chip" style={{ color: seatColor(row.seat), borderColor: seatColor(row.seat) }}>
                    {row.avatar ?? '•'}
                  </span>
                  <span style={{ color: seatColor(row.seat) }}>{row.name}</span>
                </th>
                {row.cells.map((cell) => (
                  <td key={cell.column} className={`score-tracker__cell ${cell.isLast ? 'score-tracker__cell--last' : ''}`}>
                    {cell.playedByRow && (
                      <span
                        className="score-tracker__dot"
                        style={{ background: seatColor(row.seat) }}
                        title={t('track.youDealt')}
                        aria-label={t('track.youDealt')}
                      />
                    )}
                    {cell.entries.length === 0 ? (
                      <span className="score-tracker__cell--empty">—</span>
                    ) : (
                      <span className="score-tracker__entries">
                        {cell.entries.map((e) => (
                          <span key={e.dealerId} className="score-tracker__entry" title={e.dealerName}>
                            <span
                              className="st-chip st-chip--sm"
                              style={{ color: seatColor(e.dealerSeat), borderColor: seatColor(e.dealerSeat) }}
                              aria-label={e.dealerName}
                            >
                              {e.dealerAvatar ?? e.dealerMarker}
                            </span>
                            <span className={e.score >= 0 ? 'score--positive' : 'score--negative'}>
                              {e.score >= 0 ? `+${e.score}` : e.score}
                            </span>
                          </span>
                        ))}
                      </span>
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
