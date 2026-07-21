import { useI18n } from '../../i18n';
import type { PokerState } from '../../games/poker/types';

interface Props {
  state: PokerState;
  mySeat: number | null;
  onPlayAgain?: () => void;
  onExit: () => void;
}

/** Match-over screen: the last player standing holds every chip (§11). */
export default function PokerFinished({ state, mySeat, onPlayAgain, onExit }: Props) {
  const { t } = useI18n();
  const winner = state.winnerSeat;
  const iWon = winner != null && winner === mySeat;
  const winnerName = winner != null ? state.players[winner]?.name ?? '' : '';

  return (
    <div className="screen poker-finished">
      <div className="finish-frame poker-finished__card">
        <h1 className="poker-finished__title">{iWon ? '🏆 ' + t('poker.youWin') : t('poker.matchOver')}</h1>
        <p className="poker-finished__winner">{t('poker.winnerIs').replace('{name}', winnerName)}</p>
        <ul className="poker-finished__stacks">
          {state.players.map((p) => (
            <li key={p.id} className={p.seatIndex === winner ? 'is-winner' : ''}>
              <span>{p.seatIndex === mySeat ? t('poker.you') : p.name}</span>
              <span>🪙 {state.stacksBySeat[p.seatIndex]}</span>
            </li>
          ))}
        </ul>
        <div className="poker-finished__actions">
          {onPlayAgain && <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('poker.playAgain')}</button>}
          <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
        </div>
      </div>
    </div>
  );
}
