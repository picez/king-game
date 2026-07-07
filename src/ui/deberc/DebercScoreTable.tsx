import { useI18n } from '../../i18n';
import { useEscToClose } from '../../hooks/useEscToClose';
import type { DebercState } from '../../games/deberc/types';

const TARGET = { small: 510, big: 1020 } as const;

/** Display name(s) for each team (3p: one player; 4p: the two partners). */
function teamNames(state: DebercState): string[] {
  const names: string[] = [];
  for (let team = 0; team < state.teamCount; team++) {
    names.push(
      state.players.filter((p) => state.teamOf[p.seatIndex] === team).map((p) => p.name).join(' & '),
    );
  }
  return names;
}

/**
 * The per-hand score sheet body (reused in a modal and on the Finished screen).
 * One row per scored hand: the об'яз (with ХВ/бейт flags) and each team's hand
 * total with a card/meld/penalty breakdown; a bold TOTAL row = the authoritative
 * running match score (which also folds in the −100 pair-ledger deductions).
 */
export function DebercScoreSheet({ state }: { state: DebercState }) {
  const { t } = useI18n();
  const teams = teamNames(state);
  const target = TARGET[state.matchSize];
  const cols = 2 + teams.length;

  return (
    <div className="deberc-sheet__wrap">
      <table className="deberc-sheet">
        <thead>
          <tr>
            <th className="deberc-sheet__num">#</th>
            <th>{t('deberc.objaz')}</th>
            {teams.map((name, team) => (
              <th key={team} className={team === state.winnerTeam ? 'deberc-sheet__win' : ''}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.handHistory.length === 0 && (
            <tr><td colSpan={cols} className="deberc-sheet__empty">{t('deberc.noHands')}</td></tr>
          )}
          {state.handHistory.map((h, i) => (
            <tr key={i}>
              <td className="deberc-sheet__num">{i + 1}</td>
              <td>
                {state.players[h.objazSeat]?.name}
                {h.hvTeam != null && <span className="deberc-sheet__flag deberc-sheet__flag--hv"> {t('deberc.hv')}</span>}
                {h.beitTeams.length > 0 && <span className="deberc-sheet__flag deberc-sheet__flag--beit"> {t('deberc.beit')}</span>}
              </td>
              {teams.map((_, team) => (
                <td key={team} className={h.topScorerTeam === team ? 'deberc-sheet__top' : ''}>
                  <strong>{h.teamPoints[team]}</strong>
                  <span className="deberc-sheet__break">
                    {h.cardPoints[team]}
                    {h.meldPoints[team] ? ` +${h.meldPoints[team]}` : ''}
                    {h.penaltyPoints[team] ? ` −${h.penaltyPoints[team]}` : ''}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="deberc-sheet__totalrow">
            <td colSpan={2}>{t('deberc.total')}</td>
            {teams.map((_, team) => (
              <td key={team} className={team === state.winnerTeam ? 'deberc-sheet__win' : ''}>
                <strong>{state.matchScore[team]}</strong>
              </td>
            ))}
          </tr>
          <tr className="deberc-sheet__marksrow">
            <td colSpan={2}>{t('deberc.hv')} · {t('deberc.beit')}</td>
            {teams.map((_, team) => (
              <td key={team}>{state.hvMarks[team] ?? 0} · {state.beitMarks[team] ?? 0}</td>
            ))}
          </tr>
        </tfoot>
      </table>
      <p className="deberc-sheet__target">{t('deberc.target')}: <strong>{target}</strong></p>
    </div>
  );
}

/** In-game score-sheet modal (📊). */
export default function DebercScoreTable({ state, onClose }: { state: DebercState; onClose: () => void }) {
  const { t } = useI18n();
  useEscToClose(onClose);
  return (
    <div className="durak-help-overlay" role="dialog" aria-modal="true" aria-label={t('deberc.scoreTable')} onClick={onClose}>
      <div className="durak-help deberc-sheet-modal" onClick={(e) => e.stopPropagation()}>
        <div className="durak-help__head">
          <h2 className="durak-help__title">📊 {t('deberc.scoreTable')}</h2>
          <button type="button" className="btn btn--ghost durak-help__x" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <DebercScoreSheet state={state} />
        <button type="button" className="btn btn--primary durak-help__ok" onClick={onClose} autoFocus>{t('deberc.gotIt')}</button>
      </div>
    </div>
  );
}
