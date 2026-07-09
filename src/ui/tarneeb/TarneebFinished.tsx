import { useI18n } from '../../i18n';
import { teamOfSeat } from '../../games/tarneeb/rules';
import type { TarneebState } from '../../games/tarneeb/types';

interface Props {
  state: TarneebState;
  /** The human's seat (always 0 in the local game). */
  humanSeat: number;
  onPlayAgain: () => void;
  onExit: () => void;
}

/** End screen: did the human's team win the match (target 41 reached). */
export default function TarneebFinished({ state, humanSeat, onPlayAgain, onExit }: Props) {
  const { t } = useI18n();
  const myTeam = teamOfSeat(humanSeat);
  const humanWon = state.winnerTeam === myTeam;
  const title = humanWon ? t('tarneeb.youWon') : t('tarneeb.youLost');

  return (
    <div className="screen tarneeb-screen tarneeb-finished">
      <div className="tarneeb-finished__card finish-frame">
        <div className="tarneeb-finished__emoji" aria-hidden="true">{humanWon ? '🏆' : '🙁'}</div>
        <h1 className="tarneeb-finished__title">{title}</h1>
        <p className="tarneeb-finished__sub">
          {state.winnerTeam && t('tarneeb.teamWon').replace('{team}', state.winnerTeam)}
        </p>
        <div className="tarneeb-finished__scores">
          <div className={`tarneeb-finished__score ${humanWon ? 'tarneeb-finished__score--win' : ''}`}>
            <span className="tarneeb-finished__score-label">{t('tarneeb.teamUs')}</span>
            <span className="tarneeb-finished__score-value">{state.scoresByTeam[myTeam]}</span>
          </div>
          <div className={`tarneeb-finished__score ${!humanWon ? 'tarneeb-finished__score--win' : ''}`}>
            <span className="tarneeb-finished__score-label">{t('tarneeb.teamThem')}</span>
            <span className="tarneeb-finished__score-value">{state.scoresByTeam[myTeam === 'A' ? 'B' : 'A']}</span>
          </div>
        </div>
        <div className="tarneeb-finished__actions">
          <button type="button" className="btn btn--primary" onClick={onPlayAgain}>
            {t('tarneeb.playAgain')}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            {t('btn.backToMenu')}
          </button>
        </div>
      </div>
    </div>
  );
}
