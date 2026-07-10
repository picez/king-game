import { useI18n } from '../../i18n';
import type { PreferansState } from '../../games/preferans/types';
import WinnerCelebration from '../components/WinnerCelebration';

interface Props {
  state: PreferansState;
  /** The human's seat (always 0 in the local game). */
  humanSeat: number;
  onPlayAgain: () => void;
  onExit: () => void;
}

/** End screen: did the human reach the target first (a draw is possible, §11). */
export default function PreferansFinished({ state, humanSeat, onPlayAgain, onExit }: Props) {
  const { t } = useI18n();
  const isDraw = state.winnerSeat == null;
  const humanWon = state.winnerSeat === humanSeat;
  const winnerName = state.winnerSeat != null
    ? state.winnerSeat === humanSeat ? t('preferans.you') : state.players[state.winnerSeat].name
    : null;

  const title = isDraw ? t('preferans.draw') : humanWon ? t('preferans.youWon') : t('preferans.youLost');
  const emoji = isDraw ? '🤝' : humanWon ? '🏆' : '🙁';

  return (
    <div className="screen preferans-screen preferans-finished">
      <div className="preferans-finished__card finish-frame">
        <WinnerCelebration kind={humanWon ? 'win' : 'loss'} />
        <div className="preferans-finished__emoji" aria-hidden="true">{emoji}</div>
        <h1 className="preferans-finished__title">{title}</h1>
        {winnerName && !humanWon && (
          <p className="preferans-finished__sub">{t('preferans.winnerIs').replace('{name}', winnerName)}</p>
        )}
        <div className="preferans-finished__scores">
          {state.players.map((p) => {
            const win = state.winnerSeat === p.seatIndex;
            return (
              <div key={p.id} className={`preferans-finished__score ${win ? 'preferans-finished__score--win' : ''}`}>
                <span className="preferans-finished__score-label">
                  {p.seatIndex === humanSeat ? t('preferans.you') : p.name}
                </span>
                <span className="preferans-finished__score-value">{state.scores[p.seatIndex]}</span>
              </div>
            );
          })}
        </div>
        <div className="preferans-finished__actions">
          <button type="button" className="btn btn--primary" onClick={onPlayAgain}>
            {t('preferans.playAgain')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            {t('btn.backToMenu')}
          </button>
        </div>
      </div>
    </div>
  );
}
