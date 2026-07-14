import { useI18n } from '../../i18n';
import type { FiftyOneState } from '../../games/fiftyOne/types';

interface Props {
  state: FiftyOneState;
  humanSeat: number;
  onPlayAgain: () => void;
  onExit: () => void;
}

/** Match-over screen: the last seat standing wins (51_RULES §12). */
export default function FiftyOneFinished({ state, humanSeat, onPlayAgain, onExit }: Props) {
  const { t } = useI18n();
  const winner = state.winnerSeat;
  const name = winner === humanSeat ? t('fiftyOne.you') : (winner != null ? state.players[winner].name : '');
  const humanWon = winner === humanSeat;

  return (
    <div className="screen menu-screen fiftyone-finished">
      <header className="menu-header">
        <h1 className="menu-title">{humanWon ? '🏆' : '🏁'} {t('fiftyOne.matchWinner').replace('{name}', name)}</h1>
      </header>

      <div className="setup-card">
        <table className="fiftyone-roundover__table">
          <thead>
            <tr><th></th><th>{t('fiftyOne.total')}</th></tr>
          </thead>
          <tbody>
            {state.players.map((p) => (
              <tr key={p.id} className={state.eliminatedSeats[p.seatIndex] ? 'fiftyone-roundover__out' : ''}>
                <td>
                  {p.seatIndex === humanSeat ? t('fiftyOne.you') : p.name}
                  {p.seatIndex === winner && <span> 🏆</span>}
                  {state.eliminatedSeats[p.seatIndex] && <span> ☠</span>}
                </td>
                <td><strong>{state.scoresBySeat[p.seatIndex]}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>

        <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('fiftyOne.playAgain')}</button>
        <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
      </div>
    </div>
  );
}
