import { useI18n } from '../../i18n';
import type { DebercState } from '../../games/deberc/types';

interface Props {
  state: DebercState;
  humanId: string;
  onPlayAgain: () => void;
  onExit: () => void;
}

/** End screen: did the human's team win the match (target reached or деберц jackpot). */
export default function DebercFinished({ state, humanId, onPlayAgain, onExit }: Props) {
  const { t } = useI18n();
  const me = state.players.find((p) => p.id === humanId);
  const myTeam = me ? state.teamOf[me.seatIndex] : 0;
  const won = state.winnerTeam === myTeam;
  const title = won ? t('deberc.youWon') : t('deberc.youLost');
  const teamName = (team: number) =>
    state.players.filter((p) => state.teamOf[p.seatIndex] === team).map((p) => p.name).join(' & ');

  return (
    <div className="screen durak-screen durak-finished">
      <div className="durak-finished__card">
        <div className="durak-finished__emoji" aria-hidden="true">{won ? '🏆' : '🙃'}</div>
        <h1 className="durak-finished__title">{title}</h1>
        {state.jackpot && <p className="durak-finished__sub">🎴 {t('deberc.jackpot')}</p>}
        <ul className="deberc-final-scores">
          {state.matchScore.map((sc, team) => (
            <li key={team} className={team === state.winnerTeam ? 'deberc-final--win' : ''}>
              <strong>{teamName(team)}</strong>: {sc}
            </li>
          ))}
        </ul>
        <div className="durak-finished__actions">
          <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('deberc.playAgain')}</button>
          <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
        </div>
      </div>
    </div>
  );
}
