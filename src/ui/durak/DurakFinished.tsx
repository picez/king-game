import { useI18n } from '../../i18n';
import type { DurakState } from '../../games/durak/types';
import WinnerCelebration from '../components/WinnerCelebration';

interface Props {
  state: DurakState;
  humanId: string;
  onPlayAgain: () => void;
  onExit: () => void;
}

/** End screen: did the human win / lose (become the fool) / draw. */
export default function DurakFinished({ state, humanId, onPlayAgain, onExit }: Props) {
  const { t } = useI18n();
  const humanIsFool = state.foolId === humanId;
  const title = state.isDraw ? t('durak.draw') : humanIsFool ? t('durak.youLost') : t('durak.youWon');
  const fool = state.players.find((p) => p.id === state.foolId);

  return (
    <div className="screen durak-screen durak-finished">
      <div className="durak-finished__card finish-frame">
        {/* Celebrate the survivor; the fool / a draw render the calm state. */}
        <WinnerCelebration kind={state.isDraw ? 'draw' : humanIsFool ? 'fool' : 'win'} />
        <div className="durak-finished__emoji" aria-hidden="true">{state.isDraw ? '🤝' : humanIsFool ? '🤡' : '🏆'}</div>
        <h1 className="durak-finished__title">{title}</h1>
        {!state.isDraw && fool && (
          <p className="durak-finished__sub">
            {t('durak.fool')}: <strong>{fool.name}</strong>
            {fool.hand.length > 0 && <span className="durak-finished__left"> · {fool.hand.length} {t('durak.cardsRemaining')}</span>}
          </p>
        )}
        <div className="durak-finished__actions">
          <button type="button" className="btn btn--primary" onClick={onPlayAgain}>{t('durak.playAgain')}</button>
          <button type="button" className="btn btn--ghost" onClick={onExit}>{t('btn.backToMenu')}</button>
        </div>
      </div>
    </div>
  );
}
